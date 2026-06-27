// ============================================================
//  CivicReport — app.js  (Day 2 Update)
//  Replace YOUR_GEMINI_API_KEY with your real key
// ============================================================

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"; // 🔑 paste your key here

// ===== STATE =====
let issues = JSON.parse(localStorage.getItem("civicIssues") || "[]");
let currentImageBase64 = null;
let map = null;

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  renderIssues();
  updateStats();
  updateDashboard();
  animateHeroStats();
  setupUploadZone();
});

// ===== MAP =====
function initMap() {
  map = L.map("map").setView([19.3149, 84.7941], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);
  issues.forEach(issue => addMarkerToMap(issue));
}

function addMarkerToMap(issue) {
  if (!issue.lat || !issue.lng) return;
  const color = issue.status === "Resolved" ? "#10b981" : issue.status === "In Progress" ? "#f59e0b" : "#ef4444";
  const marker = L.circleMarker([issue.lat, issue.lng], {
    radius: 10, fillColor: color, color: "#fff",
    weight: 2, opacity: 1, fillOpacity: 0.9
  }).addTo(map);
  marker.bindPopup(`
    <strong>${issue.title}</strong><br/>
    <em>${issue.category}</em> — <strong>${issue.severity || 'Medium'}</strong><br/>
    Status: ${issue.status}<br/>
    By: ${issue.reporter}<br/>
    ✅ ${issue.verifiedBy || 0} community verifications
  `);
}

// ===== UPLOAD ZONE =====
function setupUploadZone() {
  const zone = document.getElementById("uploadZone");
  const input = document.getElementById("imageInput");

  zone.addEventListener("click", () => input.click());
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

  document.getElementById("analyzeBtn").addEventListener("click", analyzeWithGemini);
  document.getElementById("submitBtn").addEventListener("click", submitReport);
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result.split(",")[1];
    currentImageBase64 = base64;
    const preview = document.getElementById("previewImg");
    preview.src = e.target.result;
    preview.classList.remove("hidden");
    document.getElementById("uploadInner").classList.add("hidden");
    document.getElementById("analyzeBtn").disabled = false;
  };
  reader.readAsDataURL(file);
}

