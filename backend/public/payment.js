(async () => {
// payment.js
const staff = requireLogin();
if (staff) renderNav("payment", staff);

document.getElementById("lastReceiptBtn").onclick = async () => {
  const res = await api("/api/orders/last-receipt");
  if (!res.ok) { showToast("No paid orders yet for this branch."); return; }
  const order = await res.json();
  window.location.href = `receipt?orderId=${order.id}`;
};

// ---------- Check Order Status — quick lookup by order number for the
// classic "is my order ready?" customer question, without hunting through
// the unpaid-orders list (which won't show already-paid orders at all). ----------
async function checkOrderStatus() {
  const input = document.getElementById("orderLookupInput");
  const resultEl = document.getElementById("orderLookupResult");
  const id = input.value.trim();
  if (!id) { resultEl.innerHTML = ""; return; }

  const res = await api(`/api/orders/${id}`);
  if (!res.ok) {
    resultEl.innerHTML = `<div class="empty-state" style="padding:10px;">No order #${id} found for this branch.</div>`;
    return;
  }
  const o = await res.json();
  const statusColor = o.status === "ready" || o.status === "dispatched" ? "var(--success)" : o.status === "preparing" ? "var(--warning)" : "var(--muted)";
  const statusText = o.status === "ready" ? "✅ Ready — head to the kitchen pass / can be served now" : o.status === "dispatched" ? "🛵 Dispatched" : o.status === "preparing" ? "🔥 Still being prepared" : o.status === "voided" ? "❌ Voided" : "⏳ Not started yet";
  resultEl.innerHTML = `
    <div style="border-left:3px solid ${statusColor}; padding:10px 14px; background:var(--neutral-bg); border-radius:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong>${(o.displayNum || (o.displayNum || orderNum(o.id)))} · ${o.tableName}</strong>
        <span class="badge ${o.paymentStatus === "paid" ? "badge-paid" : "badge-pending"}">${o.paymentStatus === "paid" ? "paid" : "unpaid"}</span>
      </div>
      <div style="color:${statusColor}; font-weight:600; font-size:13px; margin-top:4px;">${statusText}</div>
      ${o.kitchenTag ? `<div style="font-size:12px; color:var(--warning); margin-top:4px;">⚠ ${o.kitchenTag.type}${o.kitchenTag.note ? " — " + o.kitchenTag.note : ""}</div>` : ""}
      <div style="font-size:12px; color:var(--muted); margin-top:6px;">${o.items.map((i) => `${i.qty}x ${i.name} (${i.status})`).join(", ")}</div>
      <div style="margin-top:10px;"><button class="btn btn-sm" data-open-order="${o.id}">Open order${(o.amountPaid || 0) > 0 ? " / refund" : ""} →</button></div>
    </div>`;
  const openBtn = resultEl.querySelector("[data-open-order]");
  if (openBtn) openBtn.onclick = () => selectOrder(o.id);
}
document.getElementById("orderLookupBtn").onclick = checkOrderStatus;
document.getElementById("orderLookupInput").addEventListener("keydown", (e) => { if (e.key === "Enter") checkOrderStatus(); });

let selectedOrder = null;

const listEl = document.getElementById("readyList");
const panel = document.getElementById("detailPanel");

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

let _lastPayHash = "";
async function loadReady() {
  const [ordersRes, billsRes] = await Promise.all([
    api("/api/orders?status=pending,preparing,ready,dispatched"),
    api("/api/table-bills?status=open"),
  ]);
  const orders = ordersRes.ok ? await ordersRes.json() : [];
  const bills = billsRes.ok ? await billsRes.json() : [];
  const groupedIds = new Set(bills.flatMap((b) => b.orderIds || []).map(Number));
  const unpaidOrders = orders.filter((o) => o.paymentStatus !== "paid" && o.paymentStatus !== "refunded" && !groupedIds.has(Number(o.id)));
  const unpaid = [...bills, ...unpaidOrders];
  // Only re-render list if data changed — prevents flicker
  const hash = unpaid.map(o => `${o.isMergedBill ? 'bill' : 'order'}:${o.id}:${o.status}:${o.paymentStatus}:${o.grandTotal}:${o.amountPaid}:${o.discount?.amount||0}`).join(",");
  if (hash === _lastPayHash) return;
  _lastPayHash = hash;
  render(unpaid);
}

const KITCHEN_STATUS_BADGE = { pending: "pending", preparing: "preparing", ready: "ready", dispatched: "dirty" };
const KITCHEN_STATUS_LABEL = { pending: "pending", preparing: "preparing", ready: "ready to serve", dispatched: "dispatched" };

function orderBalance(o) {
  return Math.max(0, Number(o.grandTotal || o.total || 0) - Number(o.amountPaid || 0));
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
}
let mergeCandidates = [];
let mergeTableLabel = "";
function openMergeChooser(orders, tableLabel, allSelected) {
  mergeCandidates = orders.filter(o => orderBalance(o) > 0.01 && !o.isMergedBill);
  mergeTableLabel = tableLabel;
  const modal = document.getElementById("combinedBillModal");
  const choices = document.getElementById("combinedTicketChoices");
  document.getElementById("combinedBillTitle").textContent = `Table ${tableLabel} · merge tickets`;
  document.getElementById("combinedBillSubtitle").textContent = `${mergeCandidates.length} separate kitchen tickets are available. Select the tickets that should become one bill.`;
  choices.innerHTML = mergeCandidates.map((o) => `
    <label class="combined-ticket-choice"><input type="checkbox" data-merge-order="${o.id}" ${allSelected ? "checked" : ""}>
      <span class="combined-ticket-main"><strong>${escapeHtml(o.displayNum || orderNum(o.id))} · ${escapeHtml(o.tableName || tableLabel)}</strong><small>${(o.items || []).length} item line${(o.items || []).length === 1 ? "" : "s"} · ${escapeHtml(o.status || "open")}</small></span>
      <span class="combined-ticket-amount">${posCurrency()}${orderBalance(o).toFixed(2)}</span></label>`).join("");
  choices.querySelectorAll("input").forEach(el => el.addEventListener("change", updateMergeTotal));
  document.getElementById("mergeSelectedBtn").onclick = createMergedBill;
  modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
  updateMergeTotal();
}
function selectedMergeOrders() {
  const ids = new Set([...document.querySelectorAll("[data-merge-order]:checked")].map(x => Number(x.dataset.mergeOrder)));
  return mergeCandidates.filter(o => ids.has(Number(o.id)));
}
function updateMergeTotal() {
  const xs = selectedMergeOrders();
  const total = xs.reduce((sum, o) => sum + orderBalance(o), 0);
  document.getElementById("combinedFinalAmount").textContent = `${posCurrency()}${total.toFixed(2)}`;
  const btn = document.getElementById("mergeSelectedBtn");
  btn.disabled = xs.length < 2;
  btn.textContent = xs.length < 2 ? "Select at least 2 tickets" : `Merge ${xs.length} tickets · ${posCurrency()}${total.toFixed(2)}`;
}
async function createMergedBill() {
  const xs = selectedMergeOrders();
  if (xs.length < 2) { showToast("Select at least two tickets to merge"); return; }
  const total = xs.reduce((sum, o) => sum + orderBalance(o), 0);
  if (!confirm(`Create one merged bill for Table ${mergeTableLabel}?\n${xs.length} tickets · ${posCurrency()}${total.toFixed(2)}`)) return;
  const btn = document.getElementById("mergeSelectedBtn"); btn.disabled = true; btn.textContent = "Merging tickets…";
  const res = await api("/api/table-bills", { method: "POST", json: { orderIds: xs.map(o => o.id) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || "Could not merge tickets"); btn.disabled = false; updateMergeTotal(); return; }
  document.getElementById("combinedBillModal").classList.remove("open");
  document.getElementById("combinedBillModal").setAttribute("aria-hidden", "true");
  showToast(`Merged ${xs.length} tickets into ${data.displayNum} · ${posCurrency()}${data.grandTotal.toFixed(2)}`);
  _lastPayHash = ""; await loadReady(); selectOrder(`bill:${data.id}`);
}
document.querySelectorAll("[data-combined-close]").forEach(el => el.addEventListener("click", () => {
  const modal = document.getElementById("combinedBillModal"); modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
}));

function render(orders) {
  _readyOrders = orders;
  listEl.innerHTML = "";
  if (orders.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No unpaid orders right now.</div>`;
    _highlightIdx = -1;
    return;
  }
  // Only tickets not already attached to a merged bill are eligible to merge.
  const tableGroups = new Map();
  orders.filter(o => !o.isMergedBill && o.orderType === "dine-in" && o.tableName && !/^online$/i.test(o.tableName))
    .forEach(o => {
      const key = String(o.tableId || o.tableName);
      if (!tableGroups.has(key)) tableGroups.set(key, []);
      tableGroups.get(key).push(o);
    });
  const multiGroups = [...tableGroups.entries()].filter(([, xs]) => xs.length > 1);
  if (multiGroups.length) {
    const groupWrap = document.createElement("div");
    groupWrap.style = "display:grid;gap:10px;margin-bottom:12px";
    multiGroups.forEach(([key, xs]) => {
      const total = xs.reduce((sum, o) => sum + orderBalance(o), 0);
      const safeName = String(xs[0].tableName || key).replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[c]));
      const card = document.createElement("section");
      card.className = "table-bill-card";
      card.innerHTML = `
        <div class="table-bill-head"><div><div class="table-bill-title">Table ${safeName}</div><div class="table-bill-sub">${xs.length} separate kitchen tickets available to merge</div></div><div class="table-bill-total">${posCurrency()}${total.toFixed(2)}</div></div>
        <div class="table-bill-tickets">${xs.map(o=>`<span class="table-ticket-chip">${escapeHtml(o.displayNum || orderNum(o.id))} · ${posCurrency()}${orderBalance(o).toFixed(2)}</span>`).join("")}</div>
        <div class="table-bill-actions"><button type="button" class="btn btn-primary" data-merge-all>Merge all</button><button type="button" class="btn" data-merge-select>Choose tickets to merge</button></div>`;
      card.querySelector("[data-merge-all]").onclick = () => {
        if (xs.length < 2) return;
        mergeCandidates = xs; mergeTableLabel = safeName;
        createMergedBillDirect(xs, safeName);
      };
      card.querySelector("[data-merge-select]").onclick = () => openMergeChooser(xs, safeName, false);
      groupWrap.appendChild(card);
    });
    listEl.appendChild(groupWrap);
  }
  orders.forEach((order, idx) => {
    const row = document.createElement("button");
    row.className = "card clickable pay-row";
    row.dataset.ordIdx = idx;
    row.style = "text-align:left; padding:15px 18px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; border:1px solid var(--border); background:var(--panel); width:100%; border-radius:12px; margin-bottom:8px;";
    const balance = orderBalance(order);
    if (order.isMergedBill) {
      row.style.background = "linear-gradient(110deg, var(--accent-soft), var(--panel))";
      row.style.borderColor = "var(--accent)";
      row.innerHTML = `<span style="font-weight:700;">▦ ${escapeHtml(order.displayNum)} · Table ${escapeHtml(order.tableName)} <span class="badge badge-ready" style="margin-left:5px;">Merged bill · ${order.orderIds.length} tickets</span><small style="display:block;color:var(--muted);font-weight:400;margin-top:4px;">Select to apply discount, print, or pay normally</small></span><span class="mono" style="color:var(--accent);font-weight:800;">${posCurrency()}${balance.toFixed(2)} due</span>`;
      row.onclick = () => selectOrder(`bill:${order.id}`);
    } else {
      const isTakeaway = order.orderType && order.orderType !== "dine-in";
      const custLabel = isTakeaway ? (order.customerName?.trim() || "no name") : "";
      const typeTag = isTakeaway ? ` <span class="badge badge-ordered" style="margin-left:4px;">${escapeHtml(order.orderType)}</span> <span style="margin-left:4px;font-weight:600;color:var(--muted);">${escapeHtml(custLabel)}</span>` : "";
      const kitchenTag = ` <span class="badge badge-${KITCHEN_STATUS_BADGE[order.status] || "pending"}" style="margin-left:4px;">${KITCHEN_STATUS_LABEL[order.status] || order.status}</span>`;
      const delayFlag = order.kitchenTag ? ` <span class="badge" style="background:var(--warning-bg);color:var(--warning);margin-left:4px;">⚠ ${escapeHtml(order.kitchenTag.type)}</span>` : "";
      const priorityFlag = order.priority === "high" ? "🔥 " : "";
      row.innerHTML = `<span style="font-weight:600;">${priorityFlag}${escapeHtml(order.displayNum || orderNum(order.id))} · ${escapeHtml(order.tableName || "Order")}${typeTag}${kitchenTag}${delayFlag}</span><span class="mono" style="color:var(--accent);font-weight:700;">${posCurrency()}${balance.toFixed(2)} due</span>`;
      row.onclick = () => selectOrder(order.id);
    }
    listEl.appendChild(row);
  });
  if (_highlightIdx >= orders.length) _highlightIdx = orders.length - 1;
  if (_highlightIdx < 0 && orders.length && !selectedOrder) _highlightIdx = 0;
  paintHighlight();
}

async function createMergedBillDirect(xs, tableLabel) {
  if (!xs || xs.length < 2) { showToast("At least two tickets are needed to merge"); return; }
  const total = xs.reduce((sum, o) => sum + orderBalance(o), 0);
  if (!confirm(`Merge all ${xs.length} unpaid tickets for Table ${tableLabel} into one bill?\nFinal total: ${posCurrency()}${total.toFixed(2)}`)) return;
  const res = await api("/api/table-bills", { method: "POST", json: { orderIds: xs.map(o => o.id) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(data.error || "Could not merge tickets"); return; }
  showToast(`Created ${data.displayNum} · ${posCurrency()}${data.grandTotal.toFixed(2)}`);
  _lastPayHash = ""; await loadReady(); selectOrder(`bill:${data.id}`);
}

// ── Keyboard selection of orders (minimise mouse use) ──
// In the list: ↑/↓ move the highlight, Enter opens it, 1–9 jump to the Nth.
// Esc from an open order returns to the list. The dialpad + Enter-to-pay (below)
// take over once an order is open.
let _readyOrders = [];
let _highlightIdx = -1;
function paintHighlight() {
  listEl.querySelectorAll(".pay-row").forEach((r) => {
    const on = Number(r.dataset.ordIdx) === _highlightIdx;
    r.style.outline = on ? "2px solid var(--accent)" : "none";
    r.style.outlineOffset = on ? "-1px" : "0";
    if (on) r.scrollIntoView({ block: "nearest" });
  });
}
function moveHighlight(delta) {
  if (!_readyOrders.length) return;
  _highlightIdx = (_highlightIdx < 0 ? 0 : (_highlightIdx + delta + _readyOrders.length) % _readyOrders.length);
  paintHighlight();
}
function openHighlighted() {
  if (_highlightIdx >= 0 && _readyOrders[_highlightIdx]) selectOrder(_readyOrders[_highlightIdx].isMergedBill ? `bill:${_readyOrders[_highlightIdx].id}` : _readyOrders[_highlightIdx].id);
}
function closeDetail() {
  selectedOrder = null;
  panel.style.display = "none";
  paintHighlight();
}

document.addEventListener("keydown", (e) => {
  // Once an order is PAID, its detail stays open — Esc/Enter returns to the list
  // so the next order can be picked without the mouse.
  if (selectedOrder && selectedOrder.paymentStatus === "paid") {
    if (e.key === "Escape" || e.key === "Enter") { closeDetail(); e.preventDefault(); }
    return;
  }
  // List navigation only applies when no order is open and we're not typing.
  if (selectedOrder) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;
  if (document.querySelector(".modal-backdrop")) return;   // let modals handle keys
  if (e.key === "ArrowDown") { moveHighlight(1); e.preventDefault(); }
  else if (e.key === "ArrowUp") { moveHighlight(-1); e.preventDefault(); }
  else if (e.key === "Enter") { openHighlighted(); e.preventDefault(); }
  else if (e.key === "/") { const i = document.getElementById("orderLookupInput"); if (i) { i.focus(); e.preventDefault(); } }
  else if (/^[1-9]$/.test(e.key)) { const n = Number(e.key) - 1; if (_readyOrders[n]) { _highlightIdx = n; paintHighlight(); selectOrder(_readyOrders[n].isMergedBill ? `bill:${_readyOrders[n].id}` : _readyOrders[n].id); } e.preventDefault(); }
});

async function selectOrder(id) {
  const isBill = typeof id === "string" && id.startsWith("bill:");
  const endpoint = isBill ? `/api/table-bills/${id.slice(5)}` : `/api/orders/${id}`;
  const res = await api(endpoint);
  if (!res.ok) { const e = await res.json().catch(() => ({})); showToast(e.error || "Could not open ticket"); return; }
  selectedOrder = await res.json();
  if (isBill) selectedOrder.isMergedBill = true;
  renderDetail();
}

function renderDetail(preserveTender) {
  const o = selectedOrder;
  const isMerged = !!o.isMergedBill;
  const isPaid = o.paymentStatus === "paid";
  panel.style.display = "block";

  // Order type dropdown — reflects the order, and locks once it's paid
  const typeSel = document.getElementById("orderTypeSelect");
  if (typeSel) {
    typeSel.value = o.orderType || "dine-in";
    const locked = isMerged || o.paymentStatus === "paid";
    typeSel.disabled = locked;
    typeSel.style.opacity = locked ? "0.5" : "";
    const typeRow = document.getElementById("orderTypeRow");
    if (typeRow) typeRow.style.display = isMerged ? "none" : "flex";
  }

  document.getElementById("detailTitle").innerHTML = `${escapeHtml(o.displayNum || orderNum(o.id))} · ${escapeHtml(o.tableName || "Order")}${isMerged ? ` <span class="badge badge-ready" style="font-size:11px;vertical-align:middle;">MERGED BILL</span>` : o.source === "qr" ? ` <span class="badge badge-ready" style="font-size:11px; vertical-align:middle;">QR</span>` : o.source === "online" ? ` <span class="badge badge-ordered" style="font-size:11px; vertical-align:middle;">Online</span>` : ""}`;
  const isTakeaway = o.orderType && o.orderType !== "dine-in";
  const typeTag = isTakeaway
    ? ` · ${o.orderType} · ${o.customerName?.trim() || "no name"}`
    : "";
  document.getElementById("detailServer").textContent = isMerged
    ? `Merged from ${(o.memberOrders || []).map((x) => x.displayNum).join(", ")}`
    : `Server: ${o.staffName}${typeTag}`;
  const kitchenStatusEl = document.getElementById("detailKitchenStatus");
  if (kitchenStatusEl) {
    kitchenStatusEl.innerHTML = isMerged ? `<span class="badge badge-ready">${(o.orderIds || []).length} kitchen tickets remain separate</span>`
      : `${o.priority === "high" ? "🔥 Priority &nbsp;" : ""}Kitchen: <span class="badge badge-${KITCHEN_STATUS_BADGE[o.status] || "pending"}">${KITCHEN_STATUS_LABEL[o.status] || o.status}</span>`
      + (o.kitchenTag ? `<div style="margin-top:4px; padding:6px 8px; background:var(--warning-bg); color:var(--warning); border-radius:6px; font-size:11px;">⚠ ${o.kitchenTag.type}${o.kitchenTag.note ? " — " + o.kitchenTag.note : ""} (flagged by ${o.kitchenTag.setBy})</div>` : "");
  }
  const noteEl = document.getElementById("detailNote");
  if (noteEl) noteEl.textContent = o.note ? `📝 ${o.note}` : "";

  document.getElementById("detailItems").innerHTML = o.items.map((i) => `
    <div style="padding:3px 0;">
      <div style="display:flex; justify-content:space-between;"><span>${i.qty}× ${i.name}</span><span>${posCurrency()}${i.lineTotal.toFixed(2)}</span></div>
      ${i.modifiers && i.modifiers.length ? `<div style="font-size:11px; color:var(--muted);">${i.modifiers.map((m) => m.option).join(", ")}</div>` : ""}
      ${i.notes ? `<div style="font-size:11px; color:var(--danger);">${i.notes}</div>` : ""}
    </div>`).join("");

  document.getElementById("dSubtotal").textContent = `${posCurrency()}${o.subtotal.toFixed(2)}`;
  const discountRow = document.getElementById("dDiscountRow");
  if (o.discount) {
    discountRow.style.display = "flex";
    document.getElementById("dDiscountLabel").textContent = o.discount.reason ? `Discount (${o.discount.reason})` : "Discount";
    document.getElementById("dDiscountAmt").textContent = `-${posCurrency()}${o.discount.amount.toFixed(2)}`;
  } else {
    discountRow.style.display = "none";
  }
  const promoRow = document.getElementById("dPromoRow");
  if (promoRow) {
    if (o.promo && o.promo.amount) {
      promoRow.style.display = "flex";
      document.getElementById("dPromoLabel").textContent = `Promo (${o.promo.name})`;
      document.getElementById("dPromoAmt").textContent = `-${posCurrency()}${o.promo.amount.toFixed(2)}`;
    } else { promoRow.style.display = "none"; }
  }
  document.getElementById("dServiceCharge").textContent = `${posCurrency()}${o.serviceCharge.toFixed(2)}`;
  document.getElementById("dVat").textContent = `${posCurrency()}${o.vat.toFixed(2)}`;
  document.getElementById("dTotal").textContent = `${posCurrency()}${o.total.toFixed(2)}`;

  // Tip row
  const tipRow = document.getElementById("dTipRow");
  const tip = o.tipAmount || 0;
  if (tip > 0) {
    tipRow.style.display = "flex";
    document.getElementById("dTipAmt").textContent = `+${posCurrency()}${tip.toFixed(2)}`;
    document.getElementById("dGrandTotal").textContent = `${posCurrency()}${o.grandTotal.toFixed(2)}`;
    document.getElementById("dGrandTotalRow").style.display = "flex";
  } else {
    tipRow.style.display = "none";
    document.getElementById("dGrandTotalRow").style.display = "none";
  }

  document.getElementById("dPaid").textContent = `${posCurrency()}${o.amountPaid.toFixed(2)}`;
  const balance = +(o.grandTotal - o.amountPaid).toFixed(2);
  currentBalance = balance;
  // Changing the order type (a flag) must NOT wipe an amount the cashier has
  // already keyed in — only a fresh order selection clears it.
  if (!preserveTender) tenderedRaw = "";
  updateDialpad();
  if (!isPaid) buildQuickAmounts(balance);
  document.getElementById("dBalance").textContent = `${posCurrency()}${balance.toFixed(2)}`;
  document.getElementById("paymentsLog").innerHTML = o.payments
    .map((p) => `${p.method === "cash" ? "💵" : p.method === "card" ? "💳" : p.method === "online" ? "🏦" : p.method === "loyalty" ? "💛" : p.method === "giftcard" ? "🎁" : "📱"} ${posCurrency()}${p.amount.toFixed(2)}`)
    .join(" · ");
  document.getElementById("payEntry").style.display = isPaid ? "none" : "block";
  document.getElementById("paidState").style.display = isPaid ? "block" : "none";
  document.getElementById("actionRow").style.display = isPaid ? "none" : "flex";
  const dBtn = document.getElementById("discountBtn");
  dBtn.disabled = o.amountPaid > 0;
  dBtn.textContent = o.discount ? "Edit Discount" : "Discount";
  const voidBtn = document.getElementById("voidBtn");
  voidBtn.disabled = isMerged || o.amountPaid > 0;
  voidBtn.style.display = isMerged ? "none" : "inline-flex";
  document.getElementById("printBillRow").style.display = isPaid ? "none" : "block";
  document.getElementById("refundRow").style.display = (!isMerged && o.amountPaid > 0) ? "block" : "none";
  document.getElementById("printBillLink").href = isMerged ? "#merged-bill-print" : `receipt?orderId=${o.id}`;
  document.getElementById("printBillLink").removeAttribute("target");
  document.getElementById("printBillLink").textContent = isMerged ? "🧾 Print Merged Bill" : "🧾 Print Bill";
  document.getElementById("printBillLink").onclick = isMerged ? (e) => { e.preventDefault(); printMergedBill(o); } : null;
  if (!isMerged) updateLoyaltyRow(o, balance);
  else { const loyaltyRow = document.getElementById("loyaltyRow"); if (loyaltyRow) loyaltyRow.style.display = "none"; }
  const gcRow = document.getElementById("giftcardRow");
  if (gcRow) {
    const s = window.posSettings;
    const on = !!(s && Array.isArray(s.enabledAddons) && s.enabledAddons.includes("giftcards"));
    gcRow.style.display = (!isMerged && on && !isPaid && balance > 0.01) ? "block" : "none";
    const gb = document.getElementById("giftcardBtn");
    if (gb) gb.onclick = () => openGiftCardModal(o, balance);
  }
  if (isPaid) {
    document.getElementById("receiptLink").href = isMerged ? "#merged-bill-print" : `receipt?orderId=${o.id}`;
    document.getElementById("receiptLink").removeAttribute("target");
    document.getElementById("receiptLink").onclick = isMerged ? (e) => { e.preventDefault(); printMergedBill(o); } : null;
    document.getElementById("receiptLink").textContent = isMerged ? "Print merged bill" : "🖨️ Print Receipt";
  }}

function printMergedBill(bill) {
  const c = posCurrency();
  const rows = (bill.items || []).map((it) => `<tr><td>${escapeHtml(it.sourceOrderNum || '')}</td><td>${escapeHtml(it.name || '')}${it.modifiers?.length ? `<small>${it.modifiers.map(m => escapeHtml(m.option || m.name || '')).join(', ')}</small>` : ''}</td><td>${Number(it.qty || 0)}</td><td style="text-align:right">${c}${Number(it.lineTotal || 0).toFixed(2)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.displayNum)} · ${escapeHtml(bill.tableName)}</title><style>body{font:14px Arial,sans-serif;max-width:760px;margin:30px auto;color:#222}h1{font-size:24px;margin:0}p{color:#666}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}small{display:block;color:#666}.total{font-size:22px;font-weight:bold;text-align:right;margin-top:12px}.meta{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:12px 0}@media print{button{display:none}body{margin:0}}</style></head><body><h1>Golden Beach Restaurant</h1><p>Merged table bill</p><div class="meta"><strong>${escapeHtml(bill.displayNum)} · ${escapeHtml(bill.tableName)}</strong><span>${new Date().toLocaleString()}</span></div><p>Includes tickets: ${(bill.memberOrders||[]).map(x=>escapeHtml(x.displayNum)).join(', ')}</p><table><thead><tr><th>Ticket</th><th>Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table><p>Subtotal: ${c}${Number(bill.subtotal||0).toFixed(2)}</p>${bill.discount ? `<p>Bill discount: −${c}${Number(bill.discount.amount||0).toFixed(2)}</p>` : ''}<p>Service charge: ${c}${Number(bill.serviceCharge||0).toFixed(2)}</p><p>Tax: ${c}${Number(bill.vat||0).toFixed(2)}</p><div class="total">Total: ${c}${Number(bill.grandTotal||0).toFixed(2)}</div><p>Paid: ${c}${Number(bill.amountPaid||0).toFixed(2)} · Balance: ${c}${Math.max(0,Number(bill.grandTotal||0)-Number(bill.amountPaid||0)).toFixed(2)}</p><button onclick="window.print()">Print</button><script>setTimeout(()=>window.print(),250)</script></body></html>`;
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { showToast('Allow pop-ups to print the merged bill'); return; }
  win.document.open(); win.document.write(html); win.document.close();
}

// ---------- Loyalty ----------
function loyaltyOn() {
  const s = window.posSettings;
  return !!(s && Array.isArray(s.enabledAddons) && s.enabledAddons.includes("loyalty"));
}

async function updateLoyaltyRow(o, balance) {
  const row = document.getElementById("loyaltyRow");
  if (!row) return;
  if (!loyaltyOn() || !o.customerPhone || o.paymentStatus === "paid") { row.style.display = "none"; return; }
  const s = window.posSettings || {};
  const per = s.loyaltyEarnPer || 100, pts = s.loyaltyEarnPoints || 1;
  const willEarn = Math.floor((o.grandTotal || 0) / per) * pts;
  row.style.display = "flex";
  const info = document.getElementById("loyaltyInfo");
  const redeemBtn = document.getElementById("loyaltyRedeemBtn");
  info.textContent = `💛 earns ~${willEarn} pt(s) on payment`;
  redeemBtn.style.display = "none";
  // Look up the customer's current balance so they can redeem it now.
  try {
    const res = await api(`/api/customers/lookup?phone=${encodeURIComponent(o.customerPhone)}`);
    if (!res.ok) return;
    const data = await res.json();
    const have = data.customer ? Math.floor(data.customer.loyaltyPoints || 0) : 0;
    info.textContent = `💛 ${have} pt(s) available · earns ~${willEarn} on payment`;
    if (have > 0 && balance > 0.01) {
      redeemBtn.style.display = "";
      redeemBtn.onclick = () => openLoyaltyRedeemModal(o, have, balance);
    }
  } catch (_) {}
}

function openLoyaltyRedeemModal(o, have, balance) {
  const c = posCurrency();
  const s = window.posSettings || {};
  const redeemValue = s.loyaltyRedeemValue || 1;
  const maxByBalance = Math.ceil(balance / redeemValue);
  const maxPoints = Math.min(have, maxByBalance);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:360px;">
      <h3 style="margin-top:0;">💛 Redeem points</h3>
      <p style="font-size:13px; color:var(--muted); margin:0 0 12px;">
        ${have} point(s) available · each worth ${c}${redeemValue}. Up to <strong>${maxPoints}</strong> apply to this bill.</p>
      <div class="f"><label>Points to redeem</label>
        <input id="ly_pts" type="number" step="1" min="1" max="${maxPoints}" value="${maxPoints}"/></div>
      <div id="ly_preview" style="font-size:13px; color:var(--accent); font-weight:600; margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="ly_cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="ly_go" style="flex:1;">Redeem</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  const input = backdrop.querySelector("#ly_pts");
  const preview = backdrop.querySelector("#ly_preview");
  const sync = () => {
    let p = Math.min(parseInt(input.value, 10) || 0, maxPoints);
    preview.textContent = `Applies ${c}${(p * redeemValue).toFixed(2)} to the balance`;
  };
  input.addEventListener("input", sync); sync();
  backdrop.querySelector("#ly_cancel").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#ly_go").onclick = async () => {
    const points = Math.min(parseInt(input.value, 10) || 0, maxPoints);
    if (points < 1) return showToast("Enter points to redeem");
    const btn = backdrop.querySelector("#ly_go"); btn.disabled = true; btn.textContent = "Redeeming…";
    const res = await api(`/api/orders/${o.id}/loyalty-redeem`, { method: "POST", json: { points } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(r.error || "Redeem failed"); btn.disabled = false; btn.textContent = "Redeem"; return; }
    showToast(`Redeemed ${r.redeemedPoints} pt(s) (${c}${r.redeemedValue.toFixed(2)})`);
    close();
    selectedOrder = r.order;
    renderDetail();
    loadReady();
  };
}

// ---------- Gift card tender ----------
function openGiftCardModal(o, balance) {
  const c = posCurrency();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:380px;">
      <h3 style="margin-top:0;">🎁 Pay with Gift Card</h3>
      <div class="f"><label>Scan or type the card code</label>
        <input id="gc_code" class="mono" placeholder="GC…" autocomplete="off" style="text-transform:uppercase;"/></div>
      <div id="gc_status" style="font-size:13px; margin-bottom:8px; min-height:18px;"></div>
      <div id="gc_amtWrap" style="display:none;">
        <div class="f"><label>Amount to redeem (${c})</label><input id="gc_amount" type="number" step="0.01" min="0.01"/></div>
      </div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn" id="gc_cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="gc_go" style="flex:1;" disabled>Redeem</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#gc_cancel").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  const codeEl = backdrop.querySelector("#gc_code");
  const statusEl = backdrop.querySelector("#gc_status");
  const amtWrap = backdrop.querySelector("#gc_amtWrap");
  const amtEl = backdrop.querySelector("#gc_amount");
  const goBtn = backdrop.querySelector("#gc_go");
  let card = null;

  async function lookup() {
    const code = codeEl.value.trim().toUpperCase();
    if (!code) return;
    const res = await api(`/api/giftcards/lookup?code=${encodeURIComponent(code)}`);
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { card = null; goBtn.disabled = true; amtWrap.style.display = "none"; statusEl.textContent = r.error || "Card not found"; statusEl.style.color = "var(--danger)"; return; }
    card = r;
    if (r.status !== "active") { goBtn.disabled = true; amtWrap.style.display = "none"; statusEl.textContent = "This card is disabled"; statusEl.style.color = "var(--danger)"; return; }
    statusEl.textContent = `Balance ${c}${r.balance.toFixed(2)}`; statusEl.style.color = "var(--success)";
    const use = Math.min(r.balance, balance);
    amtWrap.style.display = "block"; amtEl.value = use.toFixed(2); amtEl.max = Math.min(r.balance, balance).toFixed(2);
    goBtn.disabled = use <= 0;
  }
  // Scanners send the code then Enter.
  codeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } });
  let t = null; codeEl.addEventListener("input", () => { clearTimeout(t); t = setTimeout(lookup, 350); });
  codeEl.focus();

  goBtn.onclick = async () => {
    if (!card) return;
    const amount = parseFloat(amtEl.value);
    if (!amount || amount <= 0) return showToast("Enter an amount");
    goBtn.disabled = true; goBtn.textContent = "Redeeming…";
    const res = await api(`/api/orders/${o.id}/giftcard-pay`, { method: "POST", json: { code: card.code, amount } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(r.error || "Redeem failed"); goBtn.disabled = false; goBtn.textContent = "Redeem"; return; }
    showToast(`Gift card applied: ${c}${r.redeemed.toFixed(2)} (card left ${c}${r.remainingCardBalance.toFixed(2)})`);
    close();
    // The redeem response can contain a stale/partial order snapshot. Fetch the authoritative
    // order (including payments and updated balance) so the gift-card payment appears immediately.
    const freshRes = await api(`/api/orders/${o.id}`);
    if (freshRes.ok) selectedOrder = await freshRes.json();
    else selectedOrder = r.order;
    renderDetail();
    _lastPayHash = "";
    await loadReady();
  };
}

// ---------- Dialpad state ----------
let tenderedRaw = ""; // string like "1500" or "1500.50"
let currentBalance = 0; // set from renderDetail()

function tenderedValue() {
  return parseFloat(tenderedRaw) || 0;
}

function formatDialpad(raw) {
  if (!raw) return "0.00";
  const n = parseFloat(raw);
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function updateDialpad() {
  const tendered = tenderedValue();
  document.getElementById("tenderedDisplay").textContent = formatDialpad(tenderedRaw);
  const change = tendered - currentBalance;
  const changeEl = document.getElementById("changeDisplay");
  const changeRow = document.getElementById("changeRow");
  if (tendered === 0) {
    changeEl.textContent = "—";
    changeRow.style.background = "var(--neutral-bg)";
    changeRow.style.color = "var(--muted)";
  } else if (change < 0) {
    changeEl.textContent = `${posCurrency()}${Math.abs(change).toFixed(2)} short`;
    changeRow.style.background = "var(--danger-bg)";
    changeRow.style.color = "var(--danger)";
  } else {
    changeEl.textContent = `${posCurrency()}${change.toFixed(2)}`;
    changeRow.style.background = "var(--success-bg)";
    changeRow.style.color = "var(--success)";
  }
  // Enable/disable the confirm button based on whether the amount is valid
  const canPay  = tendered > 0;
  const payBtn  = document.getElementById("payConfirmBtn");
  payBtn.disabled      = !canPay;
  payBtn.style.opacity = canPay ? "" : "0.4";
}

// Dialpad key handling
// Apply a single dialpad key ("0"-"9", ".", "back"). Shared by the on-screen
// buttons and the physical keyboard.
function pressDialpadKey(k) {
  if (k === "back") {
    tenderedRaw = tenderedRaw.slice(0, -1);
  } else if (k === ".") {
    if (!tenderedRaw.includes(".")) tenderedRaw += ".";
  } else {
    // Guard: max 2 decimal places
    const dotIdx = tenderedRaw.indexOf(".");
    if (dotIdx !== -1 && tenderedRaw.length - dotIdx > 2) return;
    tenderedRaw += k;
  }
  updateDialpad();
}

document.querySelectorAll(".dialpad-btn").forEach((btn) => {
  btn.onclick = () => pressDialpadKey(btn.dataset.key);
});

// Physical keyboard entry — type the amount directly. Active only when an
// order is selected and the user isn't typing in another input.
document.addEventListener("keydown", (e) => {
  if (!selectedOrder || selectedOrder.paymentStatus === "paid") return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || e.target.isContentEditable) return;

  if (e.key >= "0" && e.key <= "9") { pressDialpadKey(e.key); e.preventDefault(); }
  else if (e.key === ".") { pressDialpadKey("."); e.preventDefault(); }
  else if (e.key === "Backspace") { pressDialpadKey("back"); e.preventDefault(); }
  else if (e.key === "Enter") {
    // Enter records the payment with the selected method
    const btn = document.getElementById("payConfirmBtn");
    if (btn && !btn.disabled) { btn.click(); e.preventDefault(); }
  }
  else if (e.key === "Escape") {
    // First Esc clears a typed amount; a second Esc returns to the order list.
    if (tenderedRaw) { tenderedRaw = ""; updateDialpad(); }
    else closeDetail();
    e.preventDefault();
  }
});

// Cash denominations: tap the physical notes the customer handed over. "Exact"
// sets the tendered amount to the balance due (handy for card/online). The note
// buttons ADD to whatever's been tendered so far, so 500 + 500 = 1000, matching
// how cash actually changes hands.
const CASH_NOTES = [100, 500, 1000];
function buildQuickAmounts(balance) {
  const c = posCurrency();
  const el = document.getElementById("quickAmounts");
  el.innerHTML =
    `<button class="quick-amt-btn" data-exact="1">Exact</button>` +
    CASH_NOTES.map((n) => `<button class="quick-amt-btn" data-add="${n}">+${c}${n}</button>`).join("");
  el.querySelector("[data-exact]").onclick = () => { tenderedRaw = String(balance); updateDialpad(); };
  el.querySelectorAll("[data-add]").forEach((btn) => {
    btn.onclick = () => {
      const add = parseFloat(btn.dataset.add);
      tenderedRaw = String(+((tenderedValue() + add).toFixed(2)));
      updateDialpad();
    };
  });
}

// Single confirm button — the method comes from the dropdown
document.getElementById("payConfirmBtn").onclick = () => {
  recordPayment(document.getElementById("payMethodSelect").value);
};

// Keep the button label in step with the chosen method
document.getElementById("payMethodSelect").onchange = () => {
  const sel   = document.getElementById("payMethodSelect");
  const label = sel.options[sel.selectedIndex].textContent.trim();
  document.getElementById("payConfirmBtn").textContent = `Record ${label} Payment`;
};

// ---------- Order type dropdown ----------
document.getElementById("orderTypeSelect").onchange = async (e) => {
  if (!selectedOrder || selectedOrder.isMergedBill) return;
  const newType = e.target.value;
  const payload = { orderType: newType };
  if (newType !== "dine-in") {
    // Carry over whatever customer details the order already has
    payload.customerName    = selectedOrder.customerName    || "";
    payload.customerPhone   = selectedOrder.customerPhone   || "";
    payload.customerAddress = selectedOrder.customerAddress || "";
  }
  const res = await api(`/api/orders/${selectedOrder.id}/type`, { method: "PATCH", json: payload });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    showToast(err.error || "Could not change order type");
    e.target.value = selectedOrder.orderType || "dine-in"; // revert
    return;
  }
  selectedOrder = await res.json();
  showToast(`Order type set to ${newType}`);
  renderDetail(true);   // keep the amount the cashier already entered
  loadReady();
};

// Confirm dialog shown before any payment is recorded. Resolves true on
// Confirm, false on Cancel — nothing is charged until the user commits.
function confirmPayment({ method, tendered, payable, change, feeAmount, netAmount }) {
  return new Promise((resolve) => {
    const o = selectedOrder;
    const c = posCurrency();
    const methodLabel = { cash: "💵 Cash", card: "💳 Card", online: "🏦 Online Transfer", wallet: "📱 Wallet" }[method] || method;
    const isTakeaway  = o.orderType && o.orderType !== "dine-in";
    const custLabel   = isTakeaway ? (o.customerName?.trim() || "no name") : "";

    const rows = (o.items || []).map((it) => `
      <div style="display:flex; justify-content:space-between; gap:8px; padding:3px 0;">
        <span>${it.qty}× ${it.name}</span>
        <span class="mono">${c}${Number(it.lineTotal || 0).toFixed(2)}</span>
      </div>
      ${(it.modifiers && it.modifiers.length)
        ? `<div style="font-size:11px; color:var(--muted); padding-left:14px;">+ ${it.modifiers.map(m => m.option || m.name).join(", ")}</div>` : ""}
    `).join("");

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h3 style="margin:0 0 2px;">Confirm Payment</h3>
        <div style="font-size:12px; color:var(--muted); margin-bottom:12px;">
          ${o.displayNum || orderNum(o.id)} · ${o.tableName}
          ${isTakeaway ? ` · ${o.orderType} · ${custLabel}` : ""}
        </div>

        <div class="mono" style="font-size:12px; max-height:150px; overflow-y:auto;
             background:var(--neutral-bg); border-radius:8px; padding:10px 12px; margin-bottom:12px;">
          ${rows || '<div style="color:var(--muted);">No items</div>'}
        </div>

        <div class="mono" style="font-size:13px; border-top:1px solid var(--border); padding-top:10px;">
          <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><span>${c}${Number(o.subtotal||0).toFixed(2)}</span></div>
          ${o.discount ? `<div style="display:flex; justify-content:space-between; color:var(--danger);"><span>Discount</span><span>−${c}${Number(o.discount.amount||0).toFixed(2)}</span></div>` : ""}
          <div style="display:flex; justify-content:space-between;"><span>Service Charge</span><span>${c}${Number(o.serviceCharge||0).toFixed(2)}</span></div>
          <div style="display:flex; justify-content:space-between;"><span>VAT</span><span>${c}${Number(o.vat||0).toFixed(2)}</span></div>
          ${o.tipAmount > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--accent);"><span>Tip</span><span>${c}${Number(o.tipAmount).toFixed(2)}</span></div>` : ""}
          <div style="display:flex; justify-content:space-between; font-weight:700; font-size:16px; padding-top:5px; border-top:1px solid var(--border); margin-top:5px;">
            <span>Balance Due</span><span>${c}${currentBalance.toFixed(2)}</span>
          </div>
        </div>

        <div style="background:var(--accent-soft); border-radius:8px; padding:12px 14px; margin-top:12px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; font-weight:700; margin-bottom:4px;">
            <span>Method</span><span>${methodLabel}</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>Customer pays</span><span class="mono">${c}${tendered.toFixed(2)}</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>Applied to bill</span><span class="mono">${c}${payable.toFixed(2)}</span>
          </div>
          ${method === "cash" && change > 0
            ? `<div style="display:flex; justify-content:space-between; font-weight:700; color:var(--success);">
                 <span>Change to give</span><span class="mono">${c}${change.toFixed(2)}</span></div>` : ""}
          ${feeAmount > 0
            ? `<div style="display:flex; justify-content:space-between; color:var(--danger); font-size:12px; margin-top:4px;">
                 <span>Card fee</span><span class="mono">−${c}${feeAmount.toFixed(2)}</span></div>
               <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--muted);">
                 <span>You receive</span><span class="mono">${c}${netAmount.toFixed(2)}</span></div>` : ""}
        </div>

        <div style="display:flex; gap:8px; margin-top:16px;">
          <button class="btn" id="cpCancel" style="flex:1; padding:12px;">Cancel</button>
          <button class="btn btn-primary" id="cpConfirm" style="flex:1; padding:12px; font-weight:700;">Confirm &amp; Print</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    const close = (val) => { backdrop.remove(); resolve(val); };
    backdrop.querySelector("#cpCancel").onclick  = () => close(false);
    backdrop.querySelector("#cpConfirm").onclick = () => close(true);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
    backdrop.querySelector("#cpConfirm").focus();
  });
}

// Print the receipt without leaving the payment screen.
// receipt.js renders asynchronously, so we let it call print() itself once the
// content is on the page (?print=1). Printing on iframe load fires too early
// and produces a sheet that just says "Loading…".
function printReceipt(url) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  frame.src = url + (url.includes("?") ? "&" : "?") + "print=1";
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 60000);
}

