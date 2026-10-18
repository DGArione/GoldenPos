(async () => {
const staff = requireLogin();
if (staff) renderNav("kitchen", staff);

const ticketsEl = document.getElementById("tickets");
let STATIONS     = [];
let _menuCache   = {}; // menuItemId -> stationId
let _orders      = null;
let _hash        = "";

// Restore last selected station
const _sv = localStorage.getItem("kitchenStation");
let activeStation = _sv
  ? (_sv === "all" || _sv === "unassigned" ? _sv : Number(_sv))
  : "all";

let activeView = "tickets";
let _visible   = [];   // tickets currently on screen — what bulk actions act on
let _bulkBusy  = false;

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

// ── View tab switching ─────────────────────────────────────────
document.querySelectorAll("#kitchenViewTabs .tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#kitchenViewTabs .tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeView = btn.dataset.view;
    document.getElementById("stationTabs").style.display  = activeView === "tickets" ? "flex" : "none";
    ticketsEl.style.display                                = activeView === "tickets" ? "grid" : "none";
    document.getElementById("issuesPanel").style.display  = activeView === "issues"  ? "block" : "none";
    document.getElementById("historyPanel").style.display = activeView === "history" ? "block" : "none";
    // Bulk actions only make sense on the Tickets view
    const onTickets = activeView === "tickets";
    ["readyAllBtn", "cancelAllBtn"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.style.display = onTickets ? "" : "none";
    });

    if      (activeView === "tickets") loadOrders();
    else if (activeView === "issues")  loadIssues();
    else                               loadHistory();
  };
});

// ── Station tab rendering ──────────────────────────────────────
function renderStationTabs() {
  const el   = document.getElementById("stationTabs");
  const tabs = [{ id: "all", name: "All Stations" }, ...STATIONS, { id: "unassigned", name: "Unassigned" }];
  el.innerHTML = tabs.map(t =>
    `<button class="tab${String(t.id) === String(activeStation) ? " active" : ""}" data-sid="${t.id}">${t.name}</button>`
  ).join("");
  el.querySelectorAll("[data-sid]").forEach(btn => {
    btn.onclick = () => {
      const v = btn.dataset.sid;
      activeStation = (v === "all" || v === "unassigned") ? v : Number(v);
      localStorage.setItem("kitchenStation", String(activeStation));
      renderStationTabs();
      _hash = "";
      // Render immediately with whatever orders we already have (cache is ready by now)
      if (_orders) renderTickets(_orders);
      // Then fetch fresh in the background
      loadOrders();
    };
  });
}

// ── Station resolution ─────────────────────────────────────────
// Returns the numeric stationId for an order line item, or null.
function getItemStation(item) {
  // 1. Check item.stationId (set by API on new orders)
  const raw = item.stationId;
  if (raw !== undefined && raw !== null && raw !== "null" && raw !== "" && Number(raw) > 0) {
    return Number(raw);
  }
  // 2. Fall back to menu item cache (for old orders without stationId on line items)
  const menuSid = _menuCache[item.menuItemId];
  if (menuSid !== undefined && menuSid !== null && Number(menuSid) > 0) {
    return Number(menuSid);
  }
  return null;
}

function itemBelongsHere(item) {
  const sid = getItemStation(item);
  if (activeStation === "all") return true;
  if (activeStation === "unassigned") return sid === null || sid === 0;
  return sid !== null && sid === Number(activeStation);
}

// ── Age helpers ────────────────────────────────────────────────
function ageMin(iso) { return Math.floor((Date.now() - new Date(iso).getTime()) / 60000); }
function ageColor(m) { return m >= 10 ? "var(--danger)" : m >= 5 ? "var(--warning)" : "var(--success)"; }

// ── Station badge ──────────────────────────────────────────────
function stationBadge(item) {
  const sid = getItemStation(item);
  const st  = STATIONS.find(s => s.id === sid);
  if (!st) return `<span class="badge badge-voided" style="font-size:9px;">unassigned</span>`;
  return `<span class="badge" style="font-size:9px;background:${st.color}22;color:${st.color};">${st.name}</span>`;
}

