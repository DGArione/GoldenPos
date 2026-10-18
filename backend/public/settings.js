(async () => {
// settings.js — Admin-only Application Settings page.
const user = requireLogin();
let settings = {};

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

// ---- Panel switching — called by nav.js sidebar clicks ----
window.posShowSettingsPanel = function(key) {
  document.querySelectorAll(".settings-panel").forEach((p) => (p.style.display = p.dataset.panel === key ? "" : "none"));
  if (key === "users") loadUsers();
  if (key === "activity") loadActivity();
  if (key === "addons") loadAddons();
  if (key === "fiscal") loadFiscal();
  if (key === "printing") loadPrinting();
  if (key === "qrorder") loadQrOrder();
  if (key === "storage") loadStorage();
};

// ---- QR Ordering ----
function loadQrOrder() {
  const s = settings || {};
  const b = document.getElementById("qrBaseUrl"); if (b) b.value = s.publicBaseUrl || "";
  const a = document.getElementById("qrAutoKitchen"); if (a) a.checked = s.qrOrderAutoKitchen !== false;
}
(function wireQrOrder() {
  const save = document.getElementById("qrSaveBtn");
  if (save) save.onclick = async () => {
    const body = {
      publicBaseUrl: document.getElementById("qrBaseUrl").value.trim(),
      qrOrderAutoKitchen: document.getElementById("qrAutoKitchen").checked,
    };
    const res = await api("/api/qr/settings", { method: "PUT", json: body });
    if (!res.ok) return showToast("Could not save");
    const r = await res.json();
    settings.publicBaseUrl = r.publicBaseUrl; settings.qrOrderAutoKitchen = r.qrOrderAutoKitchen;
    if (window.posSettings) { window.posSettings.publicBaseUrl = r.publicBaseUrl; window.posSettings.qrOrderAutoKitchen = r.qrOrderAutoKitchen; }
    showToast("QR ordering settings saved");
  };
})();

// ---- Printing: separate Windows kitchen and payment printers ----
function printAgentBase() {
  const raw = (document.getElementById("paUrl")?.value || settings.printAgentUrl || "http://localhost:9110/print").trim();
  try { const u = new URL(raw); u.pathname = "/printers"; u.search = ""; u.hash = ""; return u.toString(); } catch (_) { return ""; }
}
function setPrinterOptions(select, names, selected) {
  if (!select) return;
  select.innerHTML = "";
  const blank = document.createElement("option"); blank.value = ""; blank.textContent = "— Select a printer —"; select.appendChild(blank);
  names.forEach((name) => { const o = document.createElement("option"); o.value = name; o.textContent = name; select.appendChild(o); });
  select.value = selected || "";
  if (selected && select.value !== selected) { const o = document.createElement("option"); o.value = selected; o.textContent = selected + " (saved; not detected)"; select.appendChild(o); select.value = selected; }
}
async function refreshPrinterList() {
  const info = document.getElementById("paTestInfo");
  const kitchen = document.getElementById("paKitchenPrinter"), payment = document.getElementById("paPaymentPrinter"), qrp = document.getElementById("paQrPrinter");
  try {
    const response = await fetch(printAgentBase(), { method: "GET" });
    if (!response.ok) throw new Error("Agent returned " + response.status);
    const data = await response.json();
    const names = Array.isArray(data.printers) ? data.printers : [];
    setPrinterOptions(kitchen, names, settings.kitchenPrinterName || "");
    setPrinterOptions(payment, names, settings.paymentPrinterName || "");
    setPrinterOptions(qrp, names, settings.qrPrinterName || "");
    if (info) info.textContent = names.length ? `Found ${names.length} printer(s). Select one for each role.` : "No Windows printers found. Check the print agent is running on the POS computer.";
  } catch (e) {
    setPrinterOptions(kitchen, [], settings.kitchenPrinterName || "");
    setPrinterOptions(payment, [], settings.paymentPrinterName || "");
    setPrinterOptions(qrp, [], settings.qrPrinterName || "");
    if (info) info.textContent = "Could not load printers. Start the print agent on this POS computer, then refresh the printer list.";
  }
}
function loadPrinting() {
  const s = settings || {};
  const en = document.getElementById("paEnabled"); if (en) en.checked = !!s.printAgentEnabled;
  const url = document.getElementById("paUrl"); if (url) url.value = s.printAgentUrl || "http://localhost:9110/print";
  const w = document.getElementById("paWidth"); if (w) w.value = String(s.printPaperWidth || 48);
  refreshPrinterList();
}
(function wirePrinting() {
  const save = document.getElementById("paSaveBtn");
  if (save) save.onclick = async () => {
    const body = {
      printAgentEnabled: document.getElementById("paEnabled").checked,
      printAgentUrl: document.getElementById("paUrl").value.trim(),
      printPaperWidth: parseInt(document.getElementById("paWidth").value, 10) || 48,
      kitchenPrinterName: document.getElementById("paKitchenPrinter").value,
      paymentPrinterName: document.getElementById("paPaymentPrinter").value,
      qrPrinterName: document.getElementById("paQrPrinter").value,
    };
    const res = await api("/api/print/settings", { method: "PUT", json: body });
    if (!res.ok) return showToast("Could not save printer settings");
    const r = await res.json(); Object.assign(settings, r);
    if (window.posSettings) Object.assign(window.posSettings, r);
    showToast("Printer settings saved");
  };
  const refresh = document.getElementById("paRefreshPrintersBtn"); if (refresh) refresh.onclick = refreshPrinterList;
  async function testPrinter(role) {
    const info = document.getElementById("paTestInfo");
    if (!window.posSendToAgent) { info.textContent = "Printing helper not loaded."; return; }
    const select = document.getElementById(role === "kitchen" ? "paKitchenPrinter" : "paPaymentPrinter");
    const printerName = select.value;
    if (!printerName) { info.textContent = "Select a printer first."; return; }
    const w = parseInt(document.getElementById("paWidth").value, 10) || 48;
    const text = [role === "kitchen" ? "*** KITCHEN PRINTER TEST ***" : "*** PAYMENT PRINTER TEST ***", settings.businessName || "Golden POS", new Date().toLocaleString(), "-".repeat(w), "Printer routing is working.", ""].join("\n");
    if (window.posSettings) Object.assign(window.posSettings, { printAgentUrl: document.getElementById("paUrl").value.trim(), printAgentEnabled: true, kitchenPrinterName: document.getElementById("paKitchenPrinter").value, paymentPrinterName: document.getElementById("paPaymentPrinter").value });
    const ok = await window.posSendToAgent({ type: "test", printerRole: role, printerName, title: role + " printer test", text, copies: 1 });
    info.textContent = ok ? `Test sent to ${printerName}.` : `Could not print to ${printerName}. Check the agent and printer connection.`;
  }
  const tk = document.getElementById("paTestKitchenBtn"); if (tk) tk.onclick = () => testPrinter("kitchen");
  const tp = document.getElementById("paTestPaymentBtn"); if (tp) tp.onclick = () => testPrinter("payment");
  const tq = document.getElementById("paTestQrBtn");
  if (tq) tq.onclick = async () => {
    const info = document.getElementById("paTestInfo");
    const printerName = document.getElementById("paQrPrinter").value;
    if (!printerName) { info.textContent = "Select a QR printer first."; return; }
    if (!window.posPrintTableQr || typeof window.posQrRaster !== "function") { info.textContent = "QR helper not loaded."; return; }
    if (window.posSettings) Object.assign(window.posSettings, { printAgentUrl: document.getElementById("paUrl").value.trim(), printAgentEnabled: true, printPaperWidth: parseInt(document.getElementById("paWidth").value, 10) || 48, qrPrinterName: printerName });
    const base = (settings.publicBaseUrl || window.location.origin).replace(/\/+$/, "");
    const ok = await window.posPrintTableQr({ title: "QR TEST", subtitle: settings.businessName || "Golden POS", url: base + "/t/test", footer: new Date().toLocaleString() });
    info.textContent = ok ? `Test QR sent to ${printerName}.` : `Could not print to ${printerName}. Check the agent and printer connection.`;
  };
})();


// ---- Storage & Backups: data + backup folders, with free-space checks ----
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(0) + " MB";
  return Math.max(0, Math.round(n / 1024)) + " KB";
}
function spaceBar(d) {
  if (!d || !d.totalBytes) return "";
  const used = Math.max(0, d.totalBytes - d.freeBytes), pct = Math.round(used / d.totalBytes * 100);
  const low = d.freeBytes < 2 * 1073741824 || d.freeBytes / d.totalBytes < 0.1;
  return `<div style="margin:2px 0 4px;"><div style="height:8px;border-radius:4px;background:var(--neutral-bg);overflow:hidden;max-width:360px;"><div style="height:100%;width:${pct}%;background:${low ? "var(--danger)" : "var(--accent)"};"></div></div>
    <span style="font-size:12px;color:${low ? "var(--danger)" : "var(--muted)"};">Drive ${d.root}: <strong>${fmtBytes(d.freeBytes)}</strong> free of ${fmtBytes(d.totalBytes)}${low ? " - running low" : ""}</span></div>`;
}
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let stInfo = null;
async function loadStorage() {
  const dataEl = document.getElementById("stDataInfo"), bkEl = document.getElementById("stBackupInfo");
  try {
    const res = await api("/api/admin/storage");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const i = stInfo = await res.json();
    let note = "";
    if (i.envLocked) note += `<div style="color:var(--warning);font-size:12px;">The data folder is fixed on this computer (POS_DATA_DIR) and can't be changed here.</div>`;
    if (i.pendingMove) note += `<div style="color:var(--warning);font-size:12px;">A move to <code>${escHtml(i.pendingMove)}</code> is waiting for the next restart. <a href="#" id="stCancelMove">Cancel it</a></div>`;
    if (i.lastMove) note += i.lastMove.ok
      ? `<div style="font-size:12px;color:var(--muted);">Last move: ${new Date(i.lastMove.at).toLocaleString()} - done. The old files are still in <code>${escHtml(i.lastMove.from)}</code>; delete them yourself once you are happy.</div>`
      : `<div style="font-size:12px;color:var(--danger);">Last move attempt failed and was cancelled (${escHtml(i.lastMove.error)}). Nothing was changed.</div>`;
    dataEl.innerHTML = `Now saved in <code>${escHtml(i.dataDir)}</code><br>Database ${fmtBytes(i.dbBytes)} &middot; whole folder ${fmtBytes(i.dataBytes)}${spaceBar(i.dataDrive)}${note}`;
    bkEl.innerHTML = `Now saved in <code>${escHtml(i.backupDir)}</code><br>${i.backupCount} backup file(s), ${fmtBytes(i.backupBytes)}${spaceBar(i.backupDrive)}`;
    const c = document.getElementById("stCancelMove");
    if (c) c.onclick = async (e) => { e.preventDefault(); await api("/api/admin/storage/cancel-move", { method: "POST", json: {} }); loadStorage(); };
    document.getElementById("stDataPath").disabled = !!i.envLocked;
  } catch (e) {
    dataEl.textContent = bkEl.textContent = "Could not load storage details.";
  }
}
async function checkFolderUi(kind) {
  const input = document.getElementById(kind === "data" ? "stDataPath" : "stBackupPath");
  const out = document.getElementById(kind === "data" ? "stDataResult" : "stBackupResult");
  const go = document.getElementById(kind === "data" ? "stDataMoveBtn" : "stBackupUseBtn");
  go.disabled = true; out.textContent = "Checking…";
  const res = await api("/api/admin/storage/check", { method: "POST", json: { path: input.value, kind } });
  const r = res.ok ? await res.json() : { problem: "Could not check that folder." };
  const lines = [];
  if (r.root) lines.push(`Drive ${escHtml(r.root)}: <strong>${fmtBytes(r.freeBytes)}</strong> free of ${fmtBytes(r.totalBytes)}`);
  if (r.requiredBytes) lines.push(`Space needed: about ${fmtBytes(r.requiredBytes)}`);
  if (r.problem) lines.push(`<span style="color:var(--danger);font-weight:600;">✖ ${escHtml(r.problem)}</span>`);
  else lines.push(`<span style="color:var(--success,green);font-weight:600;">✔ This folder can be used${r.exists ? "" : " (it will be created)"}.</span>`);
  out.innerHTML = lines.join("<br>");
  go.disabled = !r.usable;
  return r;
}
async function waitForBackend() {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try { const r = await fetch("api/boot", { cache: "no-store" }); if (r.ok) return true; } catch (_) {}
  }
  return false;
}
(function wireStorage() {
  const q = (id) => document.getElementById(id);
  if (!q("stDataCheckBtn")) return;
  q("stDataCheckBtn").onclick = () => checkFolderUi("data");
  q("stBackupCheckBtn").onclick = () => checkFolderUi("backup");
  q("stDataPath").oninput = () => { q("stDataMoveBtn").disabled = true; };
  q("stBackupPath").oninput = () => { q("stBackupUseBtn").disabled = true; };
  q("stDataMoveBtn").onclick = async () => {
    const r = await checkFolderUi("data");
    if (!r.usable) return;
    if (!confirm(`Move ALL POS data to:\n${r.path}\n\nThe POS will restart and everyone will be signed out for about a minute. The old files stay where they are as a fallback.\n\nContinue?`)) return;
    const out = q("stDataResult"); q("stDataMoveBtn").disabled = true;
    out.textContent = "Taking a safety backup and restarting…";
    const res = await api("/api/admin/storage/data-dir", { method: "POST", json: { path: q("stDataPath").value, confirm: true } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { out.innerHTML = `<span style="color:var(--danger);">✖ ${escHtml(j.error || "Could not start the move.")}</span>`; return; }
    out.textContent = "Restarting the POS and copying the data… please wait.";
    const back = await waitForBackend();
    out.textContent = back ? "Back online. Reloading…" : "The POS is taking longer than expected. Check the POS computer.";
    if (back) setTimeout(() => location.reload(), 1200);
  };
  q("stBackupUseBtn").onclick = async () => {
    const r = await checkFolderUi("backup");
    if (!r.usable) return;
    const out = q("stBackupResult"); q("stBackupUseBtn").disabled = true;
    out.textContent = "Copying existing backups and making a test backup…";
    const res = await api("/api/admin/storage/backup-dir", { method: "POST", json: { path: q("stBackupPath").value, confirm: true } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { out.innerHTML = `<span style="color:var(--danger);">✖ ${escHtml(j.error || "Could not change the backup folder.")}</span>`; return; }
    out.innerHTML = `<span style="color:var(--success,green);font-weight:600;">✔ Backups now go to ${escHtml(j.backupDir)}.</span> ${j.copied} existing backup(s) copied; test backup ${escHtml(j.testBackup || "")} saved.`;
    showToast("Backup folder changed"); loadStorage();
  };
  q("stBackupResetBtn").onclick = async () => {
    if (!confirm("Go back to the default backup folder (inside the data folder)?")) return;
    const res = await api("/api/admin/storage/backup-dir", { method: "POST", json: { path: "", confirm: true } });
    const j = await res.json().catch(() => ({}));
    q("stBackupResult").innerHTML = res.ok ? `<span style="color:var(--success,green);">✔ Backups now go to ${escHtml(j.backupDir)}.</span>` : `<span style="color:var(--danger);">✖ ${escHtml(j.error || "Failed")}</span>`;
    if (res.ok) { q("stBackupPath").value = ""; loadStorage(); }
  };
})();

// ---- Fiscal & Tax ----
function loadFiscal() {
  const s = settings || {};
  const trn = document.getElementById("fiscalTrn"); if (trn) trn.value = s.taxRegNo || "";
  const en = document.getElementById("fiscalEnabled"); if (en) en.checked = !!s.fiscalEnabled;
  const pre = document.getElementById("fiscalPrefix"); if (pre) pre.value = s.fiscalPrefix || "INV-";
  const today = new Date().toISOString().slice(0, 10);
  const first = today.slice(0, 8) + "01";
  const from = document.getElementById("fiscalFrom"); if (from && !from.value) from.value = first;
  const to = document.getElementById("fiscalTo"); if (to && !to.value) to.value = today;
}
(function wireFiscal() {
  const saveBtn = document.getElementById("fiscalSaveBtn");
  if (saveBtn) saveBtn.onclick = async () => {
    const body = {
      taxRegNo: document.getElementById("fiscalTrn").value.trim(),
      fiscalEnabled: document.getElementById("fiscalEnabled").checked,
      fiscalPrefix: document.getElementById("fiscalPrefix").value.trim() || "INV-",
    };
    const res = await api("/api/fiscal/settings", { method: "PUT", json: body });
    if (!res.ok) { showToast("Could not save fiscal settings"); return; }
    const r = await res.json();
    settings.taxRegNo = r.taxRegNo; settings.fiscalEnabled = r.fiscalEnabled; settings.fiscalPrefix = r.fiscalPrefix;
    if (window.posSettings) Object.assign(window.posSettings, { taxRegNo: r.taxRegNo, fiscalEnabled: r.fiscalEnabled, fiscalPrefix: r.fiscalPrefix });
    showToast("Fiscal settings saved");
  };
  const expBtn = document.getElementById("fiscalExportBtn");
  if (expBtn) expBtn.onclick = async () => {
    const from = document.getElementById("fiscalFrom").value;
    const to = document.getElementById("fiscalTo").value;
    const res = await api(`/api/fiscal/export?from=${from}&to=${to}`);
    if (!res.ok) { showToast("Export failed"); return; }
    const data = await res.json();
    const blob = new Blob([data.csv || ""], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fiscal-journal-${from}_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    document.getElementById("fiscalExportInfo").textContent =
      `${data.count} invoice(s) · VAT ${(window.posCurrency ? posCurrency() : "")}${(data.totalVat || 0).toFixed(2)} · Gross ${(window.posCurrency ? posCurrency() : "")}${(data.totalGross || 0).toFixed(2)}`;
  };
})();

// ---- Add-ons ----
const ADDONS = [
  { key: "loyalty",      icon: "💛", name: "Loyalty Points", desc: "Customers earn points on paid orders and redeem them for discounts. Needs the Customer directory." },
  { key: "giftcards",    icon: "🎁", name: "Gift Cards",     desc: "Issue and redeem prepaid gift cards with a scannable QR code." },
  { key: "promotions",   icon: "🏷️", name: "Promotions",     desc: "Buy-N, bundle and daily item discounts, applied automatically at order time." },
  { key: "reservations", icon: "📅", name: "Reservations",   desc: "Take and manage table bookings." },
];
function loadAddons() {
  const el = document.getElementById("addonsList");
  if (!el) return;
  const on = Array.isArray(settings.enabledAddons) ? settings.enabledAddons : [];
  el.innerHTML = ADDONS.map((a) => {
    const enabled = on.includes(a.key);
    return `
      <div class="card" style="padding:16px 18px; display:flex; align-items:center; gap:14px;">
        <div style="font-size:26px;">${a.icon}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; font-size:14px;">${a.name} ${enabled ? '<span class="badge badge-paid" style="margin-left:4px;">on</span>' : ''}</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">${a.desc}</div>
        </div>
        <button class="btn ${enabled ? "btn-danger" : "btn-primary"}" data-addon="${a.key}" data-enable="${enabled ? 0 : 1}" style="font-size:13px; white-space:nowrap;">
          ${enabled ? "Disable" : "Enable"}
        </button>
      </div>`;
  }).join("");
  el.querySelectorAll("[data-addon]").forEach((btn) => {
    btn.onclick = async () => {
      const addon = btn.dataset.addon;
      const enabled = btn.dataset.enable === "1";
      btn.disabled = true;
      const res = await api("/api/admin/addons", { method: "POST", json: { addon, enabled } });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(r.error || "Could not update add-on"); btn.disabled = false; return; }
      settings.enabledAddons = r.enabledAddons;
      if (window.posSettings) window.posSettings.enabledAddons = r.enabledAddons;
      showToast(`${addon} ${enabled ? "enabled" : "disabled"} — staff see it on next load`);
      loadAddons();
    };
  });
}

function setupSidenav() {
  // Sidebar nav handles panel switching via posShowSettingsPanel.
  // Default to first panel on load.
  window.posShowSettingsPanel("bizinfo");
}

// ---- Populate form ----
function populateForm() {
  // Business info
  document.getElementById("setBusinessName").value  = settings.businessName || "";
  document.getElementById("setTagline").value        = settings.businessTagline || "";
  document.getElementById("setBusinessPhone").value  = settings.businessPhone || "";
  document.getElementById("setBusinessAddress").value= settings.businessAddress || "";
  document.getElementById("setBusinessEmail").value  = settings.businessEmail || "";
  document.getElementById("setLogoUrl").value        = settings.logoUrl || "";
  // Rates
  document.getElementById("setServiceCharge").value = ((settings.serviceChargeRate || 0) * 100).toFixed(2);
  document.getElementById("setVat").value            = ((settings.vatRate || 0) * 100).toFixed(2);
  document.getElementById("setCardFee").value         = ((settings.cardFeePercent || 0) * 100).toFixed(2);
  document.getElementById("setCurrency").value       = settings.currencySymbol || "Rs.";
  document.getElementById("setDefaultOrderType").value = settings.defaultOrderType || "dine-in";
  document.getElementById("setDateFormat").value     = settings.dateFormat || "DD/MM/YYYY";
  // Receipt
  document.getElementById("setReceiptFooter").value  = settings.receiptFooterText || "Thank you!";
  document.getElementById("setReceiptVatBreakdown").checked = settings.receiptShowVatBreakdown !== false;
  // Appearance
  document.getElementById("setTheme").value          = settings.theme || "light";
  document.getElementById("setAllowOverride").checked = settings.allowUserThemeOverride !== false;
  document.getElementById("setFont").value           = settings.font || "Inter";
  // Notifications
  document.getElementById("setLowStockThreshold").value = settings.lowStockDefaultThreshold ?? 5;
  // System info
  document.getElementById("sysInfo").innerHTML = `
    App version: <strong>Phase 5+</strong><br>
    Last backup: <strong>${settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString() : "Never"}</strong><br>
    Data store: <strong>JSON file</strong> (data/store.json)`;
  // Render theme grid
  renderThemeGrid();
  // Login page
  renderLoginLayoutPicker();
  renderLoginThemeSelect();
  const lbEl = document.getElementById("setLoginBgUrl");
  if (lbEl) lbEl.value = settings.loginBgUrl || "";
  // Show/hide based on saved setting
  const imgRow = document.getElementById("loginBgUrlRow");
  const activeLayout = LOGIN_LAYOUTS.find(l => l.id === (settings.loginLayout || "chalkboard"));
  if (imgRow) imgRow.style.display = (activeLayout && activeLayout.needsImage) ? "" : "none";
}

// ---- Theme grid ----
// Track what's been selected (staged) vs what's saved
// ---- Login page layout picker ----
const LOGIN_LAYOUTS = [
  { id: "chalkboard",   label: "Chalkboard Split", desc: "An olive chalkboard panel with the café name in script, beside a warm kraft login card.", needsImage: false },
  { id: "kraft-ticket", label: "Kraft Ticket",     desc: "One cosy kraft card framed with a dashed receipt border. Simple and homely.",            needsImage: false },
  { id: "seaside",      label: "Seaside",          desc: "Kraft card with a golden sun glow behind it and a hand-drawn wave along the bottom.",    needsImage: false },
];

// Build the login-page theme dropdown from the palettes theme.js defines.
function renderLoginThemeSelect() {
  const sel = document.getElementById("setLoginTheme");
  if (!sel) return;
  const themes = window.POS_THEMES || {};
  const label = (id) => id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
  const light = [], dark = [];
  Object.keys(themes).forEach((id) => (themes[id].dark ? dark : light).push(id));
  const opts = (ids) => ids.map((id) => `<option value="${id}">${label(id)}</option>`).join("");
  sel.innerHTML =
    `<option value="">Match app theme</option>` +
    (light.length ? `<optgroup label="Light">${opts(light)}</optgroup>` : "") +
    (dark.length ? `<optgroup label="Dark">${opts(dark)}</optgroup>` : "");
  sel.value = settings.loginThemeId || "";
}

function renderLoginLayoutPicker() {
  const el = document.getElementById("loginLayoutPicker");
  if (!el) return;
  const active = settings.loginLayout || "chalkboard";
  el.innerHTML = LOGIN_LAYOUTS.map(l => `
    <div data-layout="${l.id}" style="border:2px solid ${l.id===active ? "var(--accent)" : "var(--border)"}; border-radius:12px; padding:12px; cursor:pointer; background:var(--panel); transition:all .15s; position:relative;">
      ${l.id===active ? `<span style="position:absolute;top:8px;right:8px;background:var(--accent);color:white;font-size:9px;font-weight:700;border-radius:4px;padding:2px 6px;">ACTIVE</span>` : ""}
      <div style="height:72px; border-radius:8px; margin-bottom:10px; overflow:hidden;">
        ${loginLayoutPreview(l.id)}
      </div>
      <div style="font-size:12px; font-weight:700; margin-bottom:3px;">${l.label}</div>
      <div style="font-size:10px; color:var(--muted); line-height:1.5;">${l.desc}</div>
      ${l.needsImage ? `<div style="font-size:10px; color:var(--accent); margin-top:4px; font-weight:600;">📷 Requires background image</div>` : ""}
    </div>`).join("");

  // Show/hide image URL field based on selection
  function syncImageField() {
    const active = settings.loginLayout || "chalkboard";
    const activeLayout = LOGIN_LAYOUTS.find(l => l.id === active);
    const imgRow = document.getElementById("loginBgUrlRow");
    if (imgRow) imgRow.style.display = (activeLayout && activeLayout.needsImage) ? "" : "none";
  }
  syncImageField();

  el.querySelectorAll("[data-layout]").forEach(card => {
    card.onclick = () => {
      settings = { ...settings, loginLayout: card.dataset.layout };
      renderLoginLayoutPicker(); // re-renders with new active + shows/hides image field
    };
  });
}

function loginLayoutPreview(id) {
  const s = 'width:100%;height:100%;display:block;';
  const pad = (x) => `<rect x="${x}" y="30" width="7" height="7" rx="1.5" fill="var(--border)"/><rect x="${x}" y="40" width="7" height="7" rx="1.5" fill="var(--border)"/>`;
  // Chalkboard Split: dark olive panel on the left, kraft card on the right
  if (id === "chalkboard") return `<svg viewBox="0 0 100 72" style="${s}"><rect width="100" height="72" fill="var(--bg)"/><rect width="46" height="72" fill="#2c3420"/><rect x="44" y="0" width="2" height="72" fill="#241a0f"/><circle cx="12" cy="13" r="5" fill="var(--accent)"/><path d="M8 34 h26 M8 41 h20 M8 48 h24" stroke="#f4e9cf" stroke-width="2.4" stroke-linecap="round" opacity=".85"/><rect x="55" y="12" width="38" height="48" rx="7" fill="var(--panel)" stroke="var(--border)" stroke-width="1.5"/><rect x="64" y="19" width="20" height="3" rx="1.5" fill="var(--accent)"/><rect x="63" y="29" width="6" height="6" rx="1.5" fill="var(--border)"/><rect x="71" y="29" width="6" height="6" rx="1.5" fill="var(--border)"/><rect x="79" y="29" width="6" height="6" rx="1.5" fill="var(--border)"/><rect x="63" y="38" width="6" height="6" rx="1.5" fill="var(--border)"/><rect x="71" y="38" width="6" height="6" rx="1.5" fill="var(--border)"/><rect x="79" y="38" width="6" height="6" rx="1.5" fill="var(--border)"/><rect x="63" y="49" width="22" height="6" rx="3" fill="var(--accent)"/></svg>`;
  // Kraft Ticket: single kraft card with a dashed receipt frame
  if (id === "kraft-ticket") return `<svg viewBox="0 0 100 72" style="${s}"><rect width="100" height="72" fill="var(--bg)"/><rect x="28" y="9" width="44" height="54" rx="6" fill="var(--panel)" stroke="var(--border)" stroke-width="1.5"/><rect x="32" y="13" width="36" height="46" rx="4" fill="none" stroke="var(--accent)" stroke-width="1.2" stroke-dasharray="3 3"/><rect x="40" y="19" width="20" height="3" rx="1.5" fill="var(--accent)"/>${pad(38)}${pad(46)}${pad(54)}<rect x="38" y="52" width="24" height="6" rx="3" fill="var(--accent)"/></svg>`;
  // Seaside: sun glow + wave
  if (id === "seaside") return `<svg viewBox="0 0 100 72" style="${s}"><rect width="100" height="72" fill="var(--bg)"/><circle cx="50" cy="6" r="26" fill="var(--sun, #e0a040)" opacity=".4"/><rect x="28" y="11" width="44" height="46" rx="7" fill="var(--panel)" stroke="var(--border)" stroke-width="1.5"/><rect x="38" y="17" width="24" height="3" rx="1.5" fill="var(--accent)"/>${pad(38)}${pad(46)}${pad(54)}<rect x="38" y="49" width="24" height="5" rx="2.5" fill="var(--accent)"/><path d="M0 66 Q 12 60 25 66 T 50 66 T 75 66 T 100 66" stroke="#4c5738" stroke-width="2" fill="none"/><path d="M0 70 Q 12 64 25 70 T 50 70 T 75 70 T 100 70" stroke="var(--accent)" stroke-width="2" fill="none"/></svg>`;
  return "";
}

let stagedLight = null;
let stagedDark  = null;

function renderThemeGrid() {
  const grid = document.getElementById("themeGrid");
  const savedLightId = settings.lightThemeId || "espresso";
  const savedDarkId  = settings.darkThemeId  || "slateNight";
  // Stage defaults to saved on first render
  if (!stagedLight) stagedLight = savedLightId;
  if (!stagedDark)  stagedDark  = savedDarkId;

  const allThemes = Object.entries(window.POS_THEMES);
  const lightThemes = allThemes.filter(([, t]) => !t.dark);
  const darkThemes  = allThemes.filter(([, t]) =>  t.dark);

  function cardHtml([id, t], selected) {
    const isSaved = id === (t.dark ? savedDarkId : savedLightId);
    return `<div class="theme-card ${id === selected ? "active" : ""}" data-theme-id="${id}" data-is-dark="${t.dark ? 1 : 0}" style="position:relative;">
      ${isSaved ? `<span style="position:absolute;top:5px;right:5px;background:var(--accent);color:white;font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;">SAVED</span>` : ""}
      <div class="theme-swatches">${t.preview.map(c => `<div class="theme-swatch" style="background:${c};"></div>`).join("")}</div>
      <div class="theme-label" style="font-size:11px;">${t.label}</div>
    </div>`;
  }

  const lightChanged = stagedLight !== savedLightId;
  const darkChanged  = stagedDark  !== savedDarkId;

  grid.innerHTML = `
    <!-- LIGHT SECTION -->
    <div style="grid-column:1/-1; margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div>
          <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">☀ Light Mode Theme</span>
          <span style="font-size:11px;color:var(--muted);margin-left:8px;">tap to preview — see it live on this page</span>
        </div>
        <button id="saveLightBtn" class="btn btn-primary" style="font-size:12px; padding:7px 14px; ${!lightChanged ? "opacity:0.4;" : ""}">
          Save Light Theme
        </button>
      </div>
      <div class="theme-grid-inner">${lightThemes.map(e => cardHtml(e, stagedLight)).join("")}</div>
    </div>

    <!-- DARK SECTION -->
    <div style="grid-column:1/-1; margin-top:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div>
          <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">🌙 Dark Mode Theme</span>
          <span style="font-size:11px;color:var(--muted);margin-left:8px;">tap to preview — see it live on this page</span>
        </div>
        <button id="saveDarkBtn" class="btn btn-primary" style="font-size:12px; padding:7px 14px; ${!darkChanged ? "opacity:0.4;" : ""}">
          Save Dark Theme
        </button>
      </div>
      <div class="theme-grid-inner">${darkThemes.map(e => cardHtml(e, stagedDark)).join("")}</div>
    </div>

    <p style="grid-column:1/-1; font-size:11px; color:var(--muted); margin-top:14px;">
      💡 Tap any theme to preview it instantly. Click <strong>Save</strong> to lock it in — all staff will use your saved choices when toggling modes.
    </p>
  `;

  // Card click → preview live, mark as staged (not yet saved)
  grid.querySelectorAll(".theme-card").forEach(card => {
    card.onclick = () => {
      const themeId = card.dataset.themeId;
      const isDark  = card.dataset.isDark === "1";

      // Stage it
      if (isDark) stagedDark  = themeId;
      else        stagedLight = themeId;

      // Preview live: temporarily apply it
      const previewSettings = { ...settings };
      if (isDark) previewSettings.darkThemeId  = themeId;
      else        previewSettings.lightThemeId = themeId;

      // Switch to that mode so the preview is visible
      const previewMode = isDark ? "dark" : "light";
      localStorage.setItem(window.posModeKey(), previewMode);
      window._currentMode = previewMode;
      window.posApplyBranding(previewSettings);

      // Re-render to update active/staged state
      renderThemeGrid();
    };
  });

  // Save Light
  document.getElementById("saveLightBtn").onclick = async () => {
    const updated = await saveSettings({ lightThemeId: stagedLight }, "Light theme");
    if (updated) {
      settings = updated;
      window.posApplyBranding(settings);
      showToast(`Light theme saved — all staff will see "${window.POS_THEMES[stagedLight]?.label}" in light mode`);
      renderThemeGrid();
    }
  };

  // Save Dark
  document.getElementById("saveDarkBtn").onclick = async () => {
    const updated = await saveSettings({ darkThemeId: stagedDark }, "Dark theme");
    if (updated) {
      settings = updated;
      window.posApplyBranding(settings);
      showToast(`Dark theme saved — all staff will see "${window.POS_THEMES[stagedDark]?.label}" in dark mode`);
      renderThemeGrid();
    }
  };
}

// ---- Save helper ----
async function saveSettings(updates, label) {
  const res = await api("/api/settings", { method: "PUT", json: updates });
  if (!res.ok) { showToast("Save failed"); return null; }
  settings = await res.json();
  window.posApplyBranding(settings);
  showToast(`${label} saved ✓`);
  return settings;
}

// ---- Save handlers ----
function setupSaveHandlers() {
  document.getElementById("saveBusinessBtn").onclick = () => saveSettings({
    businessName:    document.getElementById("setBusinessName").value.trim() || "Restaurant POS",
    businessTagline: document.getElementById("setTagline").value.trim(),
    businessPhone:   document.getElementById("setBusinessPhone").value.trim(),
    businessAddress: document.getElementById("setBusinessAddress").value.trim(),
    businessEmail:   document.getElementById("setBusinessEmail").value.trim(),
    logoUrl:         document.getElementById("setLogoUrl").value.trim(),
  }, "Business info");

  document.getElementById("saveRegionalBtn").onclick = () => saveSettings({
    serviceChargeRate: +(Number(document.getElementById("setServiceCharge").value) / 100).toFixed(4),
    vatRate:           +(Number(document.getElementById("setVat").value) / 100).toFixed(4),
    cardFeePercent:    +(Number(document.getElementById("setCardFee").value) / 100).toFixed(4),
    currencySymbol:    document.getElementById("setCurrency").value.trim() || "Rs.",
    defaultOrderType:  document.getElementById("setDefaultOrderType").value,
    dateFormat:        document.getElementById("setDateFormat").value,
  }, "Rates & currency");

  document.getElementById("saveReceiptBtn").onclick = () => saveSettings({
    receiptFooterText:      document.getElementById("setReceiptFooter").value.trim() || "Thank you!",
    receiptShowVatBreakdown: document.getElementById("setReceiptVatBreakdown").checked,
  }, "Receipt settings");

  const saveLoginPageBtn = document.getElementById("saveLoginPageBtn");
  if (saveLoginPageBtn) {
    saveLoginPageBtn.onclick = async () => {
      const bgUrl = document.getElementById("setLoginBgUrl").value.trim();
      const layout = settings.loginLayout || "chalkboard";
      const loginThemeId = (document.getElementById("setLoginTheme") || {}).value || "";
      const updated = await saveSettings({ loginLayout: layout, loginBgUrl: bgUrl, loginThemeId }, "Login page");
      if (updated) { settings = updated; renderLoginLayoutPicker(); }
    };
  }

  document.getElementById("saveAppearanceBtn").onclick = () => saveSettings({
    theme:                  document.getElementById("setTheme").value,
    allowUserThemeOverride: document.getElementById("setAllowOverride").checked,
    font:                   document.getElementById("setFont").value.trim() || "Inter",
  }, "Appearance");

  document.getElementById("saveNotificationsBtn").onclick = () => saveSettings({
    lowStockDefaultThreshold: Number(document.getElementById("setLowStockThreshold").value) || 0,
    notifyEmailEnabled:       document.getElementById("setEmailEnabled").checked,
    notifySmsEnabled:         document.getElementById("setSmsEnabled").checked,
  }, "Notifications");

  document.getElementById("backupBtn").onclick = async () => {
    const res = await api("/api/settings/backup", { method: "POST" });
    if (!res.ok) { showToast("Backup failed"); return; }
    const data = await res.json();
    settings = data.settings;
    populateForm();
    showToast("Backup time recorded");
  };

  // Real backup — pulls every table and saves it as a JSON file locally.
  document.getElementById("downloadBackupBtn").onclick = async () => {
    const btn = document.getElementById("downloadBackupBtn");
    btn.disabled = true; const orig = btn.textContent; btn.textContent = "Preparing…";
    try {
      const res = await api("/api/settings/export");
      if (!res.ok) { showToast("Export failed"); return; }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.href = url;
      a.download = `pos-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      settings.lastBackupAt = data.exportedAt;
      populateForm();
      showToast("Backup downloaded ✓");
    } catch (e) {
      showToast("Backup failed: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  };

  // Restore — upload a backup JSON and overwrite everything (destructive).
  const restoreBtn   = document.getElementById("restoreBackupBtn");
  const restoreInput = document.getElementById("restoreFileInput");
  if (restoreBtn && restoreInput) {
    restoreBtn.onclick = () => restoreInput.click();
    restoreInput.onchange = async () => {
      const file = restoreInput.files && restoreInput.files[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); }
      catch (e) { showToast("That file isn't valid JSON"); restoreInput.value = ""; return; }
      if (!data || !data.tables || typeof data.tables !== "object") {
        showToast("Not a POS backup file (no \"tables\" section)"); restoreInput.value = ""; return;
      }
      const nTables = Object.keys(data.tables).length;
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : "unknown date";
      const ok = prompt(`⚠ This REPLACES ALL current data with the backup from ${when} (${nTables} tables).\nThis cannot be undone.\n\nType RESTORE to confirm.`);
      if (ok !== "RESTORE") { restoreInput.value = ""; return; }
      restoreBtn.disabled = true; const o = restoreBtn.textContent; restoreBtn.textContent = "Restoring…";
      try {
        const res = await api("/api/settings/import", { method: "POST", json: { tables: data.tables, confirm: true } });
        const r = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(r.error || "Restore failed"); return; }
        showToast(`✅ Restored ${r.rowsRestored} rows across ${r.tablesRestored} tables. Reloading…`);
        setTimeout(() => location.reload(), 1400);
      } catch (e) { showToast("Restore failed: " + e.message); }
      finally { restoreBtn.disabled = false; restoreBtn.textContent = o; restoreInput.value = ""; }
    };
  }

  // Health check — runs server-side so it can see pin_index and real counts.
  async function runHealthCheck() {
    const el = document.getElementById("healthCheck");
    if (!el) return;
    el.innerHTML = "Running checks…";
    const color = { ok: "var(--success)", warn: "var(--warning)", bad: "var(--danger)" };
    const icon  = { ok: "✓", warn: "⚠", bad: "✗" };
    try {
      const res = await api("/api/settings/health");
      if (!res.ok) { el.innerHTML = `<div style="color:var(--danger);">✗ Health check unavailable</div>`; return; }
      const data = await res.json();
      el.innerHTML = (data.checks || []).map(c =>
        `<div style="color:${color[c.level] || "var(--text)"};">${icon[c.level] || "•"} ${c.msg}</div>`
      ).join("");
    } catch (e) {
      el.innerHTML = `<div style="color:var(--danger);">✗ Health check failed: ${e.message}</div>`;
    }
  }
  document.getElementById("runHealthBtn").onclick = runHealthCheck;
  runHealthCheck();

  document.getElementById("resetDataBtn").onclick = async () => {
    const confirm = prompt("Type RESET to clear all test data (orders, shifts, notifications).");
    if (confirm !== "RESET") return;
    await api("/api/settings/reset-test-data", { method: "POST" });
    showToast("Test data cleared");
  };
}

// ---- User oversight (with PIN/Password reset + Add User) ----
async function loadUsers() {
  const res   = await api("/api/admin/users");
  const users = await res.json();
  document.getElementById("userRows").innerHTML = users.map((u) => {
    const isPassword = u.authMethod === 'password';
    const authBadge  = isPassword
      ? `<span style="font-size:11px; background:var(--accent-soft); color:var(--accent-dark); padding:2px 6px; border-radius:4px; font-weight:600;">🔑 Password</span>`
      : `<span style="font-size:11px; background:var(--neutral-bg); color:var(--muted); padding:2px 6px; border-radius:4px;">🔢 PIN</span>`;
    const resetBtn = isPassword
      ? `<button class="btn" data-reset="${u.id}" data-name="${u.name}" data-method="password" style="font-size:12px; padding:6px 10px;">🔑 Reset Password</button>`
      : `<button class="btn" data-reset="${u.id}" data-name="${u.name}" data-method="pin" style="font-size:12px; padding:6px 10px;">🔢 Reset PIN</button>`;
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--border-soft); flex-wrap:wrap;">
        <strong style="flex:1; min-width:100px;">${u.name}</strong>
        <span class="badge badge-${u.role === 'superManager' || u.role === 'admin' ? 'admin' : u.role}">${u.role}</span>
        ${authBadge}
        <span style="color:var(--muted); font-size:12px;">${u.branchId ? "Branch #" + u.branchId : "All branches"}</span>
        ${resetBtn}
      </div>`;
  }).join("") || `<div class="empty-state">No users found.</div>`;

  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.onclick = () => {
      const method = btn.dataset.method;
      const name   = btn.dataset.name;
      const uid    = btn.dataset.reset;
      if (method === "password") showResetPasswordModal(uid, name);
      else showResetPinModal(uid, name);
    };
  });

  document.getElementById("addUserBtn").onclick = () => openAddUserModal();
}

function openAddUserModal() {
  document.getElementById("newUserName").value     = "";
  document.getElementById("newUserPin").value      = "";
  document.getElementById("newUserUsername").value = "";
  document.getElementById("newUserTempPw").value   = "";
  document.getElementById("addUserError").textContent = "";
  document.getElementById("newUserRole").value     = "superManager";
  document.getElementById("newUserAuth").value     = "pin";
  document.getElementById("newUserPinFields").style.display = "";
  document.getElementById("newUserPwFields").style.display  = "none";
  const modal = document.getElementById("addUserModal");
  modal.style.display = "flex";

  document.getElementById("newUserAuth").onchange = (e) => {
    const isPw = e.target.value === "password";
    document.getElementById("newUserPinFields").style.display = isPw ? "none" : "";
    document.getElementById("newUserPwFields").style.display  = isPw ? "" : "none";
  };
  document.getElementById("addUserCancel").onclick = () => { modal.style.display = "none"; };
  document.getElementById("addUserSave").onclick = async () => {
    const errEl    = document.getElementById("addUserError");
    const name     = document.getElementById("newUserName").value.trim();
    const role     = document.getElementById("newUserRole").value;
    const auth     = document.getElementById("newUserAuth").value;
    const pin      = document.getElementById("newUserPin").value.trim();
    const username = document.getElementById("newUserUsername").value.trim();
    const tempPw   = document.getElementById("newUserTempPw").value;
    if (!name) { errEl.textContent = "Name is required."; return; }
    if (auth === "pin" && (pin.length < 4 || !/^\d+$/.test(pin))) { errEl.textContent = "PIN must be at least 4 digits."; return; }
    if (auth === "password" && (!username || tempPw.length < 6)) { errEl.textContent = "Username and password (min 6 chars) required."; return; }
    const payload = { name, role, authMethod: auth, branchId: null };
    if (auth === "pin")      payload.pin = pin;
    if (auth === "password") { payload.username = username; payload.tempPassword = tempPw; }
    const res  = await api("/api/users", { method: "POST", json: payload });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || "Could not create user."; return; }
    modal.style.display = "none";
    showToast(`✅ User "${name}" created`);
    loadUsers();
  };
}

function showResetPinModal(uid, name) {
  const modal = _makeSimpleModal(
    `Reset PIN for <strong>${name}</strong>`,
    `<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">New PIN (4–8 digits)</label>
     <input id="_resetPinInput" type="password" inputmode="numeric" maxlength="8"
       style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border-soft);background:var(--input-bg,var(--bg));color:var(--text);font-size:18px;letter-spacing:4px;text-align:center;">`,
    "Set PIN",
    async () => {
      const pin = document.getElementById("_resetPinInput").value.trim();
      if (pin.length < 4 || !/^\d+$/.test(pin)) return "PIN must be at least 4 digits.";
      const res = await api(`/api/admin/users/${uid}/reset-pin`, { method: "POST", json: { pin } });
      if (!res.ok) { const e = await res.json(); return e.error || "Could not reset PIN."; }
      showToast(`✅ PIN reset for ${name}`);
    }
  );
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById("_resetPinInput")?.focus(), 50);
}

