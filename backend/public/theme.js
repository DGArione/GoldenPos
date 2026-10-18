// theme.js — 20 colour presets, admin-selectable light/dark pair,
// per-user mode toggle that persists across pages.
// Must load before nav.js and any page script.

// ============ 10 Light themes ============
window.POS_THEMES = {
  goldenPos:   { label:"Golden POS",    accent:"#f6990d",accentDark:"#a85e00",accentSoft:"#fff3dc",bg:"#f2f2f2",panel:"#ffffff",neutralBg:"#f7f7f7",borderSoft:"#f0f0f0",border:"#eaeaea",preview:["#f6990d","#ffffff","#f2f2f2"] },
  goldenBeach: { label:"Golden Beach", accent:"#b06a38",accentDark:"#8f5126",accentSoft:"#f1e2d0",bg:"#ece3d0",panel:"#f7f1e2",neutralBg:"#e7ddc6",borderSoft:"#e7dcc3",border:"#d9cdb0",preview:["#b06a38","#4c5738","#ece3d0"] },
  espresso:  { label:"Espresso Brown", accent:"#9a5f33",accentDark:"#79471f",accentSoft:"#f3e7d7",bg:"#f8f5f0",panel:"#ffffff",neutralBg:"#f1ece4",borderSoft:"#f1ebe2",border:"#e8e0d3",preview:["#9a5f33","#f3e7d7","#f8f5f0"] },
  ocean:     { label:"Ocean Blue",     accent:"#1a6fa8",accentDark:"#124f7a",accentSoft:"#d6eaf8",bg:"#f0f6fb",panel:"#ffffff",neutralBg:"#e3f0f8",borderSoft:"#d6eaf8",border:"#b8d8ed",preview:["#1a6fa8","#d6eaf8","#f0f6fb"] },
  forest:    { label:"Forest Green",   accent:"#2d7a3e",accentDark:"#1f5a2c",accentSoft:"#d5eeda",bg:"#f1f8f3",panel:"#ffffff",neutralBg:"#e3f2e8",borderSoft:"#d0ebd6",border:"#b3d9be",preview:["#2d7a3e","#d5eeda","#f1f8f3"] },
  slate:     { label:"Slate Grey",     accent:"#4a5568",accentDark:"#2d3748",accentSoft:"#e2e8f0",bg:"#f7f8fa",panel:"#ffffff",neutralBg:"#edf0f4",borderSoft:"#e2e8f0",border:"#cbd5e0",preview:["#4a5568","#e2e8f0","#f7f8fa"] },
  crimson:   { label:"Crimson Red",    accent:"#b91c1c",accentDark:"#7f1d1d",accentSoft:"#fee2e2",bg:"#fdf5f5",panel:"#ffffff",neutralBg:"#fce8e8",borderSoft:"#fecaca",border:"#f9a8a8",preview:["#b91c1c","#fee2e2","#fdf5f5"] },
  violet:    { label:"Royal Violet",   accent:"#6d28d9",accentDark:"#4c1d95",accentSoft:"#ede9fe",bg:"#f7f5ff",panel:"#ffffff",neutralBg:"#ede9fe",borderSoft:"#ddd6fe",border:"#c4b5fd",preview:["#6d28d9","#ede9fe","#f7f5ff"] },
  teal:      { label:"Teal Breeze",    accent:"#0e7490",accentDark:"#0c4a6e",accentSoft:"#cffafe",bg:"#f0fdfe",panel:"#ffffff",neutralBg:"#e0f8fb",borderSoft:"#a5f3fc",border:"#67e8f9",preview:["#0e7490","#cffafe","#f0fdfe"] },
  amber:     { label:"Amber Gold",     accent:"#b45309",accentDark:"#78350f",accentSoft:"#fef3c7",bg:"#fffbf0",panel:"#ffffff",neutralBg:"#fef3c7",borderSoft:"#fde68a",border:"#fcd34d",preview:["#b45309","#fef3c7","#fffbf0"] },
  rose:      { label:"Rose Pink",      accent:"#be185d",accentDark:"#831843",accentSoft:"#fce7f3",bg:"#fdf2f8",panel:"#ffffff",neutralBg:"#fce7f3",borderSoft:"#fbcfe8",border:"#f9a8d4",preview:["#be185d","#fce7f3","#fdf2f8"] },
  midnight:  { label:"Midnight Navy",  accent:"#1e3a5f",accentDark:"#0f1f3a",accentSoft:"#dce9f8",bg:"#f2f6fb",panel:"#ffffff",neutralBg:"#e4edf7",borderSoft:"#c8daf0",border:"#a8c3e5",preview:["#1e3a5f","#dce9f8","#f2f6fb"] },
};