// ── Render tickets ─────────────────────────────────────────────
function renderTickets(orders) {
  const visible = orders
    .map(order => ({
      order,
      items: order.items
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => itemBelongsHere(item) && item.status !== "ready")
    }))
    .filter(({ items }) => items.length > 0)
    .sort((a, b) => (b.order.priority === "high") - (a.order.priority === "high"));

  // Bulk actions operate on exactly what's on screen right now
  _visible = visible;
  setBulkButtons(visible.length > 0);

  if (!visible.length) {
    ticketsEl.innerHTML = `<div class="empty-state">✅ No pending tickets — kitchen is caught up.</div>`;
    return;
  }

  ticketsEl.innerHTML = "";
  visible.forEach(({ order, items }) => {
    const mins  = ageMin(order.createdAt);
    const color = order.priority === "high" ? "var(--danger)" : ageColor(mins);
    const card  = document.createElement("div");
    card.className = "card";
    card.style = `border-left:4px solid ${color};${order.priority === "high" ? "box-shadow:0 0 0 1px var(--danger);" : ""}`;
    card.innerHTML = `
      <div class="ticket-header" style="display:flex;justify-content:space-between;align-items:center;">
        <span>${order.priority === "high" ? "🔥 " : ""}${order.displayNum || "#" + order.id} · ${order.tableName}
          ${order.orderType && order.orderType !== "dine-in" ? ` (${order.orderType}${order.customerName ? " — " + order.customerName : ""})` : ""}
          ${order.source === "qr" ? `<span class="badge badge-ready" style="margin-left:4px;">QR</span>` : order.source === "online" ? `<span class="badge badge-ordered" style="margin-left:4px;">Online</span>` : ""}
          ${order.paymentStatus === "paid" ? `<span class="badge badge-paid" style="margin-left:4px;">paid</span>` : ""}
        </span>
        <span class="mono" style="color:${color};font-weight:700;">${mins < 1 ? "just now" : mins + "m"}</span>
      </div>
      ${order.kitchenTag ? `<div style="padding:6px 16px;background:var(--warning-bg);color:var(--warning);font-size:11px;font-weight:600;">⚠ ${order.kitchenTag.type}${order.kitchenTag.note ? " — " + order.kitchenTag.note : ""}</div>` : ""}
      <div style="padding:12px 16px;">
        ${items.map(({ item, idx }) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border-soft);font-size:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span style="display:flex;align-items:center;gap:6px;">${item.name} ${stationBadge(item)}</span>
              <span class="mono" style="font-weight:600;">×${item.qty}</span>
            </div>
            ${item.modifiers && item.modifiers.length ? `<div style="font-size:12px;color:var(--muted);">${item.modifiers.map(m => m.option).join(", ")}</div>` : ""}
            ${item.notes ? `<div style="font-size:12px;color:var(--danger);font-weight:600;">⚠ ${item.notes}</div>` : ""}
            <div style="margin-top:6px;">
              ${item.status === "preparing"
                ? `<button class="btn btn-primary" data-ready="${idx}" style="font-size:12px;padding:6px 10px;width:100%;">Mark Ready</button>`
                : `<button class="btn" data-prep="${idx}" style="font-size:12px;padding:6px 10px;width:100%;">Start Preparing</button>`}
            </div>
          </div>`).join("")}
      </div>`;

    card.querySelectorAll("[data-prep]").forEach(btn => {
      btn.onclick = async () => {
        await api(`/api/orders/${order.id}/items/${btn.dataset.prep}/status`, { method: "PATCH", json: { status: "preparing" } });
        loadOrders();
      };
    });
    card.querySelectorAll("[data-ready]").forEach(btn => {
      btn.onclick = async () => {
        await api(`/api/orders/${order.id}/items/${btn.dataset.ready}/status`, { method: "PATCH", json: { status: "ready" } });
        loadOrders();
      };
    });

    ticketsEl.appendChild(card);
  });
}

// ── Load orders (polled every 4s) ──────────────────────────────
async function loadOrders() {
  try {
    const res    = await api("/api/orders?status=pending,preparing");
    const orders = await res.json();
    if (!Array.isArray(orders)) return;
    // Hash includes activeStation so tab switches always re-render
    const hash = activeStation + "|" + JSON.stringify(orders.map(o =>
      o.id + o.status + (o.items || []).map(i => i.status + (i.stationId ?? "")).join("")
    ));
    if (hash === _hash) return;
    _hash   = hash;
    _orders = orders;
    renderTickets(orders);
  } catch(e) { console.warn("loadOrders error", e); }
}

// ── History ────────────────────────────────────────────────────
async function loadHistory() {
  const res    = await api("/api/orders?status=ready,dispatched");
  const orders = await res.json();
  const today  = orders.filter(o => new Date(o.createdAt).toDateString() === new Date().toDateString());
  const el     = document.getElementById("historyPanel");
  if (!today.length) { el.innerHTML = `<div class="empty-state">No completed tickets today.</div>`; return; }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${
    today.sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).map(o => `
    <div class="card" style="padding:12px 16px;">
      <div style="display:flex;justify-content:space-between;">
        <strong>${o.displayNum || "#"+o.id} · ${o.tableName}</strong>
        <span class="badge badge-${o.status === "dispatched" ? "dirty" : o.status}">${o.status}</span>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px;">${o.items.map(i=>`${i.qty}× ${i.name}`).join(", ")}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">Placed ${new Date(o.createdAt).toLocaleTimeString()}</div>
    </div>`).join("")
  }</div>`;
}

