(async () => {
// promotions.js — manage automatic promotions + usage report.
const staff = requireLogin();
if (staff) renderNav("promotions", staff);

const cur = () => (typeof posCurrency === "function" ? posCurrency() : "$");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const canEdit = staff && ["superManager", "manager", "admin"].includes(staff.role);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE_LABEL = { buy_n: "Buy quantity", bundle: "Bundle", daily: "Daily % off" };

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

let MENU = [];
let PROMOS = [];
const menuName = (id) => { const m = MENU.find((x) => x.id == id); return m ? m.name : "item #" + id; };

async function loadAll() {
  const [mRes, pRes, rRes] = await Promise.all([api("/api/menu"), api("/api/promotions"), api("/api/promotions/report")]);
  MENU = mRes.ok ? await mRes.json() : [];
  PROMOS = pRes.ok ? await pRes.json() : [];
  const rep = rRes.ok ? await rRes.json() : { promos: [], totalDiscount: 0, totalOrders: 0 };
  renderReport(rep);
  renderList();
}

function renderReport(rep) {
  const tile = (label, val, cls) => `<div class="stat ${cls || ""}"><div class="stat-label">${label}</div><div class="stat-value">${val}</div></div>`;
  let html = tile("Active promotions", PROMOS.filter((p) => p.active).length, "muted")
    + tile("Orders with a promo", rep.totalOrders || 0, "muted")
    + tile("Total given", cur() + (rep.totalDiscount || 0).toFixed(2), "neg");
  document.getElementById("promoReport").innerHTML = html;
  // attach per-promo usage onto PROMOS for the list
  PROMOS.forEach((p) => {
    const u = (rep.promos || []).find((x) => x.promotionId === p.id);
    p._uses = u ? u.count : 0; p._given = u ? u.discount : 0;
  });
}

function rewardText(p) {
  if (p.rewardKind === "amount") return `${cur()}${p.rewardValue.toFixed(2)} off`;
  return `${p.rewardValue}% off ${p.scope === "order" ? "the order" : "those items"}`;
}
function condText(p) {
  return p.conditions.map((c) => `${c.qty}× ${esc(menuName(c.menuItemId))}`).join(p.type === "daily" ? " / " : " + ");
}

function renderList() {
  const el = document.getElementById("promoList");
  if (!PROMOS.length) { el.innerHTML = `<div class="empty-state">No promotions yet.</div>`; return; }
  el.innerHTML = PROMOS.map((p) => `
    <div class="card" style="padding:15px 18px; margin-bottom:10px; ${p.active ? "" : "opacity:.55;"}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div>
          <strong>${esc(p.name)}</strong>
          <span class="badge badge-ordered" style="margin-left:6px;">${TYPE_LABEL[p.type] || p.type}</span>
          ${p.days && p.days.length ? `<span class="badge badge-open" style="margin-left:4px;">${p.days.map((d) => DAYS[d]).join(", ")}</span>` : ""}
          <div style="font-size:13px; color:var(--muted); margin-top:4px;">${condText(p)} → <strong style="color:var(--accent);">${rewardText(p)}</strong></div>
          <div style="font-size:12px; color:var(--muted); margin-top:3px;">Used ${p._uses || 0}× · ${cur()}${(p._given || 0).toFixed(2)} given</div>
        </div>
        ${canEdit ? `<div style="display:flex; gap:6px; white-space:nowrap;">
          <button class="btn btn-sm" data-toggle="${p.id}">${p.active ? "Pause" : "Activate"}</button>
          <button class="btn btn-sm" data-edit="${p.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del="${p.id}">✕</button>
        </div>` : ""}
      </div>
    </div>`).join("");
  el.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = async () => {
    const p = PROMOS.find((x) => x.id == b.dataset.toggle);
    await api(`/api/promotions/${p.id}`, { method: "PUT", json: { active: !p.active } });
    loadAll();
  });
  el.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openForm(PROMOS.find((x) => x.id == b.dataset.edit)));
  el.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this promotion?")) return;
    await api(`/api/promotions/${b.dataset.del}`, { method: "DELETE" });
    toast("Promotion deleted"); loadAll();
  });
}