// ============ 10 Dark themes ============
Object.assign(window.POS_THEMES, {
  goldenPosDark:    { label:"Golden POS Night",    dark:true, accent:"#f6990d",accentDark:"#ffc55e",accentSoft:"#3a2a0a",bg:"#181818",panel:"#232323",neutralBg:"#2a2a2a",borderSoft:"#2e2e2e",border:"#333333",preview:["#f6990d","#232323","#181818"] },
  goldenBeachNight: { label:"Golden Beach Night", dark:true, accent:"#cb824b",accentDark:"#b5703a",accentSoft:"#33271c",bg:"#1b1e15",panel:"#24281c",neutralBg:"#2b3022",borderSoft:"#2c3121",border:"#363b2a",preview:["#cb824b","#24281c","#1b1e15"] },
  carbonBlack:  { label:"Carbon Black",  dark:true, accent:"#e2e8f0",accentDark:"#cbd5e0",accentSoft:"#2d3748",bg:"#0d1117",panel:"#161b22",neutralBg:"#21262d",borderSoft:"#21262d",border:"#30363d",preview:["#e2e8f0","#161b22","#0d1117"] },
  deepOcean:    { label:"Deep Ocean",    dark:true, accent:"#38bdf8",accentDark:"#0ea5e9",accentSoft:"#0c2a3f",bg:"#03111f",panel:"#0a1e30",neutralBg:"#0e2a42",borderSoft:"#0e2a42",border:"#144566",preview:["#38bdf8","#0a1e30","#03111f"] },
  forestNight:  { label:"Forest Night",  dark:true, accent:"#4ade80",accentDark:"#22c55e",accentSoft:"#052e16",bg:"#020d06",panel:"#061a0d",neutralBg:"#0d2d17",borderSoft:"#0d2d17",border:"#14532d",preview:["#4ade80","#061a0d","#020d06"] },
  crimsonNight: { label:"Crimson Night", dark:true, accent:"#f87171",accentDark:"#ef4444",accentSoft:"#450a0a",bg:"#0c0505",panel:"#1a0a0a",neutralBg:"#2d1010",borderSoft:"#2d1010",border:"#450a0a",preview:["#f87171","#1a0a0a","#0c0505"] },
  violetDusk:   { label:"Violet Dusk",   dark:true, accent:"#c084fc",accentDark:"#a855f7",accentSoft:"#2e1065",bg:"#0a0412",panel:"#130922",neutralBg:"#1e0d36",borderSoft:"#1e0d36",border:"#2e1065",preview:["#c084fc","#130922","#0a0412"] },
  amberNight:   { label:"Amber Night",   dark:true, accent:"#fbbf24",accentDark:"#f59e0b",accentSoft:"#451a03",bg:"#0d0800",panel:"#1c1000",neutralBg:"#2d1800",borderSoft:"#2d1800",border:"#451a03",preview:["#fbbf24","#1c1000","#0d0800"] },
  roseNight:    { label:"Rose Night",    dark:true, accent:"#fb7185",accentDark:"#f43f5e",accentSoft:"#4c0519",bg:"#0c0208",panel:"#1a0510",neutralBg:"#2d0a1e",borderSoft:"#2d0a1e",border:"#4c0519",preview:["#fb7185","#1a0510","#0c0208"] },
  slateNight:   { label:"Slate Night",   dark:true, accent:"#94a3b8",accentDark:"#64748b",accentSoft:"#0f172a",bg:"#060810",panel:"#0f172a",neutralBg:"#1e293b",borderSoft:"#1e293b",border:"#334155",preview:["#94a3b8","#0f172a","#060810"] },
  tealNight:    { label:"Teal Night",    dark:true, accent:"#2dd4bf",accentDark:"#14b8a6",accentSoft:"#042f2e",bg:"#010d0d",panel:"#04201f",neutralBg:"#083231",borderSoft:"#083231",border:"#134e4a",preview:["#2dd4bf","#04201f","#010d0d"] },
  midnightGold: { label:"Midnight Gold", dark:true, accent:"#fde68a",accentDark:"#fcd34d",accentSoft:"#1c1400",bg:"#0a0800",panel:"#150f00",neutralBg:"#241a00",borderSoft:"#241a00",border:"#3d2b00",preview:["#fde68a","#150f00","#0a0800"] },
});

