(async () => {
// order.js — Phase 4 + UI refresh: category rail, image dish tiles with
// quantity steppers, colorful order-type buttons, PLU quick-entry, search,
// Hold/Recall, ticket notes, customer lookup, live tax rates/currency.
const staff = requireLogin();
if (staff) renderNav("order", staff);

const params = new URLSearchParams(window.location.search);
let tableId = params.get("tableId") ? Number(params.get("tableId")) : null;
let tableName = params.get("tableName") || "Walk-in";
let orderType = "dine-in";
let priority = "normal";
let searchTerm = "";

// ---------- Order type + table flag ----------
// A selected table (from Floor) pins the order to Dine-in and shows a flag.
// With no table, the order type is a free choice, defaulting to the shop's
// configured default (Settings → Rates). The × on the flag frees the table —
// the order then counts as a walk-in, not a table order.
function defaultType() {
  const d = (window.posSettings && window.posSettings.defaultOrderType) || "dine-in";
  return ["dine-in", "takeaway", "delivery"].includes(d) ? d : "dine-in";
}
function renderTableFlag() {
  const flag = document.getElementById("tableFlag");
  const seg = document.getElementById("orderTypeSeg");
  if (tableId) {
    document.getElementById("tableFlagName").textContent = "🍽 " + tableName;
    flag.style.display = "inline-flex";
    // A table order is always dine-in; lock the selector to it.
    seg.querySelectorAll("button").forEach((b) => b.disabled = b.dataset.type !== "dine-in");
  } else {
    flag.style.display = "none";
    seg.querySelectorAll("button").forEach((b) => b.disabled = false);
  }
}
function setOrderType(type) {
  if (tableId && type !== "dine-in") return;   // a table order stays dine-in
  orderType = type;
  document.getElementById("orderTypeSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  // Delivery/takeaway benefit from the customer row (esp. address for delivery).
  if (type === "delivery") document.getElementById("customerRow").style.display = "flex";
}
document.querySelectorAll("#orderTypeSeg button").forEach((b) => b.onclick = () => setOrderType(b.dataset.type));
document.getElementById("tableFlagClear").onclick = () => {
  tableId = null; tableName = "Walk-in";
  renderTableFlag();
  setOrderType(defaultType());
};

let MENU = [];
let branchPaused = false;   // true when the active branch is in maintenance
let activeCategory = null;
let cart = []; // [{ menuItemId, name, basePrice, qty, modifiers:[{group,option,priceDelta}], notes, lineTotal }]

const railEl = document.getElementById("categoryRail");
const gridEl = document.getElementById("menuGrid");
const cartEl = document.getElementById("cartItems");
const sendKitchenBtn = document.getElementById("sendKitchenBtn");
const sendPayBtn = document.getElementById("sendPayBtn");

const CATEGORY_EMOJI = {
  "Main Course": "🍛", Mains: "🍛", Curries: "🍛", "Biryani & Rice": "🍚",
  Starters: "🥗", "Light Starters": "🥗", Desserts: "🍰", Beverages: "🥤",
  Drinks: "🥤", "Soft Drinks": "🥤", Mocktails: "🍹", "Cool Beverages": "🧊",
  "Tandoori Breads": "🫓", "Burgers & Wraps": "🍔",
};

function rates() {
  const s = window.posSettings || {};
  return {
    serviceChargeRate: s.serviceChargeRate ?? 0.10,
    vatRate: s.vatRate ?? 0.18,
    currency: s.currencySymbol || "$",
  };
}

function qtyInCart(menuItemId) {
  return cart.filter((c) => c.menuItemId === menuItemId).reduce((s, c) => s + c.qty, 0);
}

let CATEGORIES = [];
let CAT_COLOR  = {}; // loaded from categories table, independent of item data
let STATIONS   = []; // used to name each station's KOT

async function loadMenu() {
  // Load categories first from the categories table — so deleting a category
  // from Menu Admin doesn't remove it from order entry immediately
  const [menuRes, catRes, stRes] = await Promise.all([
    api("/api/menu"),
    api("/api/categories"),
    api("/api/stations"),
  ]);
  MENU = await menuRes.json();
  const catData = await catRes.json();
  // name -> colour, so tiles can be colour-coded by category
  CAT_COLOR = {};
  (Array.isArray(catData) ? catData : []).forEach(c => {
    if (c && c.name) CAT_COLOR[c.name] = c.color || "";
  });
  STATIONS = stRes.ok ? await stRes.json() : [];
  if (!Array.isArray(STATIONS)) STATIONS = [];

  // Use categories table order; fall back to any categories found in items
  // Use ONLY the categories table — so deleting a category from Menu Admin
  // immediately removes it from order entry. Items with that category name
  // will still appear under "All Items" but not in their own tab.
  CATEGORIES = catData.map(c => c.name).filter(name =>
    MENU.some(m => m.category === name)
  );

  activeCategory = "__all__"; // show every item by default
  renderRail(CATEGORIES);
  renderGrid();
}

// No emoji prefixes — categories display as clean text labels
function renderRail(categories) {
  railEl.innerHTML = `<button class="category-pill${activeCategory === "__all__" ? " active" : ""}" data-cat="__all__">All Items</button>` +
    categories.map((cat) => {
      const c = CAT_COLOR[cat] || "";
      const on = cat === activeCategory;
      const style = c ? (on ? `background:${c};border-color:${c};color:#fff;`
                            : `border-color:${c}66;color:${c};`) : "";
      return `<button class="category-pill${on ? " active" : ""}" data-cat="${cat}" style="${style}">${cat}</button>`;
    }).join("");
  railEl.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.onclick = () => { activeCategory = btn.dataset.cat; renderRail(categories); renderGrid(); };
  });
}

// Order sequence reset (manager + superManager only)
if (staff && (staff.role === 'manager' || staff.role === 'superManager')) {
  const resetBtn = document.getElementById("resetOrderNumBtn");
  if (resetBtn) {
    resetBtn.style.display = "";
    resetBtn.onclick = async () => {
      const seqRes = await api("/api/order-sequence");
      if (!seqRes.ok) return showToast("Could not load sequence info");
      const seq = await seqRes.json();
      const curr = seq.currentNum || 0;
      if (!confirm(`Reset order counter?\nCurrent count: ${String(curr).padStart(4,'0')}\nLast reset: ${seq.lastResetAt ? new Date(seq.lastResetAt).toLocaleString() : 'Never'}\n\nThis will log the count in reports and restart from #0001.`)) return;
      const res = await api("/api/order-sequence/reset", { method: "POST", json: {} });
      if (!res.ok) return showToast("Reset failed");
      const data = await res.json();
      showToast(`✅ Order counter reset. Was at ${String(data.resetFrom).padStart(4,'0')}, now starts from #0001`);
    };
  }
}

function renderGrid() {
  gridEl.innerHTML = "";
  let items = activeCategory === "__all__" ? MENU : MENU.filter((m) => m.category === activeCategory);
  if (searchTerm) items = items.filter((m) => m.name.toLowerCase().includes(searchTerm) || (m.plu && m.plu.includes(searchTerm)));

  if (!items.length) { gridEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No items match.</div>`; return; }

  items.forEach((item) => {
    const qty = qtyInCart(item.id);
    const tile = document.createElement("div");
    tile.className = "dish-tile" + (item.soldOut ? " sold-out" : "");
    const catCol = CAT_COLOR[item.category] || "";
    // A colour bar down the left edge shows the category at a glance
    if (catCol) tile.style.borderLeft = `4px solid ${catCol}`;
    tile.innerHTML = `
      ${item.soldOut ? `<div class="dish-tile-soldout">SOLD OUT</div>` : ""}
      ${qty > 0 ? `<div class="dish-tile-qty-badge">${qty}</div>` : ""}
      ${item.imageUrl
        ? `<div class="dish-tile-img" style="background-image:url('${item.imageUrl}');"></div>`
        : `<div class="dish-tile-img" style="background:var(--neutral-bg); display:flex; align-items:center; justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg></div>`}
      <div class="dish-tile-body">
        <div class="dish-tile-name">${item.name}</div>
        ${catCol && activeCategory === "__all__"
          ? `<div class="dish-tile-cat" style="background:${catCol}22; color:${catCol};">${item.category}</div>` : ""}
        <div class="dish-tile-price">${rates().currency}${item.price.toFixed(2)}</div>
      </div>`;
    tile.onclick = () => {
      // Items with modifier groups need a choice — open the modal.
      // Plain items add instantly (and re-clicking just bumps the qty), for speed.
      if (item.soldOut) { showToast(`${item.name} is sold out`); return; }
    if ((item.modifiers || item.modifierGroups || []).length) openItemModal(item);
      else quickAdd(item);
    };
    gridEl.appendChild(tile);
  });
}

function quickAdd(item) {
  const existing = cart.find((c) => c.menuItemId === item.id && !c.modifiers.length && !c.notes);
  if (existing) {
    existing.qty += 1;
    existing.lineTotal = +(item.price * existing.qty).toFixed(2);
  } else {
    cart.push({ menuItemId: item.id, name: item.name, basePrice: item.price, qty: 1, modifiers: [], notes: "", stationId: item.stationId || null, lineTotal: +item.price.toFixed(2) });
  }
  renderCart();
  renderGrid();
}

// ---------- Search ----------
document.getElementById("searchInput").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderGrid();
});

document.getElementById("priorityBtn").onclick = () => {
  priority = priority === "high" ? "normal" : "high";
  const btn = document.getElementById("priorityBtn");
  btn.classList.toggle("btn-danger", priority === "high");
  btn.textContent = priority === "high" ? "🔥 Priority ON" : "🔥 Priority";
};

// ---------- PLU quick entry ----------
document.getElementById("pluInput").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const code = e.target.value.trim();
  if (!code) return;
  const res = await api(`/api/menu/plu/${encodeURIComponent(code)}`);
  if (!res.ok) { showToast(`No item with PLU "${code}"`); e.target.select(); return; }
  const item = await res.json();
  quickAdd(item);
  e.target.value = "";
  showToast(`Added ${item.name}`);
});

// Wipe the customer fields after every send so the next order starts clean.
// Resets the order type back to the shop default (unless a table is pinned).
function clearCustomerFields() {
  ["custName", "custPhone", "custAddress"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const tag = document.getElementById("custHistoryTag");
  if (tag) tag.textContent = "";
  const clr = document.getElementById("custClearBtn");
  if (clr) clr.style.display = "none";
  document.getElementById("customerRow").style.display = "none";
  if (!tableId) setOrderType(defaultType());
}

// ---------- Customer lookup by phone ----------
let custLookupTimer = null;
document.getElementById("custPhone").addEventListener("input", (e) => {
  clearTimeout(custLookupTimer);
  const phone = e.target.value.trim();
  const tag = document.getElementById("custHistoryTag");
  if (phone.length < 6) { tag.textContent = ""; return; }
  custLookupTimer = setTimeout(async () => {
    const res = await api(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.customer) {
      document.getElementById("custName").value = data.customer.name || "";
      document.getElementById("custAddress").value = data.customer.address || "";
      const n = Array.isArray(data.orders) ? data.orders.length : (data.orderCount || 0);
      tag.textContent = `👋 Returning customer — ${n} recent order(s)`;
      const clr = document.getElementById("custClearBtn");
      if (clr) clr.style.display = "";
    } else {
      tag.textContent = "New customer";
    }
  }, 400);
});

// ---------- Customer search / add modal ----------
// A customer is always OPTIONAL. This button lets staff attach one to any order
// (dine-in or takeaway) by searching the directory, or adding a new one on the
// spot. The hidden custName/custPhone/custAddress fields carry the details into
// the order payload, so the rest of sendOrder() is unchanged.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function revealCustomerRow() {
  document.getElementById("customerRow").style.display = "flex";
}

function attachCustomer(c) {
  document.getElementById("custName").value = c.name || "";
  document.getElementById("custPhone").value = c.phone || "";
  document.getElementById("custAddress").value = c.address || "";
  const tag = document.getElementById("custHistoryTag");
  if (tag) tag.textContent = c.phone ? `👤 ${c.name || c.phone} attached` : "";
  const clr = document.getElementById("custClearBtn");
  if (clr) clr.style.display = "";
  revealCustomerRow();
}

const custClearBtn = document.getElementById("custClearBtn");
if (custClearBtn) custClearBtn.onclick = () => {
  ["custName", "custPhone", "custAddress"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("custHistoryTag").textContent = "";
  custClearBtn.style.display = "none";
  document.getElementById("customerRow").style.display = "none";
};

document.getElementById("custLookupBtn").onclick = () => {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:440px;">
      <h3 style="margin-top:0;">Attach Customer</h3>
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <input id="cuSearch" placeholder="🔍 Search by name or phone…" style="flex:1;" autofocus />
        <button class="btn btn-primary" id="cuAddNew" style="white-space:nowrap;">+ New</button>
      </div>
      <div id="cuResults" style="display:flex; flex-direction:column; gap:6px; max-height:46vh; overflow-y:auto;"></div>
      <button class="btn" id="cuClose" style="width:100%; margin-top:14px;">Cancel</button>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#cuClose").onclick = close;

  const resultsEl = backdrop.querySelector("#cuResults");
  const searchEl = backdrop.querySelector("#cuSearch");

  async function runSearch(term) {
    const res = await api("/api/customers" + (term ? `?search=${encodeURIComponent(term)}` : ""));
    const list = res.ok ? await res.json() : [];
    if (!list.length) {
      resultsEl.innerHTML = `<div class="empty-state" style="padding:14px;">No matching customers. Use <strong>+ New</strong> to add one.</div>`;
      return;
    }
    resultsEl.innerHTML = list.map((c) => `
      <div data-pick="${c.id}" style="padding:10px 12px; border:1px solid var(--border); border-radius:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
        <span><strong>${esc(c.name) || "(no name)"}</strong> <span class="mono" style="color:var(--muted); font-size:12px;">${esc(c.phone)}</span></span>
        <span class="btn btn-sm btn-primary">Attach</span>
      </div>`).join("");
    resultsEl.querySelectorAll("[data-pick]").forEach((row) => {
      row.onclick = () => {
        const c = list.find((x) => x.id == row.dataset.pick);
        attachCustomer(c);
        close();
        showToast(`Customer ${c.name || c.phone} attached`);
      };
    });
  }

  function showAddForm(prefillPhone) {
    resultsEl.innerHTML = `
      <div class="f"><label>Phone * (unique key)</label><input id="cuPhone" value="${esc(prefillPhone || "")}" placeholder="e.g. 0771234567"/></div>
      <div class="f"><label>Name</label><input id="cuName" placeholder="Customer name"/></div>
      <div class="f"><label>Address</label><input id="cuAddr" placeholder="Delivery address (optional)"/></div>
      <button class="btn btn-primary" id="cuSave" style="width:100%; margin-top:8px;">Add & Attach</button>`;
    resultsEl.querySelector("#cuSave").onclick = async () => {
      const phone = resultsEl.querySelector("#cuPhone").value.trim();
      const name = resultsEl.querySelector("#cuName").value.trim();
      const address = resultsEl.querySelector("#cuAddr").value.trim();
      if (!phone) return showToast("Phone number is required");
      const res = await api("/api/customers", { method: "POST", json: { phone, name, address } });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(r.error || "Could not save customer");
      attachCustomer(r);
      close();
      showToast(`Customer ${r.name || r.phone} added & attached`);
    };
    if (prefillPhone) resultsEl.querySelector("#cuName").focus();
  }

  backdrop.querySelector("#cuAddNew").onclick = () => {
    const term = searchEl.value.trim();
    // If they typed digits, prefill as the phone for the new customer.
    showAddForm(/^\+?\d[\d\s-]*$/.test(term) ? term : "");
  };

  let t = null;
  searchEl.addEventListener("input", (e) => { clearTimeout(t); const v = e.target.value.trim(); t = setTimeout(() => runSearch(v), 220); });
  searchEl.focus();
  runSearch("");
};

// ---------- Modifier / notes modal ----------
// Supports single-select (radio) and multi-select (checkbox) groups, with
// required / min / max rules. The server re-validates and re-prices on send,
// so this is for UX — it never sets the price the customer is charged.
function openItemModal(item) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const groups = (item.modifiers || item.modifierGroups || []).map((g) => {
    const max = Math.max(1, parseInt(g.max, 10) || 1);
    const min = g.required ? Math.max(1, parseInt(g.min, 10) || 1) : Math.max(0, parseInt(g.min, 10) || 0);
    const options = (g.options || []).map((o) => ({ name: o.name || o.option, priceDelta: Number(o.priceDelta) || 0 }));
    return { name: g.name, min, max, required: min >= 1, multi: max > 1, options };
  });
  const cur = rates().currency;

  const groupsHtml = groups.map((g, gi) => {
    const rule = g.multi
      ? `pick ${g.min}–${g.max}`
      : (g.required ? "required" : "optional");
    const optHtml = g.options.map((o, oi) => `
      <label style="display:flex; align-items:center; gap:8px; font-size:14px; padding:5px 0;">
        <input type="${g.multi ? "checkbox" : "radio"}" name="group${gi}" value="${oi}"
          ${!g.multi && g.required && oi === 0 ? "checked" : ""} data-gi="${gi}" />
        <span style="flex:1;">${o.name}</span>
        ${o.priceDelta ? `<span class="mono" style="color:var(--accent); font-size:12px;">+${cur}${o.priceDelta.toFixed(2)}</span>` : ""}
      </label>`).join("");
    return `
      <div style="margin-bottom:12px;" data-group="${gi}">
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <div style="font-size:13px; font-weight:700;">${g.name}</div>
          <div style="font-size:11px; color:${g.required ? "var(--danger)" : "var(--muted)"};">${rule}</div>
        </div>
        ${optHtml}
      </div>`;
  }).join("");

  backdrop.innerHTML = `
    <div class="modal" style="max-height:88vh; overflow-y:auto;">
      <h3 style="margin-top:0;">${item.name}</h3>
      ${groupsHtml}
      <div style="margin-bottom:10px;">
        <div style="font-size:13px; font-weight:600; margin-bottom:4px;">Special request</div>
        <textarea id="modalNotes" placeholder="e.g. no onions, allergy note..." style="width:100%; padding:8px; border:1px solid var(--border); border-radius:6px; font-family:inherit; font-size:13px;" rows="2"></textarea>
      </div>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <span style="font-size:13px; font-weight:600;">Qty</span>
        <button class="btn" id="qtyDec" style="padding:2px 10px;">−</button>
        <span id="qtyVal" class="mono">1</span>
        <button class="btn" id="qtyInc" style="padding:2px 10px;">+</button>
      </div>
      <div id="modalErr" style="font-size:12px; color:var(--danger); min-height:16px; margin-bottom:6px;"></div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="modalCancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="modalAdd" style="flex:1;">Add to Order</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  // Enforce each multi-select group's max as the user ticks boxes.
  groups.forEach((g, gi) => {
    if (!g.multi) return;
    backdrop.querySelectorAll(`input[name="group${gi}"]`).forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = backdrop.querySelectorAll(`input[name="group${gi}"]:checked`);
        if (checked.length > g.max) { cb.checked = false; backdrop.querySelector("#modalErr").textContent = `Choose at most ${g.max} from ${g.name}`; }
        else backdrop.querySelector("#modalErr").textContent = "";
      });
    });
  });

  let qty = 1;
  backdrop.querySelector("#qtyDec").onclick = () => { qty = Math.max(1, qty - 1); backdrop.querySelector("#qtyVal").textContent = qty; };
  backdrop.querySelector("#qtyInc").onclick = () => { qty++; backdrop.querySelector("#qtyVal").textContent = qty; };
  backdrop.querySelector("#modalCancel").onclick = () => backdrop.remove();
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

  backdrop.querySelector("#modalAdd").onclick = () => {
    const modifiers = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const picked = Array.from(backdrop.querySelectorAll(`input[name="group${gi}"]:checked`));
      if (picked.length < g.min) { backdrop.querySelector("#modalErr").textContent = `Choose at least ${g.min} from ${g.name}`; return; }
      if (picked.length > g.max) { backdrop.querySelector("#modalErr").textContent = `Choose at most ${g.max} from ${g.name}`; return; }
      picked.forEach((p) => { const o = g.options[Number(p.value)]; modifiers.push({ group: g.name, option: o.name, priceDelta: o.priceDelta }); });
    }
    const notes = backdrop.querySelector("#modalNotes").value.trim();
    const modTotal = modifiers.reduce((s, m) => s + m.priceDelta, 0);
    cart.push({ menuItemId: item.id, name: item.name, basePrice: item.price, qty, modifiers, notes, stationId: item.stationId || null, lineTotal: +((item.price + modTotal) * qty).toFixed(2) });
    backdrop.remove();
    renderCart();
    renderGrid();
  };
}