// ── Order issues ───────────────────────────────────────────────
let _tagTemplates = [];
async function loadIssues() {
  if (!_tagTemplates.length) {
    const r = await api("/api/kitchen-tag-templates");
    _tagTemplates = await r.json();
  }
  const res    = await api("/api/orders?status=pending,preparing,ready");
  const orders = await res.json();
  const el     = document.getElementById("issuesPanel");
  if (!orders.length) { el.innerHTML = `<div class="empty-state">No active orders right now.</div>`; return; }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">${orders.map(o => `
    <div class="card" style="padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <strong>${o.priority==="high"?"🔥 ":""}${o.displayNum||"#"+o.id} · ${o.tableName}</strong>
        <span class="badge badge-${o.status}">${o.status}</span>
      </div>
      ${o.kitchenTag ? `<div style="display:flex;justify-content:space-between;background:var(--warning-bg);color:var(--warning);padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:8px;">
        <span>⚠ ${o.kitchenTag.type}${o.kitchenTag.note?" — "+o.kitchenTag.note:""}</span>
        <button class="btn" data-clear="${o.id}" style="font-size:11px;padding:3px 8px;">Clear</button>
      </div>` : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <select data-ttype="${o.id}" style="flex:1;min-width:160px;font-size:12px;">
          ${_tagTemplates.map(t=>`<option>${t}</option>`).join("")}
        </select>
        <input data-tnote="${o.id}" placeholder="Optional note..." style="flex:2;min-width:160px;font-size:12px;"/>
        <button class="btn btn-primary" data-flag="${o.id}" style="font-size:12px;">Flag Order</button>
      </div>
    </div>`).join("")}</div>`;
  el.querySelectorAll("[data-flag]").forEach(btn => {
    btn.onclick = async () => {
      const id   = btn.dataset.flag;
      const type = el.querySelector(`[data-ttype="${id}"]`).value;
      const note = el.querySelector(`[data-tnote="${id}"]`).value.trim();
      await api(`/api/orders/${id}/kitchen-tag`, { method: "PATCH", json: { type, note } });
      loadIssues();
    };
  });
  el.querySelectorAll("[data-clear]").forEach(btn => {
    btn.onclick = async () => {
      await api(`/api/orders/${btn.dataset.clear}/kitchen-tag`, { method: "DELETE" });
      loadIssues();
    };
  });
}

// ══════════════════════════════════════════════════════════════
// BULK ACTIONS — Ready All / Cancel All
// ══════════════════════════════════════════════════════════════
function setBulkButtons(enabled) {
  ["readyAllBtn", "cancelAllBtn"].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    const on = enabled && !_bulkBusy && activeView === "tickets";
    b.disabled      = !on;
    b.style.opacity = on ? "" : "0.4";
  });
}