async function recordPayment(method) {
  const tendered = tenderedValue();
  if (!tendered || tendered <= 0) { showToast("Enter an amount using the dialpad"); return; }
  const balance = currentBalance;
  if (method === "cash" && tendered < balance - 0.01) {
    showToast("Cash amount is less than the balance due"); return;
  }
  const payable = +(method === "cash" ? balance : Math.min(tendered, balance)).toFixed(2);
  const change  = +(tendered - payable).toFixed(2);

  // Preview the card fee so the confirm dialog can show what actually lands
  const feePct    = method === "card" ? (window.posSettings?.cardFeePercent || 0) : 0;
  const feeAmount = +(payable * feePct).toFixed(2);
  const netAmount = +(payable - feeAmount).toFixed(2);

  const ok = await confirmPayment({ method, tendered, payable, change, feeAmount, netAmount });
  if (!ok) return;

  const wasMerged = !!selectedOrder.isMergedBill;
  const endpoint = wasMerged ? `/api/table-bills/${selectedOrder.id}/pay` : `/api/orders/${selectedOrder.id}/pay`;
  const res = await api(endpoint, { method: "POST", json: { method, amount: payable } });
  const paymentResult = await res.json().catch(() => ({}));
  if (!res.ok) { showToast(paymentResult.error || "Payment failed"); return; }
  selectedOrder = paymentResult;
  if (wasMerged) selectedOrder.isMergedBill = true;
  tenderedRaw = "";

  if (selectedOrder.paymentStatus === "paid") {
    if (wasMerged) {
      document.getElementById("printBillRow").style.display = "block";
      document.getElementById("printBillLink").href = "#merged-bill-print";
      document.getElementById("printBillLink").textContent = "🧾 Print Merged Bill";
      document.getElementById("printBillLink").onclick = (e) => { e.preventDefault(); printMergedBill(selectedOrder); };
      printMergedBill(selectedOrder);
    } else {
      const receiptUrl = `receipt?orderId=${selectedOrder.id}&tendered=${tendered}&change=${change}&method=${method}`;
      document.getElementById("printBillRow").style.display = "block";
      document.getElementById("printBillLink").href = receiptUrl;
      document.getElementById("printBillLink").removeAttribute("target");
      document.getElementById("printBillLink").textContent = "🖨️ Print Receipt";
      printReceipt(receiptUrl);
    }
  } else {
    document.getElementById("printBillRow").style.display = "none";
  }

  if (selectedOrder.paymentStatus === "paid") {
    if (method === "cash" && change > 0) {
      document.getElementById("changeSummary").textContent = `Balance: ${posCurrency()}${change.toFixed(2)}`;
      document.getElementById("changeSummary").style.display = "block";
      showToast(`Paid ✓ — Balance ${posCurrency()}${change.toFixed(2)}`);
    } else {
      document.getElementById("changeSummary").style.display = "none";
      showToast(`${(selectedOrder.displayNum || orderNum(selectedOrder.id))} fully paid`);
    }
    loadReady();
  } else {
    showToast(`Recorded ${posCurrency()}${payable.toFixed(2)} (${method}) — balance remaining`);
  }
  renderDetail();
}

