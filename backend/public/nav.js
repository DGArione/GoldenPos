// nav.js — shared LEFT SIDEBAR + SPA page router + floating quick-access button

// Shared helper libraries (QR, barcode, print agent). The SPA router only runs
// each page's one registered script, so <script> tags inside a page's HTML are
// NOT executed on in-app navigation. Loading these once here — nav.js persists
// across SPA navigations — keeps them available everywhere (e.g. the Floor QR
// modal, gift-card barcodes, thermal printing) however the page was reached.
(function loadSharedLibs() {
  const libs = [
    { src: "qrcode.js", ready: () => typeof window.qrcode !== "undefined" },
    { src: "qr.js", ready: () => typeof window.posQrSvg === "function" },
    { src: "barcode.js", ready: () => typeof window.renderBarcode === "function" },
    { src: "printing.js", ready: () => typeof window.posSendToAgent === "function" },
  ];
  libs.forEach(({ src, ready }) => {
    if (ready()) return;                                          // already on the page
    if (document.querySelector(`script[data-lib="${src}"]`)) return; // already requested
    const s = document.createElement("script");
    s.src = src; s.async = false; s.setAttribute("data-lib", src);
    document.head.appendChild(s);
  });
})();

// ── System boot splash ────────────────────────────────────────
// A brief branded loader shown while the app shell loads. nav.js only runs on
// a full page load (SPA navigations don't reload it), so this appears once when
// the system is opened/refreshed and fades out as soon as the nav renders.
(function bootSplash() {
  if (sessionStorage.getItem("posBootShown") === "1") return; // once per browser session
  try { sessionStorage.setItem("posBootShown", "1"); } catch (_) {}
  if (!document.body) return;
  const el = document.createElement("div");
  el.id = "posBoot";
  el.innerHTML = `
    <div class="posBoot-mark">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 3v6a2 2 0 1 0 4 0V3"/><path d="M9 9v12"/><path d="M17 3c-1.6 0-3 2-3 5s1.4 5 3 5"/><path d="M17 13v8"/>
      </svg>
    </div>
    <div class="posBoot-name" data-brand-name>Restaurant POS</div>
    <div class="posBoot-bar"><span></span></div>`;
  document.body.appendChild(el);
  window.__hidePosBoot = function () {
    const b = document.getElementById("posBoot");
    if (!b) return;
    b.classList.add("hide");
    setTimeout(() => b.remove(), 420);
  };
  // Safety fallback: never let the splash linger.
  setTimeout(() => window.__hidePosBoot && window.__hidePosBoot(), 2500);
})();

