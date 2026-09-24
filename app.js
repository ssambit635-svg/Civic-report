/* ============================================================
   CivicReport — app.js
   AI-powered civic issue reporting · Gemini + Leaflet + Chart.js
   ============================================================ */
'use strict';

/* ---------- Config ----------
   Paste your Gemini key here, OR create config.js (see README):
     const CONFIG = { GEMINI_API_KEY: "..." };
--------------------------------- */
const GEMINI_API_KEY = ""; // ← optional: paste key here

const API_KEY =
  (typeof CONFIG !== "undefined" && CONFIG.GEMINI_API_KEY) || GEMINI_API_KEY;
const hasKey = () =>
  typeof API_KEY === "string" &&
  API_KEY.length > 20 &&
  !API_KEY.includes("YOUR_");

const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

/* ---------- State ---------- */
const LS_KEY = "civicIssues";
let issues = [];
let currentImageBase64 = null;
let activeFilter = "all";
let map = null;
let markersLayer = null;
let statsAnimated = false;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

/* ---------- Demo seed data (first visit only) ---------- */
function seedDemoData() {
  const h = (n) => Date.now() - n * 3600e3;
  return [
    { id: h(2),      title: "Water pipeline burst on Khetan Bose Road", category: "Water Leakage", description: "A major pipeline has burst near the market crossing, flooding the entire lane. Two-wheelers are skidding and shops are sandbagging their entrances.", reporter: "Ashok Kumar", location: "Khetan Bose Road", lat: 19.3121, lng: 84.7985, severity: "Critical", status: "In Progress", upvotes: 22, verifiedBy: 9, image: null, timestamp: new Date(h(2)).toISOString() },
    { id: h(7),      title: "Open drain causing hazard on Canal Street", category: "Public Infrastructure", description: "The drain cover has been missing for weeks. It is directly on the school walking route and dangerously deep.", reporter: "Arjun Behera", location: "Canal Street", lat: 19.3094, lng: 84.7902, severity: "Critical", status: "Open", upvotes: 19, verifiedBy: 8, image: null, timestamp: new Date(h(7)).toISOString() },
    { id: h(13),     title: "Garbage overflow at Bada Bazaar bin point", category: "Waste Management", description: "Bins have not been cleared for four days. Waste is spilling onto the road and the smell is unbearable by evening.", reporter: "Sambit Swain", location: "Bada Bazaar", lat: 19.3156, lng: 84.8011, severity: "High", status: "Open", upvotes: 17, verifiedBy: 5, image: null, timestamp: new Date(h(13)).toISOString() },
    { id: h(26),     title: "Massive pothole near Khallikote College gate", category: "Road Damage", description: "A two-foot-wide pothole right at the college junction. Three riders have fallen this week — it fills with water and becomes invisible after rain.", reporter: "Ravi Patra", location: "Khallikote College", lat: 19.3067, lng: 84.7948, severity: "High", status: "Open", upvotes: 14, verifiedBy: 6, image: null, timestamp: new Date(h(26)).toISOString() },
    { id: h(38),     title: "Sewage water logging at Gate Bazaar", category: "Water Leakage", description: "Stagnant sewage water has collected across the bus-stop approach. Strong odour and mosquito breeding reported by residents.", reporter: "Nandini Rao", location: "Gate Bazaar", lat: 19.3178, lng: 84.7956, severity: "High", status: "In Progress", upvotes: 12, verifiedBy: 4, image: null, timestamp: new Date(h(38)).toISOString() },
    { id: h(52),     title: "Footpath tiles broken near Ramalingam Tank", category: "Public Infrastructure", description: "Broken pavers and exposed wiring along a 50-metre stretch. Elderly pedestrians are avoiding the footpath entirely.", reporter: "Meera Das", location: "Ramalingam Tank", lat: 19.3041, lng: 84.7993, severity: "Medium", status: "Resolved", upvotes: 11, verifiedBy: 7, image: null, timestamp: new Date(h(52)).toISOString() },
    { id: h(66),     title: "Streetlight out for two weeks — Gandhi Nagar", category: "Streetlight", description: "Four consecutive poles are dead on the main lane. The stretch is completely dark after 7pm and women avoid the route.", reporter: "Priya Sahu", location: "Gandhi Nagar", lat: 19.3132, lng: 84.7887, severity: "Medium", status: "Open", upvotes: 8, verifiedBy: 3, image: null, timestamp: new Date(h(66)).toISOString() },
    { id: h(80),     title: "Collapsed boundary wall at old bus stand", category: "Public Infrastructure", description: "An old compound wall collapsed onto the parking area. Bricks are scattered across two-wheeler parking bays.", reporter: "Dilip Mohanty", location: "Old Bus Stand", lat: 19.3110, lng: 84.7864, severity: "High", status: "Resolved", upvotes: 9, verifiedBy: 6, image: null, timestamp: new Date(h(80)).toISOString() },
    { id: h(96),     title: "Broken swing and rusty bench — NMV Park", category: "Public Infrastructure", description: "The children's swing chain is snapped and the bench frame is rusted through. Parents have flagged it multiple times.", reporter: "Kavya Mishra", location: "NMV Park", lat: 19.3085, lng: 84.8036, severity: "Low", status: "Open", upvotes: 5, verifiedBy: 2, image: null, timestamp: new Date(h(96)).toISOString() },
  ];
}

