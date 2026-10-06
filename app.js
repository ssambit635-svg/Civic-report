/* ============================================================
   CivicReport - browser application
   No API key is present in this file, and none can be, because
   every model call goes through this project's own server
   (/api/analyze, /api/insights). See server.js and SECURITY.md.

   Rules kept in this file:
   1. Model output and stored data are untrusted input.
   2. Untrusted values are written with textContent, never innerHTML.
   3. Anything read back from localStorage is re-validated and clamped.
   4. Photos are validated by magic bytes, downscaled and re-encoded
      in the browser, which also drops EXIF metadata.
   ============================================================ */

"use strict";

/* ------------------------------------------------------------------
   Constants
------------------------------------------------------------------ */
const STORAGE_KEY = "civicreport.issues.v1";
const MAX_ISSUES = 120;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; /* upload ceiling before resize */
const MAX_STORED_IMAGE_CHARS = 420_000; /* ~315 KB binary, keeps localStorage healthy */
const MAX_IMAGE_EDGE = 1280;
const JPEG_QUALITY = 0.82;
const AI_TIMEOUT_MS = 45_000;

const CATEGORIES = [
  "Road Damage",
  "Water Leakage",
  "Streetlight",
  "Waste Management",
  "Public Infrastructure",
  "Other",
];
const SEVERITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES = ["Open", "In Progress", "Resolved"];
const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

/* Berhampur and its immediate surroundings. Anything outside is dropped
   rather than plotted somewhere misleading. */
const BBOX = { minLat: 18.9, maxLat: 19.7, minLng: 84.4, maxLng: 85.2 };
const CITY_CENTER = { lat: 19.3115, lng: 84.7952 };

const MAX_LENGTHS = { title: 120, description: 480, reporter: 60, location: 80, category: 40, severity: 16, status: 24, action: 320, tag: 32 };

const SVG_NS = "http://www.w3.org/2000/svg";

/* ------------------------------------------------------------------
   State
------------------------------------------------------------------ */
let issues = [];
let activeFilter = "all";
let pendingImage = null; /* { base64, dataUrl, mimeType } */
let map = null;
let markersLayer = null;
let aiEnabled = false;
let serverReachable = false;
let toastTimer = null;
let newIssueCounter = 0;

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------
   Sanitising helpers
------------------------------------------------------------------ */
/* Strip control and zero-width characters, collapse whitespace, cap length.
   Applied to every value that is stored, rendered or sent to the server. */
function clean(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function oneOf(value, allowed, fallback) {
  const found = allowed.find((entry) => entry.toLowerCase() === String(value ?? "").toLowerCase());
  return found ?? fallback;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 10_000) : 0;
}

function inBbox(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= BBOX.minLat && lat <= BBOX.maxLat &&
    lng >= BBOX.minLng && lng <= BBOX.maxLng
  );
}

/* Local images only: a strict data URL shape and a hard size ceiling.
   Blocks data:text/html payloads, SVG scripts and remote image callbacks. */