function changeLineQty(index, delta) {
  const line = cart[index];
  line.qty += delta;
  if (line.qty <= 0) { cart.splice(index, 1); }
  else {
    const modTotal = line.modifiers.reduce((s, m) => s + (m.priceDelta || 0), 0);
    line.lineTotal = +((line.basePrice + modTotal) * line.qty).toFixed(2);
  }
  renderCart();
  renderGrid();
}

function renderCart() {
  const { currency, serviceChargeRate, vatRate } = rates();
  cartEl.innerHTML = "";
  if (cart.length === 0) {
    cartEl.innerHTML = `<div class="empty-state">No items yet — tap a dish or enter a PLU code.</div>`;
  } else {
    cart.forEach((c, idx) => {
      const modText = c.modifiers.map((m) => m.option).join(", ");
      const row = document.createElement("div");
      row.style = "padding:10px 0; border-bottom:1px solid var(--border-soft); font-size:14px;";
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <span style="flex:1;">${c.name}</span>
          <span class="mono" style="color:var(--accent); font-weight:600;">${currency}${c.lineTotal.toFixed(2)}</span>
        </div>
        ${modText ? `<div style="font-size:12px; color:var(--muted);">${modText}</div>` : ""}
        ${c.notes ? `<div style="font-size:12px; color:var(--danger);">note: ${c.notes}</div>` : ""}
        <div class="qty-stepper" style="margin-top:6px;">
          <button data-dec>−</button>
          <span>${c.qty}</span>
          <button data-inc>+</button>
        </div>
      `;
      row.querySelector("[data-dec]").onclick = () => changeLineQty(idx, -1);
      row.querySelector("[data-inc]").onclick = () => changeLineQty(idx, 1);
      cartEl.appendChild(row);
    });
  }

  document.getElementById("scLabel").textContent = `Service Charge (${(serviceChargeRate * 100).toFixed(0)}%)`;
  document.getElementById("vatLabel").textContent = `VAT (${(vatRate * 100).toFixed(0)}%)`;

  const subtotal = cart.reduce((sum, c) => sum + c.lineTotal, 0);
  // Promo preview (fetched from the server; mirrors how the order will price).
  const promoAmt = (currentPromo && currentPromo.amount) ? Math.min(currentPromo.amount, subtotal) : 0;
  const promoLine = document.getElementById("promoLine");
  if (promoLine) {
    if (promoAmt > 0) {
      promoLine.style.display = "flex";
      document.getElementById("promoLineLabel").textContent = `Promo (${currentPromo.name})`;
      document.getElementById("promoLineAmt").textContent = `-${currency}${promoAmt.toFixed(2)}`;
    } else { promoLine.style.display = "none"; }
  }
  const taxable = Math.max(0, subtotal - promoAmt);
  const serviceCharge = taxable * serviceChargeRate;
  const vat = (taxable + serviceCharge) * vatRate;
  const total = taxable + serviceCharge + vat;
  document.getElementById("subtotal").textContent = `${currency}${subtotal.toFixed(2)}`;
  document.getElementById("serviceCharge").textContent = `${currency}${serviceCharge.toFixed(2)}`;
  document.getElementById("vat").textContent = `${currency}${vat.toFixed(2)}`;
  document.getElementById("total").textContent = `${currency}${total.toFixed(2)}`;
  const blocked = cart.length === 0 || branchPaused;
  sendKitchenBtn.disabled = blocked;
  sendPayBtn.disabled = blocked;
  schedulePromoPreview();
}

// ---------- Promotion preview ----------
// Ask the server which promotion (if any) this cart earns, so the ticket shows
// the deal before it's sent. Debounced; the server is the source of truth.
let currentPromo = null;
let _promoTimer = null;
let _promoKey = "";
function schedulePromoPreview() {
  const key = JSON.stringify(cart.map((c) => [c.menuItemId, c.qty, c.lineTotal]));
  if (key === _promoKey) return;   // cart unchanged since last preview
  _promoKey = key;
  clearTimeout(_promoTimer);
  if (!cart.length) { if (currentPromo) { currentPromo = null; } return; }
  _promoTimer = setTimeout(async () => {
    try {
      const res = await api("/api/promotions/preview", { method: "POST", json: { items: cart.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty, lineTotal: c.lineTotal })) } });
      if (!res.ok) return;
      const data = await res.json();
      const next = data.promo || null;
      const changed = JSON.stringify(next) !== JSON.stringify(currentPromo);
      currentPromo = next;
      if (changed) renderTotalsOnly();
    } catch (_) {}
  }, 250);
}
// Re-render just the totals (avoids a renderCart → preview loop).
function renderTotalsOnly() {
  const { currency, serviceChargeRate, vatRate } = rates();
  const subtotal = cart.reduce((sum, c) => sum + c.lineTotal, 0);
  const promoAmt = (currentPromo && currentPromo.amount) ? Math.min(currentPromo.amount, subtotal) : 0;
  const promoLine = document.getElementById("promoLine");
  if (promoLine) {
    if (promoAmt > 0) {
      promoLine.style.display = "flex";
      document.getElementById("promoLineLabel").textContent = `Promo (${currentPromo.name})`;
      document.getElementById("promoLineAmt").textContent = `-${currency}${promoAmt.toFixed(2)}`;
    } else { promoLine.style.display = "none"; }
  }
  const taxable = Math.max(0, subtotal - promoAmt);
  const serviceCharge = taxable * serviceChargeRate;
  const vat = (taxable + serviceCharge) * vatRate;
  document.getElementById("serviceCharge").textContent = `${currency}${serviceCharge.toFixed(2)}`;
  document.getElementById("vat").textContent = `${currency}${vat.toFixed(2)}`;
  document.getElementById("total").textContent = `${currency}${(taxable + serviceCharge + vat).toFixed(2)}`;
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

// ---------- KOT auto-print toggle ----------
// KOT paper-printing is OFF by default: every order already appears live on the
// Kitchen screen, and browser printing pops a print dialog that drops the till
// out of full-screen. Venues with a real station printer can turn it on here.
function kotOn() { return localStorage.getItem("posAutoKot") === "on"; }
(function initKotToggle() {
  const btn = document.getElementById("kotToggleBtn");
  if (!btn) return;
  const sync = () => {
    const on = kotOn();
    btn.textContent = on ? "🖨️ KOT: On" : "🖨️ KOT: Off";
    btn.title = on
      ? "Printing a paper KOT on send. Note: the print dialog exits full-screen."
      : "Paper KOT printing is off — orders still go to the Kitchen screen.";
    btn.classList.toggle("btn-primary", on);
  };
  btn.onclick = () => {
    const turningOn = !kotOn();
    localStorage.setItem("posAutoKot", turningOn ? "on" : "off");
    sync();
    if (turningOn) showToast("Paper KOT printing on — note: the print dialog exits full-screen");
  };
  sync();
})();

// ---------- Station KOT printing ----------
// Each station has its own KOT printer. After an order is sent we print one
// KOT per station that actually has items — a station with nothing to cook
// never gets a ticket.
//
// We render into hidden iframes rather than opening pop-up windows: browsers
// block any pop-up opened after an await or on a timer, which is why only the
// first station's ticket used to appear. Iframes are never blocked.
function kotHtml(order, stationName, lines) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const placedAt  = new Date(order.createdAt || Date.now());
  const typeLabel = order.orderType && order.orderType !== "dine-in"
    ? order.orderType.toUpperCase() : "DINE-IN";
  const totalQty  = lines.reduce((n, i) => n + Number(i.qty || 0), 0);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT</title><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:"Courier New",Courier,monospace; font-size:13px; line-height:1.5; padding:6mm; }
    .station { text-align:center; font-size:20px; font-weight:700; letter-spacing:2px;
               text-transform:uppercase; border:2px solid #000; padding:6px 4px; margin-bottom:10px; }
    .head { text-align:center; margin-bottom:8px; }
    .ordernum { font-size:22px; font-weight:700; letter-spacing:1px; }
    .meta { font-size:11px; color:#555; margin-top:2px; }
    .dashed { border:none; border-top:1px dashed #999; margin:8px 0; }
    .priority { text-align:center; font-weight:700; font-size:14px; border:2px solid #000;
                padding:4px; margin-bottom:8px; }
    .line { margin-bottom:10px; }
    .line-main { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
    .qty { font-size:20px; font-weight:700; min-width:40px; }
    .name { flex:1; font-size:15px; font-weight:700; text-transform:uppercase; }
    .mods { font-size:12px; padding-left:40px; }
    .note { font-size:12px; padding-left:40px; font-weight:700; }
    .foot { text-align:center; font-size:11px; color:#555; margin-top:8px; }
    @page { margin:6mm; }
  </style></head><body>
    <div class="station">${esc(stationName)}</div>
    <div class="head">
      <div class="ordernum">${esc(order.displayNum || "#" + order.id)}</div>
      <div class="meta">${esc(order.tableName || "")} · ${esc(typeLabel)}</div>
      ${order.customerName ? `<div class="meta">Customer: ${esc(order.customerName)}</div>` : ""}
      <div class="meta">${placedAt.toLocaleString()}</div>
      <div class="meta">Server: ${esc(order.staffName || "—")}</div>
    </div>
    ${order.priority === "high" ? `<div class="priority">*** PRIORITY ***</div>` : ""}
    <hr class="dashed" />
    ${lines.map((it) => `
      <div class="line">
        <div class="line-main">
          <span class="qty">${esc(it.qty)}×</span>
          <span class="name">${esc(it.name)}</span>
        </div>
        ${(it.modifiers && it.modifiers.length)
          ? `<div class="mods">+ ${it.modifiers.map((m) => esc(m.option || m.name)).join(", ")}</div>` : ""}
        ${it.notes ? `<div class="note">** ${esc(it.notes)} **</div>` : ""}
      </div>`).join("")}
    <hr class="dashed" />
    ${order.note ? `<div class="note" style="padding-left:0;">Order note: ${esc(order.note)}</div><hr class="dashed" />` : ""}
    <div class="foot">${totalQty} item(s) · ${esc(stationName)} KOT</div>
  </body></html>`;
}

// Print one KOT and resolve once its print dialog has been dismissed.
function printKotFrame(html) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(frame);

    const cleanup = () => { frame.remove(); resolve(); };

    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        // Fires after the dialog closes in Chrome/Edge; the timeout below is a
        // safety net for browsers that don't fire it.
        win.onafterprint = cleanup;
        win.focus();
        win.print();
        setTimeout(cleanup, 60000);
      } catch (_) { cleanup(); }
    };

    frame.srcdoc = html;
  });
}

