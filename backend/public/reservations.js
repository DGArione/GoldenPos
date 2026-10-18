(async () => {
// reservations.js — table bookings for a chosen day.
const staff = requireLogin();
if (staff) renderNav("reservations", staff);

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const canDelete = staff && ["superManager", "manager", "admin"].includes(staff.role);
const STATUS = {
  booked:   { label: "Booked",    badge: "badge-ordered" },
  seated:   { label: "Seated",    badge: "badge-ready" },
  completed:{ label: "Completed", badge: "badge-paid" },
  cancelled:{ label: "Cancelled", badge: "badge-dirty" },
  no_show:  { label: "No-show",   badge: "badge-dirty" },
};

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

let TABLES = [];
let RESVS = [];
const dateEl = document.getElementById("resvDate");
dateEl.value = new Date().toISOString().slice(0, 10);

async function loadTables() {
  const res = await api("/api/tables");
  TABLES = res.ok ? await res.json() : [];
}

async function load() {
  const res = await api(`/api/reservations?date=${dateEl.value}`);
  RESVS = res.ok ? await res.json() : [];
  renderStats();
  render();
}

function renderStats() {
  const count = (s) => RESVS.filter((r) => r.status === s).length;
  const covers = RESVS.filter((r) => ["booked", "seated", "completed"].includes(r.status)).reduce((a, r) => a + (r.partySize || 0), 0);
  const tile = (l, v, cls) => `<div class="stat ${cls || "muted"}"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`;
  document.getElementById("resvStats").innerHTML =
    tile("Bookings", RESVS.length) + tile("Covers", covers) + tile("Seated", count("seated"), "pos") + tile("Booked", count("booked"));
}

function render() {
  const el = document.getElementById("resvList");
  if (!RESVS.length) { el.innerHTML = `<div class="empty-state">No bookings for this day.</div>`; return; }
  el.innerHTML = RESVS.map((r) => {
    const st = STATUS[r.status] || STATUS.booked;
    return `
    <div class="card" style="padding:14px 18px; margin-bottom:10px; ${["cancelled", "no_show"].includes(r.status) ? "opacity:.6;" : ""}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div style="display:flex; align-items:center; gap:14px;">
          <div style="text-align:center; min-width:52px;">
            <div class="mono" style="font-size:18px; font-weight:800;">${esc(r.reserveTime)}</div>
          </div>
          <div>
            <strong>${esc(r.customerName) || esc(r.customerPhone) || "Guest"}</strong>
            <span class="badge ${st.badge}" style="margin-left:6px;">${st.label}</span>
            <div style="font-size:12px; color:var(--muted); margin-top:3px;">
              👥 ${r.partySize} · ${r.tableName ? "🪑 " + esc(r.tableName) + " · " : ""}${esc(r.customerPhone) || "no phone"}${r.note ? " · 📝 " + esc(r.note) : ""}
            </div>
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${r.status === "booked" ? `<button class="btn btn-sm btn-primary" data-act="seated" data-id="${r.id}">Seat</button>` : ""}
          ${r.status === "seated" ? `<button class="btn btn-sm" data-act="completed" data-id="${r.id}">Complete</button>` : ""}
          ${["booked", "seated"].includes(r.status) ? `<button class="btn btn-sm" data-act="no_show" data-id="${r.id}">No-show</button>
            <button class="btn btn-sm btn-danger" data-act="cancelled" data-id="${r.id}">Cancel</button>` : ""}
          <button class="btn btn-sm" data-edit="${r.id}">Edit</button>
          ${canDelete ? `<button class="btn btn-sm btn-danger" data-del="${r.id}">✕</button>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-act]").forEach((b) => b.onclick = async () => {
    await api(`/api/reservations/${b.dataset.id}`, { method: "PUT", json: { status: b.dataset.act } });
    load();
  });
  el.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openForm(RESVS.find((x) => x.id == b.dataset.edit)));
  el.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this booking?")) return;
    await api(`/api/reservations/${b.dataset.del}`, { method: "DELETE" }); toast("Booking deleted"); load();
  });
}

function openForm(r) {
  const editing = !!r;
  const tableOpts = `<option value="">— no table —</option>` + TABLES.map((t) => `<option value="${t.id}" ${editing && r.tableId == t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:400px;">
      <h3 style="margin-top:0;">${editing ? "Edit" : "New"} Booking</h3>
      <div class="f"><label>Customer name</label><input id="rf_name" value="${editing ? esc(r.customerName) : ""}" placeholder="Name"/></div>
      <div class="f"><label>Phone</label><input id="rf_phone" value="${editing ? esc(r.customerPhone) : ""}" placeholder="Phone"/></div>
      <div style="display:flex; gap:8px;">
        <div class="f" style="flex:1;"><label>Date</label><input id="rf_date" type="date" value="${editing ? esc(r.reserveDate) : dateEl.value}"/></div>
        <div class="f" style="flex:1;"><label>Time</label><input id="rf_time" type="time" value="${editing ? esc(r.reserveTime) : "19:00"}"/></div>
      </div>
      <div style="display:flex; gap:8px;">
        <div class="f" style="flex:1;"><label>Party size</label><input id="rf_party" type="number" min="1" value="${editing ? r.partySize : 2}"/></div>
        <div class="f" style="flex:1;"><label>Table</label><select id="rf_table">${tableOpts}</select></div>
      </div>
      <div class="f"><label>Note</label><input id="rf_note" value="${editing ? esc(r.note) : ""}" placeholder="e.g. window seat, birthday"/></div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn" id="rf_cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="rf_save" style="flex:1;">${editing ? "Save" : "Book"}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#rf_cancel").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#rf_save").onclick = async () => {
    const payload = {
      customerName: backdrop.querySelector("#rf_name").value.trim(),
      customerPhone: backdrop.querySelector("#rf_phone").value.trim(),
      reserveDate: backdrop.querySelector("#rf_date").value,
      reserveTime: backdrop.querySelector("#rf_time").value,
      partySize: parseInt(backdrop.querySelector("#rf_party").value, 10) || 1,
      tableId: backdrop.querySelector("#rf_table").value || null,
      note: backdrop.querySelector("#rf_note").value.trim(),
    };
    if (!payload.customerName && !payload.customerPhone) return toast("A name or phone is required");
    if (!payload.reserveDate || !payload.reserveTime) return toast("Date and time are required");
    const res = editing
      ? await api(`/api/reservations/${r.id}`, { method: "PUT", json: payload })
      : await api("/api/reservations", { method: "POST", json: payload });
    const rr = await res.json().catch(() => ({}));
    if (!res.ok) return toast(rr.error || "Could not save");
    close();
    if (payload.reserveDate !== dateEl.value) dateEl.value = payload.reserveDate;
    toast(editing ? "Booking updated" : "Booking created"); load();
  };
}

document.getElementById("newResvBtn").onclick = () => openForm(null);
dateEl.onchange = load;

if (staff && !blockIfNoBranchSelected(staff, document.getElementById("resvList"))) {
  await loadTables();
  load();
}

})();