// Mark every visible item ready. The per-item endpoint already deducts
// inventory and rolls the order status up, so we reuse it rather than
// duplicating that logic. Calls must be sequential: each PATCH rewrites
// the whole items JSON, so parallel calls would overwrite each other.
async function readyAll() {
  if (_bulkBusy || !_visible.length) return;

  const orderCount = _visible.length;
  const itemCount  = _visible.reduce((n, v) => n + v.items.length, 0);
  const where      = activeStation === "all" ? "all stations"
                   : activeStation === "unassigned" ? "unassigned items"
                   : (STATIONS.find(s => s.id === Number(activeStation))?.name || "this station");

  if (!confirm(`Mark ${itemCount} item(s) across ${orderCount} ticket(s) as READY for ${where}?\n\nInventory will be deducted.`)) return;

  _bulkBusy = true;
  setBulkButtons(false);
  const btn = document.getElementById("readyAllBtn");
  const originalText = btn.textContent;
  let done = 0, failed = 0;

  try {
    for (const { order, items } of _visible) {
      // The API updates items in place, so indices stay stable throughout
      const idxs = items.map(i => i.idx);
      for (const idx of idxs) {
        btn.textContent = `Marking ${done + 1}/${itemCount}…`;
        try {
          const res = await api(`/api/orders/${order.id}/items/${idx}/status`, {
            method: "PATCH", json: { status: "ready" }
          });
          if (res.ok) done++; else failed++;
        } catch (_) { failed++; }
      }
    }
    showToast(failed
      ? `Marked ${done} ready, ${failed} failed`
      : `✅ Marked ${done} item(s) ready — inventory deducted`);
  } finally {
    btn.textContent = originalText;
    _bulkBusy = false;
    _hash = "";           // force a re-render with fresh data
    await loadOrders();
  }
}

// Void every visible ticket. Voiding restores any inventory that was
// already deducted — that's handled server-side by the void endpoint.
async function cancelAll() {
  if (_bulkBusy || !_visible.length) return;

  // Cancel All voids whole orders, so it hits every station on those tickets,
  // not only the station currently in view. Say so plainly before proceeding.
  const orderIds = [...new Set(_visible.map(v => v.order.id))];
  const nums     = _visible.map(v => v.order.displayNum || "#" + v.order.id).join(", ");
  if (!confirm(
    `CANCEL ${orderIds.length} ticket(s)?\n\n${nums}\n\n` +
    `This voids the ENTIRE order — including items for other stations — ` +
    `and restores any deducted inventory.\n\nThis cannot be undone.`
  )) return;

  const reason = prompt("Reason for cancelling (required):", "");
  if (reason === null) return;
  if (!reason.trim()) { showToast("A reason is required to cancel"); return; }

  _bulkBusy = true;
  setBulkButtons(false);
  const btn = document.getElementById("cancelAllBtn");
  const originalText = btn.textContent;
  let done = 0, failed = 0, denied = false;

  try {
    for (const id of orderIds) {
      btn.textContent = `Cancelling ${done + 1}/${orderIds.length}…`;
      try {
        const res = await api(`/api/orders/${id}/void`, {
          method: "POST", json: { reason: reason.trim() }
        });
        if (res.ok) done++;
        else { failed++; if (res.status === 403) denied = true; }
      } catch (_) { failed++; }
    }
    if (denied)      showToast("Not authorised to cancel orders — ask a manager");
    else if (failed) showToast(`Cancelled ${done}, ${failed} failed`);
    else             showToast(`✖ Cancelled ${done} ticket(s) — inventory restored`);
  } finally {
    btn.textContent = originalText;
    _bulkBusy = false;
    _hash = "";
    await loadOrders();
  }
}

document.getElementById("readyAllBtn").onclick  = readyAll;
document.getElementById("cancelAllBtn").onclick = cancelAll;

// ── Init ───────────────────────────────────────────────────────
async function initKitchen() {
  // Kill any stale polling interval from a previous visit
  if (window._kitchenInterval) {
    clearInterval(window._kitchenInterval);
    window._kitchenInterval = null;
  }

  // 1. Load stations (needed for badges + tab rendering)
  try {
    const sRes = await api("/api/stations");
    STATIONS   = await sRes.json();
    if (!Array.isArray(STATIONS)) STATIONS = [];
  } catch(e) { console.warn("stations load failed", e); STATIONS = []; }

  // 2. Build menu->station cache for old orders that lack stationId
  try {
    const mRes  = await api("/api/menu");
    const items = await mRes.json();
    if (Array.isArray(items)) items.forEach(i => { _menuCache[i.id] = i.stationId ?? null; });
  } catch(e) { console.warn("menu cache failed", e); }

  // 3. Render station tabs (wires click handlers) — AFTER stations loaded
  renderStationTabs();

  // 4. First render of tickets
  await loadOrders();

  // 5. Start polling
  window._kitchenInterval = setInterval(loadOrders, 4000);
}

if (staff) {
  if (!blockIfNoBranchSelected(staff, ticketsEl)) {
    initKitchen();
  }
}

})();