const ICONS = {
  brand: `<path d="M7 3v6a2 2 0 1 0 4 0V3"/><path d="M9 9v12"/><path d="M17 3c-1.6 0-3 2-3 5s1.4 5 3 5"/><path d="M17 13v8"/>`,
  dashboard: `<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>`,
  branches: `<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-6h4v6"/>`,
  order: `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>`,
  floor: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
  kitchen: `<path d="M12 21c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-2 5 0-3-2-5-2-7-3 2-5 5-5 9 0 4 1 7 5 7z"/>`,
  payment: `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>`,
  history: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`,
  reports: `<rect x="4" y="12" width="3" height="8"/><rect x="10" y="6" width="3" height="14"/><rect x="16" y="9" width="3" height="11"/>`,
  inventory: `<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>`,
  admin: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3"/><path d="M9 9h6M9 13h6M9 17h4"/>`,
  audit: `<path d="M4 4h12l4 4v12H4z"/><path d="M8 11l2.5 2.5L15 9"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 14.6 1.7 1.7 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10.6 3V3a2 2 0 1 1 4 0v.09c0 .68.4 1.27 1.04 1.51.66.27 1.42.13 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.24.64.83 1.04 1.51 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.04z"/>`,
  staff: `<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M21 20c0-2.2-1.6-4-4-4.5"/>`,
  zreport: `<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5M8 17h3"/>`,
  pettycash: `<rect x="2" y="7" width="20" height="12" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M6 11v4M18 11v4"/>`,
  messages: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  onlineorders: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>`,
  timeclock: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/>`,
  payroll: `<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>`,
  expand: `<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>`,
  shrink: `<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>`,
  bell: `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`,
  moon: `<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>`,
  collapse: `<path d="M15 18l-6-6 6-6"/>`,
  chevron: `<path d="M6 9l6 6 6-6"/>`,
  customers: `<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/><path d="M17 11a4 4 0 0 0 0-8"/><path d="M22 21v-2a5 5 0 0 0-3-4.5"/>`,
  loyalty: `<path d="M12 21s-7-4.6-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z"/>`,
  giftcards: `<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18M12 8v13"/><path d="M12 8S10 3 7.5 4.5 9 8 12 8z"/><path d="M12 8s2-5 4.5-3.5S15 8 12 8z"/>`,
  promotions: `<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>`,
  reservations: `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`,
  star: `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  grip: `<circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>`,
};

function initialsOf(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function svgIcon(name, size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

// ── Nav order: restaurant ops first, management after payment ──
const NAV_ITEMS = [
  { key: "dashboard",    label: "Dashboard",     href: "dashboard",      icon: "dashboard"    },
  { key: "branches",     label: "Branches",       href: "branches",       icon: "branches"     },
  { key: "order",        label: "Order Entry",    href: "order",          icon: "order"        },
  { key: "floor",        label: "Floor",          href: "floor",          icon: "floor"        },
  { key: "kitchen",      label: "Kitchen",        href: "kitchen",        icon: "kitchen"      },
  { key: "onlineorders", label: "Online Orders",  href: "online-orders",  icon: "onlineorders" },
  { key: "payment",      label: "Payment",        href: "payment",        icon: "payment"      },
  { key: "menuadmin",    label: "Menu Admin",     href: "admin",          icon: "admin"        },
  { key: "inventory",    label: "Inventory",      href: "inventory",      icon: "inventory"    },
  { key: "history",      label: "History",        href: "history",        icon: "history"      },
  { key: "reports",      label: "Reports",        href: "reports",        icon: "reports"      },
  { key: "timeclock",    label: "Time Clock",     href: "timeclock",      icon: "timeclock"    },
  { key: "payroll",      label: "Payroll",        href: "payroll",        icon: "payroll"      },
  { key: "staff",        label: "Users",          href: "staff",          icon: "staff"        },
  { key: "zreport",      label: "Z-Report",       href: "zreport",        icon: "zreport"      },
  { key: "pettycash",    label: "Petty Cash",     href: "pettycash",      icon: "pettycash"    },
  { key: "messages",     label: "Messages",       href: "messages",       icon: "messages"     },
  { key: "customers",    label: "Customers",      href: "customers",      icon: "customers"    },
  { key: "auditlog",     label: "Audit Log",      href: "audit",          icon: "audit"        },
  // Add-on modules (shown only when enabled in Admin → Settings → Add-ons)
  { key: "loyalty",      label: "Loyalty",        href: "loyalty",        icon: "loyalty"      },
  { key: "giftcards",    label: "Gift Cards",     href: "giftcards",      icon: "giftcards"    },
  { key: "promotions",   label: "Promotions",     href: "promotions",     icon: "promotions"   },
  { key: "reservations", label: "Reservations",   href: "reservations",   icon: "reservations" },
];

// Which NAV keys are add-on modules, and which add-on each belongs to.
const ADDON_NAV = { loyalty: "loyalty", giftcards: "giftcards", promotions: "promotions", reservations: "reservations" };

// Sidebar is grouped into categories. Add-on pages (when enabled) slot into
// their own "Add-ons" group — see renderNav.
const NAV_GROUPS = [
  { label: "Operations",      keys: ["dashboard", "order", "floor", "kitchen", "onlineorders", "payment"] },
  { label: "Catalog & Stock", keys: ["menuadmin", "inventory"] },
  { label: "Reports & Cash",  keys: ["history", "reports", "zreport", "pettycash"] },
  { label: "Team",            keys: ["timeclock", "payroll", "staff"] },
  { label: "Management",      keys: ["branches", "customers", "messages", "auditlog"] },
  { label: "Add-ons",         keys: ["loyalty", "giftcards", "promotions", "reservations"], addon: true },
];

const ROLE_VISIBILITY = {
  admin:        ["settings","auditlog"],
  superManager: ["dashboard","branches","order","floor","kitchen","onlineorders","payment","menuadmin","inventory","history","reports","timeclock","payroll","staff","zreport","pettycash","messages","customers","auditlog","loyalty","giftcards","promotions","reservations"],
  manager:      ["dashboard","order","floor","kitchen","onlineorders","payment","menuadmin","inventory","history","reports","timeclock","payroll","staff","zreport","pettycash","messages","customers","auditlog","loyalty","giftcards","promotions","reservations"],
  finance:      ["dashboard","history","reports","inventory","timeclock","payroll","zreport","pettycash","messages","customers"],
  server:       ["order","floor","kitchen","payment","history","timeclock","messages","customers","loyalty","giftcards","reservations"],
  cashier:      ["payment","history","timeclock","messages","customers","loyalty","giftcards"],
  kitchen:      ["kitchen","onlineorders","timeclock","messages"],
};

const ROLE_LABEL       = { admin:"admin", superManager:"super manager", manager:"manager", finance:"finance", server:"server", cashier:"cashier", kitchen:"kitchen" };
const ROLE_BADGE_CLASS = { admin:"admin", superManager:"admin", manager:"manager", finance:"finance", server:"server", cashier:"cashier", kitchen:"kitchen" };

function homeHrefFor(user) {
  if (user.role === "admin") return "settings";
  if (user.role === "superManager" || user.role === "manager") return "dashboard";
  return "index";
}

// ── SPA router ─────────────────────────────────────────────────
const PAGE_SCRIPTS = {
  "dashboard":    "dashboard.js",
  "branches":     "branches.js",
  "order":        "order.js",
  "floor":        "floor.js",
  "kitchen":      "kitchen.js",
  "online-orders":"online-orders.js",
  "payment":      "payment.js",
  "history":      "history.js",
  "reports":      "reports.js",
  "inventory":    "inventory.js",
  "timeclock":    "timeclock.js",
  "payroll":      "payroll.js",
  "admin":        "admin.js",
  "staff":        "staff.js",
  "zreport":      "zreport.js",
  "pettycash":    "pettycash.js",
  "messages":     "messages.js",
  "settings":     "settings.js",
  "customers":    "customers.js",
  "audit":        "audit.js",
  "loyalty":      "loyalty.js",
  "giftcards":    "giftcards.js",
  "promotions":   "promotions.js",
  "reservations": "reservations.js",
  "notifications":"notifications.js",
};

const _pageCache = new Map();
let _spaCurrentScript = null;
let _spaCurrentStyles = [];
let _navigating = false;
let _navVersion = 0;

// Fetch a page whether or not the server supports extensionless URLs.
// Tries "payment" first; if the host isn't rewriting, retries "payment.html".
async function spaFetchPage(href, opts) {
  let res = await fetch(href, opts);
  if (!res.ok && !/\.html(\?|#|$)/.test(href)) {
    const [path, qs] = href.split(/(?=[?#])/);
    res = await fetch(path + ".html" + (qs || ""), opts);
  }
  return res;
}

async function spaPrefetch(href) {
  const page = href.split("/").pop().split("?")[0];
  if (_pageCache.has(page)) return;
  try {
    const res  = await spaFetchPage(href, { cache: "default" });
    const html = await res.text();
    _pageCache.set(page, html);
  } catch (_) {}
}

let _bar = null;
function _showBar() {
  if (!_bar) {
    _bar = document.createElement("div");
    _bar.id = "_spaBar";
    _bar.style.cssText = "position:fixed;top:0;left:0;height:2px;width:0;background:var(--accent,#8a5a34);z-index:99999;transition:width 200ms ease,opacity 300ms ease;pointer-events:none;";
    document.body.appendChild(_bar);
  }
  _bar.style.opacity = "1";
  _bar.style.width   = "30%";
  setTimeout(() => { if (_bar) _bar.style.width = "70%"; }, 80);
}
function _hideBar() {
  if (!_bar) return;
  _bar.style.width = "100%";
  setTimeout(() => { if (_bar) { _bar.style.opacity = "0"; _bar.style.width = "0"; } }, 200);
}

function spaRefreshPage() {
  const page = window.location.pathname.split("/").pop() || "dashboard";
  _pageCache.delete(page);
  spaNavigate(page, false);
}

async function spaNavigate(href, pushState = true) {
  if (_navigating) return;
  const currentPage = window.location.pathname.split("/").pop() || "index";
  const targetPage  = href.split("/").pop().split("?")[0];
  if (targetPage === currentPage && pushState) return;

  _navigating = true;
  _showBar();

  document.querySelectorAll("[data-nav-key]").forEach((l) => {
    l.classList.toggle("active", l.getAttribute("href")?.split("/").pop() === targetPage);
  });

  try {
    let html = _pageCache.get(targetPage);
    if (!html) {
      const res = await spaFetchPage(href, { cache: "default" });
      html = await res.text();
      _pageCache.set(targetPage, html);
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const newBody = doc.querySelector(".page-body");
    if (!newBody) { window.location.href = href; return; }

    document.title = doc.title;

    // Inject the target page's own <head> styles. Page-specific CSS lives in a
    // <style> block in each page's <head>; without copying it across on SPA
    // navigation, pages (e.g. the dashboard) render unstyled. The shared
    // style.css is already loaded, so skip it.
    _spaCurrentStyles.forEach((el) => el.remove());
    _spaCurrentStyles = [];
    doc.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      if (node.tagName === "LINK") {
        const href = node.getAttribute("href") || "";
        if (/(^|\/)style\.css(\?|$)/.test(href)) return;
      }
      const clone = node.cloneNode(true);
      clone.setAttribute("data-spa-style", "1");
      document.head.appendChild(clone);
      _spaCurrentStyles.push(clone);
    });

    const oldToast = document.getElementById("toast");
    const newToast = doc.getElementById("toast");
    if (oldToast && newToast) oldToast.replaceWith(newToast.cloneNode(true));
    else if (newToast && !oldToast) document.body.insertBefore(newToast.cloneNode(true), document.getElementById("navbar").nextSibling);

    const oldBody = document.querySelector(".page-body");
    if (oldBody) { oldBody.style.transition = "opacity 80ms ease"; oldBody.style.opacity = "0"; }
    await new Promise(r => setTimeout(r, 80));

    if (oldBody) oldBody.replaceWith(newBody.cloneNode(true));
    else document.body.appendChild(newBody.cloneNode(true));

    if (pushState) history.pushState({ href }, doc.title, href);

    if (_spaCurrentScript) { _spaCurrentScript.remove(); _spaCurrentScript = null; }
    const scriptSrc = PAGE_SCRIPTS[targetPage];
    if (scriptSrc) {
      window._spaNavigating = true;
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          _navVersion++;
          s.src     = scriptSrc + "?v=" + _navVersion;
          s.onload  = resolve;
          s.onerror = reject;
          document.body.appendChild(s);
          _spaCurrentScript = s;
        });
      } finally {
        window._spaNavigating = false;
      }
    }

    const freshBody = document.querySelector(".page-body");
    if (freshBody) {
      freshBody.style.opacity = "0";
      requestAnimationFrame(() => {
        freshBody.style.transition = "opacity 120ms ease";
        freshBody.style.opacity    = "1";
      });
    }
    _hideBar();

  } catch (err) {
    console.warn("[SPA] error, falling back:", err);
    _hideBar();
    window.location.href = href;
  } finally {
    _navigating = false;
  }
}

// ══════════════════════════════════════════════════════════════
// FLOATING QUICK-ACCESS BUTTON (Assistive Touch)
// ══════════════════════════════════════════════════════════════
function setupQuickAccess(user) {
  // Remove any existing FAB from a previous SPA navigation
  const existingFab   = document.getElementById("_qaFab");
  const existingPanel = document.getElementById("_qaPanel");
  if (existingFab)   existingFab.remove();
  if (existingPanel) existingPanel.remove();

  const allowed = ROLE_VISIBILITY[user.role] || [];
  const STORAGE_KEY_FAV = "posQuickFavs_" + user.role;
  const STORAGE_KEY_POS = "posQuickPos";

  const DEFAULT_FAVS = {
    superManager: ["order","payment","kitchen","dashboard"],
    manager:      ["order","payment","kitchen","dashboard"],
    server:       ["order","floor","payment","kitchen"],
    cashier:      ["payment","history"],
    kitchen:      ["kitchen","onlineorders"],
    finance:      ["reports","zreport","inventory"],
  };

  function getFavs() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_FAV));
      if (Array.isArray(stored) && stored.length) return stored;
    } catch(_) {}
    return (DEFAULT_FAVS[user.role] || allowed.slice(0,4));
  }
  function saveFavs(favs) { localStorage.setItem(STORAGE_KEY_FAV, JSON.stringify(favs)); }

  // ── Create panel FIRST (appended to body, always on top) ───
  const panel = document.createElement("div");
  panel.id = "_qaPanel";
  panel.style.cssText = [
    "position:fixed",
    "z-index:99998",
    "display:none",
    "background:var(--panel)",
    "border:1px solid var(--border)",
    "border-radius:18px",
    "box-shadow:0 16px 48px rgba(0,0,0,0.28)",
    "width:300px",
    "overflow:hidden",
  ].join(";");
  document.body.appendChild(panel);

  // ── Create FAB ─────────────────────────────────────────────
  const fab = document.createElement("div");
  fab.id = "_qaFab";
  fab.innerHTML = svgIcon("star", 20);
  fab.style.cssText = [
    "position:fixed",
    "z-index:99999",
    "width:50px",
    "height:50px",
    "border-radius:50%",
    "background:var(--accent,#8a5a34)",
    "box-shadow:0 4px 18px rgba(0,0,0,0.28),0 0 0 3px rgba(138,90,52,0.18)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "cursor:grab",
    "color:white",
    "user-select:none",
    "touch-action:none",
    "-webkit-user-select:none",
  ].join(";");
  document.body.appendChild(fab);

  // ── Position management ────────────────────────────────────
  function loadPos() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_POS)) || null; } catch(_) { return null; }
  }
  function savePos(x, y) { localStorage.setItem(STORAGE_KEY_POS, JSON.stringify({x, y})); }

  function clamp(val, min, max) { return Math.max(min, Math.min(val, max)); }

  function applyFabPos(x, y) {
    x = clamp(x, 8, window.innerWidth  - 58);
    y = clamp(y, 8, window.innerHeight - 58);
    fab.style.left = x + "px";
    fab.style.top  = y + "px";
  }

  function repositionPanel() {
    const fr  = fab.getBoundingClientRect();
    const pw  = 300;
    let left  = fr.left + fr.width / 2 - pw / 2;
    let top   = fr.top - 16;    // panel bottom aligns near fab top
    // measure panel height after render
    const ph  = panel.offsetHeight || 320;
    top = fr.top - ph - 12;
    if (top < 8) top = fr.bottom + 12;  // flip below if no room above
    left = clamp(left, 8, window.innerWidth - pw - 8);
    panel.style.left = left + "px";
    panel.style.top  = top  + "px";
  }

  const saved = loadPos();
  // Default to the bottom-LEFT (just clear of the sidebar) so it never covers
  // the primary action buttons that live bottom-right on Order Entry / Payment.
  let sidebarW = 220;
  try { sidebarW = parseFloat(getComputedStyle(document.body).paddingLeft) || 220; } catch (_) {}
  applyFabPos(
    saved ? saved.x : sidebarW + 16,
    saved ? saved.y : window.innerHeight - 78
  );

  // ── Drag logic ─────────────────────────────────────────────
  let dragging = false, dragMoved = false, offX = 0, offY = 0;

  fab.addEventListener("pointerdown", e => {
    dragging = true; dragMoved = false;
    const r = fab.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    fab.setPointerCapture(e.pointerId);
    fab.style.cursor = "grabbing";
    fab.style.transition = "none";
    e.preventDefault();
  });

  fab.addEventListener("pointermove", e => {
    if (!dragging) return;
    dragMoved = true;
    const nx = e.clientX - offX;
    const ny = e.clientY - offY;
    applyFabPos(nx, ny);
    // Keep panel attached to fab while dragging
    if (panelOpen) repositionPanel();
  });

  fab.addEventListener("pointerup", e => {
    if (!dragging) return;
    dragging = false;
    fab.style.cursor = "grab";
    fab.style.transition = "";
    const r = fab.getBoundingClientRect();
    savePos(r.left, r.top);
    if (!dragMoved) togglePanel();
  });

  fab.addEventListener("pointercancel", () => {
    dragging = false;
    fab.style.cursor = "grab";
  });

  // ── Hover effect (only when not dragging) ─────────────────
  fab.addEventListener("mouseenter", () => {
    if (!dragging) fab.style.transform = "scale(1.12)";
  });
  fab.addEventListener("mouseleave", () => {
    fab.style.transform = "";
  });

  // ── Render panel contents ──────────────────────────────────
  let editMode = false;

  function renderPanel() {
    const favs      = getFavs();
    const favItems  = NAV_ITEMS.filter(n => allowed.includes(n.key) && favs.includes(n.key));
    const extraItems = NAV_ITEMS.filter(n => allowed.includes(n.key) && !favs.includes(n.key));

    panel.innerHTML = `
      <div style="padding:14px 16px 10px;border-bottom:1px solid var(--border-soft);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-size:13px;font-weight:700;">⚡ Quick Access</span>
        <button id="_qaEditBtn" style="background:${editMode?"var(--accent-soft)":"none"};
          border:${editMode?"1px solid var(--accent)":"none"};font-size:12px;
          color:var(--accent);cursor:pointer;font-family:inherit;
          font-weight:600;padding:4px 10px;border-radius:8px;">
          ${editMode ? "✓ Done" : "✏️ Edit"}
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:14px;">
        ${favItems.length ? favItems.map(n => `
          <div class="_qaNavBtn" data-href="${n.href}" data-key="${n.key}" style="
            background:var(--neutral-bg);border:1.5px solid var(--border);border-radius:14px;
            padding:14px 6px 11px;cursor:${editMode?"default":"pointer"};
            display:flex;flex-direction:column;align-items:center;gap:7px;
            font-size:11px;font-weight:600;color:var(--text);
            position:relative;text-align:center;line-height:1.3;
          ">
            <span style="color:var(--accent);">${svgIcon(n.icon, 22)}</span>
            ${n.label}
            ${editMode ? `
            <div class="_qaRemove" data-key="${n.key}" style="
              position:absolute;top:-7px;right:-7px;
              width:20px;height:20px;
              background:var(--danger,#c0392b);color:white;
              border-radius:50%;display:flex;align-items:center;
              justify-content:center;font-size:13px;cursor:pointer;
              line-height:1;font-weight:800;border:2px solid var(--panel);
              box-shadow:0 2px 6px rgba(0,0,0,0.2);
            ">×</div>` : ""}
          </div>`).join("")
        : `<div style="grid-column:1/-1;text-align:center;color:var(--muted);font-size:13px;padding:20px 0;">
            No favourites yet — click <strong>✏️ Edit</strong> to add some.
          </div>`}
      </div>

      ${editMode ? `
      <div style="border-top:1px solid var(--border-soft);padding:10px 14px 14px;background:var(--neutral-bg);">
        <div style="font-size:11px;color:var(--muted);font-weight:700;
          text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
          ＋ Add page
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${extraItems.map(n => `
            <div class="_qaAddBtn" data-key="${n.key}" style="
              background:var(--panel);border:1px solid var(--border);border-radius:8px;
              padding:5px 10px;font-size:12px;cursor:pointer;color:var(--text);
              display:flex;align-items:center;gap:5px;font-weight:500;
            ">${svgIcon(n.icon, 13)} ${n.label}</div>`).join("")}
          ${!extraItems.length
            ? `<span style="font-size:12px;color:var(--muted);">All pages added ✓</span>`
            : ""}
        </div>
      </div>` : ""}

      <div style="padding:8px 16px 10px;text-align:center;">
        <span style="font-size:10px;color:var(--muted);">Drag ⭐ to move • Tap to open</span>
      </div>
    `;

    // Wire nav buttons (only in normal mode)
    if (!editMode) {
      panel.querySelectorAll("._qaNavBtn").forEach(btn => {
        btn.addEventListener("mouseenter", () => {
          btn.style.background = "var(--accent-soft)";
          btn.style.borderColor = "var(--accent)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "var(--neutral-bg)";
          btn.style.borderColor = "var(--border)";
        });
        btn.addEventListener("click", () => {
          closePanel();
          spaNavigate(btn.dataset.href);
        });
      });
    }

    // Wire remove buttons
    panel.querySelectorAll("._qaRemove").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        saveFavs(getFavs().filter(k => k !== btn.dataset.key));
        renderPanel();
        repositionPanel();
      });
    });

    // Wire add buttons
    panel.querySelectorAll("._qaAddBtn").forEach(btn => {
      btn.addEventListener("mouseenter", () => {
        btn.style.borderColor = "var(--accent)";
        btn.style.background  = "var(--accent-soft)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.borderColor = "var(--border)";
        btn.style.background  = "var(--panel)";
      });
      btn.addEventListener("click", () => {
        saveFavs([...getFavs(), btn.dataset.key]);
        renderPanel();
        repositionPanel();
      });
    });

    // Wire edit toggle
    panel.querySelector("#_qaEditBtn").addEventListener("click", e => {
      e.stopPropagation();
      editMode = !editMode;
      renderPanel();
      repositionPanel();
    });
  }

  // ── Panel open/close ───────────────────────────────────────
  let panelOpen = false;

  function togglePanel() {
    if (panelOpen) { closePanel(); return; }
    editMode = false;
    panelOpen = true;
    renderPanel();
    panel.style.display = "";
    // Position AFTER display so offsetHeight is measurable
    requestAnimationFrame(() => repositionPanel());
  }

  function closePanel() {
    panelOpen = false;
    editMode  = false;
    panel.style.display = "none";
  }

  // Close on outside click
  document.addEventListener("click", e => {
    if (panelOpen && !panel.contains(e.target) && !fab.contains(e.target)) closePanel();
  }, true);  // capture phase so it fires before other handlers

  window.addEventListener("resize", () => {
    applyFabPos(
      parseFloat(fab.style.left),
      parseFloat(fab.style.top)
    );
    if (panelOpen) repositionPanel();
  });
}

