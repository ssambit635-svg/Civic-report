#!/usr/bin/env node
/* ============================================================
   Credential scanner for this repository.

   Checks three things:
     1. files tracked by git for credential-shaped strings
     2. untracked, not-ignored files for the same patterns
     3. optionally the whole git history (--history)

   It also fails if a secret-bearing file is tracked at all, even when
   the value happens to be empty, and warns when .env exists on disk
   without being ignored.

   Usage:
     npm run scan              working tree
     npm run scan:history      working tree plus every commit

   Exit code is 0 when clean and 1 when anything is found, so it can be
   wired straight into a pre-commit hook or CI.
   ============================================================ */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanHistory = process.argv.includes("--history");

const MAX_FILE_BYTES = 2_000_000;
const SKIP_PATHS = ["tools/scan-secrets.mjs", "vendor/", "package-lock.json"];

/* Patterns are deliberately specific: a scanner that cries wolf gets ignored. */
const PATTERNS = [
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "Google OAuth secret", re: /GOCSPX-[0-9A-Za-z_-]{28,}/g },
  { name: "Google API key in a URL", re: /[?&]key=AIza[0-9A-Za-z_-]{10,}/g },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "AWS secret access key", re: /aws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/gi },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "Stripe live key", re: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: "Hardcoded credential assignment", re: /\b(?:api[_-]?key|apikey|secret|passwd|password|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["'`][^"'`\n]{16,}["'`]/gi },
];

/* Shapes that are documentation, placeholders or already-handled config. */
const PLACEHOLDER = /(YOUR_|_HERE|<[^>]+>|example|placeholder|redacted|changeme|xxxx|process\.env|import\.meta|getenv|\.\.\.)/i;

const SENSITIVE_FILES = [
  /^\.env$/, /* the committed template, .env.example, is fine by design */
  /\.env\.(?!example$)/,
  /^config\.js$/,
  /\.(pem|key|p12|pfx)$/,
  /^service-account.*\.json$/,
  /(^|\/)credentials(\.json)?$/,
];

const findings = [];
const notes = [];

function report(kind, location, detail) {
  findings.push({ kind, location, detail });
}

function scanText(text, label) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length > 4000) continue;
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        const value = match[0];
        if (PLACEHOLDER.test(line)) continue;
        if (/AIza[0-9A-Za-z_-]{35}/.test(value) && /EXAMPLE|TEST|DUMMY/i.test(value)) continue;
        const redacted = value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : "[short]";
        report(name, `${label}:${index + 1}`, redacted);
      }
    }
  }
}

function isProbablyBinary(file) {
  const extension = path.extname(file).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".ico", ".woff", ".woff2", ".ttf", ".zip", ".gz", ".pdf"].includes(extension);
}

async function trackedFiles() {
  const { stdout } = await run("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean);
}

async function untrackedFiles() {
  const { stdout } = await run("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean);
}

function shouldSkip(file) {
  return SKIP_PATHS.some((entry) => file === entry || file.startsWith(entry));
}

async function scanWorkingTree() {
  const files = [...new Set([...(await trackedFiles()), ...(await untrackedFiles())])];

  for (const file of files) {
    if (shouldSkip(file)) continue;
    if (SENSITIVE_FILES.some((re) => re.test(file))) {
      report("Sensitive file tracked by git", file, "must not be committed");
      continue;
    }
    if (isProbablyBinary(file)) continue;

    const absolute = path.join(ROOT, file);
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).size > MAX_FILE_BYTES) {
      notes.push(`${file} skipped, larger than ${MAX_FILE_BYTES} bytes`);
      continue;
    }
    scanText(readFileSync(absolute, "utf8"), file);
  }

  if (existsSync(path.join(ROOT, ".env"))) {
    try {
      await run("git", ["check-ignore", "-q", ".env"], { cwd: ROOT });
      notes.push(".env exists on disk and is gitignored, which is correct");
    } catch {
      report("Unignored .env on disk", ".env", "git would commit this file");
    }
  }
  return files.length;
}

async function scanGitHistory() {
  let history;
  try {
    const result = await run("git", ["log", "-p", "--all", "--no-color", "--pretty=format:commit %H"], {
      cwd: ROOT,
      maxBuffer: 512 * 1024 * 1024,
    });
    history = result.stdout;
  } catch (error) {
    notes.push(`history scan skipped: ${error.message.split("\n")[0]}`);
    return;
  }

  let commit = "unknown";
  const lines = history.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("commit ")) {
      commit = line.slice(7, 19);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const body = line.slice(1);
    if (body.length > 4000) continue;
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(body)) !== null) {
        if (PLACEHOLDER.test(body)) continue;
        report(`${name} in history`, `commit ${commit}`, "rotate the credential and purge the commit");
      }
    }
  }
}

async function main() {
  console.log("CivicReport credential scan\n");

  const scanned = await scanWorkingTree();
  console.log(`Working tree: ${scanned} file(s) checked`);
  if (scanHistory) {
    console.log("History: scanning every commit, this can take a moment");
    await scanGitHistory();
  } else {
    console.log("History: skipped. Run npm run scan:history to include it");
  }

  for (const note of notes) console.log(`  note: ${note}`);

  if (!findings.length) {
    console.log("\nNo credentials found.");
    console.log("Reminder: the Gemini key belongs in .env only, never in app.js, index.html or config.js.");
    return;
  }

  console.log(`\n${findings.length} finding(s):\n`);
  for (const finding of findings) {
    console.log(`  ${finding.kind}`);
    console.log(`    at ${finding.location}`);
    console.log(`    value ${finding.detail}`);
  }
  console.log("\nIf a real credential was committed: revoke and rotate it first, then remove it from history.");
  process.exit(1);
}

main().catch((error) => {
  console.error(`scan-secrets failed: ${error.message}`);
  process.exit(1);
});