async function printStationKots(order) {
  if (!kotOn()) return;   // off by default; see initKotToggle
  const printerSettings = window.posSettings || {};
  // If direct printing is enabled, an unassigned kitchen printer means no printing at all.
  // Do not fall back to the browser/default printer, which can send KOTs to the wrong device.
  if (printerSettings.printAgentEnabled && !String(printerSettings.kitchenPrinterName || "").trim()) return;
  const items = order.items || [];
  if (!items.length) return;

  // Group line items by station. Items with no station get their own ticket so
  // nothing is silently lost.
  const byStation = new Map();
  items.forEach((it) => {
    const key = (it.stationId === null || it.stationId === undefined) ? "unassigned" : String(it.stationId);
    if (!byStation.has(key)) byStation.set(key, []);
    byStation.get(key).push(it);
  });

  const stationName = (key) => {
    if (key === "unassigned") return "Unassigned";
    const st = STATIONS.find((s) => String(s.id) === String(key));
    return st ? st.name : "Station " + key;
  };

  showToast(`Printing ${byStation.size} KOT(s)…`);

  // If a thermal print agent is configured, send plain-text tickets straight
  // to it — no browser dialog, so the till stays in full-screen. Otherwise
  // fall back to the hidden-iframe window.print() path.
  if (typeof posPrintAgentReady === "function" && posPrintAgentReady()) {
    let okAll = true;
    for (const [key, lines] of byStation) {
      const ok = await posSendToAgent({ type: "kot", title: stationName(key), text: posKotText(order, stationName(key), lines), copies: 1 });
      if (!ok) okAll = false;
    }
    if (okAll) return;             // all sent to the printer
    showToast("Print agent unreachable — using browser print");
  }

  // One print job at a time — fire them together and the browser merges or
  // drops all but the last.
  for (const [key, lines] of byStation) {
    await printKotFrame(kotHtml(order, stationName(key), lines));
  }
}