document.getElementById("discountBtn").onclick = async () => {
  if (!selectedOrder) return;
  const isMergedDiscount = !!selectedOrder.isMergedBill;
  const permsRes = await api("/api/permissions");
  const perms = permsRes.ok ? await permsRes.json() : { serverMaxDiscountPercent: 0 };
  const selfApproveHint = perms.serverMaxDiscountPercent > 0
    ? `<p style="font-size:11px; color:var(--success); margin:-4px 0 10px;">Percent discounts up to ${perms.serverMaxDiscountPercent}% don't need a PIN.</p>`
    : "";

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3 style="margin-top:0;">Apply Discount / Comp</h3>
      ${selfApproveHint}
      <label style="font-size:13px; font-weight:600;">Type</label>
      <select id="discType" data-cur="${selectedOrder.discount ? selectedOrder.discount.type : ''}" style="width:100%; padding:8px; margin:4px 0 10px; border:1px solid var(--border); border-radius:6px;">
        <option value="percent">Percent off</option>
        <option value="fixed">Fixed amount off</option>
      </select>
      <label style="font-size:13px; font-weight:600;">Value</label>
      <input id="discValue" type="number" step="0.01" value="${selectedOrder.discount ? selectedOrder.discount.value : ''}" placeholder="e.g. 10" style="width:100%; padding:8px; margin:4px 0 10px; border:1px solid var(--border); border-radius:6px;" />
      <label style="font-size:13px; font-weight:600;">Reason</label>
      <input id="discReason" placeholder="e.g. loyalty, comp for delay" style="width:100%; padding:8px; margin:4px 0 10px; border:1px solid var(--border); border-radius:6px;" />
      <label style="font-size:13px; font-weight:600;">Manager PIN <span style="font-weight:400; color:var(--muted);">(skip if within the self-approve limit above)</span></label>
      <input id="discPin" type="password" style="width:100%; padding:8px; margin:4px 0 14px; border:1px solid var(--border); border-radius:6px;" />
      <div style="display:flex; gap:8px;">
        ${selectedOrder.discount ? `<button class="btn btn-danger" id="discRemove" style="margin-right:auto;">Remove</button>` : ""}
      <button class="btn" id="discCancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="discConfirm" style="flex:1;">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  // Pre-select the existing discount type so editing starts from what's set
  const curType = backdrop.querySelector("#discType").dataset.cur;
  if (curType) backdrop.querySelector("#discType").value = curType;

  const discountEndpoint = isMergedDiscount ? `/api/table-bills/${selectedOrder.id}/discount` : `/api/orders/${selectedOrder.id}/discount`;
  const rmBtn = backdrop.querySelector("#discRemove");
  if (rmBtn) rmBtn.onclick = async () => {
    const res = await api(discountEndpoint, {
      method: "POST", json: { type: "percent", value: 0, reason: "Discount removed" },
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      showToast(e.error || "Could not remove discount");
      return;
    }
    selectedOrder = await res.json();
    if (isMergedDiscount) selectedOrder.isMergedBill = true;
    renderDetail();
    backdrop.remove();
    _lastPayHash = ""; loadReady();
    showToast("Discount removed");
  };

  backdrop.querySelector("#discCancel").onclick = () => backdrop.remove();
  backdrop.querySelector("#discConfirm").onclick = async () => {
    const type = backdrop.querySelector("#discType").value;
    const value = backdrop.querySelector("#discValue").value;
    const reason = backdrop.querySelector("#discReason").value;
    const pin = backdrop.querySelector("#discPin").value;
    const res = await api(discountEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, value, reason, pin }),
    });
    if (res.ok) {
      selectedOrder = await res.json();
      if (isMergedDiscount) selectedOrder.isMergedBill = true;
      renderDetail();
      backdrop.remove();
      _lastPayHash = ""; loadReady();
      showToast("Discount applied");
    } else {
      const err = await res.json();
      alert(err.error || "Could not apply discount");
    }
  };
};