function loadIssues() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      issues = JSON.parse(raw);
      if (!Array.isArray(issues)) issues = [];
    }
  } catch (_) { issues = []; }
  if (issues.length === 0) {
    issues = seedDemoData();
    save();
  }
}
const save = () => localStorage.setItem(LS_KEY, JSON.stringify(issues));

/* ---------- Helpers ---------- */
const SEV_CLASS = { low: "low", medium: "medium", high: "high", critical: "critical" };
const sevClass = (s) => SEV_CLASS[(s || "medium").toLowerCase()] || "medium";

const CATEGORY_ART = {
  "Road Damage": "art-road",
  "Water Leakage": "art-water",
  "Streetlight": "art-light",
  "Waste Management": "art-waste",
  "Public Infrastructure": "art-infra",
  "Other": "art-other",
};
const CATEGORY_ICON = {
  "Road Damage": '<path d="M4 34c4-10 8-14 12-14s6 4 8 8 4 6 8 6 6-4 8-10" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
  "Water Leakage": '<path d="M24 4C15 16 10 22 10 29a14 14 0 0 0 28 0c0-7-5-13-14-25z" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round"/>',
  "Streetlight": '<circle cx="24" cy="14" r="7" stroke="currentColor" stroke-width="3" fill="none"/><path d="M24 21v20M14 41h20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  "Waste Management": '<path d="M8 12h32M14 12l2-6h16l2 6M12 12l3 30h18l3-30" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
  "Public Infrastructure": '<path d="M6 40h36M10 40V22l14-10 14 10v18M18 40V28h12v12" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
  "Other": '<circle cx="24" cy="24" r="17" stroke="currentColor" stroke-width="3" fill="none"/><path d="M24 15v18M15 24h18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60e3);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}

/* ============================================================
   INIT
============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  loadIssues();
  initNav();
  initMap();
  initUploadZone();
  initFilters();
  initMotion();
  renderAll();
  window.scrollTo({ top: 0 }); // start at top on refresh
});

window.addEventListener("load", () => {
  document.body.classList.add("loaded");
  setTimeout(() => map && map.invalidateSize(), 200);
});

function renderAll(fitMap = false) {
  renderFeed(true);
  refreshMarkers(fitMap);
  updateStats();
  updateDashboard();
  updateHealthScore();
  renderLeaderboard();
  updateTicker();
}

/* ============================================================
   NAV
============================================================ */
function initNav() {
  const nav = $("nav");
  const toggle = $("navToggle");
  const links = $("navLinks");
  const progress = $("scrollProgress");

  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 30);
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + "%";
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );

  // Active link highlighting
  const sections = ["report", "live", "dashboard", "insights"];
  const navObs = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.querySelectorAll("a").forEach((a) =>
        a.classList.toggle("active", a.dataset.nav === e.target.id)
      );
    }),
    { rootMargin: "-35% 0px -55% 0px" }
  );
  sections.forEach((id) => {
    const el = $(id);
    if (el) navObs.observe(el);
  });

  $("resetDemo").addEventListener("click", () => {
    localStorage.removeItem(LS_KEY);
    showToast("Demo data reset — reloading…", "success");
    setTimeout(() => location.reload(), 700);
  });
}