// Send the current cart to the kitchen. When `thenPay` is true, jump to the
// Payment screen for this exact order; otherwise stay here for the next ticket.
let _sending = false;
async function sendOrder(thenPay) {
  if (_sending || !cart.length) return;
  _sending = true;
  sendKitchenBtn.disabled = sendPayBtn.disabled = true;
  try {
    const note = document.getElementById("ticketNote").value.trim();
    // A table order carries the table; any walk-in (takeaway/delivery/dine-in
    // with no table) is sent untethered with a label matching its type.
    const walkInLabel = { takeaway: "Takeaway", delivery: "Delivery", "dine-in": "Walk-in" }[orderType] || "Walk-in";
    const payload = {
      tableId: tableId || null,
      items: cart,
      orderType,
      note,
      tableNameOverride: tableId ? tableName : walkInLabel,
      priority,
      customerPhone:   document.getElementById("custPhone").value.trim(),
      customerName:    document.getElementById("custName").value.trim(),
      customerAddress: document.getElementById("custAddress").value.trim(),
    };
    const res = await api("/api/orders", { method: "POST", json: payload });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to send order");
      return;
    }
    const order = await res.json();
    printStationKots(order);   // no-op unless paper KOT is enabled

    // Clear the ticket so the next order starts clean
    cart = [];
    document.getElementById("ticketNote").value = "";
    priority = "normal";
    document.getElementById("priorityBtn").classList.remove("btn-danger");
    document.getElementById("priorityBtn").textContent = "🔥 Priority";
    clearCustomerFields();
    renderCart();
    renderGrid();

    if (thenPay) {
      showToast(`${(order.displayNum || orderNum(order.id))} sent — opening payment…`);
      const go = `payment?orderId=${order.id}`;
      if (typeof spaNavigate === "function") spaNavigate(go);
      else window.location.href = go;
    } else {
      showToast(`${(order.displayNum || orderNum(order.id))} sent to kitchen — ${rates().currency}${order.total.toFixed(2)}`);
    }
  } finally {
    _sending = false;
    renderCart();   // re-evaluates the disabled state
  }
}