// ===== GEMINI AI ANALYSIS =====
async function analyzeWithGemini() {
  if (!currentImageBase64) return;

  const btn = document.getElementById("analyzeBtn");
  btn.textContent = "⏳ Analyzing...";
  btn.disabled = true;

  const aiResult = document.getElementById("aiResult");
  const aiText = document.getElementById("aiText");
  const aiTags = document.getElementById("aiTags");

  aiResult.classList.remove("hidden");
  aiText.textContent = "Gemini is analyzing your image...";
  aiTags.innerHTML = "";

  const prompt = `You are an AI assistant for a civic issue reporting platform. 
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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: currentImageBase64 } }
            ]
          }]
        })
      }
    );

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const severityColor = { "Low": "#10b981", "Medium": "#f59e0b", "High": "#ef4444", "Critical": "#dc2626" }[result.severity] || "#3b82f6";

      aiText.innerHTML = `
        <strong style="color:${severityColor}">⚠️ ${result.issue}</strong> — Severity: 
        <span style="color:${severityColor}">${result.severity}</span><br/>
        ${result.description}<br/>
        <em style="color:#64748b; font-size:0.85rem">💡 ${result.action}</em>
      `;

      document.getElementById("issueTitle").value = result.issue;
      document.getElementById("issueCategory").value = result.category;
      document.getElementById("issueDesc").value = result.description;

      // store severity for submit
      document.getElementById("analyzeBtn").dataset.severity = result.severity;

      (result.tags || [result.category, result.severity]).forEach(tag => {
        const span = document.createElement("span");
        span.className = "ai-tag";
        span.textContent = tag;
        aiTags.appendChild(span);
      });
    } else {
      aiText.textContent = rawText || "Analysis complete. Please fill in the details below.";
    }
  } catch (err) {
    aiText.textContent = "⚠️ Could not analyze image. Please fill in details manually.";
    console.error("Gemini error:", err);
  }

  btn.textContent = "✅ Analyzed";
}

// ===== SUBMIT REPORT =====
function submitReport() {
  const title = document.getElementById("issueTitle").value.trim();
  const category = document.getElementById("issueCategory").value;
  const desc = document.getElementById("issueDesc").value.trim();
  const reporter = document.getElementById("reporterName").value.trim() || "Anonymous";
  const location = document.getElementById("issueLocation").value.trim() || "Berhampur, Odisha";
  const severity = document.getElementById("analyzeBtn").dataset.severity || "Medium";

  if (!title || !category) {
    showToast("⚠️ Please fill in title and category!", "error");
    return;
  }

  const lat = 19.3149 + (Math.random() - 0.5) * 0.04;
  const lng = 84.7941 + (Math.random() - 0.5) * 0.04;

  const issue = {
    id: Date.now(),
    title, category, description: desc,
    reporter, location, lat, lng,
    severity,
    status: "Open",
    upvotes: 0,
    verifiedBy: 0,
    image: currentImageBase64 ? `data:image/jpeg;base64,${currentImageBase64}` : null,
    timestamp: new Date().toISOString()
  };

  issues.unshift(issue);
  localStorage.setItem("civicIssues", JSON.stringify(issues));

  addMarkerToMap(issue);
  renderIssues();
  updateStats();
  updateDashboard();
  resetForm();
  showToast("✅ Issue reported successfully! Thank you, " + reporter);
}

// ===== RENDER ISSUES (Day 2) =====
function renderIssues() {
  const container = document.getElementById("issuesList");
  if (issues.length === 0) {
    container.innerHTML = `<p style="color:var(--muted); grid-column:1/-1; text-align:center; padding:2rem;">No issues reported yet. Be the first! 👆</p>`;
    return;
  }
  container.innerHTML = issues.slice(0, 9).map(issue => {
    const sev = (issue.severity || "medium").toLowerCase();
    const isCritical = sev === "critical";
    const verifiedCount = issue.verifiedBy || 0;

    return `
    <div class="issue-card ${isCritical ? 'critical-issue' : ''}">
      ${issue.image
        ? `<img src="${issue.image}" alt="${issue.title}" />`
        : `<div style="height:160px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:3rem;">📍</div>`}
      <div class="issue-card-body">
        <div class="issue-meta">
          <span class="issue-category">${issue.category}</span>
          <span class="severity-badge severity-${sev}">${sev.toUpperCase()}</span>
        </div>
        <h3>${issue.title}</h3>
        <p>${issue.description || "No description provided."}</p>
        <div class="issue-footer">
          <span>📍 ${issue.location}</span>
          <span>👤 ${issue.reporter}</span>
        </div>
        <div class="card-actions">
          <button class="upvote-btn" onclick="upvote(${issue.id})">👍 ${issue.upvotes}</button>
          <button class="verify-btn ${verifiedCount > 0 ? 'verified' : ''}" onclick="verify(${issue.id})">
            ✅ ${verifiedCount} verified
          </button>
          <select class="status-select" onchange="updateStatus(${issue.id}, this.value)">
            <option value="Open"        ${issue.status === 'Open'        ? 'selected' : ''}>🔴 Open</option>
            <option value="In Progress" ${issue.status === 'In Progress' ? 'selected' : ''}>🟡 In Progress</option>
            <option value="Resolved"    ${issue.status === 'Resolved'    ? 'selected' : ''}>🟢 Resolved</option>
          </select>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ===== UPVOTE =====
function upvote(id) {
  const issue = issues.find(i => i.id === id);
  if (issue) {
    issue.upvotes++;
    localStorage.setItem("civicIssues", JSON.stringify(issues));
    renderIssues();
  }
}

// ===== VERIFY (Day 2) =====
function verify(id) {
  const issue = issues.find(i => i.id === id);
  if (issue) {
    issue.verifiedBy = (issue.verifiedBy || 0) + 1;
    localStorage.setItem("civicIssues", JSON.stringify(issues));
    renderIssues();
    showToast("✅ You verified this issue — thank you citizen!");
  }
}

// ===== STATUS UPDATE (Day 2) =====
function updateStatus(id, newStatus) {
  const issue = issues.find(i => i.id === id);
  if (issue) {
    issue.status = newStatus;
    localStorage.setItem("civicIssues", JSON.stringify(issues));
    updateStats();
    updateDashboard();
    showToast(`Status updated to: ${newStatus}`);
  }
}

// ===== STATS =====
function updateStats() {
  document.getElementById("stat-reported").textContent = issues.length;
  document.getElementById("stat-resolved").textContent = issues.filter(i => i.status === "Resolved").length;
  document.getElementById("stat-citizens").textContent = new Set(issues.map(i => i.reporter)).size;
}

function animateHeroStats() {
  const targets = { reported: issues.length + 47, resolved: 23, citizens: issues.length + 31 };
  ["reported", "resolved", "citizens"].forEach(key => {
    let count = 0;
    const target = targets[key];
    const el = document.getElementById(`stat-${key}`);
    const step = Math.ceil(target / 40);
    const timer = setInterval(() => {
      count = Math.min(count + step, target);
      el.textContent = count;
      if (count >= target) clearInterval(timer);
    }, 40);
  });
}

// ===== DASHBOARD =====
function updateDashboard() {
  const categories = {
    "Road Damage":      { countId: "count-road",  barId: "bar-road"  },
    "Water Leakage":    { countId: "count-water", barId: "bar-water" },
    "Streetlight":      { countId: "count-light", barId: "bar-light" },
    "Waste Management": { countId: "count-waste", barId: "bar-waste" },
  };
  const max = Math.max(1, issues.length);
  Object.entries(categories).forEach(([cat, ids]) => {
    const count = issues.filter(i => i.category === cat).length;
    document.getElementById(ids.countId).textContent = count;
    document.getElementById(ids.barId).style.width = `${(count / max) * 100}%`;
  });
}

// ===== RESET FORM =====
function resetForm() {
  document.getElementById("issueTitle").value = "";
  document.getElementById("issueCategory").value = "";
  document.getElementById("issueDesc").value = "";
  document.getElementById("issueLocation").value = "";
  document.getElementById("reporterName").value = "";
  document.getElementById("previewImg").classList.add("hidden");
  document.getElementById("uploadInner").classList.remove("hidden");
  document.getElementById("aiResult").classList.add("hidden");
  document.getElementById("analyzeBtn").disabled = true;
  document.getElementById("analyzeBtn").textContent = "🔍 Analyze with Gemini";
  document.getElementById("analyzeBtn").dataset.severity = "";
  currentImageBase64 = null;
}

// ===== TOAST =====
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.borderColor = type === "error" ? "var(--red)" : "var(--green)";
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

// ============================================================
//  DAY 3 FEATURES
// ============================================================

// ===== NEWS TICKER =====
function updateTicker() {
  const track = document.getElementById("tickerTrack");
  if (!track) return;

  const defaults = [
    "🔴 Stay alert — report issues in your area",
    "💡 Together we can fix our city",
    "📍 CivicReport — powered by Gemini AI",
  ];

  const items = issues.length > 0
    ? issues.slice(0, 6).map(i =>
        `🔴 <strong>${i.reporter}</strong> reported <strong>${i.category}</strong> in ${i.location} &nbsp;•&nbsp; Status: ${i.status}`
      )
    : defaults;

  track.innerHTML = items.map(i => `<span>${i}</span>`).join("");
}

// ===== CITY HEALTH SCORE =====
function updateHealthScore() {
  const wrap = document.querySelector(".health-score-wrap");
  if (!wrap) return;

  const total = issues.length;
  if (total === 0) return;

  const resolved  = issues.filter(i => i.status === "Resolved").length;
  const critical  = issues.filter(i => (i.severity || "").toLowerCase() === "critical").length;
  const highCount = issues.filter(i => (i.severity || "").toLowerCase() === "high").length;

  let score = 100;
  score -= (critical * 15);
  score -= (highCount * 8);
  score -= ((total - resolved) * 3);
  score += (resolved * 5);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const circumference = 314;
  const offset = circumference - (score / 100) * circumference;
  const ring = document.getElementById("healthRing");
  const scoreEl = document.getElementById("healthScore");

  if (ring) ring.style.strokeDashoffset = offset;

  // animate number
  if (scoreEl) {
    let count = 0;
    const timer = setInterval(() => {
      count = Math.min(count + 2, score);
      scoreEl.textContent = count;
      if (count >= score) clearInterval(timer);
    }, 30);
  }

  // color based on score
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  if (ring) ring.style.stroke = color;
  if (scoreEl) scoreEl.style.color = color;
}

// ===== GAMIFICATION: POINTS SYSTEM =====
function getPoints(reporter) {
  const reportCount  = issues.filter(i => i.reporter === reporter).length;
  const resolveCount = issues.filter(i => i.reporter === reporter && i.status === "Resolved").length;
  const verifyCount  = issues.filter(i => i.reporter === reporter).reduce((a, b) => a + (b.verifiedBy || 0), 0);
  return (reportCount * 10) + (resolveCount * 25) + (verifyCount * 5);
}

function getBadge(points) {
  if (points >= 100) return "🏆 Champion";
  if (points >= 50)  return "⭐ Active Citizen";
  if (points >= 20)  return "🌱 Contributor";
  return "👋 Newcomer";
}

function renderLeaderboard() {
  const section = document.getElementById("leaderboardBody");
  if (!section) return;

  const reporters = [...new Set(issues.map(i => i.reporter))];
  const ranked = reporters
    .map(r => ({ name: r, points: getPoints(r), badge: getBadge(getPoints(r)) }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 8);

  if (ranked.length === 0) {
    section.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1.5rem;">No citizens yet — report an issue to appear here!</td></tr>`;
    return;
  }

  section.innerHTML = ranked.map((c, i) => `
    <tr>
      <td><span class="rank-badge rank-${i+1}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span></td>
      <td>${c.name} <span class="citizen-badge">${c.badge}</span></td>
      <td style="color:var(--accent);font-weight:600">${c.points} pts</td>
      <td style="color:var(--muted);font-size:0.8rem">${issues.filter(x => x.reporter === c.name).length} reports</td>
    </tr>
  `).join("");
}

// ===== PREDICTIVE INSIGHTS (Gemini) =====
async function generateInsights() {
  const btn = document.getElementById("insightsBtn");
  const container = document.getElementById("insightsGrid");
  if (!container) return;

  if (issues.length === 0) {
    container.innerHTML = `<p class="insights-loading">Report some issues first to generate insights! 📊</p>`;
    return;
  }

  btn.textContent = "⏳ Generating...";
  btn.disabled = true;
  container.innerHTML = `<p class="insights-loading">✨ Gemini is analyzing your city data...</p>`;

  const summary = {
    total: issues.length,
    byCategory: {},
    bySeverity: {},
    resolved: issues.filter(i => i.status === "Resolved").length,
    open: issues.filter(i => i.status === "Open").length,
  };

  issues.forEach(i => {
    summary.byCategory[i.category] = (summary.byCategory[i.category] || 0) + 1;
    const sev = i.severity || "Medium";
    summary.bySeverity[sev] = (summary.bySeverity[sev] || 0) + 1;
  });

  const prompt = `You are a smart city AI analyst. Based on this civic issue data, generate 4 predictive insights:

Data: ${JSON.stringify(summary)}

Return ONLY this JSON (no extra text):
{
  "insights": [
    {
      "icon": "emoji",
      "title": "short title",
      "text": "2 sentence insight or prediction",
      "tag": "Warning|Good|Critical",
      "tagLabel": "short label"
    }
  ]
}`;

  try {
    const response = await fetch(
      "YOUR_GEMINI_API_KEY"
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      container.innerHTML = result.insights.map(ins => `
        <div class="insight-card">
          <div class="insight-icon">${ins.icon}</div>
          <div class="insight-title">${ins.title}</div>
          <div class="insight-text">${ins.text}</div>
          <span class="insight-tag tag-${ins.tag.toLowerCase()}">${ins.tagLabel}</span>
        </div>
      `).join("");
    } else {
      throw new Error("No JSON in response");
    }
  } catch (err) {
    container.innerHTML = `<p class="insights-loading">⚠️ Could not generate insights. Try again!</p>`;
    console.error(err);
  }

  btn.textContent = "🔄 Refresh Insights";
  btn.disabled = false;
}

// ===== HEATMAP PULSE on MAP =====
function addHeatmapPulse() {
  if (!map) return;
  issues.forEach(issue => {
    if (!issue.lat || !issue.lng) return;
    const sev = (issue.severity || "medium").toLowerCase();
    const color = sev === "critical" ? "#dc2626" : sev === "high" ? "#ef4444" : sev === "medium" ? "#f59e0b" : "#10b981";
    const size  = sev === "critical" ? 30 : sev === "high" ? 22 : 15;

    L.circleMarker([issue.lat, issue.lng], {
      radius: size, fillColor: color,
      color: color, weight: 1,
      opacity: 0.3, fillOpacity: 0.15
    }).addTo(map);
  });
}

// ===== HOOK INTO EXISTING INIT =====
const _originalInit = document.addEventListener;
window.addEventListener("load", () => {
  updateTicker();
  updateHealthScore();
  renderLeaderboard();
  addHeatmapPulse();
  generateInsights();
});

// ============================================================
//  DAY 4 FEATURES
// ============================================================

// ===== SHARE ISSUE =====
function shareIssue(id) {
  const issue = issues.find(i => i.id === id);
  if (!issue) return;

  const text = `🚨 Civic Issue Reported!\n\n📍 ${issue.location}\n🏷️ ${issue.category} — ${issue.severity || 'Medium'} Severity\n📝 ${issue.title}\n\n${issue.description || ''}\n\nStatus: ${issue.status}\n\nReported via CivicReport 🌆`;

  if (navigator.share) {
    navigator.share({ title: issue.title, text: text });
  } else {
    navigator.clipboard.writeText(text);
    showToast("📋 Issue details copied to clipboard!");
  }
}

// ===== PULSING HEATMAP =====
function addPulsingHeatmap() {
  if (!map) return;

  issues.forEach(issue => {
    if (!issue.lat || !issue.lng) return;
    const sev = (issue.severity || "medium").toLowerCase();
    const color  = sev === "critical" ? "#dc2626" : sev === "high" ? "#ef4444" : sev === "medium" ? "#f59e0b" : "#10b981";
    const radius = sev === "critical" ? 35 : sev === "high" ? 25 : sev === "medium" ? 18 : 12;

    // outer pulse ring
    L.circleMarker([issue.lat, issue.lng], {
      radius: radius,
      fillColor: color,
      color: color,
      weight: 2,
      opacity: 0.25,
      fillOpacity: 0.12,
      className: 'pulse-ring'
    }).addTo(map);

    // inner solid dot
    L.circleMarker([issue.lat, issue.lng], {
      radius: 7,
      fillColor: color,
      color: "#fff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.95
    }).addTo(map).bindPopup(`
      <div style="font-family:sans-serif;min-width:160px">
        <strong style="color:${color}">${issue.title}</strong><br/>
        <span style="font-size:0.8rem;color:#666">${issue.category} • ${issue.severity || 'Medium'}</span><br/>
        <span style="font-size:0.8rem">Status: ${issue.status}</span><br/>
        <span style="font-size:0.8rem">👤 ${issue.reporter}</span>
      </div>
    `);
  });
}

// ===== SCROLL ANIMATIONS =====
function initScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.dash-card, .insight-card, .issue-card').forEach(el => {
    el.style.opacity = "0";
    el.style.transform = "translateY(20px)";
    el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
    observer.observe(el);
  });
}

