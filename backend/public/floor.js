(async () => {
// floor.js
const staff = requireLogin();
if (staff) {
  renderNav("floor", staff);
  if (isManagerRole(staff)) {
    document.getElementById("addTableForm").style.display = "flex";
    const rf = document.getElementById("resetFloorBtn");
    if (rf) {
      rf.style.display = "";
      rf.onclick = async () => {
        if (!confirm("Mark every table open again?\n\nThis frees all tables on the floor. Orders are kept in History and Payment.")) return;
        const res = await api("/api/tables/reset-floor", { method: "POST", json: {} });
        if (!res.ok) return toast("Could not reset the floor");
        toast("Floor reset — all tables are open");
        loadTables();
      };
    }
  }
}

const STATUS_COLOR = {
  open: { bg: "var(--success-bg)", fg: "var(--success)" },
  ordered: { bg: "var(--accent-soft)", fg: "var(--accent-dark)" },
  ready: { bg: "var(--warning-bg)", fg: "var(--warning)" },
  dirty: { bg: "var(--danger-bg)", fg: "var(--danger)" },
};

const gridEl = document.getElementById("tableGrid");

let _lastFloorHash = "";
async function loadTables() {
  const [tablesRes, ordersRes] = await Promise.all([api("/api/tables"), api("/api/orders?status=pending,preparing,ready,dispatched")]);
  const tables = await tablesRes.json();
  const activeOrders = await ordersRes.json();
  // Only re-render if data changed
  const hash = JSON.stringify(tables.map(t => t.id + t.status)) + activeOrders.length;
  if (hash === _lastFloorHash) return;
  _lastFloorHash = hash;
  render(tables, activeOrders);
}

function render(tables, activeOrders = []) {
  gridEl.innerHTML = "";
  const canManage = typeof isManagerRole === "function" && isManagerRole(staff);
  const hasFloors = tables.some((t) => (t.floor || "").trim());

  // Group tables by their floor/area label (first-seen order preserved).
  const groups = new Map();
  tables.forEach((t) => {
    const key = (t.floor || "").trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  for (const [floor, list] of groups) {
    if (hasFloors) {
      const h = document.createElement("div");
      h.style = "grid-column:1/-1; margin:10px 2px 0; font-family:'Oswald',sans-serif; text-transform:uppercase; letter-spacing:.12em; font-size:12px; color:var(--accent-dark); font-weight:600;";
      h.textContent = floor || "Unassigned";
      gridEl.appendChild(h);
    }
    list.forEach((t) => {
      const c = STATUS_COLOR[t.status] || STATUS_COLOR.open;
      const order = activeOrders.find((o) => o.tableId === t.id);
      const card = document.createElement("div");
      card.className = "card clickable";
      card.style = `position:relative; padding:18px 14px; text-align:center; background:${c.bg}; border-left: 4px solid ${order && order.priority === "high" ? "var(--danger)" : c.fg};`;
      card.innerHTML = `
        ${canManage ? `<button class="tbl-del" data-del="${t.id}" title="Delete table" style="position:absolute; top:6px; right:6px; width:22px; height:22px; border-radius:50%; border:none; background:var(--danger-bg); color:var(--danger); cursor:pointer; font-size:13px; line-height:1; display:flex; align-items:center; justify-content:center;">×</button>` : ""}
        <div style="font-weight:700; font-size:17px;">${order && order.priority === "high" ? "🔥 " : ""}${t.name}</div>
        <div style="color:var(--muted); font-size:12px; margin:3px 0 9px;">${t.seats} seats</div>
        <span class="badge badge-${t.status}">${t.status}</span>
        ${order && order.kitchenTag ? `<div style="font-size:10px; color:var(--warning); margin-top:6px; font-weight:600;">⚠ ${order.kitchenTag.type}</div>` : ""}
        ${t.qrToken ? `<button class="btn btn-sm qr-btn" data-qr="${t.id}" style="margin-top:9px; font-size:11px; padding:4px 10px;">QR menu</button>` : ""}
      `;
      card.onclick = (e) => { if (e.target.closest(".qr-btn") || e.target.closest(".tbl-del")) return; handleClick(t); };
      const qb = card.querySelector(".qr-btn");
      if (qb) qb.onclick = (e) => { e.stopPropagation(); openTableQr(t); };
      const db = card.querySelector(".tbl-del");
      if (db) db.onclick = (e) => { e.stopPropagation(); deleteTable(t); };
      gridEl.appendChild(card);
    });
  }
}

async function handleClick(table) {
  if (table.status === "open") {
    window.location.href = `order?tableId=${table.id}&tableName=${encodeURIComponent(table.name)}`;
  } else if (table.status === "dirty") {
    await api(`/api/tables/${table.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "open" }),
    });
    loadTables();
  } else {
    openChangeTableModal(table);
  }
}

// Phase 4 — Change Table: move an active order to a different open table
// (party relocates) without voiding and re-ringing it.
async function openChangeTableModal(table) {
  const ordersRes = await api(`/api/orders?status=pending,preparing,ready`);
  const orders = await ordersRes.json();
  const activeOrder = orders.find((o) => o.tableId === table.id);
  if (!activeOrder) {
    alert(`${table.name} is currently "${table.status}". Check Kitchen/Payment for the active order.`);
    return;
  }

  const tablesRes = await api("/api/tables");
  const allTables = await tablesRes.json();
  const openTables = allTables.filter((t) => t.status === "open" && t.id !== table.id);

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3 style="margin-top:0;">Move Order #${activeOrder.id}</h3>
      <p style="font-size:13px; color:var(--muted); margin-top:-6px;">Currently at ${table.name}. Pick the new table:</p>
      <div id="moveTableList" style="display:flex; flex-direction:column; gap:6px; max-height:40vh; overflow-y:auto; margin-bottom:14px;">
        ${openTables.length ? openTables.map((t) => `<button class="btn" data-move="${t.id}" style="text-align:left;">${t.name} · ${t.seats} seats</button>`).join("") : `<div class="empty-state">No open tables available right now.</div>`}
      </div>
      <button class="btn" id="moveCancel" style="width:100%;">Cancel</button>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#moveCancel").onclick = () => backdrop.remove();
  backdrop.querySelectorAll("[data-move]").forEach((btn) => {
    btn.onclick = async () => {
      const res = await api(`/api/orders/${activeOrder.id}/change-table`, { method: "POST", json: { newTableId: Number(btn.dataset.move) } });
      backdrop.remove();
      if (res.ok) loadTables();
      else alert("Could not move the order.");
    };
  });
}

document.getElementById("addTableBtn").onclick = async () => {
  const name = document.getElementById("newTableName").value.trim();
  const seats = document.getElementById("newTableSeats").value;
  const floor = document.getElementById("newTableFloor").value.trim();
  if (!name) return;
  await api("/api/tables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, seats, floor }),
  });
  document.getElementById("newTableName").value = "";
  document.getElementById("newTableSeats").value = "";
  document.getElementById("newTableFloor").value = "";
  loadTables();
};

// Delete a table (managers only). Exposed on each card in management mode.
async function deleteTable(t) {
  if (!confirm(`Delete "${t.name}"? This cannot be undone.`)) return;
  const res = await api(`/api/tables/${t.id}`, { method: "DELETE" });
  if (!res.ok) { toast("Could not delete table"); return; }
  toast(`${t.name} deleted`);
  _lastFloorHash = null;
  loadTables();
}
window.deleteTable = deleteTable;

// ── Table QR code (scan to order) ──
function tableUrl(t) {
  const base = (window.posSettings && window.posSettings.publicBaseUrl) || window.location.origin;
  return base.replace(/\/+$/, "") + "/t/" + t.qrToken;
}
function toast(msg) { const el = document.getElementById("toast"); if (!el) return; el.textContent = msg; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2400); }

async function ensureQrLib() {
  for (let i = 0; i < 30 && typeof window.posQrSvg !== "function"; i++) await new Promise((r) => setTimeout(r, 100));
  return typeof window.posQrSvg === "function";
}

async function openTableQr(t) {
  const url = tableUrl(t);
  await ensureQrLib();
  const svg = (typeof posQrSvg === "function") ? posQrSvg(url, { cell: 6, margin: 2 }) : `<div style="padding:40px;color:var(--muted);">QR unavailable</div>`;
  const noBase = !(window.posSettings && window.posSettings.publicBaseUrl);
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `
    <div class="modal" style="width:360px; text-align:center;">
      <h3 style="margin-top:0;">${t.name} — scan to order</h3>
      <div style="background:#fff; border-radius:12px; padding:14px; display:inline-block; margin:6px 0 10px;">
        <div style="width:220px; height:220px; margin:0 auto;">${svg}</div>
      </div>
      <div class="mono" style="font-size:11px; color:var(--muted); word-break:break-all; margin-bottom:6px;">${url}</div>
      ${noBase ? `<div style="font-size:11px; color:var(--warning); margin-bottom:10px;">Set your public/customer URL in Settings → QR Ordering so phones off the till can reach this.</div>` : ""}
      <div style="display:flex; gap:8px;">
        <button class="btn" id="qrClose" style="flex:1;">Close</button>
        <button class="btn btn-primary" id="qrPrint" style="flex:1;">Print</button>
      </div>
      ${isManagerRole(staff) ? `<button class="btn btn-sm" id="qrRegen" style="margin-top:10px; font-size:11px; color:var(--muted);">Regenerate code</button>` : ""}
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.onclick = (e) => { if (e.target === bd) close(); };
  bd.querySelector("#qrClose").onclick = close;
  bd.querySelector("#qrPrint").onclick = async () => {
    // A QR printer picked in Settings > Printing prints straight to it (no dialog).
    if (window.posQrPrinterReady && window.posQrPrinterReady()) {
      const sent = await window.posPrintTableQr({ title: t.name, subtitle: "Scan to see the menu & order", url });
      if (sent) return toast("QR sent to the QR printer");
      toast("QR printer not reachable - using the browser print window");
    }
    const w = document.createElement("iframe");
    w.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(w);
    w.srcdoc = `<!DOCTYPE html><html><body style="text-align:center;font-family:sans-serif;padding:24px;">
      <h2 style="margin:0 0 4px;">${t.name}</h2><div style="color:#666;margin-bottom:14px;">Scan to see the menu & order</div>
      <div style="width:320px;height:320px;margin:0 auto;">${svg}</div></body></html>`;
    w.onload = () => { try { w.contentWindow.focus(); w.contentWindow.print(); } catch (_) {} setTimeout(() => w.remove(), 60000); };
  };
  const regen = bd.querySelector("#qrRegen");
  if (regen) regen.onclick = async () => {
    if (!confirm("Regenerate this table's QR? The old printed code will stop working.")) return;
    const res = await api(`/api/tables/${t.id}/qr-regenerate`, { method: "POST", json: {} });
    if (!res.ok) return toast("Could not regenerate");
    const r = await res.json(); t.qrToken = r.qrToken;
    close(); toast("New code generated — reprint it"); loadTables(); openTableQr(t);
  };
}

if (staff) {
  if (!blockIfNoBranchSelected(staff, gridEl)) {
    loadTables();
    setInterval(loadTables, 5000);
  }
}

})();
