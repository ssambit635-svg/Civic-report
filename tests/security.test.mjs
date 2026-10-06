/* ============================================================
   Security and behaviour tests.

   Run with:  npm test        (node --test, no test framework needed)

   These cover the claims made in SECURITY.md rather than the
   visual layer: input validation, the static path allow-list,
   response headers, the origin gate and the rate limiter.
   ============================================================ */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/* A syntactically plausible stand-in so the AI routes are exercised. It is
   never sent anywhere: every AI request in this file fails validation or is
   rate limited before an upstream call is made, and no network is required. */
process.env.GEMINI_API_KEY = `AIza${"TEST".repeat(9)}`;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  server,
  validateAnalysis,
  validateInsights,
  normalizeSummary,
  decodeImage,
  safeStaticPath,
  redact,
  cleanText,
} = await import("../server.js");

let baseUrl = "";

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (route, body, headers = {}) =>
  fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("static file serving", () => {
  it("serves the app with hardening headers", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);

    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);

    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.ok(response.headers.get("permissions-policy"));
  });

  it("refuses traversal, dotfiles and server-side source", async () => {
    for (const route of [
      "/../../etc/passwd",
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/.env",
      "/.env.example",
      "/.git/config",
      "/server.js",
      "/package.json",
      "/tools/scan-secrets.mjs",
      "/node_modules/left-pad/index.js",
    ]) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 404, `${route} should not be served`);
    }
  });

  it("rejects non-GET methods on static paths", async () => {
    const response = await fetch(`${baseUrl}/`, { method: "DELETE" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  });

  it("answers 404 for unknown API routes", async () => {
    const response = await fetch(`${baseUrl}/api/nope`);
    assert.equal(response.status, 404);
  });
});

describe("health endpoint", () => {
  it("reports capability without leaking the key", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.ai, true);
    assert.equal(body.model, "gemini-2.5-flash");
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /AIza/);
    assert.doesNotMatch(text, /TESTTEST/);
  });

  it("rejects POST", async () => {
    assert.equal((await post("/api/health", {})).status, 405);
  });
});

describe("origin gate", () => {
  it("blocks a cross-origin caller", async () => {
    const response = await post("/api/analyze", {}, { origin: "https://evil.example" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "cross_origin_blocked");
  });

  it("blocks a cross-site fetch metadata hint", async () => {
    const response = await post("/api/analyze", {}, { "sec-fetch-site": "cross-site" });
    assert.equal(response.status, 403);
  });

  it("allows a same-origin caller", async () => {
    /* Reaches validation rather than the gate, so it is not a 403. */
    const response = await post("/api/analyze", {}, { origin: baseUrl });
    assert.equal(response.status, 400);
  });
});

describe("request body handling", () => {
  it("requires JSON content type", async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    assert.equal(response.status, 415);
  });

  it("rejects oversized bodies", async () => {
    const response = await post("/api/analyze", `{"image":{"data":"${"A".repeat(4_500_000)}"}}`);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "payload_too_large");
  });

  it("rejects malformed JSON", async () => {
    const response = await post("/api/analyze", "{not json");
    assert.equal(response.status, 400);
  });
});