// ══════════════════════════════════════════════════════════════
// RENDER NAV
// ══════════════════════════════════════════════════════════════
async function renderNav(activeKey, user) {
  if (window._spaNavigating) {
    document.querySelectorAll("[data-nav-key]").forEach((l) => {
      l.classList.toggle("active", l.dataset.navKey === activeKey);
    });
    document.querySelectorAll("[data-nav-key]").forEach((link) => {
      link.onclick = (e) => { e.preventDefault(); spaNavigate(link.getAttribute("href")); };
    });
    return;
  }

  const settings = window.posSettings || (await window.posInitSettings());
  const allowed  = ROLE_VISIBILITY[user.role] || [];
  const isSettingsPage = window.location.pathname.endsWith("settings");
  const isAdmin        = user.role === "admin";

  let linksHtml;
  if (isAdmin && isSettingsPage) {
    const p = (key, label, icon) =>
      `<a class="nav-link${activeKey===key?" active":""}" href="#" data-settings-panel="${key}">${svgIcon(icon,16)}<span class="nav-label">${label}</span></a>`;
    linksHtml = `
      <div class="nav-section-label">Business</div>
      ${p("bizinfo",      "Business Info",     "branches")}
      ${p("rates",        "Rates &amp; Currency","reports")}
      ${p("receipt",      "Receipt",            "history")}
      ${p("fiscal",       "Fiscal &amp; Tax",   "audit")}
      ${p("printing",     "Printing",           "inventory")}
      ${p("qrorder",      "QR Ordering",        "floor")}
      ${p("loginpage",    "Login Page",         "order")}
      <div class="nav-section-label" style="margin-top:8px;">Application</div>
      ${p("themes",       "Themes",             "settings")}
      ${p("appearance",   "Appearance",         "settings")}
      ${p("addons",       "Add-ons",            "giftcards")}
      ${p("notifications","Notifications",      "bell")}
      ${p("users",        "User Oversight",     "staff")}
      ${p("activity",     "Login Activity",     "history")}
      ${p("storage",      "Storage &amp; Backups","admin")}
      ${p("maintenance",  "Maintenance",        "admin")}`;
  } else {
    const navLink = (item) =>
      `<a class="nav-link${item.key === activeKey ? " active" : ""}" href="${item.href}" data-nav-key="${item.key}">${svgIcon(item.icon)}<span class="nav-label">${item.label}</span></a>`;
    const enabledAddons = Array.isArray(settings.enabledAddons) ? settings.enabledAddons : [];
    const grouped = new Set();
    linksHtml = NAV_GROUPS.map((g) => {
      let items = g.keys.map((k) => NAV_ITEMS.find((n) => n.key === k)).filter((n) => n && allowed.includes(n.key));
      // Add-on pages only appear once the admin has enabled that add-on.
      if (g.addon) items = items.filter((n) => enabledAddons.includes(ADDON_NAV[n.key]));
      items.forEach((n) => grouped.add(n.key));
      if (!items.length) return "";
      return `<div class="nav-section-label nav-label">${g.label}</div>` + items.map(navLink).join("");
    }).join("");
    // Any visible item not placed in a group (safety net) goes under "More".
    // Add-on items are intentionally excluded — they only show via the gated group.
    const leftovers = NAV_ITEMS.filter((n) => allowed.includes(n.key) && !grouped.has(n.key) && !ADDON_NAV[n.key]);
    if (leftovers.length) linksHtml += `<div class="nav-section-label nav-label">More</div>` + leftovers.map(navLink).join("");
  }

  let branchSwitcherHtml = "";
  if (user.role === "superManager") {
    branchSwitcherHtml = `<select id="branchSwitcher" class="sidebar-branch-select"><option value="">All Branches</option></select>`;
  } else if (user.branch) {
    branchSwitcherHtml = `<div class="sidebar-branch-pill">📍 ${user.branch.name}</div>`;
  }

  const brandName = settings.businessName || "Restaurant POS";
  const logoHtml  = settings.logoUrl
    ? `<img data-brand-logo src="${settings.logoUrl}" alt="" style="width:22px;height:22px;border-radius:5px;object-fit:cover;"/>`
    : svgIcon("brand", 20);

  document.getElementById("navbar").innerHTML = `
    <div class="sidebar" id="sidebar">
      <div class="sidebar-top">
        <a href="${homeHrefFor(user)}" class="brand" data-nav-brand>${logoHtml}<span data-brand-name class="nav-label">${brandName}</span></a>
        <button id="sidebarCollapseBtn" class="sidebar-collapse-btn" title="Collapse sidebar">${svgIcon("collapse", 14)}</button>
      </div>
      ${branchSwitcherHtml ? `<div class="sidebar-branch-row nav-label">${branchSwitcherHtml}</div>` : ""}
      <nav class="sidebar-links">${linksHtml}</nav>
    </div>

    <header class="topbar" id="topbar">
      <div class="topbar-right">
        <div id="topbarClock" class="topbar-clock" title="Current time"></div>
        <button id="quickClockBtn" class="topbar-btn" title="Clock in/out" aria-label="Clock in/out">
          <span id="quickClockIcon">${svgIcon("timeclock", 18)}</span><span id="quickClockLabel" class="sr-only">Clock In/Out</span>
        </button>
        <button id="notifBell" class="topbar-btn" title="Notifications" aria-label="Notifications">
          ${svgIcon("bell", 18)}<span id="notifCount" class="nav-dot topbar-dot" style="display:none;"></span>
        </button>
        <button id="themeToggleBtn" class="topbar-btn" title="Toggle theme" aria-label="Toggle theme">
          <span id="themeIcon">${svgIcon("moon", 18)}</span><span id="themeLabel" class="sr-only">Dark mode</span>
        </button>
        <button id="profileBtn" class="topbar-profile" title="Account" aria-haspopup="true" aria-expanded="false">
          <span class="topbar-avatar">${initialsOf(user.name)}</span>
          <span class="topbar-profile-meta">
            <span class="topbar-profile-name">${user.name}</span>
            <span class="topbar-profile-role">${ROLE_LABEL[user.role] || user.role}</span>
          </span>
          <span class="topbar-chevron">${svgIcon("chevron", 15)}</span>
        </button>
      </div>
    </header>

    <div id="profileMenu" class="topbar-menu" style="display:none;">
      <div class="topbar-menu-head">
        <span class="topbar-avatar lg">${initialsOf(user.name)}</span>
        <div style="min-width:0;">
          <div class="topbar-profile-name" style="font-size:14px;">${user.name}</div>
          <span class="badge badge-${ROLE_BADGE_CLASS[user.role] || "server"}" style="margin-top:3px;">${ROLE_LABEL[user.role] || user.role}</span>
        </div>
      </div>
      ${user.branch ? `<div class="topbar-menu-branch">📍 ${user.branch.name}</div>` : ""}
      <button id="myProfileBtn" class="topbar-menu-item" title="Edit your profile">${svgIcon("staff", 16)}<span>My profile</span></button>
      <button id="fullscreenBtn" class="topbar-menu-item" title="Full screen (F11)">
        <span id="fullscreenIcon">${svgIcon("expand", 16)}</span><span id="fullscreenLabel">Full screen</span>
      </button>
      <a href="#" id="logoutLink" class="topbar-menu-item danger">${svgIcon("logout", 16)}<span>Log out</span></a>
    </div>

    <div id="notifPanel" class="card notif-panel" style="display:none;"></div>
    <div id="quickClockPanel" class="card notif-panel" style="display:none; width:260px; padding:16px; text-align:center;"></div>`;

  document.body.classList.add("has-sidebar");
  document.getElementById("logoutLink").onclick = (e) => { e.preventDefault(); logout(); };

  // ── Profile dropdown ───────────────────────────────────────
  const profileBtn = document.getElementById("profileBtn");
  const profileMenu = document.getElementById("profileMenu");
  if (profileBtn && profileMenu) {
    const closeProfile = () => { profileMenu.style.display = "none"; profileBtn.setAttribute("aria-expanded", "false"); };
    profileBtn.onclick = (e) => {
      e.stopPropagation();
      const opening = profileMenu.style.display === "none";
      document.getElementById("notifPanel").style.display = "none";
      const qc = document.getElementById("quickClockPanel"); if (qc) qc.style.display = "none";
      profileMenu.style.display = opening ? "block" : "none";
      profileBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    };
    document.addEventListener("click", (e) => {
      if (profileMenu.style.display !== "none" && !profileMenu.contains(e.target) && !profileBtn.contains(e.target)) closeProfile();
    });
    // Closing the menu shouldn't swallow the fullscreen click
    document.getElementById("fullscreenBtn").addEventListener("click", () => setTimeout(closeProfile, 50));
    const myp = document.getElementById("myProfileBtn");
    if (myp) myp.onclick = () => { closeProfile(); openProfileModal(user); };
  }

  if (isAdmin && isSettingsPage) {
    document.querySelectorAll("[data-settings-panel]").forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        document.querySelectorAll("[data-settings-panel]").forEach((l) => l.classList.remove("active"));
        link.classList.add("active");
        if (window.posShowSettingsPanel) window.posShowSettingsPanel(link.dataset.settingsPanel);
      };
    });
  } else {
    document.querySelectorAll("[data-nav-key]").forEach((link) => {
      link.addEventListener("mouseenter", () => spaPrefetch(link.getAttribute("href")), { once: false });
      link.addEventListener("focus",      () => spaPrefetch(link.getAttribute("href")), { once: false });
      link.onclick = (e) => { e.preventDefault(); spaNavigate(link.getAttribute("href")); };
    });
  }

  document.querySelector("[data-nav-brand]").onclick = (e) => {
    e.preventDefault();
    spaNavigate(homeHrefFor(user));
  };

  window.addEventListener("popstate", (e) => {
    if (e.state?.href) spaNavigate(e.state.href, false);
  });

  const collapsed = localStorage.getItem("posSidebarCollapsed") === "true";
  if (collapsed) document.body.classList.add("sidebar-collapsed");
  document.getElementById("sidebarCollapseBtn").onclick = () => {
    document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("posSidebarCollapsed", document.body.classList.contains("sidebar-collapsed"));
  };

  const allowOverride = settings.allowUserThemeOverride !== false;
  // ── Full screen ─────────────────────────────────────────────
  // Kiosk mode for the till: hides the browser chrome so the POS fills the
  // screen. Survives SPA navigation because the browser owns the state.
  const fsBtn = document.getElementById("fullscreenBtn");
  if (fsBtn) {
    const syncFs = () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      const ic = document.getElementById("fullscreenIcon");
      const lb = document.getElementById("fullscreenLabel");
      if (ic) ic.innerHTML = svgIcon(on ? "shrink" : "expand", 16);
      if (lb) lb.textContent = on ? "Exit full screen" : "Full screen";
      fsBtn.title = on ? "Exit full screen (Esc)" : "Full screen (F11)";
    };
    fsBtn.onclick = async () => {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
        } else {
          const el = document.documentElement;
          await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
        }
      } catch (e) {
        // Some browsers refuse without a direct user gesture, or block it
        // entirely in an iframe. Fall back to telling them the shortcut.
        if (typeof showToast === "function") showToast("Press F11 for full screen");
      }
    };
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs);
    syncFs();
  }

  // Live top-bar clock (date + time)
  (function startTopbarClock() {
    if (window._gbClockTimer) clearInterval(window._gbClockTimer);
    function tick() {
      const el = document.getElementById("topbarClock");
      if (!el) { if (window._gbClockTimer) { clearInterval(window._gbClockTimer); window._gbClockTimer = null; } return; }
      const now = new Date();
      const h = now.getHours(), m = String(now.getMinutes()).padStart(2, "0");
      const ap = h < 12 ? "AM" : "PM", h12 = h % 12 === 0 ? 12 : h % 12;
      const day = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      el.innerHTML = `<span class="t">${h12}:${m} ${ap}</span><span class="d">${day}</span>`;
    }
    tick();
    window._gbClockTimer = setInterval(tick, 20000);
  })();

  const themeBtn = document.getElementById("themeToggleBtn");
  function syncThemeLabel() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    document.getElementById("themeIcon").innerHTML = svgIcon(isDark ? "sun" : "moon", 16);
    document.getElementById("themeLabel").textContent = isDark ? "Light mode" : "Dark mode";
  }
  syncThemeLabel();
  if (!allowOverride) {
    themeBtn.disabled = true; themeBtn.title = "Theme locked by administrator";
    themeBtn.style.cssText = "opacity:.5;cursor:not-allowed";
  } else {
    themeBtn.onclick = () => { window.posToggleTheme(); syncThemeLabel(); };
  }

  if (user.role === "superManager") {
    const res = await api("/api/branches");
    const branches = await res.json();
    const switcher = document.getElementById("branchSwitcher");
    branches.forEach((b) => switcher.insertAdjacentHTML("beforeend", `<option value="${b.id}">${b.name}</option>`));
    switcher.value = localStorage.getItem("posActiveBranchId") || "";
    switcher.onchange = () => {
      localStorage.setItem("posActiveBranchId", switcher.value);
      spaNavigate(window.location.pathname.split("/").pop() || "dashboard", false);
    };
  }

  if (user.role !== "admin") {
    setTimeout(() => {
      document.querySelectorAll("[data-nav-key]").forEach((link) => {
        const href = link.getAttribute("href");
        if (href && href !== "#") spaPrefetch(href);
      });
    }, 1500);
    setupNotifications(user);
    setupQuickClock(user);
    setupQuickAccess(user);  // ← floating button
  } else {
    document.getElementById("notifBell").style.display    = "none";
    document.getElementById("quickClockBtn").style.display = "none";
  }

  // Shell is up — dismiss the boot splash.
  if (window.__hidePosBoot) setTimeout(window.__hidePosBoot, 180);
}

