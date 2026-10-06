# Security policy

CivicReport is a small civic technology project. This document states what it
protects, what it does not, and how to report a problem.

## Reporting a vulnerability

Open a private report through GitHub's [security advisory](https://github.com/ssambit635-svg/Civic-report/security/advisories/new)
form. Please do not open a public issue for anything exploitable.

Include the affected file or endpoint, steps to reproduce, and what you would
expect to happen instead. A response should arrive within seven days. This is
a volunteer project with no bug bounty, and credit is offered in the advisory
unless you would rather stay anonymous.

Never include a live API key in a report. If you believe a key has leaked,
rotate it in Google AI Studio first, then tell us.

## The threat model in one paragraph

The application has no accounts, no cookies, no payments and no database. The
only valuable secret is the Gemini API key, and the only costly abuse is
somebody spending that key's quota. The realistic attacks are therefore: read
the key out of the shipped JavaScript, use the AI endpoint as a free proxy for
someone else's model calls, inject script through stored report text, and use a
crafted file path to read a file the server should not serve. Each of those has
a specific control below.

## Controls

### The API key never reaches the browser

Earlier versions of this project put the Gemini key in `config.js` and called
Google directly from `app.js`. Any visitor could read it from the network tab,
the page source or a downloaded copy of the repository.

The key now lives only in the server process environment, is read once at
startup, and is sent upstream in the `x-goog-api-key` header so it cannot appear
in URL logs, browser history or `Referer` headers. The browser talks only to
`/api/analyze` and `/api/insights` on the same origin.

`tools/scan-secrets.mjs` exists to keep it that way. It scans tracked and
untracked files, and with `--history` every commit, for Google, AWS, GitHub,
Slack, OpenAI and Stripe credential shapes plus private key blocks, and fails
the check with a non-zero exit code. `npm run scan` runs it.

### The AI endpoints are not an open proxy

- The prompt is built on the server. `/api/analyze` accepts an image and
  nothing else, so no client-supplied text reaches the model.
- `/api/insights` accepts aggregate counts only. Category and severity keys are
  matched against a whitelist and every value is clamped to a non-negative
  integer, so there is no free-text channel into the prompt.
- The image is sniffed by magic bytes (JPEG, PNG, WebP) and the detected type
  is what gets forwarded. A client-declared MIME type is never trusted.
- Requests must be same-origin: the `Origin` header must match the `Host`, and
  a cross-site `Sec-Fetch-Site` value is rejected with 403.
- Rate limiting defaults to 12 AI requests per client per 10 minutes, with a
  concurrency cap of 4 in flight, and answers 429 with `Retry-After`.
- Model replies are treated as untrusted input: they are parsed, checked
  against a fixed schema, stripped of control characters, length-clamped and
  re-serialised before the browser sees them.
- Upstream failures are logged with a status code and answered with a generic
  message. Response bodies and stack traces are never relayed to the client.

### Stored data is re-validated on read

Reports live in `localStorage`, which any script on the origin can write to, so
it is treated as hostile input. Every record is rebuilt through a whitelist:
categories, severities and statuses are matched against fixed lists, numbers
are clamped, coordinates must fall inside the Berhampur bounding box, and
images must match a strict `data:image/(jpeg|png|webp);base64,...` pattern
under a size ceiling. Anything that fails is dropped. Attachment data URLs
cannot be `text/html` or SVG, which closes the "stored image becomes script"
path.

### Untrusted text is rendered as text

Report text, model output and map popups are written with `textContent` and
built from DOM nodes. No user-controlled value is ever placed in `innerHTML`,
and there are no inline `onclick` attributes, so a report titled
`<img onerror=...>` renders as visible characters. This is why the strict CSP
can forbid inline script entirely.

### The server serves files it is willing to serve

Static paths are percent-decoded once, rejected if they contain a null byte,
rejected if any segment begins with a dot or matches `node_modules`, `tools`,
`.git`, `.github` or `.arena`, then resolved and confirmed to sit inside the
project root. Only allow-listed extensions are served, with the matching
content type and `nosniff`. There is no directory listing and no templating.

### Browser hardening

The server sends a Content Security Policy with no `unsafe-inline` and no
`unsafe-eval` for scripts, path-restricted script sources, `object-src 'none'`,
`frame-src 'none'`, `base-uri 'none'` and a configurable `frame-ancestors`,
plus `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`. A mirror of
the policy ships in `index.html` for deployments that cannot set headers.
`strict-transport-security` is opt-in, because sending it over plain HTTP is
pointless and can strand a host.

### Privacy is part of the security posture

Photos are downscaled and re-encoded in the browser before upload, which
discards EXIF data including GPS coordinates and device identifiers. There are
no analytics, no cookies, no third-party trackers and no fonts or scripts from
origins beyond the ones listed in the policy. Logs contain the request path,
status and duration, never query strings, and rate-limit events log a short
hash of the client address rather than the address itself.

### Dependencies

The server has zero runtime dependencies, so there is no npm supply chain to
compromise in production. The two browser libraries are pinned to exact
versions. `npm run vendor` downloads those exact versions, records their
SHA-384 hashes in `vendor/assets.lock.json`, fails if a recorded file changes
upstream, and rewrites `index.html` to load the local copies with
`integrity` attributes. `npm run verify` re-checks the working tree against the
lock file. See `vendor/README.md` after running it.

## Known limitations, stated plainly

- **There is no authentication and no shared backend.** Reports, votes and
  status changes live in one browser's storage. Anyone can edit their own copy,
  and the "community" figures are a demonstration, not a public record.
- **Both AI endpoints are unauthenticated.** They are rate limited and
  same-origin gated, which stops drive-by abuse, but a determined person on a
  rotating IP range can still consume the free quota. Put the app behind an
  authenticated reverse proxy before exposing it publicly at scale.
- **Rate limiting is in-process.** It resets on restart and is not shared
  between instances. A multi-instance deployment needs a shared store.
- **`style-src` allows inline styles** because Leaflet and Chart.js set style
  attributes at runtime. Script injection stays blocked; inline *style* is the
  one concession, and it is recorded here rather than hidden.
- **Map tiles and fonts come from third parties** (CARTO, OpenStreetMap, Google
  Fonts). Tile requests reveal the area being viewed to those providers. This
  is inherent to using a hosted tile layer. Self-hosting both removes it.
- **Photos are sent to Google** for classification when the AI features are
  used, under Google's API terms. The interface says so, and the feature is
  optional.

## Deployment checklist

1. Create the key in Google AI Studio and restrict it to the Generative
   Language API. Rotate it if it has ever been pasted into a file that shipped
   to a browser.
2. Put the key in `.env` (gitignored) or the platform's secret manager. Never
   in `app.js`, `index.html`, `config.js` or a Docker build argument.
3. Run `npm run scan:history` once on any repository that previously shipped a
   client-side key, and revoke anything it finds.
4. Terminate TLS in front of the server, then set `ENABLE_HSTS=1`.
5. Set `TRUST_PROXY=1` only when a reverse proxy you control is in front,
   otherwise clients can spoof `X-Forwarded-For` to dodge rate limits.
6. Keep `ALLOWED_FRAME_ANCESTORS='self'` unless the app must render inside a
   host page.
7. Run `npm run vendor` and commit `vendor/`, then remove the CDN entries from
   the CSP.
8. Run `npm run scan` in CI on every push.
