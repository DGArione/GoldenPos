(async () => {
// inventory.js — popup-based inventory UI
const staff = requireLogin();
if (staff) renderNav("inventory", staff);
const readOnly = staff && isFinanceRole(staff); // finance can restock + purchases, not add/delete

// ── Helpers ───────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

// Standard units, so stock and recipes always speak the same language.
const UNIT_OPTIONS = [
  { g: "Weight", v: "kg",  l: "kg — kilograms" },
  { g: "Weight", v: "g",   l: "g — grams" },
  { g: "Volume", v: "l",   l: "l — litres" },
  { g: "Volume", v: "ml",  l: "ml — millilitres" },
  { g: "Count",  v: "pcs", l: "pcs — pieces" },
  { g: "Count",  v: "box", l: "box — boxes" },
  { g: "Count",  v: "pkt", l: "pkt — packets" },
  { g: "Count",  v: "btl", l: "btl — bottles" },
  { g: "Count",  v: "can", l: "can — cans" },
];
function unitSelect(id, current) {
  const groups = [...new Set(UNIT_OPTIONS.map(u => u.g))];
  const cur = current || "kg";
  const known = UNIT_OPTIONS.some(u => u.v === cur);
  return `<select id="${id}">
    ${groups.map(g => `<optgroup label="${g}">
      ${UNIT_OPTIONS.filter(u => u.g === g).map(u =>
        `<option value="${u.v}"${u.v === cur ? " selected" : ""}>${u.l}</option>`).join("")}
    </optgroup>`).join("")}
    ${!known ? `<option value="${esc(cur)}" selected>${esc(cur)} (custom)</option>` : ""}
  </select>`;
}

function cur() {
  return (window.posSettings && window.posSettings.currencySymbol) || "Rs.";
}
function fmt(n) { return cur() + " " + Number(n||0).toFixed(2); }

// ── Global data ────────────────────────────────────────────────
let INGREDIENTS = [];
let SUPPLIERS   = [];

// ── Popup engine (same pattern as admin.js) ───────────────────
function popup(html) {
  let wrap = document.getElementById("_invPopRoot");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "_invPopRoot";
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = `<div class="adm-backdrop" id="_invBd">${html}</div>`;
  const close = () => { wrap.innerHTML = ""; };
  wrap.querySelector("#_invBd").onclick = e => { if (e.target.id === "_invBd") close(); };
  wrap.querySelectorAll("[data-close]").forEach(b => b.onclick = close);
  return { close, el: wrap };
}

// ── Tab switching ──────────────────────────────────────────────
document.querySelectorAll("#sectionTabs .tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#sectionTabs .tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ["stock","suppliers","purchases","periods","movements"].forEach(s => {
      document.getElementById(`section-${s}`).style.display = s === btn.dataset.section ? "" : "none";
    });
    if (btn.dataset.section === "suppliers") loadSuppliers();
    if (btn.dataset.section === "purchases") loadPurchases();
    if (btn.dataset.section === "periods")   loadPeriods();
    if (btn.dataset.section === "movements") loadMovements();
  };
});