sendKitchenBtn.onclick = () => sendOrder(false);
sendPayBtn.onclick     = () => sendOrder(true);

// ---------- Hold / Recall ----------
document.getElementById("holdBtn").onclick = async () => {
  if (!cart.length) return showToast("Nothing to hold yet");
  const label = prompt("Label this held order (e.g. 'Table 4 — waiting on drinks'):", tableName) || tableName;
  await api("/api/held-orders", {
    method: "POST",
    json: {
      label, orderType, tableId, tableName, priority,
      customerName: document.getElementById("custName").value.trim(),
      customerPhone: document.getElementById("custPhone").value.trim(),
      customerAddress: document.getElementById("custAddress").value.trim(),
      items: cart, note: document.getElementById("ticketNote").value.trim(),
    },
  });
  cart = [];
  document.getElementById("ticketNote").value = "";
  priority = "normal";
  document.getElementById("priorityBtn").classList.remove("btn-danger");
  document.getElementById("priorityBtn").textContent = "🔥 Priority";
  clearCustomerFields();   // held order keeps its own copy of these
  renderCart();
  renderGrid();
  showToast("Order held — recall it anytime from this screen");
};

document.getElementById("recallBtn").onclick = async () => {
  const res = await api("/api/held-orders");
  const held = await res.json();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:420px;">
      <h3 style="margin-top:0;">Recall Held Order</h3>
      <div id="heldList" style="display:flex; flex-direction:column; gap:8px; max-height:50vh; overflow-y:auto;">
        ${held.length ? held.map((h) => `
          <div class="card" style="padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${h.priority === "high" ? "🔥 " : ""}${h.label}</strong>
              <div style="font-size:11px; color:var(--muted);">${h.items.length} item(s) · held by ${h.staffName} · ${new Date(h.heldAt).toLocaleTimeString()}</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-primary" data-recall="${h.id}" style="font-size:12px; padding:6px 10px;">Recall</button>
              <button class="btn btn-danger" data-discard="${h.id}" style="font-size:12px; padding:6px 10px;">Discard</button>
            </div>
          </div>`).join("") : `<div class="empty-state">No held orders right now.</div>`}
      </div>
      <button class="btn" id="recallCancel" style="width:100%; margin-top:14px;">Close</button>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#recallCancel").onclick = () => backdrop.remove();

  backdrop.querySelectorAll("[data-recall]").forEach((btn) => {
    btn.onclick = () => {
      const h = held.find((x) => x.id === Number(btn.dataset.recall));
      cart = h.items;
      tableId = h.tableId || null;
      tableName = h.tableName || "Walk-in";
      document.getElementById("ticketNote").value = h.note || "";
      priority = h.priority === "high" ? "high" : "normal";
      document.getElementById("priorityBtn").classList.toggle("btn-danger", priority === "high");
      document.getElementById("priorityBtn").textContent = priority === "high" ? "🔥 Priority ON" : "🔥 Priority";
      // Restore the order type + table flag from the held order
      renderTableFlag();
      setOrderType(h.orderType || defaultType());
      document.getElementById("custPhone").value = h.customerPhone || "";
      document.getElementById("custName").value = h.customerName || "";
      document.getElementById("custAddress").value = h.customerAddress || "";
      // Re-open the customer row (with Clear) if this held order had a customer
      if (h.customerPhone || h.customerName || h.customerAddress) {
        document.getElementById("customerRow").style.display = "flex";
        const clr = document.getElementById("custClearBtn"); if (clr) clr.style.display = "";
      }
      api(`/api/held-orders/${h.id}`, { method: "DELETE" });
      renderCart();
      renderGrid();
      backdrop.remove();
      showToast(`Recalled "${h.label}"`);
    };
  });
  backdrop.querySelectorAll("[data-discard]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/held-orders/${btn.dataset.discard}`, { method: "DELETE" });
      backdrop.remove();
      document.getElementById("recallBtn").click();
    };
  });
};

