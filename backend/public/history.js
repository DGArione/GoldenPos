(async () => {
let _lastHistoryHash = "";
// history.js
const staff = requireLogin();
if (staff) renderNav("history", staff);

let allOrders = [];
let activeStatus = "";

const listEl = document.getElementById("orderList");

async function load() {
  const res = await api("/api/orders");
  const orders = await res.json();
  // Only re-render if data changed
  const hash = orders.map(o => o.id + o.status + o.paymentStatus).join(",");
  if (hash === _lastHistoryHash) return;
  _lastHistoryHash = hash;
  allOrders = orders;
  render();
}

function render() {
  let filtered = activeStatus === "paid"
    ? allOrders.filter((o) => o.paymentStatus === "paid")
    : activeStatus ? allOrders.filter((o) => o.status === activeStatus) : allOrders;
  const searchId = document.getElementById("searchOrderId").value.trim();
  if (searchId) filtered = filtered.filter((o) => String(o.id) === searchId);
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No orders here.</div>`;
    return;
  }
  listEl.innerHTML = "";
  filtered.forEach((o) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style = "padding:15px 18px;";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${o.priority === "high" ? "🔥 " : ""}${(o.displayNum || (o.displayNum || orderNum(o.id)))}</strong> · ${o.tableName}${o.orderType && o.orderType !== "dine-in" ? ` <span class="badge badge-ordered">${o.orderType}</span>` : ""}${o.source === "qr" ? ` <span class="badge badge-ready">QR</span>` : o.source === "online" ? ` <span class="badge badge-ordered">Online</span>` : ""} · <span style="color:var(--muted); font-size:13px;">${o.staffName}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="mono">${posCurrency()}${o.total.toFixed(2)}</span>
          <span class="badge badge-${o.status === "dispatched" ? "dirty" : o.status}">${o.status}</span>
          <span class="badge ${o.paymentStatus === "paid" ? "badge-paid" : "badge-pending"}">${o.paymentStatus === "paid" ? "paid" : "unpaid"}</span>
        </div>
      </div>
      <div style="font-size:12px; color:var(--muted); margin-top:4px;">
        ${new Date(o.createdAt).toLocaleString()} · ${o.items.map((i) => `${i.qty}x ${i.name}`).join(", ")}
      </div>
      ${o.kitchenTag ? `<div style="font-size:12px; color:var(--warning); margin-top:4px;">⚠ Kitchen flagged: ${o.kitchenTag.type}${o.kitchenTag.note ? " — " + o.kitchenTag.note : ""}</div>` : ""}
      ${o.void ? `<div style="font-size:12px; color:var(--danger); margin-top:4px;">Voided by ${o.void.byStaffName}: "${o.void.reason}"</div>` : ""}
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn" data-detail="${o.id}" style="font-size:12px; padding:5px 12px;">📋 Details</button>
        ${o.paymentStatus === "paid"
          ? `<button class="btn" data-reprint="${o.id}" style="font-size:12px; padding:5px 12px;">🖨️ Reprint Bill</button>
             <a class="btn" href="receipt?orderId=${o.id}" style="font-size:12px; padding:5px 12px; text-decoration:none;">View receipt →</a>`
          : ""}
      </div>
    `;
    card.querySelector("[data-detail]").onclick = () => showDetail(o);
    const rp = card.querySelector("[data-reprint]");
    if (rp) rp.onclick = () => reprintBill(o.id);
    listEl.appendChild(card);
  });
}

// Reprint straight to the printer — no need to open the receipt page first.
// receipt.js renders asynchronously and prints itself once ready (?print=1);
// printing on iframe load would catch it mid-"Loading…".
async function reprintBill(orderId) {
  // Prefer the thermal print agent when configured (no browser dialog).
  if (typeof posPrintAgentReady === "function" && posPrintAgentReady()) {
    const o = allOrders.find((x) => x.id === Number(orderId));
    if (o && window.posReceiptText) {
      const ok = await posSendToAgent({ type: "receipt", title: "Receipt", text: posReceiptText(o, window.posSettings), copies: 1 });
      if (ok) { showHistToast("Sent to printer"); return; }
    }
  }
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  frame.src = `receipt?orderId=${orderId}&print=1`;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 60000);
}