// ===== FILTER ISSUES =====
function filterIssues(category) {
  const filtered = category === "all"
    ? issues
    : issues.filter(i => i.category === category);

  const container = document.getElementById("issuesList");
  if (filtered.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);grid-column:1/-1;text-align:center;padding:2rem;">No issues in this category yet!</p>`;
    return;
  }

  container.innerHTML = filtered.slice(0, 9).map(issue => {
    const sev = (issue.severity || "medium").toLowerCase();
    const isCritical = sev === "critical";
    const verifiedCount = issue.verifiedBy || 0;
    return `
    <div class="issue-card ${isCritical ? 'critical-issue' : ''}">
      ${issue.image
        ? `<img src="${issue.image}" alt="${issue.title}" />`
        : `<div style="height:160px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:3rem;">📍</div>`}
      <div class="issue-card-body">
        <div class="issue-meta">
          <span class="issue-category">${issue.category}</span>
          <span class="severity-badge severity-${sev}">${sev.toUpperCase()}</span>
        </div>
        <h3>${issue.title}</h3>
        <p>${issue.description || "No description provided."}</p>
        <div class="issue-footer">
          <span>📍 ${issue.location}</span>
          <span>👤 ${issue.reporter}</span>
        </div>
        <div class="card-actions">
          <button class="upvote-btn" onclick="upvote(${issue.id})">👍 ${issue.upvotes}</button>
          <button class="verify-btn ${verifiedCount > 0 ? 'verified' : ''}" onclick="verify(${issue.id})">✅ ${verifiedCount}</button>
          <button class="share-btn" onclick="shareIssue(${issue.id})">📤 Share</button>
          <select class="status-select" onchange="updateStatus(${issue.id}, this.value)">
            <option value="Open"        ${issue.status === 'Open'        ? 'selected' : ''}>🔴 Open</option>
            <option value="In Progress" ${issue.status === 'In Progress' ? 'selected' : ''}>🟡 In Progress</option>
            <option value="Resolved"    ${issue.status === 'Resolved'    ? 'selected' : ''}>🟢 Resolved</option>
          </select>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ===== HOOK DAY 4 INTO LOAD =====
window.addEventListener("load", () => {
  addPulsingHeatmap();
  initScrollAnimations();
});

// ============================================================
//  CHARTS — Chart.js
// ============================================================

let categoryChartInstance = null;
let statusChartInstance = null;

function renderCharts() {
  const categoryCtx = document.getElementById("categoryChart");
  const statusCtx = document.getElementById("statusChart");
  if (!categoryCtx || !statusCtx) return;

  // ---- Data ----
  const categories = ["Road Damage", "Water Leakage", "Streetlight", "Waste Management", "Public Infrastructure", "Other"];
  const categoryCounts = categories.map(c => issues.filter(i => i.category === c).length);

  const statusLabels = ["Open", "In Progress", "Resolved"];
  const statusCounts = statusLabels.map(s => issues.filter(i => i.status === s).length);

  // ---- Destroy old charts if exist ----
  if (categoryChartInstance) categoryChartInstance.destroy();
  if (statusChartInstance) statusChartInstance.destroy();

  // ---- Category Bar Chart ----
  categoryChartInstance = new Chart(categoryCtx, {
    type: "bar",
    data: {
      labels: ["Road", "Water", "Light", "Waste", "Infrastructure", "Other"],
      datasets: [{
        label: "Issues",
        data: categoryCounts,
        backgroundColor: [
          "rgba(59,130,246,0.7)",
          "rgba(6,182,212,0.7)",
          "rgba(245,158,11,0.7)",
          "rgba(16,185,129,0.7)",
          "rgba(139,92,246,0.7)",
          "rgba(100,116,139,0.7)",
        ],
        borderColor: [
          "#3b82f6","#06b6d4","#f59e0b","#10b981","#8b5cf6","#64748b"
        ],
        borderWidth: 1,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a2235",
          titleColor: "#f1f5f9",
          bodyColor: "#64748b",
          borderColor: "#1e2d45",
          borderWidth: 1,
        }
      },
      scales: {
        x: {
  ticks: { 
    color: "#64748b", 
    font: { size: 11 },
    maxRotation: 0,  // yeh add kar
    minRotation: 0   // yeh add kar
  },
  grid: { color: "rgba(30,45,69,0.5)" }
},
        y: {
          ticks: { color: "#64748b", stepSize: 1 },
          grid: { color: "rgba(30,45,69,0.5)" },
          beginAtZero: true,
        }
      }
    }
  });

  // ---- Status Donut Chart ----
  statusChartInstance = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: statusLabels,
      datasets: [{
        data: statusCounts,
        backgroundColor: [
          "rgba(239,68,68,0.8)",
          "rgba(245,158,11,0.8)",
          "rgba(16,185,129,0.8)",
        ],
        borderColor: ["#ef4444","#f59e0b","#10b981"],
        borderWidth: 2,
        hoverOffset: 6,
      }]
    },
    options: {
      responsive: true,
      cutout: "65%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#64748b",
            font: { size: 11 },
            padding: 16,
          }
        },
        tooltip: {
          backgroundColor: "#1a2235",
          titleColor: "#f1f5f9",
          bodyColor: "#64748b",
          borderColor: "#1e2d45",
          borderWidth: 1,
        }
      }
    }
  });
}

// hook into existing flow
window.addEventListener("load", () => {
  renderCharts();
});