// ══════════════════════════════════════════════════════════════
// WASTE & TRANSFERS
// ══════════════════════════════════════════════════════════════
const MOVE_LABEL = { waste: "♻️ Waste", transfer_out: "🔁 Transfer out", transfer_in: "🔁 Transfer in", adjust: "✎ Adjust" };
async function loadMovements() {
  if (!INGREDIENTS.length) await loadStock();
  const res = await api("/api/inventory/movements");
  const rows = res.ok ? await res.json() : [];
  const el = document.getElementById("movementsList");
  if (!rows.length) { el.innerHTML = `<div class="empty-state">No stock movements recorded yet.</div>`; return; }
  el.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden;">
      <table><thead><tr>
        <th style="padding:9px 14px;">When</th><th>Ingredient</th><th>Type</th>
        <th style="text-align:right;">Qty</th><th>Reason</th><th>By</th>
      </tr></thead><tbody>
      ${rows.map(m => `<tr>
        <td style="padding:8px 14px;color:var(--muted);font-size:12px;">${new Date(m.createdAt).toLocaleString()}</td>
        <td style="font-weight:600;">${esc(m.ingredientName)}</td>
        <td>${MOVE_LABEL[m.type] || m.type}</td>
        <td class="mono" style="text-align:right;color:${m.type === "transfer_in" ? "var(--success)" : "var(--danger)"};">${m.type === "transfer_in" ? "+" : "−"}${Number(m.qty).toFixed(2)} ${esc(m.unit || "")}</td>
        <td style="font-size:12px;color:var(--muted);">${esc(m.reason || "")}</td>
        <td style="font-size:12px;color:var(--muted);">${esc(m.byStaffName || "")}</td>
      </tr>`).join("")}
      </tbody></table>
    </div>`;
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function ingOptions(sel) {
  return INGREDIENTS.map(i => `<option value="${i.id}">${esc(i.name)} (${Number(i.qty).toFixed(2)} ${esc(i.unit||"")})</option>`).join("");
}

function openWastePopup() {
  const { close, el } = popup(`
    <div class="adm-modal sm">
      <div class="adm-mbody">
        <h3 style="margin-top:0;">Record waste</h3>
        <div class="f"><label>Ingredient</label><select id="w_ing" style="width:100%;">${ingOptions()}</select></div>
        <div class="f"><label>Quantity wasted</label><input id="w_qty" type="number" step="0.001" min="0" placeholder="e.g. 0.5"/></div>
        <div class="f"><label>Reason</label><input id="w_reason" placeholder="e.g. spoiled, dropped, expired"/></div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn" data-close style="flex:1;">Cancel</button>
          <button class="btn btn-danger" id="w_go" style="flex:1;">Record Waste</button>
        </div>
      </div>
    </div>`);
  el.querySelector("#w_go").onclick = async () => {
    const ingredientId = Number(el.querySelector("#w_ing").value);
    const qty = parseFloat(el.querySelector("#w_qty").value);
    if (!qty || qty <= 0) return toast("Enter a quantity");
    const res = await api("/api/inventory/waste", { method: "POST", json: { ingredientId, qty, reason: el.querySelector("#w_reason").value.trim() } });
    if (!res.ok) { const e = await res.json().catch(()=>({})); return toast(e.error || "Could not record"); }
    toast("Waste recorded"); close(); await loadStock(); loadMovements();
  };
}

async function openTransferPopup() {
  const bRes = await api("/api/branches");
  const branches = bRes.ok ? await bRes.json() : [];
  const active = Number(localStorage.getItem("posActiveBranchId") || 0);
  const dests = branches.filter(b => Number(b.id) !== active);
  const { close, el } = popup(`
    <div class="adm-modal sm">
      <div class="adm-mbody">
        <h3 style="margin-top:0;">Transfer stock</h3>
        <div class="f"><label>Ingredient</label><select id="t_ing" style="width:100%;">${ingOptions()}</select></div>
        <div class="f"><label>Quantity</label><input id="t_qty" type="number" step="0.001" min="0"/></div>
        <div class="f"><label>To branch</label><select id="t_to" style="width:100%;">${dests.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select></div>
        <div class="f"><label>Reason (optional)</label><input id="t_reason" placeholder="e.g. covering a shortage"/></div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn" data-close style="flex:1;">Cancel</button>
          <button class="btn btn-primary" id="t_go" style="flex:1;">Transfer</button>
        </div>
      </div>
    </div>`);
  if (!dests.length) el.querySelector("#t_go").disabled = true;
  el.querySelector("#t_go").onclick = async () => {
    const ingredientId = Number(el.querySelector("#t_ing").value);
    const qty = parseFloat(el.querySelector("#t_qty").value);
    const toBranchId = Number(el.querySelector("#t_to").value);
    if (!qty || qty <= 0) return toast("Enter a quantity");
    if (!toBranchId) return toast("Choose a destination");
    const res = await api("/api/inventory/transfer", { method: "POST", json: { ingredientId, qty, toBranchId, reason: el.querySelector("#t_reason").value.trim() } });
    const r = await res.json().catch(()=>({}));
    if (!res.ok) return toast(r.error || "Transfer failed");
    toast(`Transferred to ${r.toBranch}`); close(); await loadStock(); loadMovements();
  };
}

(function wireMovementButtons(){
  const w = document.getElementById("recordWasteBtn"); if (w) w.onclick = openWastePopup;
  const t = document.getElementById("recordTransferBtn"); if (t) t.onclick = openTransferPopup;
})();

// ══════════════════════════════════════════════════════════════
// STOCK
// ══════════════════════════════════════════════════════════════
async function loadStock() {
  const res = await api("/api/ingredients");
  INGREDIENTS = await res.json();
  if (!Array.isArray(INGREDIENTS)) INGREDIENTS = [];
  renderStock();
}

function renderStock() {
  const tbody   = document.getElementById("rows");
  const empty   = document.getElementById("stockEmpty");
  const summary = document.getElementById("stockSummary");
  const banner  = document.getElementById("lowStockBanner");

  const low = INGREDIENTS.filter(i => i.qty <= i.lowStockThreshold);
  summary.textContent = `${INGREDIENTS.length} ingredient${INGREDIENTS.length!==1?"s":""}`;

  if (low.length) {
    banner.style.display = "";
    banner.innerHTML = `⚠️ <strong>${low.length} item${low.length>1?"s":""} low on stock:</strong> ${low.map(i => `${i.name} (${i.qty} ${i.unit})`).join(", ")}`;
  } else {
    banner.style.display = "none";
  }

  if (!INGREDIENTS.length) {
    tbody.innerHTML = "";
    empty.style.display = "";
    return;
  }
  empty.style.display = "none";

  tbody.innerHTML = INGREDIENTS.map(ing => {
    const isLow = ing.qty <= ing.lowStockThreshold;
    return `<tr>
      <td style="padding:12px 18px;font-weight:600;">${ing.name}</td>
      <td>
        <span class="mono" style="font-size:15px;font-weight:700;${isLow?"color:var(--danger);":"color:var(--text);"}">${ing.qty}</span>
        ${isLow ? `<span class="badge badge-dirty" style="margin-left:6px;">LOW</span>` : ""}
      </td>
      <td style="color:var(--muted);font-size:13px;">${ing.unit}</td>
      <td class="mono" style="font-size:13px;">${cur()}${Number(ing.unitCost || 0).toFixed(2)}</td>
      <td class="mono" style="font-size:13px;font-weight:600;">${cur()}${(Number(ing.qty) * Number(ing.unitCost || 0)).toFixed(2)}</td>
      <td style="color:var(--muted);font-size:13px;">${ing.lowStockThreshold} ${ing.unit}</td>
      <td style="text-align:right;padding-right:18px;">
        <div style="display:inline-flex;gap:6px;align-items:center;">
          <button class="btn btn-primary" data-restock="${ing.id}" style="font-size:12px;padding:6px 12px;">＋ Restock</button>
          <button class="btn" data-edit="${ing.id}" style="font-size:12px;padding:6px 10px;">✏️</button>
          ${!readOnly ? `<button class="btn btn-danger" data-del="${ing.id}" style="font-size:12px;padding:6px 10px;">Delete</button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-restock]").forEach(btn => {
    btn.onclick = () => openRestockPopup(INGREDIENTS.find(i => i.id === Number(btn.dataset.restock)));
  });
  tbody.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => openEditIngPopup(INGREDIENTS.find(i => i.id === Number(btn.dataset.edit)));
  });
  if (!readOnly) {
    tbody.querySelectorAll("[data-del]").forEach(btn => {
      btn.onclick = async () => {
        const ing = INGREDIENTS.find(i => i.id === Number(btn.dataset.del));
        if (!confirm(`Delete "${ing.name}"? This cannot be undone.`)) return;
        await api(`/api/ingredients/${ing.id}`, { method: "DELETE" });
        toast(`Deleted ${ing.name}`);
        loadStock();
      };
    });
  }
}

// ── Add Ingredient popup ───────────────────────────────────────
document.getElementById("openAddIngBtn").onclick = () => {
  if (readOnly) return;
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>📦 Add Ingredient</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Ingredient Name *</label>
        <input id="ing_name" placeholder="e.g. Chicken Breast, Rice, Milk"/>
      </div>
      <div class="f-row">
        <div class="f"><label>Unit *</label>
          ${unitSelect("ing_unit", "kg")}
        </div>
        <div class="f"><label>Starting Qty</label>
          <input id="ing_qty" type="number" step="0.001" min="0" placeholder="0"/>
        </div>
      </div>
      <div class="f"><label>Unit Cost (${window.posSettings?.currencySymbol || "Rs. "}per ${"unit"})</label>
        <input id="ing_cost" type="number" step="0.0001" min="0" placeholder="e.g. 850.00"/>
        <div class="f-hint">What one unit costs you. Used for stock valuation and consumption cost in reports.</div>
      </div>
      <div class="f"><label>Low Stock Alert at</label>
        <input id="ing_thresh" type="number" step="0.001" min="0" placeholder="e.g. 2"/>
        <div class="f-hint">You'll get a warning badge when stock falls to or below this amount.</div>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="ing_save">＋ Add Ingredient</button>
    </div>
  </div>`);
  el.querySelector("#ing_name").focus();
  el.querySelector("#ing_save").onclick = async () => {
    const name   = el.querySelector("#ing_name").value.trim();
    const unit   = el.querySelector("#ing_unit").value.trim();
    const qty    = parseFloat(el.querySelector("#ing_qty").value) || 0;
    const cost   = parseFloat(el.querySelector("#ing_cost").value) || 0;
    const thresh = parseFloat(el.querySelector("#ing_thresh").value) || 0;
    if (!name) return toast("Enter ingredient name");
    if (!unit) return toast("Enter a unit (kg, l, pcs...)");
    const btn = el.querySelector("#ing_save");
    btn.disabled = true; btn.textContent = "Saving…";
    await api("/api/ingredients", { method: "POST", json: { name, unit, qty, unitCost: cost, lowStockThreshold: thresh } });
    toast(`✅ "${name}" added`);
    close(); loadStock();
  };
};

// ── Edit Ingredient popup ──────────────────────────────────────
function openEditIngPopup(ing) {
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>✏️ Edit: ${ing.name}</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Ingredient Name</label>
        <input id="ei_name" value="${ing.name}"/>
      </div>
      <div class="f-row">
        <div class="f"><label>Unit</label>
          ${unitSelect("ei_unit", ing.unit)}
        </div>
        <div class="f"><label>Current Stock</label>
          <input id="ei_qty" type="number" step="0.001" value="${ing.qty}"/>
        </div>
      </div>
      <div class="f"><label>Unit Cost</label>
        <input id="ei_cost" type="number" step="0.0001" min="0" value="${ing.unitCost || 0}"/>
        <div class="f-hint">Cost of one ${ing.unit} — used for stock value &amp; consumption cost.</div>
      </div>
      <div class="f"><label>Low Stock Alert at</label>
        <input id="ei_thresh" type="number" step="0.001" value="${ing.lowStockThreshold}"/>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="ei_save">Save Changes</button>
    </div>
  </div>`);
  el.querySelector("#ei_save").onclick = async () => {
    const name   = el.querySelector("#ei_name").value.trim();
    const unit   = el.querySelector("#ei_unit").value.trim();
    const qty    = parseFloat(el.querySelector("#ei_qty").value) || 0;
    const cost   = parseFloat(el.querySelector("#ei_cost").value) || 0;
    const thresh = parseFloat(el.querySelector("#ei_thresh").value) || 0;
    if (!name || !unit) return toast("Name and unit are required");
    const btn = el.querySelector("#ei_save");
    btn.disabled = true; btn.textContent = "Saving…";
    await api(`/api/ingredients/${ing.id}`, { method: "PUT", json: { name, unit, qty, unitCost: cost, lowStockThreshold: thresh } });
    toast(`✅ "${name}" updated`);
    close(); loadStock();
  };
}

// ── Restock popup ──────────────────────────────────────────────
function openRestockPopup(ing) {
  const isLow = ing.qty <= ing.lowStockThreshold;
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead">
      <h3>📥 Restock: ${ing.name}</h3>
      <button class="adm-x" data-close>×</button>
    </div>
    <div class="adm-mbody">
      <!-- Current stock status card -->
      <div style="background:var(--neutral-bg);border-radius:12px;padding:16px 18px;margin-bottom:18px;display:flex;gap:20px;align-items:center;">
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Current Stock</div>
          <div class="mono" style="font-size:26px;font-weight:800;${isLow?"color:var(--danger);":"color:var(--text);"}">${ing.qty} <span style="font-size:14px;font-weight:400;">${ing.unit}</span></div>
        </div>
        <div style="width:1px;background:var(--border);align-self:stretch;"></div>
        <div>
          <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">Alert Level</div>
          <div class="mono" style="font-size:18px;font-weight:700;color:var(--warning);">${ing.lowStockThreshold} ${ing.unit}</div>
        </div>
      </div>

      <!-- Quick restock buttons -->
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Quick Add</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" data-quick="5" style="font-size:13px;font-weight:700;padding:10px 16px;">+5</button>
          <button class="btn" data-quick="10" style="font-size:13px;font-weight:700;padding:10px 16px;">+10</button>
          <button class="btn" data-quick="25" style="font-size:13px;font-weight:700;padding:10px 16px;">+25</button>
          <button class="btn" data-quick="50" style="font-size:13px;font-weight:700;padding:10px 16px;">+50</button>
          <button class="btn" data-quick="100" style="font-size:13px;font-weight:700;padding:10px 16px;">+100</button>
        </div>
      </div>

      <!-- Custom amount -->
      <div class="f">
        <label>Custom Amount to Add</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="rs_amt" type="number" step="0.001" min="0.001" placeholder="Enter amount..." style="flex:1;font-size:16px;font-weight:600;"/>
          <span style="font-size:14px;color:var(--muted);white-space:nowrap;">${ing.unit}</span>
        </div>
      </div>

      <!-- Preview -->
      <div id="rs_preview" style="background:var(--success-bg);border-radius:10px;padding:12px 16px;font-size:13px;color:var(--success);display:none;">
        After restock: <strong id="rs_after" class="mono"></strong>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="rs_save" disabled style="padding:10px 24px;">＋ Restock</button>
    </div>
  </div>`);

  const amtInput = el.querySelector("#rs_amt");
  const preview  = el.querySelector("#rs_preview");
  const afterEl  = el.querySelector("#rs_after");
  const saveBtn  = el.querySelector("#rs_save");

  function updatePreview(val) {
    const n = parseFloat(val);
    if (n > 0) {
      preview.style.display = "";
      afterEl.textContent = `${(ing.qty + n).toFixed(3)} ${ing.unit}`;
      saveBtn.disabled = false;
    } else {
      preview.style.display = "none";
      saveBtn.disabled = true;
    }
  }

  amtInput.oninput = () => updatePreview(amtInput.value);

  // Quick buttons
  el.querySelectorAll("[data-quick]").forEach(btn => {
    btn.onclick = () => {
      amtInput.value = btn.dataset.quick;
      updatePreview(btn.dataset.quick);
      amtInput.focus();
    };
  });

  saveBtn.onclick = async () => {
    const amount = parseFloat(amtInput.value);
    if (!amount || amount <= 0) return toast("Enter a valid amount");
    saveBtn.disabled = true; saveBtn.textContent = "Restocking…";
    await api(`/api/ingredients/${ing.id}/restock`, { method: "POST", json: { amount } });
    toast(`✅ Restocked ${ing.name} +${amount} ${ing.unit}`);
    close(); loadStock();
  };

  amtInput.focus();
}