function openForm(p) {
  const editing = !!p;
  let conds = editing ? p.conditions.map((c) => ({ ...c })) : [{ menuItemId: MENU[0] && MENU[0].id, qty: 1 }];
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const itemOptions = (sel) => MENU.map((m) => `<option value="${m.id}" ${m.id == sel ? "selected" : ""}>${esc(m.name)}</option>`).join("");

  const render = () => {
    backdrop.innerHTML = `
    <div class="modal" style="width:480px; max-height:88vh; overflow-y:auto;">
      <h3 style="margin-top:0;">${editing ? "Edit" : "New"} Promotion</h3>
      <div class="f"><label>Name</label><input id="pf_name" value="${editing ? esc(p.name) : ""}" placeholder="e.g. Burger Tuesday"/></div>
      <div class="f"><label>Type</label>
        <select id="pf_type">
          <option value="buy_n">Buy quantity of an item</option>
          <option value="bundle">Bundle (several items together)</option>
          <option value="daily">Daily % off selected items</option>
        </select></div>
      <div class="f"><label>Items & quantities</label><div id="pf_conds"></div>
        <button class="btn btn-sm" id="pf_addItem" style="margin-top:6px;">+ Add item</button></div>
      <div class="f"><label>Reward</label>
        <div style="display:flex; gap:8px;">
          <select id="pf_kind" style="flex:1;"><option value="percent">% off</option><option value="amount">${cur()} off</option></select>
          <input id="pf_value" type="number" step="0.01" min="0" style="flex:1;" placeholder="value"/>
        </div></div>
      <div class="f" id="pf_scopeWrap"><label>Percent applies to</label>
        <select id="pf_scope"><option value="items">The qualifying items</option><option value="order">The whole order</option></select></div>
      <div class="f"><label>Days (none = every day)</label>
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          ${DAYS.map((d, i) => `<label style="display:flex; align-items:center; gap:3px; font-size:12px; border:1px solid var(--border); padding:4px 7px; border-radius:6px;"><input type="checkbox" class="pf_day" value="${i}"/> ${d}</label>`).join("")}
        </div></div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn" id="pf_cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="pf_save" style="flex:1;">${editing ? "Save" : "Create"}</button>
      </div>
    </div>`;
    // restore values
    backdrop.querySelector("#pf_type").value = editing ? p.type : "buy_n";
    backdrop.querySelector("#pf_kind").value = editing ? p.rewardKind : "percent";
    backdrop.querySelector("#pf_value").value = editing ? p.rewardValue : "";
    backdrop.querySelector("#pf_scope").value = editing ? p.scope : "items";
    if (editing) p.days.forEach((d) => { const cb = backdrop.querySelector(`.pf_day[value="${d}"]`); if (cb) cb.checked = true; });
    renderConds();
    syncScope();
    wire();
  };
  const renderConds = () => {
    const host = backdrop.querySelector("#pf_conds");
    host.innerHTML = conds.map((c, i) => `
      <div style="display:flex; gap:6px; margin-bottom:5px;">
        <select data-ci="${i}" class="pf_item" style="flex:1;">${itemOptions(c.menuItemId)}</select>
        <input data-ci="${i}" class="pf_qty" type="number" min="1" value="${c.qty}" style="width:70px;"/>
        ${conds.length > 1 ? `<button class="btn btn-sm btn-danger" data-rm="${i}">✕</button>` : ""}
      </div>`).join("");
    host.querySelectorAll(".pf_item").forEach((s) => s.onchange = () => conds[+s.dataset.ci].menuItemId = +s.value);
    host.querySelectorAll(".pf_qty").forEach((q) => q.onchange = () => conds[+q.dataset.ci].qty = Math.max(1, +q.value || 1));
    host.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => { conds.splice(+b.dataset.rm, 1); renderConds(); });
  };
  const syncScope = () => {
    backdrop.querySelector("#pf_scopeWrap").style.display = backdrop.querySelector("#pf_kind").value === "percent" ? "" : "none";
  };
  const wire = () => {
    backdrop.querySelector("#pf_kind").onchange = syncScope;
    backdrop.querySelector("#pf_addItem").onclick = () => { conds.push({ menuItemId: MENU[0] && MENU[0].id, qty: 1 }); renderConds(); };
    backdrop.querySelector("#pf_cancel").onclick = () => backdrop.remove();
    backdrop.querySelector("#pf_save").onclick = save;
  };
  const save = async () => {
    const payload = {
      name: backdrop.querySelector("#pf_name").value.trim(),
      type: backdrop.querySelector("#pf_type").value,
      conditions: conds,
      rewardKind: backdrop.querySelector("#pf_kind").value,
      rewardValue: parseFloat(backdrop.querySelector("#pf_value").value) || 0,
      scope: backdrop.querySelector("#pf_scope").value,
      days: Array.from(backdrop.querySelectorAll(".pf_day:checked")).map((c) => +c.value),
    };
    if (!payload.name) return toast("Name is required");
    if (!payload.rewardValue) return toast("Reward value is required");
    const res = editing
      ? await api(`/api/promotions/${p.id}`, { method: "PUT", json: payload })
      : await api("/api/promotions", { method: "POST", json: payload });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return toast(r.error || "Could not save");
    toast(editing ? "Promotion updated" : "Promotion created");
    backdrop.remove(); loadAll();
  };
  document.body.appendChild(backdrop);
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
  render();
}

const newBtn = document.getElementById("newPromoBtn");
if (newBtn) { newBtn.style.display = canEdit ? "" : "none"; newBtn.onclick = () => openForm(null); }

if (staff && !blockIfNoBranchSelected(staff, document.getElementById("promoList"))) loadAll();

})();