// ---------- Mid-sale Stock / Price Check (Phase 5) ----------
// Lets a server confirm price/availability before ringing it in, without
// building a cart entry — answers "will this run out?" before it's a problem.
document.getElementById("stockCheckBtn").onclick = () => {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:420px;">
      <h3 style="margin-top:0;">Stock / Price Check</h3>
      <input id="stockCheckSearch" placeholder="🔍 Type a dish name..." style="width:100%; margin-bottom:10px;" />
      <div id="stockCheckResults" style="display:flex; flex-direction:column; gap:6px; max-height:50vh; overflow-y:auto;"></div>
      <button class="btn" id="stockCheckClose" style="width:100%; margin-top:14px;">Close</button>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#stockCheckClose").onclick = () => backdrop.remove();

  const resultsEl = backdrop.querySelector("#stockCheckResults");
  const searchEl = backdrop.querySelector("#stockCheckSearch");

  async function runSearch(term) {
    const matches = MENU.filter((m) => m.name.toLowerCase().includes(term.toLowerCase())).slice(0, 8);
    if (!matches.length) { resultsEl.innerHTML = `<div class="empty-state">No matches.</div>`; return; }
    resultsEl.innerHTML = matches.map((m) => `<div data-row="${m.id}" style="padding:10px 12px; border:1px solid var(--border); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
      <span>${m.name}</span><span class="mono" style="color:var(--muted); font-size:12px;">checking...</span>
    </div>`).join("");
    for (const m of matches) {
      const res = await api(`/api/menu/${m.id}/stock-check`);
      const check = await res.json();
      const row = resultsEl.querySelector(`[data-row="${m.id}"]`);
      if (!row) continue;
      let statusHtml;
      if (!check.tracked) {
        statusHtml = `<span class="badge badge-open">no recipe tracked</span>`;
      } else if (check.maxPortions === null) {
        statusHtml = `<span class="badge badge-open">in stock</span>`;
      } else if (check.maxPortions <= 0) {
        statusHtml = `<span class="badge badge-dirty">out of stock</span>`;
      } else if (check.maxPortions <= 5) {
        statusHtml = `<span class="badge badge-ready">only ${check.maxPortions} left (${check.limitingIngredient})</span>`;
      } else {
        statusHtml = `<span class="badge badge-open">${check.maxPortions} available</span>`;
      }
      row.innerHTML = `<span>${m.name} <span class="mono" style="color:var(--accent); font-weight:600;">${rates().currency}${check.price.toFixed(2)}</span></span>${statusHtml}`;
    }
  }

  searchEl.addEventListener("input", (e) => runSearch(e.target.value));
  searchEl.focus();
};