/* ============================================================
   MOTION — reveals, parallax, counters, manifesto
============================================================ */
const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function initMotion() {
  if (prefersReduced) {
    document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("in"));
    splitManifesto(true);
    return;
  }

  // Reveal on scroll
  const revealObs = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.style.setProperty("--d", (e.target.dataset.delay || 0) + "ms");
          e.target.classList.add("in");
          revealObs.unobserve(e.target);
        }
      }),
    { threshold: 0.12 }
  );
  document.querySelectorAll("[data-reveal]").forEach((el) => revealObs.observe(el));

  // Hero parallax — mouse + scroll
  const floats = [...document.querySelectorAll(".float")];
  if (floats.length) {
    let mx = 0, my = 0, cx = 0, cy = 0;
    const hero = document.querySelector(".hero");
    hero.addEventListener("mousemove", (e) => {
      mx = (e.clientX / innerWidth - 0.5) * 2;
      my = (e.clientY / innerHeight - 0.5) * 2;
    });
    const tick = () => {
      cx += (mx - cx) * 0.06;
      cy += (my - cy) * 0.06;
      floats.forEach((f) => {
        const d = parseFloat(f.dataset.depth || 10);
        const scrollDrift = Math.min(scrollY, innerHeight) * 0.06;
        f.style.transform = `translate(${cx * d}px, ${cy * d + scrollDrift * (d > 0 ? 0.5 : -0.3)}px)`;
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Animated counters (stats)
  const statObs = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting && !statsAnimated) {
          statsAnimated = true;
          animateStats();
          statObs.disconnect();
        }
      }),
    { threshold: 0.4 }
  );
  const statsSection = $("stats");
  if (statsSection) statObs.observe(statsSection);

  // Manifesto word reveal
  splitManifesto(false);
  const manifesto = document.querySelector(".manifesto-text");
  if (manifesto) {
    const words = [...manifesto.querySelectorAll(".w")];
    const onScrollM = () => {
      const r = manifesto.getBoundingClientRect();
      const vh = innerHeight;
      const progress = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      const active = Math.floor(progress * words.length);
      words.forEach((w, i) => w.classList.toggle("on", i < active));
    };
    window.addEventListener("scroll", onScrollM, { passive: true });
    onScrollM();
  }
}

function splitManifesto(instant) {
  const el = document.querySelector(".manifesto-text");
  if (!el || el.dataset.split) return;
  const words = el.textContent.trim().split(/\s+/);
  el.innerHTML = words.map((w) => `<span class="w${instant ? " on" : ""}">${esc(w)}</span>`).join(" ");
  el.dataset.split = "1";
}

function animateStats() {
  const targets = {
    "stat-reported": issues.length,
    "stat-resolved": issues.filter((i) => i.status === "Resolved").length,
    "stat-citizens": new Set(issues.map((i) => i.reporter)).size,
    "stat-points": [...new Set(issues.map((i) => i.reporter))].reduce((a, r) => a + getPoints(r), 0),
  };
  Object.entries(targets).forEach(([id, target], idx) => {
    const el = $(id);
    if (!el) return;
    const dur = 1300 + idx * 150;
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function setStatsDirect() {
  $("stat-reported").textContent = issues.length;
  $("stat-resolved").textContent = issues.filter((i) => i.status === "Resolved").length;
  $("stat-citizens").textContent = new Set(issues.map((i) => i.reporter)).size;
  $("stat-points").textContent = [...new Set(issues.map((i) => i.reporter))].reduce((a, r) => a + getPoints(r), 0);
}

/* ============================================================
   TICKER
============================================================ */
function updateTicker() {
  const track = $("tickerTrack");
  if (!track) return;

  const items = issues.length
    ? issues.slice(0, 8).map(
        (i) =>
          `<span><em>●</em> <b>${esc(i.reporter)}</b> reported <b>${esc(i.category)}</b> in ${esc(i.location)} — ${esc(i.status)}</span>`
      )
    : ["<span><em>●</em> Be the first to report an issue in your area</span>"];

  const group = items.join("");
  track.innerHTML = group + group; // duplicated for seamless -50% loop
}

/* ============================================================
   MAP
============================================================ */
function initMap() {
  map = L.map("map", { scrollWheelZoom: false, attributionControl: true }).setView([19.3115, 84.7952], 13);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());
}

function markerHtml(issue) {
  const cls = issue.status === "Resolved" ? "mk-resolved" : `mk-${sevClass(issue.severity)}`;
  return `<div class="mk ${cls}"></div>`;
}

function refreshMarkers() {
  if (!map || !markersLayer) return;
  markersLayer.clearLayers();
  const bounds = [];
  issues.forEach((issue) => {
    if (issue.lat == null || issue.lng == null) return;
    const icon = L.divIcon({
      html: markerHtml(issue),
      className: "",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([issue.lat, issue.lng], { icon })
      .addTo(markersLayer)
      .bindPopup(`
        <div class="popup-title">${esc(issue.title)}</div>
        <div class="popup-meta">
          ${esc(issue.category)} · ${esc(issue.severity || "Medium")}<br/>
          Status: ${esc(issue.status)}<br/>
          ${esc(issue.reporter)} · ${timeAgo(issue.timestamp)}<br/>
          ${issue.verifiedBy || 0} community verifications
        </div>
      `);
    bounds.push([issue.lat, issue.lng]);
  });
  if (bounds.length && issues.length <= 12) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

/* ============================================================
   UPLOAD + GEMINI ANALYSIS
============================================================ */
function initUploadZone() {
  const zone = $("uploadZone");
  const input = $("imageInput");
  const removeBtn = $("previewRemove");

  zone.addEventListener("click", (e) => {
    if (e.target.closest(".preview-remove")) return;
    input.click();
  });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
  });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragging"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragging");
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resetUpload();
  });

  $("analyzeBtn").addEventListener("click", analyzeWithGemini);
  $("submitBtn").addEventListener("click", submitReport);
}