// ── Quick clock ────────────────────────────────────────────────
async function setupQuickClock(user) {
  const btn   = document.getElementById("quickClockBtn");
  const panel = document.getElementById("quickClockPanel");
  async function getOpenShift() {
    const res = await api(`/api/shifts/open/${user.id}`);
    return res.ok ? res.json() : null;
  }
  async function renderPanel() {
    const open = await getOpenShift();
    if (open) {
      const mins = Math.floor((Date.now() - new Date(open.clockIn).getTime()) / 60000);
      panel.innerHTML = `
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">Clocked in since</div>
        <div style="font-weight:700;font-size:15px;margin-bottom:4px;">${new Date(open.clockIn).toLocaleTimeString()}</div>
        <div style="font-size:12px;color:var(--success);margin-bottom:14px;">${mins<60?mins+"m":(mins/60).toFixed(1)+"h"} on shift</div>
        <button class="btn btn-danger" id="quickClockToggle" style="width:100%;">Clock Out</button>`;
    } else {
      panel.innerHTML = `
        <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">You're not clocked in right now.</div>
        <button class="btn btn-primary" id="quickClockToggle" style="width:100%;">Clock In</button>`;
    }
    panel.querySelector("#quickClockToggle").onclick = async () => {
      await api(open ? "/api/shifts/clockout" : "/api/shifts/clockin", { method:"POST", json:{userId:user.id} });
      renderPanel(); syncLabel();
    };
  }
  async function syncLabel() {
    const open = await getOpenShift();
    document.getElementById("quickClockLabel").textContent = open ? "Clocked In" : "Clock In/Out";
    document.getElementById("quickClockIcon").style.color  = open ? "var(--success)" : "";
  }
  btn.onclick = async (e) => {
    e.stopPropagation();
    const opening = panel.style.display === "none";
    document.getElementById("notifPanel").style.display = "none";
    panel.style.display = opening ? "block" : "none";
    if (opening) renderPanel();
  };
  document.addEventListener("click", (e) => { if (!panel.contains(e.target) && e.target !== btn) panel.style.display = "none"; });
  syncLabel();
}