// ---------- Keyboard control ----------
// Lets the whole order be built and sent without a mouse. A persistent
// document listener is used (menu tiles are re-rendered constantly), and it
// removes itself once this screen is gone (SPA navigation).
function visibleTiles() { return Array.from(gridEl.querySelectorAll(".dish-tile")); }
function bumpLastLine(delta) {
  if (!cart.length) return;
  changeLineQty(cart.length - 1, delta);
}

function showShortcutHelp() {
  if (document.getElementById("kbHelpModal")) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "kbHelpModal";
  const row = (k, d) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--border-soft);font-size:13px;">
      <span style="color:var(--muted);">${d}</span><kbd style="font-family:'JetBrains Mono',monospace;font-size:12px;background:var(--neutral-bg);border:1px solid var(--border);border-radius:6px;padding:2px 7px;white-space:nowrap;">${k}</kbd></div>`;
  backdrop.innerHTML = `
    <div class="modal" style="width:420px;">
      <h3 style="margin-top:0;">⌨ Keyboard shortcuts</h3>
      ${row("/", "Focus menu search")}
      ${row("P", "Focus PLU entry")}
      ${row("Enter", "In search: add the first result")}
      ${row("1 – 9", "Add the Nth item in the grid")}
      ${row("+ / −", "Change quantity of the last line")}
      ${row("Backspace", "Remove the last line")}
      ${row("T", "Toggle takeaway")}
      ${row("H", "Hold the order")}
      ${row("F2", "Send to Kitchen (stay here)")}
      ${row("F4  /  Ctrl+Enter", "Send &amp; Pay (go to Payment)")}
      ${row("Esc", "Clear search / close a dialog")}
      ${row("?", "Show this help")}
      <button class="btn btn-primary" id="kbHelpClose" style="width:100%;margin-top:16px;">Got it</button>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#kbHelpClose").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
}
const kbHelpBtn = document.getElementById("kbHelpBtn");
if (kbHelpBtn) kbHelpBtn.onclick = showShortcutHelp;