describe("image intake", () => {
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");

  it("accepts a real JPEG signature", () => {
    const result = decodeImage(b64([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]));
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("accepts a real PNG signature", () => {
    const result = decodeImage(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    assert.equal(result.mimeType, "image/png");
  });

  it("rejects HTML and SVG dressed up as an image", () => {
    assert.equal(decodeImage(b64(Buffer.from("<html><script>alert(1)</script>"))).error, "image_unsupported_type");
    assert.equal(decodeImage(b64(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'>"))).error, "image_unsupported_type");
  });

  it("rejects empty, oversized and non-base64 payloads", () => {
    assert.equal(decodeImage("").error, "image_required");
    assert.equal(decodeImage(undefined).error, "image_required");
    assert.equal(decodeImage("!!!not base64!!!").error, "image_not_base64");
    assert.equal(decodeImage("A".repeat(3_600_000)).error, "image_too_large");
  });

  it("reports the declared upload rules over the API", async () => {
    const response = await post("/api/analyze", { image: { mimeType: "image/jpeg", data: b64(Buffer.from("<html>")) } });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "image_unsupported_type");
  });
});

describe("model output validation", () => {
  it("rejects malformed analyses", () => {
    assert.equal(validateAnalysis(null), null);
    assert.equal(validateAnalysis({ issue: "only a title" }), null);
    assert.equal(validateAnalysis({ issue: "", description: "" }), null);
  });

  it("coerces unknown severities and categories to safe defaults", () => {
    const result = validateAnalysis({ issue: "Pothole", description: "Deep hole", severity: "APOCALYPTIC", category: "weapons" });
    assert.equal(result.severity, "Medium");
    assert.equal(result.category, "Other");
  });

  it("keeps markup as inert text and strips control characters", () => {
    const result = validateAnalysis({ issue: "<img src=x onerror=alert(1)>", description: "line\u0000break\u200Bhere" });
    assert.equal(result.issue, "<img src=x onerror=alert(1)>");
    assert.equal(result.description, "line break here");
  });

  it("caps tags at five", () => {
    assert.equal(validateAnalysis({ issue: "a", description: "b", tags: ["1", "2", "3", "4", "5", "6", "7", "8"] }).tags.length, 5);
  });

  it("caps insights at four and normalises tags", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ title: `t${index}`, text: "x" }));
    assert.equal(validateInsights({ insights: many }).insights.length, 4);
    assert.equal(validateInsights({ insights: [{ title: "t", text: "x", tag: "nonsense" }] }).insights[0].tag, "Warning");
    assert.equal(validateInsights({ insights: "not an array" }), null);
  });
});

describe("insight summary whitelist", () => {
  it("drops keys that are not categories or severities", () => {
    const summary = normalizeSummary({
      total: 9,
      byCategory: { "Road Damage": 2, "../../etc/passwd": 1, __proto__: 3, "Other": 1 },
      bySeverity: { High: 3, "<script>alert(1)</script>": 1 },
    });
    assert.deepEqual(summary.byCategory, { "Road Damage": 2, Other: 1 });
    assert.deepEqual(summary.bySeverity, { High: 3 });
  });

  it("clamps numbers into sane ranges", () => {
    assert.equal(normalizeSummary({ total: -5 }).total, 0);
    assert.equal(normalizeSummary({ total: 99_999_999 }).total, 100_000);
    assert.equal(normalizeSummary({ total: 2, resolved: 99 }).resolved, 2);
    assert.equal(normalizeSummary(null).total, 0);
  });

  it("refuses insights for an empty dataset", async () => {
    const response = await post("/api/insights", { summary: { total: 0 } });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "no_data");
  });
});

describe("path allow-list", () => {
  it("accepts real assets", () => {
    assert.equal(safeStaticPath("/")?.extension, ".html");
    assert.equal(safeStaticPath("/style.css")?.extension, ".css");
    assert.equal(safeStaticPath("/app.js")?.extension, ".js");
    assert.equal(safeStaticPath("/docs/media/demo-recording.mp4")?.extension, ".mp4");
  });

  it("refuses everything else", () => {
    for (const route of ["/../../etc/passwd", "/%2e%2e%2fetc", "/.env", "/server.js", "/tools/x.mjs", "/README.md", "/package.json", "/vendor/assets.lock.json", ""]) {
      assert.equal(safeStaticPath(route), null, `${route} should be refused`);
    }
  });
});

describe("log hygiene", () => {
  it("redacts key-shaped strings", () => {
    /* Assembled at runtime so this test file contains no literal that a
       credential scanner, including our own, would have to special-case. */
    const fixture = ["AIza", "SyABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "6789"].join("");
    const line = redact(`failed with key ${fixture} and ?key=abc123&x=1`);
    assert.doesNotMatch(line, /AIzaSy/);
    assert.match(line, /\[redacted/);
  });

  it("keeps text on one line and within bounds", () => {
    assert.equal(cleanText("a\u200Bb\u2028c", 100), "a b c");
    assert.equal(cleanText("abcdef", 3), "abc");
  });
});

describe("rate limiting", () => {
  /* Runs last: it deliberately exhausts this client's bucket. Every request
     is rejected on validation before any upstream call, so this stays offline. */
  it("returns 429 with Retry-After once the window is spent", async () => {
    let limited = null;
    for (let attempt = 0; attempt < 40 && !limited; attempt += 1) {
      const response = await post("/api/analyze", { image: { data: "" } });
      if (response.status === 429) limited = response;
    }
    assert.ok(limited, "expected the limiter to engage");
    assert.equal((await limited.json()).error, "rate_limited");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
});

describe("server with no key configured", () => {
  it("disables AI and says so, without a key in the response", async () => {
    const child = execFile(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, PORT: "0", GEMINI_API_KEY: "" },
    });

    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not report a port in time")), 10_000);
      child.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/"url":"http:\/\/[^:]+:(\d+)"/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early with code ${code}`));
      });
    });

    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      assert.equal(health.ok, true);
      assert.equal(health.ai, false);
      assert.equal(health.model, null);

      const response = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: { data: "" } }),
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error, "ai_unavailable");
      assert.doesNotMatch(JSON.stringify(body), /AIza/);
    } finally {
      child.kill("SIGTERM");
    }
  });
});