// ── Notifications ──────────────────────────────────────────────
async function setupNotifications(user) {
  const bell    = document.getElementById("notifBell");
  const panel   = document.getElementById("notifPanel");
  const countEl = document.getElementById("notifCount");

  // Opening the bell NEVER marks notifications as read — they stay until the
  // staff member clicks a specific one (which opens the Notifications page) or
  // uses "Mark all read". This stops the badge from vanishing on a stray hover
  // or a quick peek.  (Requested: keep them until I click and go to the page.)
  let notificationBaselineReady = false;
  let seenNotificationIds = new Set();
  function alertNewNotification(n) {
    const msg = String(n.message || "New restaurant notification");
    if (typeof navToast === "function") navToast(msg);
    // Browsers require an explicit user gesture before audio can play; after
    // the cashier interacts with the page this short alert tone is best-effort.
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = "sine"; osc.frequency.value = 880; gain.gain.value = 0.045;
        osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.16);
        osc.onended = () => ctx.close();
      }
    } catch (_) {}
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification("Golden POS", { body: msg, tag: `golden-pos-${n.id}` }); } catch (_) {}
    }
  }
  async function load() {
    const res  = await api("/api/notifications");
    const list = res.ok ? await res.json() : [];
    const newest = list.filter(n => !seenNotificationIds.has(String(n.id)));
    if (notificationBaselineReady) newest.filter(n => !n.read).slice().reverse().forEach(alertNewNotification);
    list.forEach(n => seenNotificationIds.add(String(n.id)));
    notificationBaselineReady = true;
    const unread = list.filter((n) => !n.read).length;
    countEl.style.display = unread ? "inline-block" : "none";
    countEl.textContent   = unread > 9 ? "9+" : unread;

    const header = `
      <div class="notif-head">
        <span>Notifications${unread ? ` <span class="notif-head-count">${unread}</span>` : ""}</span>
        ${unread ? `<button type="button" class="notif-markall" data-notif-markall>Mark all read</button>` : ""}
      </div>`;
    const body = list.length
      ? list.slice(0, 12).map((n) => `
          <button type="button" class="notif-item${n.read ? " read" : ""}" data-notif-id="${n.id}">
            ${!n.read ? `<span class="notif-unread-dot"></span>` : ""}
            <span class="notif-item-body">
              <span class="notif-item-msg">${navEsc(n.message)}</span>
              <span class="notif-item-time">${new Date(n.createdAt).toLocaleString()}</span>
            </span>
          </button>`).join("")
      : `<div class="empty-state" style="padding:26px 14px;">You're all caught up 🎉</div>`;
    const footer = `<button type="button" class="notif-viewall" data-notif-viewall>View all notifications →</button>`;
    panel.innerHTML = header + `<div class="notif-list">${body}</div>` + footer;

    // A click on a single notification marks just that one read, then opens
    // the Notifications page so the staff member can act on it.
    panel.querySelectorAll("[data-notif-id]").forEach((el) => {
      el.onclick = async () => {
        const id = el.getAttribute("data-notif-id");
        try { await api(`/api/notifications/${id}/read`, { method: "POST" }); } catch (_) {}
        panel.style.display = "none";
        load(); // refresh the topbar badge right away
        if (typeof spaNavigate === "function") spaNavigate("notifications");
        else window.location.href = "notifications";
      };
    });
    const viewAll = panel.querySelector("[data-notif-viewall]");
    if (viewAll) viewAll.onclick = () => {
      panel.style.display = "none";
      if (typeof spaNavigate === "function") spaNavigate("notifications");
      else window.location.href = "notifications";
    };
    const markAll = panel.querySelector("[data-notif-markall]");
    if (markAll) markAll.onclick = async (e) => {
      e.stopPropagation();
      try { await api("/api/notifications/read-all", { method: "POST" }); } catch (_) {}
      load();
    };
  }

  // Let other pages (e.g. the Notifications page) refresh the topbar badge
  // after they mark things read.
  window.refreshNavNotifCount = load;

  bell.onclick = async (e) => {
    e.stopPropagation();
    const opening = panel.style.display === "none" || panel.style.display === "";
    panel.style.display = opening ? "block" : "none";
    if (opening) {
      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (_) {}
      }
      load();
    }
  };
  document.addEventListener("click", (e) => { if (!panel.contains(e.target) && e.target !== bell && !bell.contains(e.target)) panel.style.display = "none"; });
  load();
  setInterval(() => { if (panel.style.display === "none" || panel.style.display === "") load(); else load(); }, 15000);
}

