<div align="center">

# 🏛️ CivicReport
### AI-Powered Civic Issue Reporting Platform

![CivicReport Banner](https://img.shields.io/badge/CivicReport-Community%20Platform-1a56a0?style=for-the-badge&logo=google-maps&logoColor=white)

[![Made with Love](https://img.shields.io/badge/Made%20with-❤️-red?style=flat-square)](https://github.com/ssambit635-svg)
[![Gemini AI](https://img.shields.io/badge/Powered%20by-Gemini%201.5%20Flash-4285F4?style=flat-square&logo=google&logoColor=white)](https://aistudio.google.com)
[![Leaflet](https://img.shields.io/badge/Maps-Leaflet.js-199900?style=flat-square&logo=leaflet&logoColor=white)](https://leafletjs.com)
[![Chart.js](https://img.shields.io/badge/Charts-Chart.js-FF6384?style=flat-square)](https://chartjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

> *"The strength of a nation derives from the integrity of the home."* — APJ Abdul Kalam

**Snap a photo. Report an issue. Watch your community fix it — together.**

[🚀 Live Demo](#) • [📸 Screenshots](#screenshots) • [⚡ Features](#features) • [🛠️ Setup](#setup)

</div>

---

## 📌 About The Project

Communities across India face daily struggles with potholes, water leakages, broken streetlights, and overflowing garbage — yet reporting these issues remains fragmented, opaque, and frustrating.

**CivicReport** changes that.

It is a community-driven civic tech platform that lets citizens **snap a photo**, **report an issue**, and **track its resolution** — all powered by **Google Gemini AI** that automatically analyzes images, detects the problem type, assigns severity, and generates descriptions. No forms. No confusion. Just action.

Built as a real-world solution for **Berhampur, Odisha** — but designed to scale to any city in India.

---

## ✨ Features <a name="features"></a>

### 🤖 AI-Powered Reporting
- Upload any photo of a civic issue
- **Gemini 1.5 Flash** analyzes it instantly
- Auto-detects: issue type, severity (Low/Medium/High/Critical), category, and description
- One-click form auto-fill from AI analysis

### 🗺️ Live Issue Map
- Real-time map powered by **Leaflet.js** + OpenStreetMap
- Severity-based color markers (green → red)
- Pulsing heatmap overlay showing issue density
- Click any marker for full issue details

### 📊 Interactive Dashboard
- **Bar chart** — Issues by category (Chart.js)
- **Donut chart** — Status breakdown (Open / In Progress / Resolved)
- Category-wise count cards with progress bars
- **City Health Score** — Live 0–100 indicator based on issue severity

### 🧠 Predictive City Insights
- Gemini AI analyzes all reported data
- Generates smart predictions and recommendations for city authorities
- Warning / Good / Critical insight tags

### 🏆 Gamification System
- Citizens earn points for reporting (10pts), resolving (25pts), and verifying (5pts)
- Live **leaderboard** with rank badges
- Badges: Newcomer → Contributor → Active Citizen → Champion

### ⚡ Real-Time News Ticker
- Scrolling live ticker showing latest community reports
- Keeps the platform feeling alive and active

### 🔍 Filter & Search
- Filter issues by category with one click
- Pill-based UI for Road / Water / Light / Waste / Infrastructure

### ✅ Community Verification
- Citizens can verify issues they've seen themselves
- Verification count shown on each card
- Builds trust and accountability

### 📤 Share Issues
- One-click share any issue via Web Share API
- Falls back to clipboard copy on desktop

---

## 🖼️ Screenshots <a name="screenshots"></a>

| Hero Section | Issue Reporting | Live Map |
|---|---|---|
| Government-style clean UI | AI auto-fills the form | Severity heatmap |

| Dashboard | Leaderboard | AI Insights |
|---|---|---|
| Charts + Health Score | Top citizen rankings | Gemini predictions |

---

## 🛠️ Tech Stack <a name="setup"></a>

| Technology | Purpose |
|---|---|
| HTML5 + CSS3 + JavaScript | Core frontend — zero frameworks |
| Google Gemini 1.5 Flash API | Image analysis + predictive insights |
| Leaflet.js | Interactive map |
| Chart.js | Data visualization |
| OpenStreetMap | Free map tiles |
| LocalStorage | Client-side data persistence |
| Web Share API | Native sharing |

---

## ⚙️ Setup & Installation

### Prerequisites
- A modern browser (Chrome recommended)
- Google Gemini API key — [Get it free here](https://aistudio.google.com/apikey)
- VS Code + Live Server extension

### Steps

**1. Clone the repository**
```bash
git clone https://github.com/ssambit635-svg/civic-report.git
cd civic-report
```

**2. Create your config file**
```bash
# Create config.js in the project root
touch config.js
```

**3. Add your Gemini API key to config.js**
```javascript
const CONFIG = {
  GEMINI_API_KEY: "YOUR_GEMINI_API_KEY_HERE"
};
```

**4. Run with Live Server**
- Open the project in VS Code
- Right click `index.html` → **Open with Live Server**
- Visit `http://127.0.0.1:5500`

> ⚠️ **Important:** Never commit `config.js` to GitHub. It is already in `.gitignore`.

---

## 📁 Project Structure

```
civic-report/
│
├── index.html          # Main HTML — all sections
├── style.css           # Full styling — light govt theme
├── app.js              # All JavaScript logic + Gemini API calls
├── config.js           # 🔒 API key (NOT pushed to GitHub)
├── .gitignore          # Ignores config.js
└── README.md           # You are here!
```

---

## 🌍 Real World Impact

This platform directly addresses **SDG 11 — Sustainable Cities and Communities** by:

- Enabling transparent civic issue reporting
- Creating accountability between citizens and authorities
- Using AI to prioritize high-severity issues
- Building community engagement through gamification
- Providing data-driven insights for smarter city management

---

## 🚀 Future Roadmap

- [ ] Backend integration (Node.js + MongoDB)
- [ ] User authentication system
- [ ] Push notifications for issue updates
- [ ] Official authority dashboard
- [ ] Mobile app (React Native)
- [ ] Multi-city support
- [ ] SMS reporting for non-smartphone users
- [ ] Integration with municipal APIs

---

## 👨‍💻 Author

**Sambit** — First Year B.Tech CSE @ NIST University, Berhampur

[![GitHub](https://img.shields.io/badge/GitHub-ssambit635--svg-181717?style=flat-square&logo=github)](https://github.com/ssambit635-svg)
[![LinkedIn](www.linkedin.com/in/sambit-swain-7032a8378)](https://linkedin.com)

---

## 📄 License

This project is licensed under the MIT License — feel free to use, modify, and distribute.

---

<div align="center">

**Built with ❤️ for Berhampur, Odisha 🏙️**

*CivicReport — Because every pothole deserves to be fixed.*

⭐ Star this repo if you found it useful!

</div>