function handleImageFile(file) {
  if (!file.type.startsWith("image/")) {
    showToast("Please upload an image file.", "error");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("Image is larger than 10MB — try a smaller photo.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageBase64 = e.target.result.split(",")[1];
    const preview = $("previewImg");
    preview.src = e.target.result;
    preview.classList.remove("hidden");
    $("uploadInner").classList.add("hidden");
    $("previewRemove").classList.remove("hidden");
    $("analyzeBtn").disabled = false;
  };
  reader.readAsDataURL(file);
}

function resetUpload() {
  currentImageBase64 = null;
  $("imageInput").value = "";
  $("previewImg").classList.add("hidden");
  $("previewRemove").classList.add("hidden");
  $("uploadInner").classList.remove("hidden");
  $("analyzeBtn").disabled = true;
}

async function callGemini(prompt, imageBase64) {
  const res = await fetch(GEMINI_URL(API_KEY), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          ...(imageBase64 ? [{ inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] : []),
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function analyzeWithGemini() {
  if (!currentImageBase64) return;

  const btn = $("analyzeBtn");
  const result = $("aiResult");
  const status = $("aiStatus");

  if (!hasKey()) {
    result.classList.remove("hidden");
    $("aiText").innerHTML =
      "<strong>No Gemini API key detected.</strong><br/>Create <b>config.js</b> with your free key from aistudio.google.com — reporting still works without it.";
    $("aiTags").innerHTML = "";
    status.textContent = "Offline";
    showToast("AI analysis needs a Gemini API key in config.js", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = "Analysing…";
  result.classList.remove("hidden");
  $("aiText").textContent = "Gemini is scanning your photo…";
  $("aiTags").innerHTML = "";
  status.textContent = "Scanning image…";

  const prompt = `You are an AI assistant for a civic issue reporting platform in Berhampur, India.
Analyze this image and provide:
1. What community/infrastructure issue is visible
2. Severity level: Low / Medium / High / Critical
3. Suggested category from: Road Damage, Water Leakage, Streetlight, Waste Management, Public Infrastructure, Other
4. A brief 1-2 sentence description
5. Recommended action for authorities

Respond in this exact JSON format only, no extra text:
{
  "issue": "brief issue name",
  "severity": "Medium",
  "category": "Road Damage",
  "description": "2 sentence description",
  "action": "recommended action",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  try {
    const rawText = await callGemini(prompt, currentImageBase64);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const r = JSON.parse(jsonMatch[0]);
    const sev = (r.severity || "Medium").toLowerCase();
    const sevColor = { low: "var(--sev-low)", medium: "var(--sev-medium)", high: "var(--sev-high)", critical: "var(--sev-critical)" }[sev] || "var(--text)";

    $("aiText").innerHTML = `
      <strong style="color:${sevColor}">${esc(r.issue)}</strong> — severity
      <strong style="color:${sevColor}">${esc(r.severity)}</strong><br/>
      ${esc(r.description)}<br/>
      <em style="color:var(--muted);font-size:0.85rem">Action: ${esc(r.action)}</em>`;
    status.textContent = "Analysis complete";

    $("issueTitle").value = r.issue || "";
    if (r.category) $("issueCategory").value = r.category;
    if (r.severity) $("issueSeverity").value = r.severity;
    $("issueDesc").value = r.description || "";

    const tags = r.tags?.length ? r.tags : [r.category, r.severity].filter(Boolean);
    $("aiTags").innerHTML = tags.map((t) => `<span class="ai-tag">${esc(t)}</span>`).join("");

    showToast("AI analysis complete — form auto-filled", "success");
  } catch (err) {
    console.error("Gemini error:", err);
    $("aiText").textContent = "Could not analyse the image. Please fill in the details manually.";
    status.textContent = "Failed";
    showToast("AI analysis failed — fill details manually", "error");
  }

  btn.disabled = false;
  btn.innerHTML = "Analyse with AI";
}

/* ============================================================
   SUBMIT
============================================================ */
function submitReport() {
  const title = $("issueTitle").value.trim();
  const category = $("issueCategory").value;
  const desc = $("issueDesc").value.trim();
  const reporter = $("reporterName").value.trim() || "Anonymous";
  const location = $("issueLocation").value.trim() || "Berhampur";
  const severity = $("issueSeverity").value || "Medium";

  if (!title || !category) {
    showToast("Please add a title and category first.", "error");
    $("issueTitle").focus();
    return;
  }

  const issue = {
    id: Date.now(),
    title, category, description: desc,
    reporter, location,
    lat: 19.3115 + (Math.random() - 0.5) * 0.03,
    lng: 84.7952 + (Math.random() - 0.5) * 0.03,
    severity,
    status: "Open",
    upvotes: 0,
    verifiedBy: 0,
    image: currentImageBase64 ? `data:image/jpeg;base64,${currentImageBase64}` : null,
    timestamp: new Date().toISOString(),
  };

  issues.unshift(issue);
  save();
  activeFilter = "all";
  syncPillUI();
  renderAll();
  resetForm();
  showToast(`Report submitted — thank you, ${reporter}. You earned 10 pts.`, "success");
  document.querySelector("#live").scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth" });
}

function resetForm() {
  $("issueTitle").value = "";
  $("issueCategory").value = "";
  $("issueSeverity").value = "Medium";
  $("issueDesc").value = "";
  $("issueLocation").value = "";
  $("reporterName").value = "";
  $("aiResult").classList.add("hidden");
  resetUpload();
}

/* ============================================================
   FEED
============================================================ */
function initFilters() {
  document.querySelectorAll("#filterPills .pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      activeFilter = pill.dataset.filter;
      syncPillUI();
      renderFeed();
      refreshMarkers();
    });
  });
  syncPillUI();
}

function syncPillUI() {
  document.querySelectorAll("#filterPills .pill").forEach((p) => {
    const f = p.dataset.filter;
    const count = f === "all" ? issues.length : issues.filter((i) => i.category === f).length;
    p.innerHTML = `${f === "all" ? "All" : esc(f)}<span class="pill-count">${count}</span>`;
    p.classList.toggle("active", f === activeFilter);
  });
}

function issueCard(issue) {
  const sev = sevClass(issue.severity);
  const art = CATEGORY_ART[issue.category] || "art-other";
  const icon = CATEGORY_ICON[issue.category] || CATEGORY_ICON["Other"];
  const media = issue.image
    ? `<img src="${issue.image}" alt="${esc(issue.title)}" loading="lazy" />`
    : `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">${icon}</svg>`;

  return `
  <article class="issue-card">
    <div class="issue-art ${art}">${media}</div>
    <div class="issue-card-body">
      <div class="issue-meta">
        <span class="issue-category">${esc(issue.category)}</span>
        <span class="sev-badge sev-${sev}">${esc((issue.severity || "Medium"))}</span>
      </div>
      <h3>${esc(issue.title)}</h3>
      <p class="issue-desc">${esc(issue.description || "No description provided.")}</p>
      <div class="issue-foot">
        <span><svg viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="2"/></svg>${esc(issue.location)}</span>
        <span><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>${esc(issue.reporter)}</span>
        <span style="margin-left:auto">${timeAgo(issue.timestamp)}</span>
      </div>
      <div class="card-actions">
        <button class="act-btn" onclick="upvote(${issue.id})" aria-label="Upvote">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 4l8 9h-5v7H9v-7H4l8-9z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${issue.upvotes || 0}
        </button>
        <button class="act-btn ${issue.verifiedBy > 0 ? "on" : ""}" onclick="verify(${issue.id})" aria-label="Verify">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5L20 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>${issue.verifiedBy || 0}
        </button>
        <button class="act-btn" onclick="shareIssue(${issue.id})" aria-label="Share">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="6" r="2.5" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="2.5" stroke="currentColor" stroke-width="2"/><path d="M8.2 10.8l7.5-3.7M8.2 13.2l7.5 3.7" stroke="currentColor" stroke-width="2"/></svg>
        </button>
        <select class="status-select" onchange="updateStatus(${issue.id}, this.value)" aria-label="Update status">
          <option value="Open" ${issue.status === "Open" ? "selected" : ""}>Open</option>
          <option value="In Progress" ${issue.status === "In Progress" ? "selected" : ""}>In progress</option>
          <option value="Resolved" ${issue.status === "Resolved" ? "selected" : ""}>Resolved</option>
        </select>
      </div>
    </div>
  </article>`;
}

function renderFeed(animate = true) {
  const container = $("issuesList");
  const list = activeFilter === "all" ? issues : issues.filter((i) => i.category === activeFilter);

  if (!list.length) {
    container.innerHTML = `<p class="feed-empty">No issues in this category yet — be the first to report one</p>`;
    return;
  }
  container.innerHTML = list.slice(0, 12).map(issueCard).join("");

  // staggered scroll-reveal only when the set changes (not on upvote/verify)
  if (animate && !prefersReduced && "IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        el.classList.add("in");
        obs.unobserve(el);
        setTimeout(() => { el.classList.remove("enter", "in"); el.style.transitionDelay = ""; }, 1100);
      });
    }, { threshold: 0.08 });
    container.querySelectorAll(".issue-card").forEach((c, i) => {
      c.classList.add("enter");
      c.style.transitionDelay = `${Math.min(i, 7) * 70}ms`;
      obs.observe(c);
    });
  }
}

/* ============================================================
   CARD ACTIONS
============================================================ */
function findIssue(id) { return issues.find((i) => i.id === id); }

function upvote(id) {
  const issue = findIssue(id);
  if (!issue) return;
  issue.upvotes = (issue.upvotes || 0) + 1;
  save();
  renderFeed();
  refreshMarkers();
}

function verify(id) {
  const issue = findIssue(id);
  if (!issue) return;
  issue.verifiedBy = (issue.verifiedBy || 0) + 1;
  save();
  renderFeed();
  refreshMarkers();
  updateStats();
  showToast("Verified — thanks for being the community's eyes.", "success");
}

function updateStatus(id, newStatus) {
  const issue = findIssue(id);
  if (!issue) return;
  issue.status = newStatus;
  save();
  renderAll();
  showToast(`Status updated to “${newStatus}”`, "success");
}

function shareIssue(id) {
  const issue = findIssue(id);
  if (!issue) return;
  const text = `Civic issue reported on CivicReport:\n\n${issue.title}\n${issue.category} — ${issue.severity || "Medium"} severity\nLocation: ${issue.location}\nStatus: ${issue.status}\n\nReported by ${issue.reporter}`;

  if (navigator.share) {
    navigator.share({ title: issue.title, text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    showToast("Issue details copied to clipboard", "success");
  }
}

/* ============================================================
   STATS / DASHBOARD / HEALTH
============================================================ */
function updateStats() {
  if (statsAnimated) setStatsDirect();
  else if (prefersReduced) { statsAnimated = true; setStatsDirect(); }
}

function updateDashboard() {
  const cats = {
    "Road Damage":      { c: "count-road",  b: "bar-road" },
    "Water Leakage":    { c: "count-water", b: "bar-water" },
    "Streetlight":      { c: "count-light", b: "bar-light" },
    "Waste Management": { c: "count-waste", b: "bar-waste" },
  };
  const max = Math.max(1, ...Object.keys(cats).map((c) => issues.filter((i) => i.category === c).length));
  Object.entries(cats).forEach(([cat, ids]) => {
    const count = issues.filter((i) => i.category === cat).length;
    const cEl = $(ids.c), bEl = $(ids.b);
    if (cEl) cEl.textContent = count;
    if (bEl) bEl.style.width = `${(count / max) * 100}%`;
  });
  renderCharts();
}

function updateHealthScore() {
  const ring = $("healthRing");
  const scoreEl = $("healthScore");
  const labelEl = $("healthLabel");
  const total = issues.length;

  let score = 100, target = 78;
  if (total > 0) {
    const resolved = issues.filter((i) => i.status === "Resolved").length;
    const critical = issues.filter((i) => (i.severity || "").toLowerCase() === "critical").length;
    const high = issues.filter((i) => (i.severity || "").toLowerCase() === "high").length;
    score -= critical * 15;
    score -= high * 8;
    score -= (total - resolved) * 3;
    score += resolved * 5;
    target = Math.max(0, Math.min(100, Math.round(score)));
  }

  const color = target >= 70 ? "var(--green)" : target >= 40 ? "var(--amber)" : "var(--red)";
  const C = 339.3;
  if (ring) {
    ring.style.strokeDashoffset = C - (target / 100) * C;
    ring.style.stroke = color;
  }
  if (labelEl) labelEl.textContent = target >= 70 ? "Healthy" : target >= 40 ? "Strained" : "Critical";

  if (scoreEl) {
    const t0 = performance.now();
    const from = parseInt(scoreEl.textContent, 10) || 0;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 900);
      scoreEl.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    scoreEl.style.color = color;
  }
}

/* ============================================================
   GAMIFICATION
============================================================ */
function getPoints(reporter) {
  const reports = issues.filter((i) => i.reporter === reporter);
  const reportCount = reports.length;
  const resolveCount = reports.filter((i) => i.status === "Resolved").length;
  const verifyCount = reports.reduce((a, b) => a + (b.verifiedBy || 0), 0);
  return reportCount * 10 + resolveCount * 25 + verifyCount * 5;
}

function getBadge(points) {
  if (points >= 100) return "City Champion";
  if (points >= 50) return "Active Citizen";
  if (points >= 20) return "Contributor";
  return "Newcomer";
}

function renderLeaderboard() {
  const body = $("leaderboardBody");
  if (!body) return;

  const ranked = [...new Set(issues.map((i) => i.reporter))]
    .map((r) => ({
      name: r,
      points: getPoints(r),
      reports: issues.filter((i) => i.reporter === r).length,
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 8);

  if (!ranked.length) {
    body.innerHTML = `<div class="lb-empty">No citizens yet — report an issue to appear here.</div>`;
    return;
  }

  body.innerHTML = ranked
    .map((c, i) => `
      <div class="lb-row ${i === 0 ? "top" : ""}">
        <span class="lb-rank">${String(i + 1).padStart(2, "0")}</span>
        <span class="lb-name">${esc(c.name)}<span class="badge-pill">${getBadge(c.points)}</span></span>
        <span class="lb-right lb-points">${c.points} pts</span>
        <span class="lb-right lb-reports">${c.reports} reports</span>
      </div>`)
    .join("");
}

/* ============================================================
   PREDICTIVE INSIGHTS (Gemini)
============================================================ */
async function generateInsights() {
  const btn = $("insightsBtn");
  const container = $("insightsGrid");
  if (!container) return;
  const btnHTML = btn.innerHTML;

  if (!hasKey()) {
    container.innerHTML = `<p class="insights-empty">Add a free Gemini API key in config.js to unlock predictive insights</p>`;
    showToast("AI insights need a Gemini API key in config.js", "error");
    return;
  }
  if (issues.length === 0) {
    container.innerHTML = `<p class="insights-empty">Report some issues first — the AI needs data to analyse</p>`;
    return;
  }

  btn.disabled = true;
  btn.innerHTML = "Generating insights…";
  container.innerHTML = `<p class="insights-empty">Gemini is reading your city data…</p>`;

  const summary = {
    total: issues.length,
    resolved: issues.filter((i) => i.status === "Resolved").length,
    open: issues.filter((i) => i.status === "Open").length,
    inProgress: issues.filter((i) => i.status === "In Progress").length,
    byCategory: {},
    bySeverity: {},
  };
  issues.forEach((i) => {
    summary.byCategory[i.category] = (summary.byCategory[i.category] || 0) + 1;
    const s = i.severity || "Medium";
    summary.bySeverity[s] = (summary.bySeverity[s] || 0) + 1;
  });

  const prompt = `You are a smart city AI analyst for Berhampur, India. Based on this civic issue data, generate exactly 4 predictive insights for city authorities:

${JSON.stringify(summary)}

Return ONLY this JSON (no extra text):
{
  "insights": [
    {
      "title": "short punchy title",
      "text": "2 sentence insight or prediction",
      "tag": "Warning|Good|Critical",
      "tagLabel": "short label e.g. Monsoon risk"
    }
  ]
}`;

  try {
    const rawText = await callGemini(prompt);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]);

    container.innerHTML = result.insights
      .map(
        (ins) => `
        <div class="insight-card">
          <span class="insight-tag tag-${(ins.tag || "warning").toLowerCase()}">${esc(ins.tagLabel || ins.tag)}</span>
          <h4>${esc(ins.title)}</h4>
          <p>${esc(ins.text)}</p>
        </div>`
      )
      .join("");
    showToast("City insights generated", "success");
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="insights-empty">Could not generate insights — check the API key and try again</p>`;
    showToast("Insight generation failed", "error");
  }

  btn.disabled = false;
  btn.innerHTML = "Generate insights";
}

/* ============================================================
   CHARTS (Chart.js)
============================================================ */
let categoryChart = null;
let statusChart = null;

function renderCharts() {
  const catCtx = $("categoryChart");
  const statusCtx = $("statusChart");
  if (!catCtx || !statusCtx || typeof Chart === "undefined") return;

  const categories = ["Road Damage", "Water Leakage", "Streetlight", "Waste Management", "Public Infrastructure", "Other"];
  const shortLabels = ["Road", "Water", "Light", "Waste", "Infra", "Other"];
  const catCounts = categories.map((c) => issues.filter((i) => i.category === c).length);

  const statuses = ["Open", "In Progress", "Resolved"];
  const statusCounts = statuses.map((s) => issues.filter((i) => i.status === s).length);

  const mono = { family: "'JetBrains Mono', monospace", size: 11 };

  try {
  if (categoryChart) categoryChart.destroy();
  if (statusChart) statusChart.destroy();

  categoryChart = new Chart(catCtx, {
    type: "bar",
    data: {
      labels: shortLabels,
      datasets: [{
        label: "Issues",
        data: catCounts,
        backgroundColor: "rgba(255, 90, 31, 0.85)",
        hoverBackgroundColor: "#FF5A1F",
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 42,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1B1915",
          borderColor: "rgba(242,239,230,0.2)",
          borderWidth: 1,
          titleColor: "#F2EFE6",
          bodyColor: "#8F8A79",
          titleFont: mono,
          bodyFont: mono,
          padding: 12,
          displayColors: false,
        },
      },
      scales: {
        x: {
          ticks: { color: "#8F8A79", font: mono },
          grid: { display: false },
          border: { color: "rgba(242,239,230,0.12)" },
        },
        y: {
          ticks: { color: "#8F8A79", font: mono, stepSize: 1, precision: 0 },
          grid: { color: "rgba(242,239,230,0.06)" },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });

  statusChart = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: statuses,
      datasets: [{
        data: statusCounts,
        backgroundColor: ["#FF5A1F", "#FFC24B", "#7BD88F"],
        borderColor: "#151310",
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8F8A79", font: mono, padding: 16, boxWidth: 10, boxHeight: 10, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: "#1B1915",
          borderColor: "rgba(242,239,230,0.2)",
          borderWidth: 1,
          titleColor: "#F2EFE6",
          bodyColor: "#8F8A79",
          titleFont: mono,
          bodyFont: mono,
          padding: 12,
        },
      },
    },
  });
  } catch (err) {
    console.warn("Charts unavailable:", err.message);
  }
}

/* ============================================================
   TOAST
============================================================ */
let toastTimer = null;
function showToast(message, type = "success") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3600);
}

/* Expose handlers used in inline onclick */
Object.assign(window, { upvote, verify, updateStatus, shareIssue, generateInsights });