// Full breakdown for one order, including how it was paid.
function showDetail(o) {
  const c   = posCurrency();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const METHOD_LABEL = { cash: "💵 Cash", card: "💳 Card", online: "🏦 Online Transfer", wallet: "📱 Wallet", loyalty: "💛 Points", giftcard: "🎁 Gift Card" };
  const isTakeaway = o.orderType && o.orderType !== "dine-in";

  const itemRows = (o.items || []).map((it) => `
    <div style="padding:7px 0; border-bottom:1px solid var(--border-soft);">
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <span>${it.qty}× ${esc(it.name)}</span>
        <span class="mono">${c}${Number(it.lineTotal || 0).toFixed(2)}</span>
      </div>
      ${(it.modifiers && it.modifiers.length)
        ? `<div style="font-size:11px; color:var(--muted); padding-left:14px;">+ ${it.modifiers.map(m => esc(m.option || m.name)).join(", ")}</div>` : ""}
      ${it.notes ? `<div style="font-size:11px; color:var(--danger); padding-left:14px;">⚠ ${esc(it.notes)}</div>` : ""}
    </div>`).join("");

  // Payments, with the bank's cut shown where one was taken
  const payRows = (o.payments || []).length
    ? o.payments.map((p) => {
        const fee = Number(p.feeAmount || 0);
        const net = p.netAmount != null ? Number(p.netAmount) : Number(p.amount || 0) - fee;
        return `
        <div style="display:flex; justify-content:space-between; padding:3px 0;">
          <span>${METHOD_LABEL[p.method] || esc(p.method)}
            <span style="font-size:11px; color:var(--muted);">${p.paidAt ? new Date(p.paidAt).toLocaleString() : ""}</span>
          </span>
          <span class="mono">${c}${Number(p.amount || 0).toFixed(2)}</span>
        </div>
        ${fee > 0 ? `
        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--danger); padding-left:14px;">
          <span>card fee ${(Number(p.feePercent || 0) * 100).toFixed(2)}%</span><span class="mono">−${c}${fee.toFixed(2)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--muted); padding-left:14px;">
          <span>received</span><span class="mono">${c}${net.toFixed(2)}</span>
        </div>` : ""}`;
      }).join("")
    : `<div style="color:var(--muted); font-size:12px;">No payments recorded.</div>`;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="max-width:460px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h3 style="margin:0 0 2px;">${o.priority === "high" ? "🔥 " : ""}${esc(o.displayNum || orderNum(o.id))}</h3>
          <div style="font-size:12px; color:var(--muted);">
            ${esc(o.tableName)}${isTakeaway ? ` · ${esc(o.orderType)} · ${esc(o.customerName?.trim() || "no name")}` : ""}
          </div>
          <div style="font-size:12px; color:var(--muted);">Server: ${esc(o.staffName || "—")}</div>
          <div style="font-size:12px; color:var(--muted);">${new Date(o.createdAt).toLocaleString()}</div>
        </div>
        <button class="btn" id="hdClose" style="padding:4px 10px; font-size:16px; line-height:1;">×</button>
      </div>

      <div style="display:flex; gap:6px; margin:10px 0;">
        <span class="badge badge-${o.status === "dispatched" ? "dirty" : o.status}">${esc(o.status)}</span>
        <span class="badge ${o.paymentStatus === "paid" ? "badge-paid" : "badge-pending"}">${o.paymentStatus === "paid" ? "paid" : "unpaid"}</span>
      </div>

      ${o.note ? `<div style="font-size:12px; color:var(--warning); margin-bottom:8px;">📝 ${esc(o.note)}</div>` : ""}
      ${o.void ? `<div style="font-size:12px; color:var(--danger); margin-bottom:8px;">Voided by ${esc(o.void.byStaffName)}: "${esc(o.void.reason)}"</div>` : ""}

      <div style="max-height:200px; overflow-y:auto; font-size:13px;">${itemRows}</div>

      <div class="mono" style="font-size:13px; border-top:1px solid var(--border); padding-top:10px; margin-top:10px;">
        <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><span>${c}${Number(o.subtotal||0).toFixed(2)}</span></div>
        ${o.discount ? `<div style="display:flex; justify-content:space-between; color:var(--danger);">
          <span>Discount${o.discount.reason ? ` (${esc(o.discount.reason)})` : ""}</span><span>−${c}${Number(o.discount.amount||0).toFixed(2)}</span></div>
          ${o.discount.approvedBy ? `<div style="font-size:11px; color:var(--muted); text-align:right;">approved by ${esc(o.discount.approvedBy)}</div>` : ""}` : ""}
        ${o.promo && o.promo.amount ? `<div style="display:flex; justify-content:space-between; color:var(--accent);">
          <span>Promo (${esc(o.promo.name)})</span><span>−${c}${Number(o.promo.amount).toFixed(2)}</span></div>` : ""}
        <div style="display:flex; justify-content:space-between;"><span>Service Charge</span><span>${c}${Number(o.serviceCharge||0).toFixed(2)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>VAT</span><span>${c}${Number(o.vat||0).toFixed(2)}</span></div>
        ${o.tipAmount > 0 ? `<div style="display:flex; justify-content:space-between; color:var(--accent);"><span>Tip</span><span>${c}${Number(o.tipAmount).toFixed(2)}</span></div>` : ""}
        <div style="display:flex; justify-content:space-between; font-weight:700; font-size:16px; padding-top:5px; border-top:1px solid var(--border); margin-top:5px;">
          <span>Total</span><span>${c}${Number(o.grandTotal || o.total || 0).toFixed(2)}</span>
        </div>
      </div>

      <div style="border-top:1px solid var(--border); padding-top:10px; margin-top:10px; font-size:13px;">
        <div style="font-weight:700; margin-bottom:4px;">Payments</div>
        ${payRows}
      </div>

      <div style="display:flex; gap:8px; margin-top:16px;">
        <button class="btn" id="hdCloseBtn" style="flex:1;">Close</button>
        ${Number(o.amountPaid || 0) > 0
          ? `<button class="btn btn-danger" id="hdRefund" style="flex:1;">↩ Refund</button>` : ""}
        ${o.paymentStatus === "paid"
          ? `<button class="btn btn-primary" id="hdPrint" style="flex:1;">🖨️ Reprint Bill</button>` : ""}
      </div>
    </div>`;

  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#hdClose").onclick    = close;
  backdrop.querySelector("#hdCloseBtn").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  const pb = backdrop.querySelector("#hdPrint");
  if (pb) pb.onclick = () => reprintBill(o.id);
  const rb = backdrop.querySelector("#hdRefund");
  if (rb) rb.onclick = () => { close(); openRefundModal(o); };
}

// Refund an order straight from History: select the order → Details → Refund.
// The refund is a negative payment, so it flows into the dashboard and reports
// automatically. Managers/superManagers refund directly; everyone else must
// enter a manager approval PIN (enforced again on the server).
function openRefundModal(o) {
  const c = posCurrency();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const paid = Number(o.amountPaid || 0);
  const needsPin = !["superManager", "manager", "admin"].includes(staff.role);
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:400px;">
      <h3 style="margin-top:0;">↩ Refund — ${esc(o.displayNum || ("#" + o.id))}</h3>
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
    if (!amount || amount <= 0) return showHistToast("Enter a refund amount");
    if (!reason) return showHistToast("A reason is required");
    if (needsPin && !pin) return showHistToast("Manager approval PIN required");
    const btn = backdrop.querySelector("#rf_go"); btn.disabled = true; btn.textContent = "Refunding…";
    const res = await api(`/api/orders/${o.id}/refund`, { method: "POST", json: { amount, method, reason, pin } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { showHistToast(r.error || "Refund failed"); btn.disabled = false; btn.textContent = "Refund"; return; }
    showHistToast(`Refunded ${c}${amount.toFixed(2)}`);
    close();
    _lastHistoryHash = "";   // force a re-render
    load();
  };
}

function showHistToast(msg) {
  const t = document.getElementById("toast");
  if (!t) { alert(msg); return; }
  t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

document.querySelectorAll("#statusFilter .tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#statusFilter .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeStatus = btn.dataset.status;
    render();
  };
});

document.getElementById("searchOrderId").addEventListener("input", render);

if (staff) { load(); setInterval(load, 15000); }

})();