// ══════════════════════════════════════════════════════════════
// SUPPLIERS
// ══════════════════════════════════════════════════════════════
async function loadSuppliers() {
  const res = await api("/api/suppliers");
  SUPPLIERS = await res.json();
  if (!Array.isArray(SUPPLIERS)) SUPPLIERS = [];
  renderSuppliers();
}

function renderSuppliers() {
  const el    = document.getElementById("supplierRows");
  const count = document.getElementById("supplierCount");
  count.textContent = `${SUPPLIERS.length} supplier${SUPPLIERS.length!==1?"s":""}`;

  if (!SUPPLIERS.length) {
    el.innerHTML = `<div class="empty-state">No suppliers yet — click <strong>＋ Add Supplier</strong>.</div>`;
    return;
  }
  el.innerHTML = SUPPLIERS.map(s => `
    <div class="card" style="padding:16px 18px;display:flex;align-items:center;gap:14px;">
      <div style="width:44px;height:44px;border-radius:10px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">🚚</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:15px;">${s.name}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">
          ${s.contact ? `📞 ${s.contact}` : ""}
          ${s.contact && s.notes ? " · " : ""}
          ${s.notes ? s.notes : ""}
          ${!s.contact && !s.notes ? "No contact info" : ""}
        </div>
      </div>
      ${!readOnly ? `
      <div style="display:flex;gap:6px;">
        <button class="btn" data-editsup="${s.id}" style="font-size:12px;padding:6px 10px;">✏️ Edit</button>
        <button class="btn btn-danger" data-delsup="${s.id}" style="font-size:12px;padding:6px 10px;">Delete</button>
      </div>` : ""}
    </div>`).join("");

  if (!readOnly) {
    el.querySelectorAll("[data-editsup]").forEach(btn => {
      btn.onclick = () => openEditSupPopup(SUPPLIERS.find(s => s.id === Number(btn.dataset.editsup)));
    });
    el.querySelectorAll("[data-delsup]").forEach(btn => {
      btn.onclick = async () => {
        const s = SUPPLIERS.find(s => s.id === Number(btn.dataset.delsup));
        if (!confirm(`Delete supplier "${s.name}"?`)) return;
        await api(`/api/suppliers/${s.id}`, { method: "DELETE" });
        toast(`Deleted "${s.name}"`);
        loadSuppliers();
      };
    });
  }
}