function showResetPasswordModal(uid, name) {
  const modal = _makeSimpleModal(
    `Reset Password for <strong>${name}</strong>`,
    `<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px;">Temporary password (min 6 chars)</label>
     <input id="_resetPwInput" type="password"
       style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border-soft);background:var(--input-bg,var(--bg));color:var(--text);font-size:14px;">
     <div style="font-size:11px;color:var(--muted);margin-top:6px;">They will be forced to change it on next login.</div>`,
    "Set Password",
    async () => {
      const pw = document.getElementById("_resetPwInput").value;
      if (pw.length < 6) return "Password must be at least 6 characters.";
      const res = await api(`/api/admin/users/${uid}/reset-password`, { method: "POST", json: { tempPassword: pw } });
      if (!res.ok) { const e = await res.json(); return e.error || "Could not reset password."; }
      showToast(`✅ Temporary password set for ${name}`);
    }
  );
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById("_resetPwInput")?.focus(), 50);
}

function _makeSimpleModal(title, bodyHtml, confirmLabel, onConfirm) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6)";
  el.innerHTML = `
    <div style="background:var(--card);border-radius:12px;padding:28px 32px;width:340px;max-width:95vw;">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px;">${title}</div>
      ${bodyHtml}
      <div id="_simpleModalErr" style="color:var(--danger,#e74c3c);font-size:12px;min-height:16px;margin:8px 0;"></div>
      <div style="display:flex;gap:10px;margin-top:6px;">
        <button id="_simpleModalCancel" class="btn" style="flex:1;">Cancel</button>
        <button id="_simpleModalOk" class="btn btn-primary" style="flex:1;">${confirmLabel}</button>
      </div>
    </div>`;
  const remove = () => el.remove();
  el.querySelector("#_simpleModalCancel").onclick = remove;
  el.querySelector("#_simpleModalOk").onclick = async () => {
    const errEl = el.querySelector("#_simpleModalErr");
    errEl.textContent = "";
    const errMsg = await onConfirm();
    if (errMsg) { errEl.textContent = errMsg; return; }
    remove();
  };
  return el;
}

