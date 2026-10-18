(async () => {
// customers.js — customer directory (phone = primary key).
const staff = requireLogin();
if (staff) renderNav("customers", staff);

const cur = () => (typeof posCurrency === "function" ? posCurrency() : "$");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const canManage = staff && ["superManager", "manager", "admin"].includes(staff.role);
const loyaltyOn = () => (window.posSettings && Array.isArray(window.posSettings.enabledAddons) && window.posSettings.enabledAddons.includes("loyalty"));

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

const listEl = document.getElementById("custList");
let CUSTOMERS = [];

async function load(search) {
  const res = await api("/api/customers" + (search ? `?search=${encodeURIComponent(search)}` : ""));
  CUSTOMERS = res.ok ? await res.json() : [];
  render();
}

function render() {
  if (!CUSTOMERS.length) {
    listEl.innerHTML = `<div class="empty-state">No customers yet — add one, or they’re saved automatically when you take an order with a phone number.</div>`;
    return;
  }
  listEl.innerHTML = `
    <div class="card" style="padding:0; overflow:hidden;">
      <table>
        <thead><tr>
          <th>Name</th><th>Phone</th><th>Address</th>
          ${loyaltyOn() ? "<th style='text-align:right;'>Points</th>" : ""}
          <th style="text-align:right;">Actions</th>
        </tr></thead>
        <tbody>
          ${CUSTOMERS.map((c) => `
            <tr>
              <td style="font-weight:600;">${esc(c.name) || "<span style='color:var(--muted);'>—</span>"}</td>
              <td class="mono">${esc(c.phone)}</td>
              <td style="color:var(--muted); font-size:13px;">${esc(c.address) || "—"}</td>
              ${loyaltyOn() ? `<td class="mono" style="text-align:right; font-weight:700; color:var(--accent);">${Math.round(c.loyaltyPoints || 0)}</td>` : ""}
              <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-sm" data-view="${c.id}">View</button>
                <button class="btn btn-sm" data-edit="${c.id}">Edit</button>
                ${canManage ? `<button class="btn btn-sm btn-danger" data-del="${c.id}">✕</button>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  listEl.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => viewCustomer(b.dataset.view));
  listEl.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { const c = CUSTOMERS.find((x) => x.id == b.dataset.edit); openForm(c); });
  listEl.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this customer? Their past orders are kept.")) return;
    await api(`/api/customers/${b.dataset.del}`, { method: "DELETE" });
    toast("Customer deleted"); load(document.getElementById("custSearch").value.trim());
  });
}

function modal(inner) {
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal" style="width:420px;">${inner}</div>`;
  document.body.appendChild(bd);
  bd.onclick = (e) => { if (e.target === bd) bd.remove(); };
  return { bd, close: () => bd.remove() };
}

function openForm(c) {
  const editing = !!c;
  const { bd, close } = modal(`
    <h3 style="margin-top:0;">${editing ? "Edit" : "Add"} Customer</h3>
    <div class="f"><label>Phone * (unique key)</label><input id="cf_phone" value="${editing ? esc(c.phone) : ""}" ${editing ? "" : ""} placeholder="e.g. 0771234567"/></div>
    <div class="f"><label>Name</label><input id="cf_name" value="${editing ? esc(c.name) : ""}" placeholder="Customer name"/></div>
    <div class="f"><label>Address</label><input id="cf_addr" value="${editing ? esc(c.address) : ""}" placeholder="Delivery address (optional)"/></div>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <button class="btn" id="cf_cancel" style="flex:1;">Cancel</button>
      <button class="btn btn-primary" id="cf_save" style="flex:1;">${editing ? "Save" : "Add"}</button>
    </div>`);
  bd.querySelector("#cf_cancel").onclick = close;
  bd.querySelector("#cf_save").onclick = async () => {
    const phone = bd.querySelector("#cf_phone").value.trim();
    const name = bd.querySelector("#cf_name").value.trim();
    const address = bd.querySelector("#cf_addr").value.trim();
    if (!phone) return toast("Phone number is required");
    const res = editing
      ? await api(`/api/customers/${c.id}`, { method: "PUT", json: { phone, name, address } })
      : await api("/api/customers", { method: "POST", json: { phone, name, address } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return toast(r.error || "Could not save");
    toast(editing ? "Customer updated" : "Customer added");
    close(); load(document.getElementById("custSearch").value.trim());
  };
}

async function viewCustomer(id) {
  const res = await api(`/api/customers/${id}`);
  if (!res.ok) return toast("Could not load customer");
  const c = await res.json();
  const orders = c.orders || [];
  const { close } = modal(`
    <h3 style="margin-top:0;">${esc(c.name) || esc(c.phone)}</h3>
    <div style="font-size:13px; color:var(--muted); margin-bottom:4px;">📞 ${esc(c.phone)}</div>
    ${c.address ? `<div style="font-size:13px; color:var(--muted); margin-bottom:10px;">📍 ${esc(c.address)}</div>` : ""}
    ${loyaltyOn() ? `<div style="display:inline-block; background:var(--accent-soft); color:var(--accent-dark); font-weight:700; padding:6px 12px; border-radius:999px; margin-bottom:14px;">💛 ${Math.round(c.loyaltyPoints || 0)} points</div>` : ""}
    <div style="font-size:12px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:6px 0 8px;">Recent orders (${orders.length})</div>
    <div style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
      ${orders.length ? orders.map((o) => `
        <div style="display:flex; justify-content:space-between; padding:8px 10px; background:var(--neutral-bg); border-radius:8px; font-size:13px;">
          <span>${o.displayNum || ("#" + o.id)} · <span style="color:var(--muted);">${new Date(o.createdAt).toLocaleDateString()}</span></span>
          <span class="mono" style="font-weight:700;">${cur()}${Number(o.grandTotal || o.total).toFixed(2)}</span>
        </div>`).join("") : `<div class="empty-state" style="padding:16px;">No orders yet.</div>`}
    </div>
    <button class="btn" id="cv_close" style="width:100%; margin-top:14px;">Close</button>`);
  document.getElementById("cv_close").onclick = close;
}

document.getElementById("addCustBtn").onclick = () => openForm(null);
let searchTimer = null;
document.getElementById("custSearch").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value.trim();
  searchTimer = setTimeout(() => load(v), 250);
});

// Make sure settings (enabledAddons) are loaded before the first render, so the
// loyalty Points column shows immediately rather than after a refresh.
if (staff && !blockIfNoBranchSelected(staff, listEl)) {
  (async () => {
    try { if (!window.posSettings && typeof window.posInitSettings === "function") await window.posInitSettings(); } catch (_) {}
    load("");
  })();
}

})();