document.getElementById("openAddSupBtn").onclick = () => {
  if (readOnly) return;
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>🚚 Add Supplier</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Supplier Name *</label><input id="sup_name" placeholder="e.g. Fresh Farms Ltd"/></div>
      <div class="f"><label>Phone / Contact</label><input id="sup_phone" placeholder="e.g. +94 77 123 4567"/></div>
      <div class="f"><label>Notes</label><input id="sup_notes" placeholder="e.g. Delivers Mon/Wed/Fri"/></div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="sup_save">＋ Add Supplier</button>
    </div>
  </div>`);
  el.querySelector("#sup_name").focus();
  el.querySelector("#sup_name").onkeydown = e => { if (e.key === "Enter") el.querySelector("#sup_save").click(); };
  el.querySelector("#sup_save").onclick = async () => {
    const name  = el.querySelector("#sup_name").value.trim();
    const contact = el.querySelector("#sup_phone").value.trim();
    const notes = el.querySelector("#sup_notes").value.trim();
    if (!name) return toast("Enter supplier name");
    await api("/api/suppliers", { method: "POST", json: { name, contact, notes } });
    toast(`✅ "${name}" added`);
    close(); loadSuppliers();
  };
};

function openEditSupPopup(sup) {
  const { close, el } = popup(`
  <div class="adm-modal sm">
    <div class="adm-mhead"><h3>✏️ Edit Supplier</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Supplier Name</label><input id="es_name" value="${sup.name}"/></div>
      <div class="f"><label>Phone / Contact</label><input id="es_phone" value="${sup.contact||""}"/></div>
      <div class="f"><label>Notes</label><input id="es_notes" value="${sup.notes||""}"/></div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="es_save">Save Changes</button>
    </div>
  </div>`);
  el.querySelector("#es_save").onclick = async () => {
    const name    = el.querySelector("#es_name").value.trim();
    const contact = el.querySelector("#es_phone").value.trim();
    const notes   = el.querySelector("#es_notes").value.trim();
    if (!name) return toast("Name is required");
    await api(`/api/suppliers/${sup.id}`, { method: "PUT", json: { name, contact, notes } });
    toast(`✅ Updated "${name}"`);
    close(); loadSuppliers();
  };
}

// ══════════════════════════════════════════════════════════════
// PURCHASE HISTORY
// ══════════════════════════════════════════════════════════════
async function loadPurchases() {
  const [pRes, iRes, sRes] = await Promise.all([
    api("/api/purchases"), api("/api/ingredients"), api("/api/suppliers")
  ]);
  const purchases = await pRes.json();
  if (!Array.isArray(INGREDIENTS) || !INGREDIENTS.length) INGREDIENTS = await iRes.json();
  if (!Array.isArray(SUPPLIERS)   || !SUPPLIERS.length)   SUPPLIERS   = await sRes.json();

  const count = document.getElementById("purchaseCount");
  const tbody = document.getElementById("purchaseRows");
  const empty = document.getElementById("purchaseEmpty");

  count.textContent = `${Array.isArray(purchases) ? purchases.length : 0} record${purchases.length!==1?"s":""}`;

  if (!Array.isArray(purchases) || !purchases.length) {
    tbody.innerHTML = ""; empty.style.display = "";
    return;
  }
  empty.style.display = "none";
  tbody.innerHTML = purchases.map(p => `
    <tr>
      <td style="padding:12px 18px;color:var(--muted);font-size:13px;">${new Date(p.createdAt||p.date).toLocaleDateString()}</td>
      <td style="font-weight:600;">${p.ingredientName || "—"}</td>
      <td style="color:var(--muted);font-size:13px;">${p.supplierName || "—"}</td>
      <td class="mono" style="color:var(--success);font-weight:700;">+${p.qty}</td>
      <td class="mono">${p.total ? fmt(p.total) : "—"}</td>
    </tr>`).join("");
}

document.getElementById("openAddPurchBtn").onclick = async () => {
  // Make sure we have fresh data for dropdowns
  if (!INGREDIENTS.length) await loadStock();
  if (!SUPPLIERS.length)   await loadSuppliers();

  const ingOpts = INGREDIENTS.map(i => `<option value="${i.id}">${i.name} (${i.qty} ${i.unit})</option>`).join("");
  const supOpts = SUPPLIERS.length
    ? SUPPLIERS.map(s => `<option value="${s.id}">${s.name}</option>`).join("")
    : `<option value="">No suppliers — add one first</option>`;

  const { close, el } = popup(`
  <div class="adm-modal sm" style="width:480px;">
    <div class="adm-mhead"><h3>🧾 Record Purchase</h3><button class="adm-x" data-close>×</button></div>
    <div class="adm-mbody">
      <div class="f"><label>Ingredient *</label>
        <select id="pu_ing">${ingOpts || '<option value="">No ingredients yet</option>'}</select>
      </div>
      <div class="f"><label>Supplier</label>
        <select id="pu_sup"><option value="">No supplier / walk-in</option>${supOpts}</select>
      </div>
      <div class="f-row">
        <div class="f"><label>Quantity Received *</label>
          <input id="pu_qty" type="number" step="0.001" min="0.001" placeholder="e.g. 10"/>
        </div>
        <div class="f"><label>Total Cost (${cur()})</label>
          <input id="pu_cost" type="number" step="0.01" min="0" placeholder="e.g. 1500.00"/>
        </div>
      </div>
      <div class="f"><label>Note (optional)</label>
        <input id="pu_note" placeholder="e.g. Weekly order, Invoice #123"/>
      </div>
      <div id="pu_preview" style="background:var(--success-bg);border-radius:10px;padding:12px 16px;font-size:13px;color:var(--success);margin-top:4px;display:none;">
        Stock will increase: <strong id="pu_after" class="mono"></strong>
      </div>
    </div>
    <div class="adm-mfoot">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="pu_save">✅ Record Purchase</button>
    </div>
  </div>`);

  function updatePreview() {
    const ing = INGREDIENTS.find(i => i.id === Number(el.querySelector("#pu_ing").value));
    const qty = parseFloat(el.querySelector("#pu_qty").value);
    const preview = el.querySelector("#pu_preview");
    const after   = el.querySelector("#pu_after");
    if (ing && qty > 0) {
      preview.style.display = "";
      after.textContent = `${ing.name}: ${ing.qty} → ${(ing.qty + qty).toFixed(3)} ${ing.unit}`;
    } else {
      preview.style.display = "none";
    }
  }

  el.querySelector("#pu_ing").onchange = updatePreview;
  el.querySelector("#pu_qty").oninput  = updatePreview;

  el.querySelector("#pu_save").onclick = async () => {
    const ingredientId = Number(el.querySelector("#pu_ing").value);
    const supplierId   = el.querySelector("#pu_sup").value || null;
    const qty          = parseFloat(el.querySelector("#pu_qty").value);
    const cost         = parseFloat(el.querySelector("#pu_cost").value) || 0;
    const note         = el.querySelector("#pu_note").value.trim();

    if (!ingredientId) return toast("Select an ingredient");
    if (!qty || qty <= 0) return toast("Enter quantity received");

    const btn = el.querySelector("#pu_save");
    btn.disabled = true; btn.textContent = "Saving…";

    await api("/api/purchases", { method: "POST", json: { ingredientId, supplierId, qty, cost, note } });
    toast("✅ Purchase recorded — stock updated");
    close();
    loadStock();
    loadPurchases();
  };

  el.querySelector("#pu_qty").focus();
};

// ══════════════════════════════════════════════════════════════
// STOCK PERIODS — opening/closing stock & carry-over
// ══════════════════════════════════════════════════════════════
let PERIODS = [];

async function loadPeriods() {
  const res = await api("/api/stock-periods");
  PERIODS = res.ok ? await res.json() : [];
  renderPeriods();
}

function renderPeriods() {
  const el = document.getElementById("periodsList");
  if (!PERIODS.length) {
    el.innerHTML = `<div class="empty-state">No stock periods closed yet. Click "Close Stock Period" to snapshot your current stock — usually at month-end.</div>`;
    return;
  }
  el.innerHTML = PERIODS.map(p => `
    <div class="card" style="padding:16px 18px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-size:15px; font-weight:700;">${p.label}</div>
          <div style="font-size:12px; color:var(--muted);">${p.startDate} → ${p.endDate} · closed by ${p.closedByName || "—"}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-primary" data-report-period="${p.id}" style="font-size:12px; padding:5px 12px;">📄 Report</button>
          <button class="btn" data-view-period="${p.id}" style="font-size:12px; padding:5px 12px;">View / Edit</button>
          <button class="btn btn-danger" data-del-period="${p.id}" style="font-size:12px; padding:5px 10px;">Delete</button>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-top:12px;">
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Opening Value</div><div class="mono" style="font-weight:700;">${cur()}${Number(p.openingValue).toFixed(2)}</div></div>
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Purchased</div><div class="mono" style="font-weight:700;">${cur()}${Number(p.purchaseValue).toFixed(2)}</div></div>
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Consumed</div><div class="mono" style="font-weight:700;color:var(--danger);">${cur()}${Number(p.consumedValue).toFixed(2)}</div></div>
        <div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;">Closing Value</div><div class="mono" style="font-weight:700;color:var(--success);">${cur()}${Number(p.closingValue).toFixed(2)}</div></div>
      </div>
    </div>`).join("");

  el.querySelectorAll("[data-report-period]").forEach(b => {
    b.onclick = () => {
      const p = PERIODS.find(x => x.id == b.dataset.reportPeriod);
      if (p) openPeriodReport(p);
    };
  });
  el.querySelectorAll("[data-view-period]").forEach(b => {
    b.onclick = () => {
      const p = PERIODS.find(x => x.id == b.dataset.viewPeriod);
      if (p) openPeriodEditor(p);
    };
  });
  el.querySelectorAll("[data-del-period]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Delete this stock period? This does not change current stock.")) return;
      await api(`/api/stock-periods/${b.dataset.delPeriod}`, { method: "DELETE" });
      toast("Period deleted");
      loadPeriods();
    };
  });
}

// Build the closing sheet from a preview, let the user adjust counts, then save.
async function openCloseStockPeriod() {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const fmt   = d => d.toISOString().slice(0, 10);

  const { close, el } = popup(`
    <div class="adm-modal" style="max-width:760px;">
      <div class="adm-mhead"><h3>📋 Close Stock Period</h3><button class="adm-x" data-close>×</button></div>
      <div class="adm-mbody">
        <div class="f-row">
          <div class="f"><label>Period Label</label><input id="sp_label" placeholder="e.g. ${now.toLocaleString('default',{month:'long'})} ${now.getFullYear()}" value="${now.toLocaleString('default',{month:'long'})} ${now.getFullYear()}"/></div>
          <div class="f"><label>From</label><input id="sp_from" type="date" value="${fmt(first)}"/></div>
          <div class="f"><label>To</label><input id="sp_to" type="date" value="${fmt(now)}"/></div>
        </div>
        <button class="btn btn-primary" id="sp_build" style="margin:4px 0 14px;">↻ Build sheet from stock</button>
        <div id="sp_sheet" style="font-size:12px; color:var(--muted);">Set the dates, then build the sheet. Opening comes from the last closed period; purchases are summed automatically; closing defaults to your current live stock — adjust it to your physical count.</div>
      </div>
      <div class="adm-mfoot">
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; margin-right:auto;">
          <input type="checkbox" id="sp_carry" checked /> Carry closing stock over as new live stock
        </label>
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="sp_save" disabled style="opacity:.5;">Save Period</button>
      </div>
    </div>`);

  let sheetLines = [];

  const buildSheet = async () => {
    const from = el.querySelector("#sp_from").value;
    const to   = el.querySelector("#sp_to").value;
    el.querySelector("#sp_sheet").innerHTML = "Loading…";
    const res = await api(`/api/stock-periods/preview?from=${from}&to=${to}`);
    if (!res.ok) {
      let msg = "Could not build sheet.";
      try { const e = await res.json(); if (e.error) msg = e.error; } catch(_) {}
      el.querySelector("#sp_sheet").innerHTML = `<div style="color:var(--danger);">${msg}</div>`;
      return;
    }
    const data = await res.json();
    sheetLines = data.lines;
    if (!sheetLines.length) { el.querySelector("#sp_sheet").innerHTML = "No ingredients to snapshot."; return; }

    el.querySelector("#sp_sheet").innerHTML = `
      ${!data.hasPrevious ? `<div style="font-size:12px; color:var(--warning); margin-bottom:8px;">No earlier period found — opening starts at 0 for every item. This is normal for your first close.</div>` : ""}
      <div style="max-height:340px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
        <table style="width:100%; font-size:12px; margin:0;">
          <thead><tr style="position:sticky;top:0;background:var(--panel);">
            <th style="text-align:left;padding:8px;">Ingredient</th>
            <th style="text-align:right;padding:8px;">Opening</th>
            <th style="text-align:right;padding:8px;">Purchased</th>
            <th style="text-align:right;padding:8px;">Closing (count)</th>
            <th style="text-align:right;padding:8px;">Consumed</th>
          </tr></thead>
          <tbody>
            ${sheetLines.map((ln, i) => `
              <tr>
                <td style="padding:6px 8px;">${ln.name} <span style="color:var(--muted);">${ln.unit}</span></td>
                <td class="mono" style="text-align:right;padding:6px 8px;">${ln.opening}</td>
                <td class="mono" style="text-align:right;padding:6px 8px;">${ln.purchased}</td>
                <td style="text-align:right;padding:6px 8px;">
                  <input type="number" step="0.001" data-close-idx="${i}" value="${ln.closing}" style="width:90px; text-align:right; font-size:12px;"/>
                </td>
                <td class="mono" data-consumed="${i}" style="text-align:right;padding:6px 8px;color:var(--danger);">${ln.consumed}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div style="font-size:11px; color:var(--muted); margin-top:8px;">Consumed = Opening + Purchased − Closing. Adjust closing to match your physical count.</div>`;

    // Live-recompute consumed when the user edits a closing count
    el.querySelectorAll("[data-close-idx]").forEach(inp => {
      inp.oninput = () => {
        const i = +inp.dataset.closeIdx;
        const closing = parseFloat(inp.value) || 0;
        sheetLines[i].closing  = closing;
        sheetLines[i].consumed = Math.max(0, sheetLines[i].opening + sheetLines[i].purchased - closing);
        el.querySelector(`[data-consumed="${i}"]`).textContent = sheetLines[i].consumed.toFixed(3);
      };
    });

    const saveBtn = el.querySelector("#sp_save");
    saveBtn.disabled = false; saveBtn.style.opacity = "";
  };

  el.querySelector("#sp_build").onclick = buildSheet;

  el.querySelector("#sp_save").onclick = async () => {
    const label = el.querySelector("#sp_label").value.trim();
    if (!label) return toast("Give the period a label");
    if (!sheetLines.length) return toast("Build the sheet first");
    const btn = el.querySelector("#sp_save");
    btn.disabled = true; btn.textContent = "Saving…";
    const res = await api("/api/stock-periods", {
      method: "POST",
      json: {
        label,
        from: el.querySelector("#sp_from").value,
        to:   el.querySelector("#sp_to").value,
        lines: sheetLines,
        setStockToClosing: el.querySelector("#sp_carry").checked,
      },
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); toast(e.error || "Could not save"); btn.disabled=false; btn.textContent="Save Period"; return; }
    toast(`✅ "${label}" closed`);
    close();
    loadPeriods();
    loadStock(); // stock may have been carried over
  };
}

// View / edit a saved period.
function openPeriodEditor(p) {
  const { close, el } = popup(`
    <div class="adm-modal" style="max-width:760px;">
      <div class="adm-mhead"><h3>${p.label}</h3><button class="adm-x" data-close>×</button></div>
      <div class="adm-mbody">
        <div class="f"><label>Period Label</label><input id="ep_label" value="${p.label}"/></div>
        <div style="max-height:360px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; margin-top:8px;">
          <table style="width:100%; font-size:12px; margin:0;">
            <thead><tr style="position:sticky;top:0;background:var(--panel);">
              <th style="text-align:left;padding:8px;">Ingredient</th>
              <th style="text-align:right;padding:8px;">Opening</th>
              <th style="text-align:right;padding:8px;">Purchased</th>
              <th style="text-align:right;padding:8px;">Closing</th>
              <th style="text-align:right;padding:8px;">Consumed</th>
            </tr></thead>
            <tbody>
              ${p.lines.map((ln, i) => `
                <tr>
                  <td style="padding:6px 8px;">${ln.name}</td>
                  <td style="text-align:right;padding:6px 8px;"><input type="number" step="0.001" data-f="opening" data-i="${i}" value="${ln.opening}" style="width:80px;text-align:right;font-size:12px;"/></td>
                  <td style="text-align:right;padding:6px 8px;"><input type="number" step="0.001" data-f="purchased" data-i="${i}" value="${ln.purchased}" style="width:80px;text-align:right;font-size:12px;"/></td>
                  <td style="text-align:right;padding:6px 8px;"><input type="number" step="0.001" data-f="closing" data-i="${i}" value="${ln.closing}" style="width:80px;text-align:right;font-size:12px;"/></td>
                  <td class="mono" data-consumed="${i}" style="text-align:right;padding:6px 8px;color:var(--danger);">${ln.consumed}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="adm-mfoot">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="ep_save">Save Changes</button>
      </div>
    </div>`);

  const lines = JSON.parse(JSON.stringify(p.lines));
  el.querySelectorAll("[data-f]").forEach(inp => {
    inp.oninput = () => {
      const i = +inp.dataset.i, f = inp.dataset.f;
      lines[i][f] = parseFloat(inp.value) || 0;
      lines[i].consumed = Math.max(0, lines[i].opening + lines[i].purchased - lines[i].closing);
      el.querySelector(`[data-consumed="${i}"]`).textContent = lines[i].consumed.toFixed(3);
    };
  });

  el.querySelector("#ep_save").onclick = async () => {
    const btn = el.querySelector("#ep_save");
    btn.disabled = true; btn.textContent = "Saving…";
    const res = await api(`/api/stock-periods/${p.id}`, {
      method: "PUT",
      json: { label: el.querySelector("#ep_label").value.trim(), lines },
    });
    if (!res.ok) { toast("Could not save"); btn.disabled=false; btn.textContent="Save Changes"; return; }
    toast("Period updated");
    close(); loadPeriods();
  };
}

document.getElementById("openCloseStockBtn").onclick = openCloseStockPeriod;

// ── Printable monthly stock report ─────────────────────────────
function openPeriodReport(p) {
  const c = cur();
  const biz = (window.posSettings && window.posSettings.businessName) || "Restaurant POS";
  const branchName = (staff && staff.branch && staff.branch.name) || "";
  const money = (n) => c + " " + Number(n || 0).toFixed(2);
  const q = (n) => Number(n || 0).toFixed(3).replace(/\.?0+$/, "");

  const rows = (p.lines || []).map((ln) => {
    const uc = Number(ln.unitCost || 0);
    return { ...ln,
      openingVal: Number(ln.opening || 0) * uc,
      purchasedVal: Number(ln.purchased || 0) * uc,
      consumedVal: Number(ln.consumed || 0) * uc,
      closingVal: Number(ln.closing || 0) * uc };
  });

  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stock Report — ${p.label}</title>
    <style>
      *{box-sizing:border-box;} body{font-family:"Inter",Arial,sans-serif;color:#1c1c1c;margin:0;padding:28px 34px;font-size:12.5px;}
      h1{font-size:20px;margin:0 0 2px;} .sub{color:#666;font-size:12px;margin-bottom:2px;}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1c1c1c;padding-bottom:12px;margin-bottom:16px;}
      .hdr .r{text-align:right;color:#555;font-size:12px;}
      table{width:100%;border-collapse:collapse;margin-top:6px;}
      th{font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#666;text-align:right;padding:7px 8px;border-bottom:1.5px solid #ccc;}
      th:first-child,td:first-child{text-align:left;}
      td{padding:7px 8px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;}
      tfoot td{font-weight:700;border-top:2px solid #1c1c1c;border-bottom:none;padding-top:9px;}
      .summary{margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;}
      .box{flex:1;min-width:150px;border:1px solid #ddd;border-radius:10px;padding:12px 14px;}
      .box .k{font-size:10.5px;text-transform:uppercase;color:#777;letter-spacing:.04em;}
      .box .v{font-size:18px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums;}
      .box.consumed .v{color:#b23b30;} .box.closing .v{color:#2d7a3e;}
      .foot{margin-top:22px;color:#999;font-size:11px;text-align:center;}
      @media print{ body{padding:0;} @page{margin:14mm;} }
    </style></head><body>
    <div class="hdr">
      <div><h1>${biz}</h1><div class="sub">Monthly Stock Report${branchName ? " · " + branchName : ""}</div></div>
      <div class="r"><strong>${p.label}</strong><br/>${p.startDate} → ${p.endDate}<br/>Closed by ${p.closedByName || "—"}</div>
    </div>
    <table>
      <thead><tr>
        <th>Ingredient</th><th>Unit</th><th>Opening</th><th>Purchased</th><th>Consumed</th><th>Closing</th>
        <th>Unit Cost</th><th>Consumed ${c}</th><th>Closing ${c}</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>
          <td>${r.name}</td><td>${r.unit || ""}</td>
          <td>${q(r.opening)}</td><td>${q(r.purchased)}</td><td>${q(r.consumed)}</td><td>${q(r.closing)}</td>
          <td>${money(r.unitCost)}</td><td>${money(r.consumedVal)}</td><td>${money(r.closingVal)}</td>
        </tr>`).join("")}
      </tbody>
      <tfoot><tr>
        <td colspan="7">Totals</td>
        <td>${money(p.consumedValue)}</td><td>${money(p.closingValue)}</td>
      </tr></tfoot>
    </table>
    <div class="summary">
      <div class="box"><div class="k">Opening Value</div><div class="v">${money(p.openingValue)}</div></div>
      <div class="box"><div class="k">+ Purchases</div><div class="v">${money(p.purchaseValue)}</div></div>
      <div class="box consumed"><div class="k">− Consumed (cost of goods)</div><div class="v">${money(p.consumedValue)}</div></div>
      <div class="box closing"><div class="k">= Closing Value</div><div class="v">${money(p.closingValue)}</div></div>
    </div>
    <div class="foot">Generated ${new Date().toLocaleString()} · ${rows.length} ingredient(s)</div>
    </body></html>`;

  const { close, el } = popup(`
    <div class="adm-modal" style="max-width:860px;">
      <div class="adm-mhead"><h3>📄 ${p.label} — Stock Report</h3><button class="adm-x" data-close>×</button></div>
      <div class="adm-mbody" style="padding:0;">
        <iframe id="rpt_frame" style="width:100%;height:60vh;border:none;background:#fff;"></iframe>
      </div>
      <div class="adm-mfoot">
        <button class="btn" data-close>Close</button>
        <button class="btn btn-primary" id="rpt_print">🖨 Print / Save as PDF</button>
      </div>
    </div>`);
  const frame = el.querySelector("#rpt_frame");
  frame.srcdoc = doc;
  el.querySelector("#rpt_print").onclick = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch (e) { toast("Could not open print dialog"); }
  };
}

// ── Auto month-end close toggle ────────────────────────────────
(function initAutoClose() {
  const t = document.getElementById("autoCloseToggle");
  if (!t) return;
  t.checked = (window.posSettings ? window.posSettings.autoStockClose : true) !== false;
  t.onchange = async () => {
    const res = await api("/api/stock-auto-close", { method: "PUT", json: { autoStockClose: t.checked } });
    if (!res.ok) { toast("Could not change the setting"); t.checked = !t.checked; return; }
    if (window.posSettings) window.posSettings.autoStockClose = t.checked;
    toast(t.checked ? "Auto-close on — periods will close at month-end" : "Auto-close off — close manually each month");
  };
})();

// ── Init ───────────────────────────────────────────────────────
if (staff) loadStock();

})();