function onOrderKey(e) {
  // Self-remove once this screen is replaced by SPA navigation.
  if (!document.body.contains(sendPayBtn)) {
    document.removeEventListener("keydown", onOrderKey);
    if (window._orderKeyHandler === onOrderKey) window._orderKeyHandler = null;
    return;
  }

  const ae = document.activeElement;
  const tag = ae && ae.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  const modalOpen = !!document.querySelector(".modal-backdrop");

  // ── Always available (even while typing) ──
  if ((e.key === "Enter" && (e.ctrlKey || e.metaKey)) || e.key === "F4") {
    e.preventDefault(); sendOrder(true); return;
  }
  if (e.key === "F2") { e.preventDefault(); sendOrder(false); return; }
  if (e.key === "Escape") {
    if (modalOpen) return;  // let the modal's own handler/overlay deal with it
    const search = document.getElementById("searchInput");
    if (ae === search && search.value) { search.value = ""; searchTerm = ""; renderGrid(); }
    else if (typing) ae.blur();
    return;
  }

  if (modalOpen) return;

  // Enter inside the search box adds the first matching tile (fast ringing-in).
  if (e.key === "Enter" && ae && ae.id === "searchInput") {
    const first = visibleTiles()[0];
    if (first) { e.preventDefault(); first.click(); ae.value = ""; searchTerm = ""; renderGrid(); ae.focus(); }
    return;
  }

  if (typing) return;  // the rest are single-key, only when not in a field

  switch (e.key) {
    case "/": e.preventDefault(); document.getElementById("searchInput").focus(); break;
    case "p": case "P": e.preventDefault(); document.getElementById("pluInput").focus(); break;
    case "t": case "T": {   // cycle order type (skips when a table is pinned)
      if (!tableId) { const order = ["dine-in", "takeaway", "delivery"]; setOrderType(order[(order.indexOf(orderType) + 1) % 3]); }
      break;
    }
    case "h": case "H": document.getElementById("holdBtn").click(); break;
    case "+": case "=": bumpLastLine(1); break;
    case "-": case "_": bumpLastLine(-1); break;
    case "Backspace": case "Delete": e.preventDefault(); bumpLastLine(-9999); break;
    case "?": showShortcutHelp(); break;
    default:
      if (/^[1-9]$/.test(e.key)) {
        const tile = visibleTiles()[Number(e.key) - 1];
        if (tile) tile.click();
      }
  }
}
if (window._orderKeyHandler) document.removeEventListener("keydown", window._orderKeyHandler);
window._orderKeyHandler = onOrderKey;
document.addEventListener("keydown", onOrderKey);

// If the current branch is in maintenance, make it obvious and stop new orders
// here too (the server also refuses them).
async function checkBranchMaintenance() {
  try {
    const activeId = staff.role === "superManager"
      ? Number(localStorage.getItem("posActiveBranchId") || 0)
      : (staff.branch && staff.branch.id);
    if (!activeId) return;
    const res = await api("/api/branches");
    if (!res.ok) return;
    const branches = await res.json();
    const b = branches.find((x) => Number(x.id) === Number(activeId));
    if (b && b.status !== "active") {
      branchPaused = true;
      renderCart();
      sendKitchenBtn.title = sendPayBtn.title = "Branch is in maintenance — ordering is paused";
      const host = document.querySelector(".page-body--fullscreen");
      if (host && !document.getElementById("maintBanner")) {
        const bar = document.createElement("div");
        bar.id = "maintBanner";
        bar.style.cssText = "flex-shrink:0;background:var(--warning-bg);color:var(--warning);padding:10px 20px;font-size:13px;font-weight:600;text-align:center;border-bottom:1px solid var(--border);";
        bar.innerHTML = `🛠️ <strong>${b.name}</strong> is in maintenance mode — new orders are paused. Re-activate it under Branches to resume.`;
        host.insertBefore(bar, host.firstChild);
      }
    }
  } catch (_) {}
}

// Initialise the order type + table flag once settings (the default type)
// are available. A table from Floor pins Dine-in; otherwise use the default.
async function initOrderType() {
  try { if (!window.posSettings && typeof window.posInitSettings === "function") await window.posInitSettings(); } catch (_) {}
  renderTableFlag();
  setOrderType(tableId ? "dine-in" : defaultType());
}

if (staff) {
  if (!blockIfNoBranchSelected(staff, gridEl)) {
    initOrderType();
    loadMenu();
    renderCart();
    checkBranchMaintenance();
  }
}

})();