// Small HTML escaper for notification text (messages can contain names).
function navEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ── My Profile modal (self-service for every role) ─────────────
function navToast(msg) {
  const el = document.getElementById("toast");
  if (el) { el.textContent = msg; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600); }
  else if (typeof showToast === "function") showToast(msg);
}
function openProfileModal(user) {
  if (document.getElementById("profileModal")) return;
  const isApprover = ["manager", "superManager", "admin"].includes(user.role);
  const isPin = (user.authMethod || "pin") === "pin";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "profileModal";
  backdrop.innerHTML = `
    <div class="modal" style="width:420px;">
      <h3 style="margin-top:0; display:flex; align-items:center; gap:9px;">
        <span class="topbar-avatar">${initialsOf(user.name)}</span> My Profile
      </h3>

      <div class="f" style="margin-top:6px;"><label>Display name</label>
        <input id="pf_name" value="${(user.name || "").replace(/"/g, "&quot;")}"/></div>
      <button class="btn btn-primary btn-sm" id="pf_saveName" style="margin-bottom:16px;">Save name</button>

      <div style="border-top:1px solid var(--border-soft); padding-top:14px; margin-bottom:6px;">
        ${isPin ? `
          <div class="f"><label>New login PIN (4–8 digits)</label><input id="pf_pin" type="password" inputmode="numeric" placeholder="New PIN"/></div>
          <div class="f"><label>Confirm PIN</label><input id="pf_pin2" type="password" inputmode="numeric" placeholder="Re-enter"/></div>
          <button class="btn btn-sm" id="pf_savePin">Change login PIN</button>
        ` : `
          <div class="f"><label>New password (min 6)</label><input id="pf_pw" type="password" placeholder="New password"/></div>
          <div class="f"><label>Confirm password</label><input id="pf_pw2" type="password" placeholder="Re-enter"/></div>
          <button class="btn btn-sm" id="pf_savePw">Change password</button>
        `}
      </div>

      ${isApprover ? `
      <div style="border-top:1px solid var(--border-soft); padding-top:14px; margin-top:14px;">
        <div style="font-size:12px; color:var(--muted); margin-bottom:8px;">
          🔑 <strong>Approval PIN</strong> — used to approve discounts, voids and refunds.
          Separate from your login PIN. ${user.hasApprovalPin ? "<span style='color:var(--success);'>Currently set.</span>" : "<span style='color:var(--warning);'>Not set yet.</span>"}
        </div>
        <div class="f"><label>New approval PIN (4–8 digits)</label><input id="pf_appr" type="password" inputmode="numeric" placeholder="Approval PIN"/></div>
        <div class="f"><label>Confirm approval PIN</label><input id="pf_appr2" type="password" inputmode="numeric" placeholder="Re-enter"/></div>
        <button class="btn btn-sm" id="pf_saveAppr">Save approval PIN</button>
      </div>` : ""}

      <button class="btn" id="pf_close" style="width:100%; margin-top:18px;">Close</button>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#pf_close").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };

  backdrop.querySelector("#pf_saveName").onclick = async () => {
    const name = backdrop.querySelector("#pf_name").value.trim();
    if (!name) return navToast("Name can't be empty");
    const res = await api("/api/me", { method: "PUT", json: { name } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return navToast(e.error || "Could not save"); }
    const stored = currentUser(); if (stored) { stored.name = name; setCurrentUser(stored, currentToken()); }
    const chip = document.querySelector(".topbar-profile-name"); if (chip) chip.textContent = name;
    document.querySelectorAll(".topbar-avatar").forEach((a) => a.textContent = initialsOf(name));
    navToast("Name updated");
  };

  const pinBtn = backdrop.querySelector("#pf_savePin");
  if (pinBtn) pinBtn.onclick = async () => {
    const p1 = backdrop.querySelector("#pf_pin").value.trim(), p2 = backdrop.querySelector("#pf_pin2").value.trim();
    if (!/^\d{4,8}$/.test(p1)) return navToast("PIN must be 4–8 digits");
    if (p1 !== p2) return navToast("PINs don't match");
    const res = await api("/api/me/login-pin", { method: "POST", json: { pin: p1 } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return navToast(r.error || "Could not change PIN");
    backdrop.querySelector("#pf_pin").value = ""; backdrop.querySelector("#pf_pin2").value = "";
    navToast("Login PIN changed");
  };

  const pwBtn = backdrop.querySelector("#pf_savePw");
  if (pwBtn) pwBtn.onclick = async () => {
    const p1 = backdrop.querySelector("#pf_pw").value, p2 = backdrop.querySelector("#pf_pw2").value;
    if (p1.length < 6) return navToast("Password must be at least 6 characters");
    if (p1 !== p2) return navToast("Passwords don't match");
    const res = await api("/api/auth/change-password", { method: "POST", json: { userId: user.id, newPassword: p1 } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return navToast(r.error || "Could not change password");
    backdrop.querySelector("#pf_pw").value = ""; backdrop.querySelector("#pf_pw2").value = "";
    navToast("Password changed");
  };

  const apprBtn = backdrop.querySelector("#pf_saveAppr");
  if (apprBtn) apprBtn.onclick = async () => {
    const a1 = backdrop.querySelector("#pf_appr").value.trim(), a2 = backdrop.querySelector("#pf_appr2").value.trim();
    if (!/^\d{4,8}$/.test(a1)) return navToast("Approval PIN must be 4–8 digits");
    if (a1 !== a2) return navToast("Approval PINs don't match");
    const res = await api("/api/me/approval-pin", { method: "POST", json: { approvalPin: a1 } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return navToast(r.error || "Could not save approval PIN");
    const stored = currentUser(); if (stored) { stored.hasApprovalPin = true; setCurrentUser(stored, currentToken()); }
    backdrop.querySelector("#pf_appr").value = ""; backdrop.querySelector("#pf_appr2").value = "";
    navToast("Approval PIN saved");
  };
}

// ── Global keyboard navigation (installed once) ────────────────
// Alt+1…9 jumps to the Nth item in the sidebar, so the whole app can be
// driven from the keyboard. Per-page shortcuts (e.g. Order Entry) are layered
// on top of this by their own scripts.
if (!window._navKeysInstalled) {
  window._navKeysInstalled = true;
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (!/^[1-9]$/.test(e.key)) return;
    const links = Array.from(document.querySelectorAll(".sidebar-links [data-nav-key]"));
    const target = links[Number(e.key) - 1];
    if (target) {
      e.preventDefault();
      const href = target.getAttribute("href");
      if (typeof spaNavigate === "function") spaNavigate(href);
      else window.location.href = href;
    }
  });
}