document.getElementById("voidBtn").onclick = async () => {
  if (!selectedOrder || selectedOrder.isMergedBill) return;
  const reason = prompt("Reason for voiding this order:");
  if (reason == null) return;
  const pin = prompt("Manager PIN:");
  if (!pin) return;
  const res = await api(`/api/orders/${selectedOrder.id}/void`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, pin }),
  });
  if (res.ok) {
    showToast("Order voided");
    panel.style.display = "none";
    loadReady();
  } else {
    const err = await res.json();
    alert(err.error || "Could not void order");
  }
};

// ── Refund ─────────────────────────────────────────────────────
const refundBtnEl = document.getElementById("refundBtn");
if (refundBtnEl) refundBtnEl.onclick = () => { if (selectedOrder) openRefundModal(selectedOrder); };

function openRefundModal(o) {
  const c = posCurrency();
  const paid = Number(o.amountPaid || 0);
  const needsPin = !["superManager", "manager"].includes(staff.role);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:400px;">
      <h3 style="margin-top:0;">↩ Refund — ${(o.displayNum || ("#" + o.id))}</h3>
      <p style="font-size:13px; color:var(--muted); margin:0 0 14px;">Paid so far: <strong class="mono">${c}${paid.toFixed(2)}</strong></p>
      <div class="f"><label>Refund amount (${c})</label>
        <input id="rf_amount" type="number" step="0.01" min="0.01" max="${paid.toFixed(2)}" value="${paid.toFixed(2)}"/></div>
      <div class="f"><label>Method</label>
        <select id="rf_method"><option value="cash">💵 Cash</option><option value="card">💳 Card</option><option value="online">🏦 Online</option></select></div>
      <div class="f"><label>Reason *</label>
        <input id="rf_reason" placeholder="e.g. wrong item, customer complaint"/></div>
      ${needsPin ? `<div class="f"><label>Manager approval PIN *</label>
        <input id="rf_pin" type="password" inputmode="numeric" placeholder="Approval PIN"/></div>` : ""}
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn" id="rf_cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-danger" id="rf_go" style="flex:1;">Refund</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#rf_cancel").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#rf_go").onclick = async () => {
    const amount = parseFloat(backdrop.querySelector("#rf_amount").value);
    const method = backdrop.querySelector("#rf_method").value;
    const reason = backdrop.querySelector("#rf_reason").value.trim();
    const pin = needsPin ? backdrop.querySelector("#rf_pin").value.trim() : "";
    if (!amount || amount <= 0) return showToast("Enter a refund amount");
    if (!reason) return showToast("A reason is required");
    if (needsPin && !pin) return showToast("Manager approval PIN required");
    const btn = backdrop.querySelector("#rf_go"); btn.disabled = true; btn.textContent = "Refunding…";
    const res = await api(`/api/orders/${o.id}/refund`, { method: "POST", json: { amount, method, reason, pin } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(r.error || "Refund failed"); btn.disabled = false; btn.textContent = "Refund"; return; }
    showToast(`Refunded ${c}${amount.toFixed(2)}`);
    close();
    selectedOrder = r;
    renderDetail();
    loadReady();
  };
}

if (staff) {
  if (!blockIfNoBranchSelected(staff, listEl)) {
    loadReady().then(() => {
      // Deep-link from Order Entry's "Send & Pay" — open that order straight away.
      const qid = new URLSearchParams(window.location.search).get("orderId");
      if (qid) selectOrder(Number(qid));
    });
    setInterval(loadReady, 5000);
  }
}

})();