function sanitizeImage(value) {
  if (typeof value !== "string" || value.length > MAX_STORED_IMAGE_CHARS) return null;
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

/* ------------------------------------------------------------------
   DOM helpers
------------------------------------------------------------------ */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/* Icons are built from constant geometry, never from data. */
function svgIcon(viewBox, shapes, className) {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", viewBox);
  node.setAttribute("fill", "none");
  node.setAttribute("aria-hidden", "true");
  if (className) node.setAttribute("class", className);
  for (const shape of shapes) {
    const child = document.createElementNS(SVG_NS, shape.tag || "path");
    for (const [key, value] of Object.entries(shape.attrs)) child.setAttribute(key, value);
    node.append(child);
  }
  return node;
}

const ICONS = {
  pin: () => svgIcon("0 0 24 24", [
    { attrs: { d: "M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z", stroke: "currentColor", "stroke-width": "2" } },
    { attrs: { cx: "12", cy: "10", r: "2.5", stroke: "currentColor", "stroke-width": "2" } },
  ]),
  person: () => svgIcon("0 0 24 24", [
    { attrs: { cx: "12", cy: "8", r: "4", stroke: "currentColor", "stroke-width": "2" } },
    { attrs: { d: "M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" } },
  ]),
  upvote: () => svgIcon("0 0 24 24", [
    { attrs: { d: "M12 4l8 9h-5v7H9v-7H4l8-9z", stroke: "currentColor", "stroke-width": "2", "stroke-linejoin": "round" } },
  ]),
  check: () => svgIcon("0 0 24 24", [
    { attrs: { d: "M4 12.5l5 5L20 6.5", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round" } },
  ]),
  share: () => svgIcon("0 0 24 24", [
    { attrs: { cx: "6", cy: "12", r: "2.5", stroke: "currentColor", "stroke-width": "2" } },
    { attrs: { cx: "18", cy: "6", r: "2.5", stroke: "currentColor", "stroke-width": "2" } },
    { attrs: { cx: "18", cy: "18", r: "2.5", stroke: "currentColor", "stroke-width": "2" } },
    { attrs: { d: "M8.2 10.8l7.5-3.7M8.2 13.2l7.5 3.7", stroke: "currentColor", "stroke-width": "2" } },
  ]),
};

const CATEGORY_ICON = {
  "Road Damage": [{ attrs: { d: "M4 34c4-10 8-14 12-14s6 4 8 8 4 6 8 6 6-4 8-10", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round" } }],
  "Water Leakage": [{ attrs: { d: "M24 4C15 16 10 22 10 29a14 14 0 0 0 28 0c0-7-5-13-14-25z", stroke: "currentColor", "stroke-width": "3", "stroke-linejoin": "round" } }],
  "Streetlight": [
    { attrs: { cx: "24", cy: "14", r: "7", stroke: "currentColor", "stroke-width": "3" } },
    { attrs: { d: "M24 21v20M14 41h20", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round" } },
  ],
  "Waste Management": [{ attrs: { d: "M8 12h32M14 12l2-6h16l2 6M12 12l3 30h18l3-30", stroke: "currentColor", "stroke-width": "3", "stroke-linejoin": "round", "stroke-linecap": "round" } }],
  "Public Infrastructure": [{ attrs: { d: "M6 40h36M10 40V22l14-10 14 10v18M18 40V28h12v12", stroke: "currentColor", "stroke-width": "3", "stroke-linejoin": "round", "stroke-linecap": "round" } }],
  "Other": [
    { attrs: { cx: "24", cy: "24", r: "17", stroke: "currentColor", "stroke-width": "3" } },
    { attrs: { d: "M24 15v18M15 24h18", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round" } },
  ],
};

/* ------------------------------------------------------------------
   Storage: validate everything on the way in and out
------------------------------------------------------------------ */
function normalizeIssue(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = Number(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const title = clean(raw.title, MAX_LENGTHS.title);
  if (!title) return null;

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const timestamp = new Date(raw.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    id: Math.round(id),
    title,
    category: oneOf(raw.category, CATEGORIES, "Other"),
    description: clean(raw.description, MAX_LENGTHS.description),
    reporter: clean(raw.reporter, MAX_LENGTHS.reporter) || "Anonymous",
    location: clean(raw.location, MAX_LENGTHS.location) || "Berhampur",
    lat: inBbox(lat, lng) ? lat : null,
    lng: inBbox(lat, lng) ? lng : null,
    severity: oneOf(raw.severity, SEVERITIES, "Medium"),
    status: oneOf(raw.status, STATUSES, "Open"),
    upvotes: toCount(raw.upvotes),
    verifiedBy: toCount(raw.verifiedBy),
    image: sanitizeImage(raw.image),
    timestamp: timestamp.toISOString(),
    verified: raw.verified === true,
  };
}

function loadIssues() {
  let stored = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null; /* corrupt or unavailable storage: fall back to demo data */
  }

  if (Array.isArray(stored)) {
    issues = stored.map(normalizeIssue).filter(Boolean).slice(0, MAX_ISSUES);
  }
  if (!issues.length) {
    issues = seedDemoData();
    save();
  }
}

function save() {
  issues = issues.slice(0, MAX_ISSUES);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
      return true;
    } catch {
      /* Almost always the quota: drop the heaviest thing we keep, photos. */
      const withImage = issues.filter((issue) => issue.image);
      if (!withImage.length) {
        showToast("This browser will not let the page store data, so reports will not survive a reload.", "error");
        return false;
      }
      withImage[withImage.length - 1].image = null;
    }
  }
  return false;
}

/* ------------------------------------------------------------------
   Demo seed data: shown once, on a browser with no stored reports
------------------------------------------------------------------ */
function seedDemoData() {
  const hoursAgo = (n) => new Date(Date.now() - n * 3600e3).toISOString();
  const seeds = [
    { h: 2, title: "Water pipeline burst on Khetan Bose Road", category: "Water Leakage", severity: "Critical", status: "In Progress", reporter: "Ashok Kumar", location: "Khetan Bose Road", lat: 19.3121, lng: 84.7985, upvotes: 22, verifiedBy: 9, description: "A major pipeline has burst near the market crossing and the lane is flooded. Two-wheelers are skidding and shopkeepers are sandbagging their entrances." },
    { h: 7, title: "Open drain on the school walking route", category: "Public Infrastructure", severity: "Critical", status: "Open", reporter: "Arjun Behera", location: "Canal Street", lat: 19.3094, lng: 84.7902, upvotes: 19, verifiedBy: 8, description: "The drain cover has been missing for weeks. It sits directly on the route children take to school and is deep enough to trap a leg." },
    { h: 13, title: "Garbage overflow at Bada Bazaar bin point", category: "Waste Management", severity: "High", status: "Open", reporter: "Sambit Swain", location: "Bada Bazaar", lat: 19.3156, lng: 84.8011, upvotes: 17, verifiedBy: 5, description: "The bins have not been cleared for four days. Waste is spilling onto the road and the smell is strong by evening." },
    { h: 26, title: "Pothole at the Khallikote College gate", category: "Road Damage", severity: "High", status: "Open", reporter: "Ravi Patra", location: "Khallikote College", lat: 19.3067, lng: 84.7948, upvotes: 14, verifiedBy: 6, description: "A two-foot-wide pothole at the college junction. It fills with water after rain and becomes invisible. Three riders have fallen this week." },
    { h: 38, title: "Sewage water logging at Gate Bazaar", category: "Water Leakage", severity: "High", status: "In Progress", reporter: "Nandini Rao", location: "Gate Bazaar", lat: 19.3178, lng: 84.7956, upvotes: 12, verifiedBy: 4, description: "Stagnant sewage has collected across the bus stop approach. Residents report a strong odour and mosquito breeding." },
    { h: 52, title: "Broken footpath tiles near Ramalingam Tank", category: "Public Infrastructure", severity: "Medium", status: "Resolved", reporter: "Meera Das", location: "Ramalingam Tank", lat: 19.3041, lng: 84.7993, upvotes: 11, verifiedBy: 7, description: "Broken pavers and exposed wiring along a fifty metre stretch. Elderly pedestrians had started avoiding the footpath entirely." },
    { h: 66, title: "Streetlights out for two weeks in Gandhi Nagar", category: "Streetlight", severity: "Medium", status: "Open", reporter: "Priya Sahu", location: "Gandhi Nagar", lat: 19.3132, lng: 84.7887, upvotes: 8, verifiedBy: 3, description: "Four consecutive poles are dead on the main lane. The stretch is completely dark after seven in the evening." },
    { h: 80, title: "Collapsed boundary wall at the old bus stand", category: "Public Infrastructure", severity: "High", status: "Resolved", reporter: "Dilip Mohanty", location: "Old Bus Stand", lat: 19.311, lng: 84.7864, upvotes: 9, verifiedBy: 6, description: "An old compound wall collapsed onto the parking area. Bricks were scattered across two-wheeler bays." },
    { h: 96, title: "Broken swing and rusted bench in NMV Park", category: "Public Infrastructure", severity: "Low", status: "Open", reporter: "Kavya Mishra", location: "NMV Park", lat: 19.3085, lng: 84.8036, upvotes: 5, verifiedBy: 2, description: "The swing chain has snapped and the bench frame is rusted through. Parents have raised it more than once." },
  ];

  return seeds.map((seed) => normalizeIssue({
    id: Date.now() - seed.h * 3600e3,
    title: seed.title,
    category: seed.category,
    description: seed.description,
    reporter: seed.reporter,
    location: seed.location,
    lat: seed.lat,
    lng: seed.lng,
    severity: seed.severity,
    status: seed.status,
    upvotes: seed.upvotes,
    verifiedBy: seed.verifiedBy,
    image: null,
    timestamp: hoursAgo(seed.h),
  })).filter(Boolean);
}

/* ------------------------------------------------------------------
   Server API (relative paths only: never an absolute upstream URL)
------------------------------------------------------------------ */
async function apiRequest(path, { method = "POST", body, timeout = AI_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(clean(payload?.message, 300) || "Request failed");
      error.code = clean(payload?.error, 60) || `http_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function describeApiError(error) {
  if (error?.name === "AbortError") return "The analysis took too long and was stopped. Try again, or fill the form in manually.";
  switch (error?.code) {
    case "ai_unavailable":
      return "AI features are switched off on this server because no GEMINI_API_KEY is configured. You can still submit the report by hand.";
    case "rate_limited":
      return "Too many AI requests from this network. Please wait a few minutes and try again.";
    case "busy":
      return "The analyser is busy right now. Try again in a moment.";
    case "payload_too_large":
    case "image_too_large":
      return "That photo is larger than the server accepts. Try a smaller or more compressed image.";
    case "image_unsupported_type":
    case "image_not_base64":
    case "image_required":
      return "That file did not look like a JPEG, PNG or WebP image.";
    case "upstream_timeout":
      return "The AI service did not answer in time. Try again shortly.";
    case "upstream_unreachable":
      return "The server could not reach the AI service. Try again shortly.";
    case "upstream_busy":
      return "The AI service is rate limiting this key. Try again in a minute.";
    case "upstream_rejected":
      return "The AI service rejected the request. The API key may be restricted or invalid.";
    case "upstream_error":
    case "upstream_empty_response":
      return "The AI service returned an error. Please fill the details in manually.";
    case "analysis_failed":
    case "insights_failed":
      return "The AI did not return a usable answer. Please fill the details in manually.";
    case "no_data":
      return "Report at least one issue before asking for insights.";
    default:
      return error instanceof TypeError
        ? "This page cannot reach the server. AI features need the Node server: run npm start and open the address it prints."
        : "Something went wrong talking to the server. Please try again.";
  }
}

async function checkServer() {
  try {
    const health = await apiRequest("/api/health", { method: "GET", timeout: 6000 });
    serverReachable = health?.ok === true;
    aiEnabled = health?.ai === true;
  } catch {
    serverReachable = false;
    aiEnabled = false;
  }
  reflectAiAvailability();
}

function reflectAiAvailability() {
  const notice = $("aiNotice");
  if (!notice) return;

  if (aiEnabled) {
    notice.classList.add("hidden");
    notice.textContent = "";
    return;
  }

  notice.textContent = !serverReachable
    ? "Running as a static page: the AI classifier needs the Node server. Start it with npm start, then open the address it prints. Everything else on this page works."
    : "The AI classifier is switched off on this server because no GEMINI_API_KEY is set. Reports, the map and the dashboard all work normally.";
  notice.classList.remove("hidden");
}

/* ------------------------------------------------------------------
   Image intake
------------------------------------------------------------------ */
function sniffImage(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode_failed"));
    };
    image.src = url;
  });
}

/* Resizing through a canvas is what removes EXIF: GPS coordinates and device
   identifiers in the original file never survive the re-encode. */
async function prepareImage(file) {
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) throw new Error("type_not_allowed");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("too_large");

  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffImage(bytes)) throw new Error("type_not_allowed");

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const base64 = dataUrl.split(",")[1] || "";
  if (!base64) throw new Error("encode_failed");

  return { dataUrl, base64, mimeType: "image/jpeg", width, height, bytes: Math.round((base64.length * 3) / 4) };
}

function handleImageError(error) {
  const messages = {
    type_not_allowed: "Please choose a JPEG, PNG or WebP image.",
    too_large: "That photo is over 12 MB. Try a smaller one.",
    decode_failed: "That image could not be read. It may be damaged or in an unsupported format.",
    canvas_unavailable: "This browser blocked image resizing, so the photo cannot be prepared.",
    encode_failed: "The photo could not be prepared for upload.",
  };
  showToast(messages[error?.message] || "That image could not be used.", "error");
}

async function acceptImageFile(file) {
  if (!file) return;
  try {
    const prepared = await prepareImage(file);
    pendingImage = prepared;
    const preview = $("previewImg");
    preview.src = prepared.dataUrl;
    preview.classList.remove("hidden");
    $("uploadInner").classList.add("hidden");
    $("previewRemove").classList.remove("hidden");
    $("analyzeBtn").disabled = false;
    $("analyzeBtn").title = "";
  } catch (error) {
    handleImageError(error);
    resetUpload();
  }
}

function resetUpload() {
  pendingImage = null;
  $("imageInput").value = "";
  $("previewImg").classList.add("hidden");
  $("previewImg").removeAttribute("src");
  $("previewRemove").classList.add("hidden");
  $("uploadInner").classList.remove("hidden");
  const analyze = $("analyzeBtn");
  analyze.disabled = true;
  analyze.title = "Add a photo first";
}

/* ------------------------------------------------------------------
   AI: analyse a photo
------------------------------------------------------------------ */
async function analyzeWithAi() {
  if (!pendingImage) return;

  const analyzeBtn = $("analyzeBtn");
  const result = $("aiResult");
  const status = $("aiStatus");
  const text = $("aiText");
  const tags = $("aiTags");

  result.classList.remove("hidden");

  if (!aiEnabled) {
    status.textContent = "Unavailable";
    text.textContent = serverReachable
      ? "This server has no GEMINI_API_KEY configured, so the AI classifier is off. Fill the form in manually, or add a key and restart the server."
      : "The AI classifier needs the Node server. Run npm start, open the address it prints, and try again.";
    tags.replaceChildren();
    showToast("AI analysis is not available right now.", "error");
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analysing";
  status.textContent = "Scanning the photo";
  text.textContent = "Sending the photo to the server for classification.";
  tags.replaceChildren();

  try {
    const payload = await apiRequest("/api/analyze", {
      body: { image: { mimeType: pendingImage.mimeType, data: pendingImage.base64 } },
    });
    const analysis = payload?.analysis;
    if (!analysis) throw new Error("empty_analysis");

    /* Every value below is rendered as text, never as markup. */
    const severityClass = `sev-${(analysis.severity || "Medium").toLowerCase()}`;
    text.replaceChildren(
      el("strong", { class: severityClass, text: clean(analysis.issue, MAX_LENGTHS.title) }),
      el("span", { text: ` . ${oneOf(analysis.severity, SEVERITIES, "Medium")} severity, ${oneOf(analysis.category, CATEGORIES, "Other")}.` }),
      el("br"),
      el("span", { text: clean(analysis.description, MAX_LENGTHS.description) })
    );
    if (analysis.action) {
      text.append(el("em", { class: "ai-action", text: `Recommended action: ${clean(analysis.action, MAX_LENGTHS.action)}` }));
    }

    $("issueTitle").value = clean(analysis.issue, MAX_LENGTHS.title);
    $("issueCategory").value = oneOf(analysis.category, CATEGORIES, "Other");
    $("issueSeverity").value = oneOf(analysis.severity, SEVERITIES, "Medium");
    $("issueDesc").value = clean(analysis.description, MAX_LENGTHS.description);

    const list = Array.isArray(analysis.tags) ? analysis.tags : [];
    tags.replaceChildren(...list.slice(0, 5).map((tag) => el("span", { class: "ai-tag", text: clean(tag, MAX_LENGTHS.tag) })));

    status.textContent = "Analysis complete";
    showToast("The form has been filled in from the photo. Check it before submitting.", "success");
  } catch (error) {
    status.textContent = "Failed";
    text.textContent = describeApiError(error);
    tags.replaceChildren();
    showToast(describeApiError(error), "error");
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Analyse with AI";
  }
}

/* ------------------------------------------------------------------
   Submit
------------------------------------------------------------------ */
function setFormError(message) {
  const node = $("formError");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("hidden", !message);
}

function submitReport(event) {
  event.preventDefault();

  const title = clean($("issueTitle").value, MAX_LENGTHS.title);
  const category = oneOf($("issueCategory").value, CATEGORIES, "Other");
  const explicitCategory = $("issueCategory").value !== "";

  if (!title) {
    setFormError("Add a short title so people know what the report is about.");
    $("issueTitle").focus();
    return;
  }
  if (!explicitCategory) {
    setFormError("Choose a category. You can let the AI fill this in from the photo first.");
    $("issueCategory").focus();
    return;
  }
  setFormError("");

  const jitter = () => (Math.random() - 0.5) * 0.012;
  const reporter = clean($("reporterName").value, MAX_LENGTHS.reporter) || "Anonymous";

  const issue = normalizeIssue({
    id: Date.now() + (newIssueCounter += 1) * 1000,
    title,
    category,
    description: clean($("issueDesc").value, MAX_LENGTHS.description),
    reporter,
    location: clean($("issueLocation").value, MAX_LENGTHS.location) || "Berhampur",
    lat: CITY_CENTER.lat + jitter(),
    lng: CITY_CENTER.lng + jitter(),
    severity: oneOf($("issueSeverity").value, SEVERITIES, "Medium"),
    status: "Open",
    upvotes: 0,
    verifiedBy: 0,
    image: pendingImage?.dataUrl && pendingImage.dataUrl.length <= MAX_STORED_IMAGE_CHARS ? pendingImage.dataUrl : null,
    timestamp: new Date().toISOString(),
  });

  if (!issue) {
    setFormError("That report could not be saved. Please check the fields and try again.");
    return;
  }

  issues.unshift(issue);
  const stored = save();
  activeFilter = "all";
  syncFilterPills();
  renderAll();
  resetForm();

  showToast(
    stored
      ? `Report added. Thank you, ${issue.reporter}. It is worth ten community points.`
      : "Report added for this session, but this browser refused to store it.",
    stored ? "success" : "error"
  );
  document.getElementById("live")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
}

function resetForm() {
  $("reportForm").reset();
  $("issueSeverity").value = "Medium";
  $("aiResult").classList.add("hidden");
  $("aiTags").replaceChildren();
  setFormError("");
  resetUpload();
}

/* ------------------------------------------------------------------
   Feed
------------------------------------------------------------------ */
function issueCard(issue) {
  const categoryIcon = CATEGORY_ICON[issue.category] || CATEGORY_ICON.Other;

  const media = issue.image
    ? el("img", { src: issue.image, alt: `Photograph attached to: ${issue.title}`, loading: "lazy", decoding: "async" })
    : svgIcon("0 0 48 48", categoryIcon);

  const art = el("div", { class: "issue-art" }, [media]);

  const footIcon = (icon, value) => el("span", {}, [icon(), el("span", { text: value })]);

  const actionButton = (action, icon, label, count, extraClass) =>
    el("button", {
      type: "button",
      class: `act-btn${extraClass ? ` ${extraClass}` : ""}`,
      dataset: { action, id: String(issue.id) },
      "aria-label": label,
    }, [icon(), count === undefined ? null : el("span", { text: String(count) })]);

  const statusSelect = el("select", {
    class: "status-select",
    dataset: { action: "status", id: String(issue.id) },
    "aria-label": `Status of: ${issue.title}`,
  }, STATUSES.map((status) => el("option", { value: status, text: statusLabel(status), selected: issue.status === status })));

  const body = el("div", { class: "issue-card-body" }, [
    el("div", { class: "issue-meta" }, [
      el("span", { class: "issue-category", text: issue.category }),
      el("span", { class: `sev-badge sev-${issue.severity.toLowerCase()}`, text: issue.severity }),
    ]),
    el("h3", { text: issue.title }),
    el("p", { class: "issue-desc", text: issue.description || "No description was provided." }),
    el("div", { class: "issue-foot" }, [
      footIcon(ICONS.pin, issue.location),
      footIcon(ICONS.person, issue.reporter),
      el("span", { class: "issue-time", text: timeAgo(issue.timestamp) }),
    ]),
    el("div", { class: "card-actions" }, [
      actionButton("upvote", ICONS.upvote, `Upvote: ${issue.title}`, issue.upvotes),
      actionButton("verify", ICONS.check, `Confirm you have seen this: ${issue.title}`, issue.verifiedBy, issue.verifiedBy > 0 ? "on" : ""),
      actionButton("share", ICONS.share, `Share: ${issue.title}`),
      statusSelect,
    ]),
  ]);

  return el("article", { class: "issue-card" }, [art, body]);
}

function statusLabel(status) {
  return status === "In Progress" ? "In progress" : status;
}

function renderFeed({ animate = true } = {}) {
  const container = $("issuesList");
  const list = activeFilter === "all" ? issues : issues.filter((issue) => issue.category === activeFilter);

  if (!list.length) {
    container.replaceChildren(el("p", { class: "feed-empty", text: "Nothing reported in this category yet. Add the first report." }));
    return;
  }

  container.replaceChildren(...list.slice(0, 12).map(issueCard));

  if (animate && !prefersReducedMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08 });
    for (const card of container.querySelectorAll(".issue-card")) {
      card.classList.add("enter");
      observer.observe(card);
    }
  }
}

function syncFilterPills() {
  for (const pill of document.querySelectorAll("#filterPills .pill")) {
    const filter = pill.dataset.filter;
    const count = filter === "all" ? issues.length : issues.filter((issue) => issue.category === filter).length;
    const label = filter === "all" ? "All" : pillLabel(filter);
    pill.replaceChildren(el("span", { text: label }), el("span", { class: "pill-count", text: String(count) }));
    pill.classList.toggle("active", filter === activeFilter);
    pill.setAttribute("aria-pressed", String(filter === activeFilter));
  }
}

function pillLabel(filter) {
  return { "Road Damage": "Road", "Water Leakage": "Water", "Streetlight": "Light", "Waste Management": "Waste", "Public Infrastructure": "Infrastructure" }[filter] || filter;
}

function timeAgo(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60e3);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------
   Card actions (event delegation, so no inline handlers exist at all)
------------------------------------------------------------------ */
function findIssue(id) {
  return issues.find((issue) => issue.id === Number(id));
}

function upvoteIssue(id) {
  const issue = findIssue(id);
  if (!issue) return;
  issue.upvotes = toCount(issue.upvotes) + 1;
  issue.verified = false;
  save();
  renderFeed({ animate: false });
}

function verifyIssue(id) {
  const issue = findIssue(id);
  if (!issue) return;
  if (issue.verified) {
    showToast("You have already confirmed this report from this browser.", "error");
    return;
  }
  issue.verifiedBy = toCount(issue.verifiedBy) + 1;
  issue.verified = true;
  save();
  renderFeed({ animate: false });
  updateStats();
  showToast("Confirmation recorded. Thank you for checking.", "success");
}

function setStatus(id, status) {
  const issue = findIssue(id);
  if (!issue) return;
  const next = oneOf(status, STATUSES, issue.status);
  if (next === issue.status) return;
  issue.status = next;
  save();
  renderAll();
  showToast(`Status set to ${statusLabel(next)}.`, "success");
}

async function shareIssue(id) {
  const issue = findIssue(id);
  if (!issue) return;
  const text = [
    "Civic issue reported on CivicReport:",
    "",
    issue.title,
    `${issue.category}, ${issue.severity} severity`,
    `Location: ${issue.location}`,
    `Status: ${statusLabel(issue.status)}`,
    `Reported by ${issue.reporter}`,
  ].join("\n");

  if (navigator.share) {
    try {
      await navigator.share({ title: issue.title, text });
      return;
    } catch {
      /* The user dismissed the sheet: fall through to the clipboard. */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Issue details copied to the clipboard.", "success");
  } catch {
    showToast("Sharing is not available in this browser.", "error");
  }
}

/* ------------------------------------------------------------------
   Map
------------------------------------------------------------------ */
function initMap() {
  const container = $("map");
  const fallback = $("mapFallback");
  if (!container) return;

  if (typeof window.L === "undefined" || !window.L?.map) {
    if (fallback) fallback.classList.remove("hidden");
    return;
  }
  fallback?.classList.add("hidden");

  try {
    map = window.L.map(container, { scrollWheelZoom: false, attributionControl: true }).setView([CITY_CENTER.lat, CITY_CENTER.lng], 13);
    window.L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    markersLayer = window.L.layerGroup().addTo(map);

    /* Deliberate two-step: the wheel only zooms once the map has focus, so
       page scrolling is never hijacked by a stray scroll gesture. */
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
  } catch {
    map = null;
    markersLayer = null;
    if (fallback) {
      fallback.textContent = "The map could not start in this browser. Reports and the dashboard still work.";
      fallback.classList.remove("hidden");
    }
  }
}

function refreshMarkers({ fit = false } = {}) {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();

  const bounds = [];
  const visible = activeFilter === "all" ? issues : issues.filter((issue) => issue.category === activeFilter);

  for (const issue of visible) {
    if (issue.lat === null || issue.lng === null) continue;

    const markerClass = issue.status === "Resolved" ? "mk-resolved" : `mk-${issue.severity.toLowerCase()}`;
    /* Leaflet's divIcon takes an HTML string. The only interpolated value is
       a class name built from a whitelisted status and severity, so it cannot
       carry markup. No other string in this file is ever parsed as HTML. */
    const icon = window.L.divIcon({
      html: `<div class="mk ${markerClass}"></div>`,
      className: "mk-wrap",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const marker = window.L.marker([issue.lat, issue.lng], { icon, title: issue.title });
    /* Popup content is assembled as DOM, not as a string, so a hostile
       reporter name or title cannot inject markup into the map. */
    const popup = el("div", { class: "popup" }, [
      el("div", { class: "popup-title", text: issue.title }),
      el("div", { class: "popup-meta" }, [
        el("div", { text: `${issue.category}, ${issue.severity} severity` }),
        el("div", { text: `Status: ${statusLabel(issue.status)}` }),
        el("div", { text: `${issue.reporter}, ${timeAgo(issue.timestamp)}` }),
        el("div", { text: `${issue.verifiedBy} community confirmations` }),
      ]),
    ]);
    marker.bindPopup(popup);
    marker.addTo(markersLayer);
    bounds.push([issue.lat, issue.lng]);
  }

  if (fit && bounds.length && visible.length <= 12) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

/* ------------------------------------------------------------------
   Stats, dashboard, charts
------------------------------------------------------------------ */
function summary() {
  const byCategory = {};
  const bySeverity = {};
  for (const category of CATEGORIES) byCategory[category] = 0;
  for (const severity of SEVERITIES) bySeverity[severity] = 0;

  for (const issue of issues) {
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
  }

  return {
    total: issues.length,
    resolved: issues.filter((issue) => issue.status === "Resolved").length,
    open: issues.filter((issue) => issue.status === "Open").length,
    inProgress: issues.filter((issue) => issue.status === "In Progress").length,
    byCategory,
    bySeverity,
  };
}

function contributorPoints(reporter) {
  const mine = issues.filter((issue) => issue.reporter === reporter);
  return mine.length * 10 +
    mine.filter((issue) => issue.status === "Resolved").length * 25 +
    mine.reduce((total, issue) => total + issue.verifiedBy, 0) * 5;
}

function statValues() {
  const reporters = new Set(issues.map((issue) => issue.reporter));
  return {
    "stat-reported": issues.length,
    "stat-resolved": issues.filter((issue) => issue.status === "Resolved").length,
    "stat-citizens": reporters.size,
    "stat-points": [...reporters].reduce((total, reporter) => total + contributorPoints(reporter), 0),
  };
}

function updateStats({ animate = false } = {}) {
  for (const [id, value] of Object.entries(statValues())) {
    const node = $(id);
    if (!node) continue;
    if (!animate || prefersReducedMotion) {
      node.textContent = String(value);
      continue;
    }
    const from = Number.parseInt(node.textContent, 10) || 0;
    const started = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - started) / 900);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = String(Math.round(from + (value - from) * eased));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function updateDashboard() {
  const counts = {
    "Road Damage": { count: "count-road", bar: "bar-road" },
    "Water Leakage": { count: "count-water", bar: "bar-water" },
    "Streetlight": { count: "count-light", bar: "bar-light" },
    "Waste Management": { count: "count-waste", bar: "bar-waste" },
  };
  const totals = summary().byCategory;
  const max = Math.max(1, ...Object.keys(counts).map((category) => totals[category] || 0));

  for (const [category, ids] of Object.entries(counts)) {
    const value = totals[category] || 0;
    const countNode = $(ids.count);
    const barNode = $(ids.bar);
    if (countNode) countNode.textContent = String(value);
    if (barNode) barNode.style.width = `${Math.round((value / max) * 100)}%`;
  }
  renderCharts();
}

function updateHealthScore() {
  const ring = $("healthRing");
  const scoreNode = $("healthScore");
  const labelNode = $("healthLabel");
  const data = summary();

  let target = 78;
  if (data.total > 0) {
    const critical = issues.filter((issue) => issue.severity === "Critical").length;
    const high = issues.filter((issue) => issue.severity === "High").length;
    const score = 78 - critical * 12 - high * 6 - (data.total - data.resolved) * 2 + data.resolved * 4;
    target = Math.max(0, Math.min(100, Math.round(score)));
  }

  const colour = target >= 70 ? "var(--green)" : target >= 40 ? "var(--amber)" : "var(--red)";
  const circumference = 339.3;

  if (ring) {
    ring.style.strokeDashoffset = String(circumference - (target / 100) * circumference);
    ring.style.stroke = colour;
  }
  if (labelNode) {
    labelNode.textContent = data.total === 0 ? "No data" : target >= 70 ? "Healthy" : target >= 40 ? "Strained" : "Critical";
  }
  if (scoreNode) {
    scoreNode.textContent = String(target);
    scoreNode.style.color = colour;
  }
}

let categoryChart = null;
let statusChart = null;

function chartFont() {
  return { family: "'JetBrains Mono', monospace", size: 11 };
}

function renderCharts() {
  const categoryCanvas = $("categoryChart");
  const statusCanvas = $("statusChart");
  if (!categoryCanvas || !statusCanvas || typeof window.Chart === "undefined") return;

  const data = summary();
  const labels = ["Road", "Water", "Light", "Waste", "Infra", "Other"];
  const categoryOrder = ["Road Damage", "Water Leakage", "Streetlight", "Waste Management", "Public Infrastructure", "Other"];
  const ink = "#A6A192";
  const grid = "rgba(243, 240, 232, 0.07)";

  try {
    categoryChart?.destroy();
    statusChart?.destroy();

    categoryChart = new window.Chart(categoryCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: categoryOrder.map((category) => data.byCategory[category] || 0),
          backgroundColor: "rgba(255, 90, 31, 0.75)",
          hoverBackgroundColor: "#FF5A1F",
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 40,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReducedMotion ? false : { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1D1B17",
            borderColor: "rgba(243, 240, 232, 0.16)",
            borderWidth: 1,
            titleColor: "#F3F0E8",
            bodyColor: ink,
            titleFont: chartFont(),
            bodyFont: chartFont(),
            padding: 10,
            displayColors: false,
          },
        },
        scales: {
          x: { ticks: { color: ink, font: chartFont() }, grid: { display: false }, border: { color: grid } },
          y: { beginAtZero: true, ticks: { color: ink, font: chartFont(), precision: 0 }, grid: { color: grid }, border: { display: false } },
        },
      },
    });

    statusChart = new window.Chart(statusCanvas, {
      type: "doughnut",
      data: {
        labels: ["Open", "In progress", "Resolved"],
        datasets: [{
          data: [data.open, data.inProgress, data.resolved],
          backgroundColor: ["#FF5A1F", "#FFC24B", "#7BD88F"],
          borderColor: "#171613",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        animation: prefersReducedMotion ? false : { duration: 500 },
        plugins: {
          legend: { position: "bottom", labels: { color: ink, font: chartFont(), padding: 14, boxWidth: 8, boxHeight: 8, usePointStyle: true } },
          tooltip: {
            backgroundColor: "#1D1B17",
            borderColor: "rgba(243, 240, 232, 0.16)",
            borderWidth: 1,
            titleColor: "#F3F0E8",
            bodyColor: ink,
            titleFont: chartFont(),
            bodyFont: chartFont(),
            padding: 10,
          },
        },
      },
    });
  } catch {
    /* Charting is a nice-to-have: the numbers above it are the source of truth. */
  }
}

/* ------------------------------------------------------------------
   Leaderboard
------------------------------------------------------------------ */
function badgeFor(points) {
  if (points >= 100) return "City champion";
  if (points >= 50) return "Active resident";
  if (points >= 20) return "Contributor";
  return "Newcomer";
}

function renderLeaderboard() {
  const body = $("leaderboardBody");
  if (!body) return;

  const ranked = [...new Set(issues.map((issue) => issue.reporter))]
    .map((reporter) => ({
      reporter,
      points: contributorPoints(reporter),
      reports: issues.filter((issue) => issue.reporter === reporter).length,
    }))
    .sort((a, b) => b.points - a.points || a.reporter.localeCompare(b.reporter))
    .slice(0, 8);

  if (!ranked.length) {
    body.replaceChildren(el("div", { class: "lb-empty", text: "No reports yet. Add one to appear here." }));
    return;
  }

  body.replaceChildren(...ranked.map((entry, index) =>
    el("div", { class: `lb-row${index === 0 ? " top" : ""}` }, [
      el("span", { class: "lb-rank", text: String(index + 1).padStart(2, "0") }),
      el("span", { class: "lb-name" }, [
        el("span", { text: entry.reporter }),
        el("span", { class: "badge-pill", text: badgeFor(entry.points) }),
      ]),
      el("span", { class: "lb-right lb-points", text: `${entry.points} pts` }),
      el("span", { class: "lb-right lb-reports", text: `${entry.reports} reports` }),
    ])
  ));
}

/* ------------------------------------------------------------------
   Ticker
------------------------------------------------------------------ */
function updateTicker() {
  const track = $("tickerTrack");
  if (!track) return;

  const items = issues.slice(0, 8).map((issue) =>
    el("span", {}, [
      el("b", { text: issue.reporter }),
      el("span", { text: ` reported ${issue.category} at ${issue.location}, ` }),
      el("b", { text: statusLabel(issue.status) }),
    ])
  );

  if (!items.length) {
    track.replaceChildren(el("span", { text: "Be the first to report an issue in your area" }));
    return;
  }
  /* Duplicated once so the CSS translate loop is seamless. */
  track.replaceChildren(el("span", { class: "ticker-group" }, items), el("span", { class: "ticker-group" }, items.map((node) => node.cloneNode(true))));
}

/* ------------------------------------------------------------------
   Insights
------------------------------------------------------------------ */
async function generateInsights() {
  const button = $("insightsBtn");
  const container = $("insightsGrid");
  if (!button || !container) return;

  if (!aiEnabled) {
    container.replaceChildren(el("p", {
      class: "insights-empty",
      text: serverReachable
        ? "This server has no GEMINI_API_KEY configured, so insights are switched off."
        : "Insights need the Node server. Run npm start and open the address it prints.",
    }));
    showToast("AI insights are not available right now.", "error");
    return;
  }
  if (issues.length === 0) {
    container.replaceChildren(el("p", { class: "insights-empty", text: "Add at least one report first. The model needs data to summarise." }));
    return;
  }

  button.disabled = true;
  button.textContent = "Generating";
  container.replaceChildren(el("p", { class: "insights-empty", text: "Reading the aggregate counts on this page." }));

  try {
    const payload = await apiRequest("/api/insights", { body: { summary: summary() } });
    const insights = Array.isArray(payload?.insights) ? payload.insights.slice(0, 4) : [];
    if (!insights.length) throw new Error("empty_insights");

    container.replaceChildren(...insights.map((insight) => {
      const tag = oneOf(insight.tag, ["Warning", "Good", "Critical"], "Warning");
      return el("div", { class: "insight-card" }, [
        el("span", { class: `insight-tag tag-${tag.toLowerCase()}`, text: clean(insight.tagLabel || tag, 48) }),
        el("h4", { text: clean(insight.title, 120) }),
        el("p", { text: clean(insight.text, 420) }),
      ]);
    }));
    showToast("Insights generated from the current counts.", "success");
  } catch (error) {
    container.replaceChildren(el("p", { class: "insights-empty", text: describeApiError(error) }));
    showToast(describeApiError(error), "error");
  } finally {
    button.disabled = false;
    button.textContent = "Generate insights";
  }
}

/* ------------------------------------------------------------------
   Toast
------------------------------------------------------------------ */
function showToast(message, type = "success") {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = clean(message, 300);
  toast.className = `toast show ${type === "error" ? "error" : "success"}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

/* ------------------------------------------------------------------
   Navigation and page furniture
------------------------------------------------------------------ */
function initNav() {
  const nav = $("nav");
  const toggle = $("navToggle");
  const links = $("navLinks");
  const progress = $("scrollProgress");

  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 24);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0}%`;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const closeMenu = () => {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
  };
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  links.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  const sections = ["report", "live", "dashboard", "insights"];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links.querySelectorAll("a")) {
        const active = link.dataset.nav === entry.target.id;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
  }, { rootMargin: "-40% 0px -55% 0px" });
  for (const id of sections) {
    const node = $(id);
    if (node) observer.observe(node);
  }

  $("resetDemo")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    issues = seedDemoData();
    save();
    renderAll();
    showToast("Local demo data reset.", "success");
  });
}

function initMotion() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    for (const node of targets) node.classList.add("in");
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12 });
  for (const node of targets) observer.observe(node);
}

function initUploadZone() {
  const zone = $("uploadZone");
  const input = $("imageInput");

  zone.addEventListener("click", (event) => {
    if (event.target.closest(".preview-remove")) return;
    input.click();
  });
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", (event) => acceptImageFile(event.target.files?.[0]));
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
    acceptImageFile(event.dataTransfer?.files?.[0]);
  });
  $("previewRemove").addEventListener("click", (event) => {
    event.stopPropagation();
    resetUpload();
  });

  $("analyzeBtn").addEventListener("click", analyzeWithAi);
  $("reportForm").addEventListener("submit", submitReport);
  $("insightsBtn").addEventListener("click", generateInsights);
}

function initFeedInteractions() {
  const container = $("issuesList");

  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.tagName === "SELECT") return;
    const { action, id } = button.dataset;
    if (action === "upvote") upvoteIssue(id);
    else if (action === "verify") verifyIssue(id);
    else if (action === "share") shareIssue(id);
  });

  container.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-action='status']");
    if (select) setStatus(select.dataset.id, select.value);
  });

  for (const pill of document.querySelectorAll("#filterPills .pill")) {
    pill.addEventListener("click", () => {
      activeFilter = pill.dataset.filter === "all" ? "all" : oneOf(pill.dataset.filter, CATEGORIES, "all");
      syncFilterPills();
      renderFeed();
      refreshMarkers();
    });
  }
}

/* ------------------------------------------------------------------
   Render orchestration
------------------------------------------------------------------ */
function renderAll({ fitMap = false } = {}) {
  renderFeed();
  refreshMarkers({ fit: fitMap });
  updateStats();
  updateDashboard();
  updateHealthScore();
  renderLeaderboard();
  updateTicker();
}

/* ------------------------------------------------------------------
   Boot
------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  loadIssues();
  initNav();
  initMap();
  initUploadZone();
  initFeedInteractions();
  initMotion();
  syncFilterPills();
  renderAll({ fitMap: true });
  resetUpload();
  checkServer();
});
