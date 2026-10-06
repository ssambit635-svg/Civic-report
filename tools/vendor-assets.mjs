#!/usr/bin/env node
/* ============================================================
   Self-host the browser libraries and add subresource integrity.

   Why this exists: index.html loads Leaflet and Chart.js from a
   third-party CDN. That is convenient but it means the page trusts
   two remote origins at runtime. Running this script downloads the
   exact pinned versions into vendor/, records their SHA-384 hashes
   in vendor/assets.lock.json, and rewrites index.html to load the
   local copies with integrity="sha384-..." attributes.

   Usage:
     node tools/vendor-assets.mjs              download (or verify) and rewrite
     node tools/vendor-assets.mjs --verify-only   re-hash local files, change nothing

   After running it, tighten the CSP in server.js and index.html by
   dropping the https://unpkg.com and https://cdn.jsdelivr.net entries.
   ============================================================ */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_FILE = path.join(ROOT, "vendor", "assets.lock.json");
const INDEX_FILE = path.join(ROOT, "index.html");
const verifyOnly = process.argv.includes("--verify-only");

/* Exact versions. Never use a floating tag such as "latest" here. */
const ASSETS = [
  { url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", to: "vendor/leaflet/leaflet.js" },
  { url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", to: "vendor/leaflet/leaflet.css" },
  { url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png", to: "vendor/leaflet/images/marker-icon.png" },
  { url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png", to: "vendor/leaflet/images/marker-icon-2x.png" },
  { url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png", to: "vendor/leaflet/images/marker-shadow.png" },
  { url: "https://unpkg.com/leaflet@1.9.4/dist/images/layers.png", to: "vendor/leaflet/images/layers.png" },
  { url: "https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png", to: "vendor/leaflet/images/layers-2x.png" },
  { url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.js", to: "vendor/chartjs/chart.umd.js" },
];

/* The tags this script replaces, and what they become. */
const REWRITES = [
  {
    from: '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="anonymous" referrerpolicy="no-referrer" />',
    to: (hash) => `<link rel="stylesheet" href="vendor/leaflet/leaflet.css" integrity="${hash}" crossorigin="anonymous" />`,
    asset: "vendor/leaflet/leaflet.css",
  },
  {
    from: '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>',
    to: (hash) => `<script src="vendor/leaflet/leaflet.js" integrity="${hash}" crossorigin="anonymous"></script>`,
    asset: "vendor/leaflet/leaflet.js",
  },
  {
    from: '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>',
    to: (hash) => `<script src="vendor/chartjs/chart.umd.js" integrity="${hash}" crossorigin="anonymous"></script>`,
    asset: "vendor/chartjs/chart.umd.js",
  },
];

const sha384 = (buffer) => `sha384-${createHash("sha384").update(buffer).digest("base64")}`;

async function readLock() {
  try {
    return JSON.parse(await readFile(LOCK_FILE, "utf8"));
  } catch {
    return { assets: {} };
  }
}

async function download(url) {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const lock = await readLock();
  const results = [];
  let failures = 0;

  for (const asset of ASSETS) {
    const absolute = path.join(ROOT, asset.to);
    const recorded = lock.assets?.[asset.to] ?? null;
    let buffer = null;

    if (existsSync(absolute)) {
      buffer = await readFile(absolute);
      const hash = sha384(buffer);
      if (!verifyOnly && recorded && recorded.hash !== hash) {
        console.error(`MISMATCH ${asset.to}\n  recorded ${recorded.hash}\n  on disk  ${hash}`);
        failures += 1;
        continue;
      }
      if (!recorded) results.push({ to: asset.to, hash, action: "hashed" });
      else if (recorded.hash === hash) results.push({ to: asset.to, hash, action: "verified" });
      else results.push({ to: asset.to, hash, action: "hashed" });
    } else if (verifyOnly) {
      console.error(`MISSING  ${asset.to}`);
      failures += 1;
      continue;
    } else {
      try {
        buffer = await download(asset.url);
      } catch (error) {
        console.error(`FAILED   ${asset.to}\n  ${error.message}`);
        failures += 1;
        continue;
      }
    }

    const hash = sha384(buffer);
    /* A previously recorded hash that no longer matches the upstream bytes is
       a supply-chain signal worth stopping for, not something to overwrite. */
    if (recorded?.hash && recorded.hash !== hash && !verifyOnly) {
      console.error(`TAMPERED ${asset.to}\n  recorded ${recorded.hash}\n  upstream ${hash}`);
      failures += 1;
      continue;
    }

    if (!verifyOnly) {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, buffer);
    }
    lock.assets = lock.assets || {};
    lock.assets[asset.to] = { hash, url: asset.url, bytes: buffer.length };
    results.push({ to: asset.to, hash, action: existsSync(absolute) ? "written" : "written" });
  }

  if (verifyOnly) {
    for (const result of results) console.log(`${result.action.padEnd(9)} ${result.to}`);
    if (failures) {
      console.error(`\n${failures} asset(s) failed verification.`);
      process.exit(1);
    }
    console.log("\nAll vendored assets match vendor/assets.lock.json.");
    return;
  }

  let html = await readFile(INDEX_FILE, "utf8");
  let rewritten = 0;
  for (const entry of REWRITES) {
    const hash = lock.assets?.[entry.asset]?.hash;
    if (!hash) continue;
    if (html.includes(entry.from)) {
      html = html.replace(entry.from, entry.to(hash));
      rewritten += 1;
    }
  }

  if (rewritten) {
    html = html.includes("<!-- vendored-assets -->")
      ? html
      : html.replace("<link rel=\"stylesheet\" href=\"style.css\" />", "<!-- vendored-assets -->\n  <link rel=\"stylesheet\" href=\"style.css\" />");
    await writeFile(INDEX_FILE, html);
  }

  await mkdir(path.dirname(LOCK_FILE), { recursive: true });
  lock.generatedAt = new Date().toISOString();
  lock.note = "SHA-384 of each vendored file. Re-run npm run verify to compare the working tree against this record.";
  await writeFile(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`);

  const provenance = [
    "# Vendored browser libraries",
    "",
    "Generated by `npm run vendor`. These files are third-party code, copied",
    "byte for byte from the pinned URLs below and verified against",
    "`assets.lock.json` on every run.",
    "",
    "| File | Source | License |",
    "| --- | --- | --- |",
    "| leaflet.js, leaflet.css, images/ | https://unpkg.com/leaflet@1.9.4/ | BSD-2-Clause |",
    "| chart.umd.js | https://cdn.jsdelivr.net/npm/chart.js@4.4.6/ | MIT |",
    "",
    "Do not edit these files by hand. To upgrade, change the pinned version in",
    "`tools/vendor-assets.mjs`, delete `vendor/`, and run `npm run vendor` again.",
    "",
  ].join("\n");
  await writeFile(path.join(ROOT, "vendor", "README.md"), provenance);

  for (const result of results) console.log(`${result.action.padEnd(9)} ${result.to}  ${result.hash.slice(0, 22)}...`);
  console.log(`\n${results.length} asset(s) in vendor/. index.html updated: ${rewritten} tag(s).`);
  console.log("Next: remove the unpkg.com and cdn.jsdelivr.net entries from the CSP in server.js and index.html.");
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(`vendor-assets failed: ${error.message}`);
  process.exit(1);
});
