(async () => {
// dashboard.js — modern operations dashboard.
// KPI tiles, a 7-day revenue area chart (hover tooltip), payment-method
// breakdown, per-branch cards, live shift roster, station load, a void/
// discount audit trail, and an item-analytics panel.
const staff = requireLogin();
if (staff) {
  renderNav("dashboard", staff);
  const _hr = new Date().getHours();
  const _greet = _hr < 12 ? "Good morning" : _hr < 17 ? "Good afternoon" : "Good evening";
  const _first = (staff.name || "").trim().split(/\s+/)[0] || "there";
  document.getElementById("pageTitle").textContent = `${_greet}, ${_first}`;
  document.getElementById("dashSubtitle").textContent =
    (staff.role === "superManager" ? "All branches" : (staff.branch ? staff.branch.name : "")) + " · today";
}

const cur = () => (typeof posCurrency === "function" ? posCurrency() : "$");
const money = (n) => cur() + Number(n || 0).toFixed(2);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Payment-method categorical palette (validated CVD-safe, theme-aware)
function methodColors() {
  return isDark()
    ? { cash: "#3987e5", card: "#d95926", online: "#199e70", wallet: "#c98500" }
    : { cash: "#2a78d6", card: "#eb6834", online: "#1baf7a", wallet: "#eda100" };
}

let lastTrend = null;
// Entry animations should play on the first paint only — the 8s auto-refresh
// re-renders innerHTML, and we don't want tiles popping every few seconds.
let _firstPaint = true;

async function load() {
  try {
    const [summaryRes, detailsRes] = await Promise.all([
      api("/api/dashboard/summary"),
      api("/api/dashboard/details"),
    ]);
    if (!summaryRes.ok || !detailsRes.ok) return;
    const summary = await summaryRes.json();
    const details = await detailsRes.json();
    renderKpis(summary.totals);
    renderMethodRow(summary.totals);
    renderBranches(summary.branches);
    renderRevenueTrend(details.revenueTrend);
    renderShiftRoster(details.shiftRoster);
    renderStationPerf(details.stationPerformance);
    renderAuditTrail(details.auditTrail);
    renderTodayInsights();
  } catch (e) { console.warn("Dashboard load error:", e); }
}

// ── Today's top sellers + hourly pacing (extra insight cards) ───
function _fmtHr(h) { const ap = h < 12 ? "am" : "pm"; const hh = h % 12 === 0 ? 12 : h % 12; return hh + ap; }
async function renderTodayInsights() {
  const today = new Date().toISOString().slice(0, 10);
  const tomo = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const c = posCurrency();
  try {
    const r = await api(`/api/analytics/items?from=${today}&to=${tomo}`);
    if (r.ok) {
      const items = ((await r.json()).items || []).slice(0, 6);
      const el = document.getElementById("topSellersToday");
      if (el) el.innerHTML = items.length ? items.map((it, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 18px;${i ? "border-top:1px dashed var(--border-soft);" : ""}">
          <span style="width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:var(--accent-dark);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${i + 1}</span>
          <span style="flex:1;font-size:13px;">${it.name}</span>
          <span style="font-size:12px;color:var(--muted);">×${it.totalQty ?? it.qty ?? 0}</span>
          <span class="mono" style="font-size:13px;font-weight:700;color:var(--accent);min-width:88px;text-align:right;">${c}${(it.totalRevenue ?? it.revenue ?? 0).toFixed(2)}</span>
        </div>`).join("") : `<div style="padding:26px;text-align:center;color:var(--muted);font-size:13px;">No sales yet today.</div>`;
    }
  } catch (e) { /* ignore */ }
  try {
    const r = await api(`/api/reports/advanced?from=${today}&to=${tomo}`);
    if (r.ok) {
      const d = await r.json();
      const hourly = d.hourly || [];
      const active = hourly.filter((h) => h.orders > 0);
      const from = active.length ? Math.max(0, Math.min(...active.map((h) => h.hour)) - 1) : 7;
      const to = active.length ? Math.min(23, Math.max(...active.map((h) => h.hour)) + 1) : 21;
      const slice = hourly.slice(from, to + 1);
      const max = Math.max(1, ...slice.map((h) => h.revenue));
      const ph = d.peakHour;
      const sub = document.getElementById("peakHourSub");
      if (sub) sub.textContent = ph && ph.orders > 0 ? `Peak ${_fmtHr(ph.hour)} · ${ph.orders} order${ph.orders === 1 ? "" : "s"}` : "When the orders come in";
      const el = document.getElementById("hourlyToday");
      if (el) el.innerHTML = active.length ? `
        <div style="display:flex;align-items:flex-end;gap:3px;height:118px;padding:0 2px;">
          ${slice.map((h) => `<div title="${_fmtHr(h.hour)} — ${c}${h.revenue.toFixed(0)}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;"><div style="width:100%;border-radius:4px 4px 0 0;background:${h.orders > 0 ? "var(--accent)" : "var(--border-soft)"};height:${Math.max(3, (h.revenue / max) * 100)}%;"></div></div>`).join("")}
        </div>
        <div style="display:flex;gap:3px;padding:5px 2px 0;">
          ${slice.map((h) => `<div style="flex:1;text-align:center;font-size:8px;color:var(--muted);">${h.hour % 3 === 0 ? _fmtHr(h.hour) : ""}</div>`).join("")}
        </div>` : `<div style="padding:34px;text-align:center;color:var(--muted);font-size:13px;">No orders yet today.</div>`;
    }
  } catch (e) { /* ignore */ }
}

// ── KPI tiles ────────────────────────────────────────────────
function renderKpis(t) {
  if (!t) return;
  const rev = t.totalRevenue ?? t.revenueToday ?? 0;
  const orders = t.totalOrders ?? 0;
  const branches = t.totalBranches ?? 1;
  const kitchen = t.totalKitchen ?? t.inKitchen ?? 0;
  const avg = orders > 0 ? rev / orders : 0;
  const fees = t.totalCardFees || 0;
  const refunds = t.totalRefunds || 0;
  const refundCount = t.refundCount || 0;
  // Net actually banked = card/online net of fees, minus refunds paid out.
  const net = (t.netRevenue != null ? t.netRevenue : rev) - refunds;
  const openTables = t.totalOpenTables ?? t.openTables ?? 0;
  const lowStock = t.totalLowStock ?? t.lowStockCount ?? 0;

  // ── Primary KPI tiles (big) ──
  const tiles = [
    { accent: "var(--accent)", icon: "payment", label: "Revenue today", value: money(rev),
      foot: `Avg ticket ${money(avg)}` },
    { accent: "#199e70", icon: "reports", label: "Net banked", value: money(net),
      foot: `${fees > 0 ? `Card fees <span class="neg">−${money(fees)}</span>` : "After fees"}${refunds > 0 ? ` · refunds <span class="neg">−${money(refunds)}</span>` : ""}` },
    { accent: "#2a78d6", icon: "order", label: "Orders today", value: String(orders),
      foot: kitchen > 0 ? `${kitchen} in kitchen now` : "Kitchen all caught up" },
    { accent: refunds > 0 ? "#d14343" : "#8a8a8a", icon: "history", label: "Refunds today", value: money(refunds),
      foot: refundCount > 0 ? `${refundCount} refund${refundCount === 1 ? "" : "s"} issued` : "No refunds today" },
  ];

  const anim = _firstPaint;
  document.getElementById("kpiRow").innerHTML = tiles.map((k, i) => `
    <div class="dash-kpi${anim ? " dash-anim-pop" : ""}" style="--kpi-accent:${k.accent};${anim ? ` animation-delay:${i * 55}ms;` : ""}">
      <div class="dash-kpi-top">
        <div class="dash-kpi-icon">${typeof svgIcon === "function" ? svgIcon(k.icon, 19) : ""}</div>
      </div>
      <div class="dash-kpi-label">${k.label}</div>
      <div class="dash-kpi-value">${k.value}</div>
      <div class="dash-kpi-foot">${k.foot}</div>
    </div>`).join("");

  // ── Secondary compact stat strip (more major details) ──
  const strip = document.getElementById("statStrip");
  if (strip) {
    const gross = rev;
    const stats = [
      { label: "Avg ticket", value: money(avg) },
      { label: "In kitchen", value: String(kitchen), alert: kitchen > 0 },
      { label: "Tables in use", value: String(openTables) },
      { label: "Low stock", value: String(lowStock), alert: lowStock > 0 },
      { label: "Card fees", value: money(fees) },
      { label: "Refund rate", value: gross > 0 ? ((refunds / gross) * 100).toFixed(1) + "%" : "0%" },
      { label: staff.role === "superManager" ? "Branches" : "Branch",
        value: staff.role === "superManager" ? String(branches) : (staff.branch ? staff.branch.name : "—") },
    ];
    strip.innerHTML = stats.map((s, i) => `
      <div class="dash-stat${anim ? " dash-anim-fade" : ""}"${anim ? ` style="animation-delay:${220 + i * 40}ms;"` : ""}>
        <div class="dash-stat-v${s.alert ? " alert" : ""}">${s.value}</div>
        <div class="dash-stat-k">${s.label}</div>
      </div>`).join("");
  }
  _firstPaint = false;
}

// ── Payment-method breakdown ─────────────────────────────────
function renderMethodRow(t) {
  const el = document.getElementById("methodRow");
  if (!el || !t || !t.byMethod) { if (el) el.innerHTML = ""; return; }
  const bm = t.byMethod;
  const colors = methodColors();
  const defs = [
    { key: "cash", label: "Cash" },
    { key: "card", label: "Card" },
    { key: "online", label: "Online transfer" },
    { key: "wallet", label: "Wallet" },
  ].filter((d) => d.key !== "wallet" || (bm.wallet && bm.wallet.gross > 0));

  const totalGross = defs.reduce((s, d) => s + ((bm[d.key] && bm[d.key].gross) || 0), 0);
  const hasMoney = totalGross > 0;

  const segs = hasMoney ? defs.map((d) => {
    const g = (bm[d.key] && bm[d.key].gross) || 0;
    if (g <= 0) return "";
    return `<span class="dash-method-seg" title="${d.label}: ${money(g)}" style="background:${colors[d.key]}; width:${(g / totalGross) * 100}%;"></span>`;
  }).join("") : "";

  el.innerHTML = `
    <div class="dash-card">
      <div class="dash-card-head" style="margin-bottom:6px;">
        <div><h3>Payment mix</h3><span class="dash-card-sub">How customers paid today</span></div>
        ${t.totalCardFees > 0
          ? `<div style="font-size:12px; color:var(--muted); text-align:right;">
               Net banked <span class="mono" style="color:var(--success); font-weight:700;">${money(t.netRevenue || 0)}</span></div>`
          : ""}
      </div>
      <div class="dash-method-bar">${segs}</div>
      <div class="dash-method-grid">
        ${defs.map((d) => {
          const m = bm[d.key] || { gross: 0, fee: 0, net: 0 };
          return `
          <div class="dash-method-item">
            <div class="dash-method-key"><span class="dash-method-dot" style="background:${colors[d.key]};"></span>${d.label}</div>
            <div class="dash-method-val">${money(m.gross)}</div>
            ${m.fee > 0
              ? `<div class="dash-method-fee"><span class="neg">fee −${money(m.fee)}</span> · <span class="pos">net ${money(m.net)}</span></div>`
              : `<div class="dash-method-fee" style="color:var(--muted);">no fee</div>`}
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── Branch cards ─────────────────────────────────────────────
function renderBranches(branches) {
  const el = document.getElementById("branchCards");
  if (!branches || !branches.length) { el.innerHTML = `<div class="dash-empty">No branch data yet.</div>`; return; }
  el.innerHTML = branches.map((b) => {
    const name = b.branchName || b.name || "Branch";
    const active = b.status === "active";
    return `
    <div class="dash-branch">
      <div class="dash-branch-top">
        <strong>${esc(name)}</strong>
        <span class="badge badge-${active ? "open" : "dirty"}">${esc(b.status || "")}</span>
      </div>
      <div class="dash-branch-rev">
        <div class="dash-branch-rev-label">Revenue today</div>
        <div class="dash-branch-rev-val">${money(b.revenueToday)}</div>
      </div>
      <div class="dash-branch-metrics">
        <div class="dash-branch-metric"><div class="v">${b.inKitchen}</div><div class="k">in kitchen</div></div>
        <div class="dash-branch-metric"><div class="v">${b.openTables}</div><div class="k">tables in use</div></div>
        <div class="dash-branch-metric ${b.lowStockCount ? "alert" : ""}"><div class="v">${b.lowStockCount}</div><div class="k">low stock</div></div>
        <div class="dash-branch-metric"><div class="v">${money((b.byMethod && b.byMethod.card && b.byMethod.card.gross) || 0)}</div><div class="k">card sales</div></div>
      </div>
    </div>`;
  }).join("");
}

// ── Revenue trend — SVG area + line chart with hover ─────────
function renderRevenueTrend(trend) {
  lastTrend = trend;
  const el = document.getElementById("revenueTrend");
  if (!trend || !trend.length) { el.innerHTML = `<div class="dash-empty">No revenue recorded in the last 7 days.</div>`; return; }

  const total = trend.reduce((s, d) => s + (d.revenue || 0), 0);
  const tt = document.getElementById("trendTotal");
  if (tt) tt.textContent = money(total);

  const W = Math.max(260, el.clientWidth || 560);
  const H = 180;
  const padL = 10, padR = 10, padT = 18, padB = 10;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = trend.length;
  const max = Math.max(1, ...trend.map((d) => d.revenue || 0));
  const accent = css("--accent") || "#8a5a34";

  const xAt = (i) => padL + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const yAt = (v) => padT + innerH - (v / max) * innerH;
  const pts = trend.map((d, i) => ({ x: xAt(i), y: yAt(d.revenue || 0), d }));

  const linePath = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${pts[n - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  // 4 recessive gridlines
  let grid = "";
  for (let g = 0; g <= 3; g++) {
    const gy = padT + (innerH * g) / 3;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="var(--border-soft)" stroke-width="1"/>`;
  }

  const dots = pts.map((p, i) =>
    `<circle class="dash-dot" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--panel)" stroke="${accent}" stroke-width="2"/>`
  ).join("");

  const gid = "dashGrad";
  el.innerHTML = `
    <div class="dash-chart-plot" style="position:relative;">
      <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stop-color="${accent}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${accent}" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        ${grid}
        <path d="${areaPath}" fill="url(#${gid})"/>
        <path d="${linePath}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
      <div class="dash-chart-cols">${trend.map((_, i) => `<div class="dash-chart-col" data-i="${i}"></div>`).join("")}</div>
      <div class="dash-tip" id="dashTip"></div>
    </div>
    <div class="dash-xlabels">${trend.map((d) => `<div class="dash-xlabel">${esc(d.label || "")}</div>`).join("")}</div>`;

  // Hover interaction
  const tip = el.querySelector("#dashTip");
  const cols = el.querySelectorAll(".dash-chart-col");
  const dotEls = el.querySelectorAll(".dash-dot");
  cols.forEach((col) => {
    col.addEventListener("mouseenter", () => {
      const i = +col.dataset.i, p = pts[i];
      dotEls.forEach((dd) => dd.setAttribute("r", dd.dataset.i === String(i) ? "5.5" : "3.5"));
      tip.innerHTML = `<b>${money(p.d.revenue || 0)}</b><br><span class="mono" style="opacity:.75;">${esc(p.d.date || p.d.label || "")}</span>`;
      tip.style.left = p.x + "px";
      tip.style.top = p.y + "px";
      tip.style.opacity = "1";
    });
    col.addEventListener("mouseleave", () => {
      tip.style.opacity = "0";
      dotEls.forEach((dd) => dd.setAttribute("r", "3.5"));
    });
  });
}

// ── Shift roster ─────────────────────────────────────────────
function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}
function renderShiftRoster(roster) {
  const el = document.getElementById("shiftRoster");
  const countEl = document.getElementById("rosterCount");
  if (countEl) countEl.textContent = roster ? roster.length : 0;
  if (!roster || !roster.length) { el.innerHTML = `<div class="dash-empty">No one is clocked in right now.</div>`; return; }
  el.innerHTML = roster.map((s) => {
    const mins = s.minutesOn || 0;
    const time = mins < 60 ? mins + "m" : (mins / 60).toFixed(1) + "h";
    return `
    <div class="dash-roster-row">
      <div class="dash-avatar">${esc(initials(s.userName))}</div>
      <div style="min-width:0;">
        <div class="dash-roster-name">${esc(s.userName || "Staff")}</div>
        <div class="dash-roster-meta">${esc(s.role || "")}${staff.role === "superManager" && s.branchName ? " · " + esc(s.branchName) : ""}</div>
      </div>
      <div class="dash-roster-time">${time}<br><span style="opacity:.7;">on shift</span></div>
    </div>`;
  }).join("");
}

// ── Station load (items plated today) ────────────────────────
function renderStationPerf(stations) {
  const el = document.getElementById("stationPerf");
  if (!stations || !stations.length) { el.innerHTML = `<div class="dash-empty">No stations configured.</div>`; return; }
  const max = Math.max(1, ...stations.map((s) => s.itemsToday || 0));
  el.innerHTML = stations.map((s) => {
    const n = s.itemsToday || 0;
    const color = s.color || css("--accent") || "#8a5a34";
    return `
    <div class="dash-station-row">
      <div class="t">
        <span><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${color};margin-right:7px;vertical-align:middle;"></span>${esc(s.stationName)}${staff.role === "superManager" && s.branchName ? ` <span style="color:var(--muted);font-size:11px;">· ${esc(s.branchName)}</span>` : ""}</span>
        <span class="mono">${n}</span>
      </div>
      <div class="dash-track"><div class="dash-fill" style="width:${(n / max) * 100}%; background:${color};"></div></div>
    </div>`;
  }).join("");
}

// ── Void / discount audit trail ──────────────────────────────
function renderAuditTrail(entries) {
  const el = document.getElementById("auditTrail");
  if (!entries || !entries.length) { el.innerHTML = `<div class="dash-empty">No voids or discounts today.</div>`; return; }
  el.innerHTML = entries.map((e) => {
    let when = "";
    try { when = new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (x) { when = e.at || ""; }
    return `
    <div class="dash-audit-row">
      <div class="dash-audit-main">
        <div class="dash-audit-title">
          <span class="badge badge-${e.type === "void" ? "voided" : "pending"}">${e.type}</span>
          <span>Order #${e.orderId}${staff.role === "superManager" && e.branchName ? ` · ${esc(e.branchName)}` : ""}</span>
        </div>
        ${e.detail ? `<div class="dash-audit-reason">${esc(e.detail)}</div>` : ""}
      </div>
      <div class="dash-audit-right">
        <div class="dash-audit-amt">${money(e.amount)}</div>
        <div class="dash-audit-meta">${esc(e.staffName || "")} · ${esc(when)}</div>
      </div>
    </div>`;
  }).join("");
}

// Re-render the chart on resize so it stays crisp and full-width.
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (lastTrend) renderRevenueTrend(lastTrend); }, 150);
});

if (staff) {
  load();
  setInterval(load, 8000);
}

// ── ANALYTICS PANEL ──────────────────────────────────────────
(async () => {
  const today = new Date();
  const past30 = new Date(); past30.setDate(today.getDate() - 30);
  const fmt = (d) => d.toISOString().slice(0, 10);
  document.getElementById("analyticsFrom").value = fmt(past30);
  document.getElementById("analyticsTo").value = fmt(today);

  try {
    const stRes = await api("/api/stations");
    const stations = await stRes.json();
    const stSel = document.getElementById("analyticsStation");
    stations.forEach((s) => { const o = document.createElement("option"); o.value = s.id; o.textContent = s.name; stSel.appendChild(o); });
  } catch (e) {}

  if (staff && staff.role === "superManager") {
    const brEl = document.getElementById("analyticsBranch");
    brEl.style.display = "";
    try {
      const brRes = await api("/api/branches");
      const branches = await brRes.json();
      branches.forEach((b) => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; brEl.appendChild(o); });
    } catch (e) {}
  }
  document.getElementById("analyticsLoadBtn").onclick = loadAnalytics;
})();

async function loadAnalytics() {
  const from = document.getElementById("analyticsFrom").value;
  const to = document.getElementById("analyticsTo").value;
  const stationId = document.getElementById("analyticsStation").value;
  const branchId = document.getElementById("analyticsBranch")?.value || "";
  const sort = document.getElementById("analyticsSort").value;
  const el = document.getElementById("analyticsResult");

  el.innerHTML = `<div class="dash-empty">Loading…</div>`;

  let url = `/api/analytics/items?from=${from}&to=${to}`;
  if (stationId) url += `&stationId=${stationId}`;
  if (branchId) url += `&branchId=${branchId}`;

  const res = await api(url);
  const data = await res.json();
  let items = data.items || [];

  if (sort === "revenue") items.sort((a, b) => b.totalRevenue - a.totalRevenue);
  else if (sort === "prep") items = items.filter((i) => i.avgPrepMinutes !== null).sort((a, b) => a.avgPrepMinutes - b.avgPrepMinutes);
  else items.sort((a, b) => b.totalQty - a.totalQty);

  if (!items.length) { el.innerHTML = `<div class="dash-empty">No data for this period.</div>`; return; }

  const maxQty = Math.max(...items.map((i) => i.totalQty));
  el.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;">${data.totalOrders} orders · ${from} to ${to}</div>
    <div style="display:flex;flex-direction:column;gap:11px;">
      ${items.slice(0, 20).map((item, idx) => `
        <div class="dash-rank-row">
          <div class="dash-rank-num">${idx + 1}</div>
          <div class="dash-rank-name">
            <div class="n">${esc(item.name)}</div>
            <div class="s">${esc(item.stationName || "")}${item.avgPrepMinutes ? ` · ${item.avgPrepMinutes} min avg prep` : ""}</div>
          </div>
          <div class="dash-rank-bar">
            <div class="dash-rank-fill" style="width:${Math.round((item.totalQty / maxQty) * 100)}%;"></div>
          </div>
          <div class="dash-rank-val">
            <div class="q">${item.totalQty} sold</div>
            <div class="r">${money(item.totalRevenue)}</div>
          </div>
        </div>`).join("")}
    </div>`;
}

})();

// ── Date-range business analytics ──────────────────────────────
(function setupBusinessAnalytics() {
  const fromEl = document.getElementById('bizFrom');
  const toEl = document.getElementById('bizTo');
  const loadEl = document.getElementById('bizLoad');
  if (!fromEl || !toEl || !loadEl) return;
  const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const now = new Date();
  fromEl.value = localISO(new Date(now.getFullYear(), now.getMonth(), 1));
  toEl.value = localISO(now);
  if (staff && staff.role === 'superManager') {
    const wrap = document.getElementById('bizBranchWrap');
    const select = document.getElementById('bizBranch');
    if (wrap && select) {
      wrap.style.display = '';
      api('/api/branches').then(r => r.json()).then(rows => {
        (Array.isArray(rows) ? rows : []).forEach(b => {
          const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; select.appendChild(o);
        });
      }).catch(() => {});
    }
  }
  const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const barRows = (rows, labelKey, valueKey, formatter) => {
    if (!rows || !rows.length) return '<div style="font-size:12px;color:var(--muted);padding:8px 0;">No data for this period.</div>';
    const max = Math.max(1, ...rows.map(r => Number(r[valueKey] || 0)));
    return rows.slice(0, 8).map(r => `<div style="margin:0 0 11px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:5px;"><span>${escHtml(r[labelKey])}</span><strong class="mono">${formatter(Number(r[valueKey] || 0))}</strong></div><div style="height:7px;border-radius:8px;background:var(--border-soft);overflow:hidden;"><div style="height:100%;width:${Math.max(0,Number(r[valueKey]||0)/max*100)}%;background:var(--accent);border-radius:8px;"></div></div></div>`).join('');
  };
  async function loadPeriod() {
    const from = fromEl.value, to = toEl.value;
    const status = document.getElementById('bizStatus');
    if (!from || !to || from > to) { status.textContent = 'Choose a valid date range.'; return; }
    status.textContent = 'Loading…'; loadEl.disabled = true;
    try {
      let url = `/api/reports/advanced?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const branch = document.getElementById('bizBranch')?.value || '';
      if (branch) url += `&branchId=${encodeURIComponent(branch)}`;
      const res = await api(url);
      if (!res.ok) throw new Error('The report API returned an error.');
      const d = await res.json(); const s = d.summary || {}; const c = posCurrency();
      const money = n => c + Number(n || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
      const kpis = [
        ['Net sales', money(s.netSales)], ['Gross sales', money(s.grossSales)], ['Paid orders', Number(s.totalOrders||0).toLocaleString()],
        ['Average order value', money(s.avgOrderValue)], ['Discounts', money(s.totalDiscounts)], ['Card fees', money(s.totalCardFees)],
        ['Tips', money(s.totalTips)], ['Inventory purchases', money(d.inventoryCost?.purchases)], ['Recorded consumption', money(d.inventoryCost?.consumed)]
      ];
      document.getElementById('bizKpis').innerHTML = kpis.map(([label,value]) => `<div style="padding:13px;border:1px solid var(--border);border-radius:12px;background:var(--panel);"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);">${label}</div><div style="font-size:19px;font-weight:750;margin-top:6px;overflow-wrap:anywhere;">${value}</div></div>`).join('');
      document.getElementById('bizOrderTypes').innerHTML = barRows((d.salesByOrderType||[]).map(x=>({...x, label: String(x.orderType||'unknown').replace(/-/g,' ').replace(/\b\w/g,m=>m.toUpperCase())})), 'label', 'revenue', money);
      document.getElementById('bizCategories').innerHTML = barRows(d.categoryStats||[], 'category', 'revenue', money);
      document.getElementById('bizWeekdays').innerHTML = barRows(d.dayOfWeek||[], 'day', 'revenue', money);
      document.getElementById('bizEmployees').innerHTML = barRows(d.salesByEmployee||[], 'staffName', 'revenue', money);
      status.textContent = `${from} to ${to} · ${Number(s.totalOrders||0)} paid orders`;
    } catch (e) {
      console.error('Business analytics failed', e);
      status.textContent = 'Could not load analytics. Check the server and try again.';
    } finally { loadEl.disabled = false; }
  }
  loadEl.addEventListener('click', loadPeriod);
  loadPeriod();
})();