(function () {
  // ---- Apply a theme palette directly to CSS variables ----
  function applyPalette(palette) {
    const r = document.documentElement;
    r.style.setProperty("--accent",      palette.accent);
    r.style.setProperty("--accent-dark", palette.accentDark);
    r.style.setProperty("--accent-soft", palette.accentSoft);
    r.style.setProperty("--bg",          palette.bg);
    r.style.setProperty("--panel",       palette.panel);
    r.style.setProperty("--neutral-bg",  palette.neutralBg);
    r.style.setProperty("--border-soft", palette.borderSoft);
    r.style.setProperty("--border",      palette.border);
    // text/muted/success/warning/danger colours — auto from CSS; reset any override
    ["--text","--muted","--success-bg","--warning-bg","--danger-bg","--shadow-sm","--shadow-md"].forEach(v => r.style.removeProperty(v));
  }

  // ---- Per-user mode key ---- (exposed so settings.js preview can write it)
  window.posModeKey = function() {
    try {
      const u = JSON.parse(localStorage.getItem("posUser") || "null");
      return u ? `posMode_${u.id}` : "posMode_guest";
    } catch (e) { return "posMode_guest"; }
  };

  function modeKey() { return window.posModeKey(); }

  // ---- Apply branding from settings ----
  window.posApplyBranding = function (settings) {
    // Determine which mode the current user is in
    const userMode = localStorage.getItem(modeKey()); // "light" | "dark" | null
    const mode = userMode || settings.theme || "light";

    const themeId = mode === "dark"
      ? (settings.darkThemeId  || "goldenPosDark")
      : (settings.lightThemeId || "goldenPos");
    const palette = window.POS_THEMES[themeId] || window.POS_THEMES.goldenPos;

    // Set data-theme so remaining CSS (text, success/danger bg etc.) matches
    document.documentElement.setAttribute("data-theme", (palette.dark || mode === "dark") ? "dark" : "light");

    applyPalette(palette);
    window._currentMode = mode;

    if (settings.font) document.documentElement.style.setProperty("--font-family-override", `"${settings.font}", "Poppins", -apple-system, "Segoe UI", sans-serif`);

    const name = settings.businessName || "Restaurant POS";
    document.querySelectorAll("[data-brand-name]").forEach(el => (el.textContent = name));
    document.querySelectorAll("[data-brand-logo]").forEach(el => {
      if (settings.logoUrl) { el.src = settings.logoUrl; el.style.display = ""; }
      else el.style.display = "none";
    });
    const di = document.getElementById("defaultBrandIcon");
    if (di) di.style.display = settings.logoUrl ? "none" : "";
    if (document.title.includes("Restaurant POS")) document.title = document.title.replace("Restaurant POS", name);
  };

  // Apply one specific palette by id (used to give the login page its own
  // theme, independent of the app theme). Returns true if the id was known.
  window.posApplyThemeById = function (themeId) {
    const palette = window.POS_THEMES[themeId];
    if (!palette) return false;
    document.documentElement.setAttribute("data-theme", palette.dark ? "dark" : "light");
    applyPalette(palette);
    window._currentMode = palette.dark ? "dark" : "light";
    return true;
  };

  // ---- Init: fetch settings and apply ----
  window.posInitSettings = async function () {
    let settings = {};
    try {
      const res = await fetch("api/public/settings");
      settings = await res.json();
    } catch (e) { /* offline — use defaults */ }
    window.posSettings = settings;
    window.posApplyBranding(settings);
    return settings;
  };

  // ---- Toggle light ↔ dark ----
  window.posToggleTheme = function () {
    const next = (window._currentMode === "dark") ? "light" : "dark";
    localStorage.setItem(modeKey(), next);
    if (window.posSettings) window.posApplyBranding(window.posSettings);
    return next;
  };

  // ---- Currency helper ----
  window.posCurrency = function () {
    return (window.posSettings && window.posSettings.currencySymbol) || "Rs. ";
  };

  // ---- Live theme sync ----
  // Re-checks the saved settings every 30 s (and when the tab becomes visible
  // again) so a theme/branding change made by the admin reaches every open
  // screen without a reload or re-login. Only reacts when the SERVER values
  // changed, so an admin's unsaved preview on the Themes page is not undone.
  (function liveThemeSync() {
    const KEYS = ["theme","lightThemeId","darkThemeId","activeThemeId","accentColor","accentDark","accentSoft","font","businessName","logoUrl","allowUserThemeOverride"];
    const sig = (s) => JSON.stringify(KEYS.map(k => (s || {})[k]));
    let last = null, busy = false;
    async function check() {
      if (busy || document.hidden) return;
      // staff screens only (logged in); skips login + customer QR pages
      try { if (!localStorage.getItem("posUser")) return; } catch (e) { return; }
      if (!window.posSettings) return;
      busy = true;
      try {
        const res = await fetch("api/public/settings", { cache: "no-store" });
        if (!res.ok) return;
        const fresh = await res.json();
        if (last === null) { last = sig(fresh); return; }   // first read = baseline
        const now = sig(fresh);
        if (now !== last) {
          last = now;
          Object.assign(window.posSettings, fresh);
          window.posApplyBranding(window.posSettings);
          if (typeof window.posThemeChanged === "function") { try { window.posThemeChanged(); } catch (e) {} }
        }
      } catch (e) { /* offline - try again next tick */ }
      finally { busy = false; }
    }
    setInterval(check, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
    setTimeout(check, 3000);   // baseline shortly after load
  })();

  // Flash prevention — apply cached theme before any network call
  (function flashPrevention() {
    const cachedMode = localStorage.getItem(modeKey());
    if (!cachedMode) return; // let posInitSettings decide
    // We don't have posSettings yet so just set data-theme for text/bg
    document.documentElement.setAttribute("data-theme", cachedMode === "dark" ? "dark" : "light");
  })();

})();