// ---- Login activity ----
function deviceHint(ua) {
  if (!ua) return "Unknown";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Other";
}
async function loadActivity() {
  const res = await api("/api/admin/login-logs");
  const logs = await res.json();
  document.getElementById("activityRows").innerHTML = logs.length
    ? logs.map((l) => `
      <div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid var(--border-soft); font-size:13px;">
        <strong style="flex:1;">${l.userName}</strong>
        <span class="badge badge-${l.role === "superManager" || l.role === "admin" ? "admin" : l.role}">${l.role}</span>
        <span style="color:var(--muted); font-size:12px; width:120px;">${l.branchName || "—"}</span>
        <span style="color:var(--muted); font-size:11px; width:80px;">${deviceHint(l.userAgent)}</span>
        <span style="color:var(--muted); font-size:12px; width:160px; text-align:right;">${new Date(l.at).toLocaleString()}</span>
      </div>`).join("")
    : `<div class="empty-state">No logins recorded yet.</div>`;
}

// ---- Init ----
async function init() {
  if (!user) return;
  if (user.role !== "admin") { window.location.href = "index"; return; }
  await renderNav("settings", user);
  const res = await api("/api/settings");
  settings = await res.json();
  populateForm();
  setupSidenav();
  setupSaveHandlers();
}

init();

})();
