(async () => {
// receipt.js — real-world receipt with business contact details, change/balance
// row, clean barcode, and "Powered by RapidSolutions" footer.
const params = new URLSearchParams(window.location.search);
const orderId = params.get("orderId");
const tenderedParam = parseFloat(params.get("tendered")) || 0;
const changeParam   = parseFloat(params.get("change"))   || 0;
const methodParam   = params.get("method") || "";

async function loadReceipt() {
  const [settingsRes, orderRes] = await Promise.all([
    fetch("api/public/settings"),
    api(`/api/orders/${orderId}`),
  ]);

  const s = await settingsRes.json().catch(() => ({}));
  const c          = s.currencySymbol    || "Rs. ";
  const bizName    = s.businessName      || "Restaurant POS";
  const tagline    = s.businessTagline   || "";
  const phone      = s.businessPhone     || "";
  const address    = s.businessAddress   || "";
  const email      = s.businessEmail     || "";
  const footer     = s.receiptFooterText || "Thank you for dining with us!";
  const showVat    = s.receiptShowVatBreakdown !== false;

  if (!orderRes.ok) {
    document.getElementById("receipt").innerHTML = `<p style="color:red;">Order #${orderId} not found.</p>`;
    return;
  }
  const o = await orderRes.json();

  const isPaid     = o.paymentStatus === "paid";
  const totalPaid  = +(o.payments || []).reduce((s, p) => s + p.amount, 0).toFixed(2);
  const balanceDue = +(o.total - totalPaid).toFixed(2);

  // Use URL-passed tendered/change for the receipt printed immediately after
  // payment. If opened from History/Last Receipt without those params, derive
  // change from the payments already recorded.
  let displayTendered = tenderedParam;
  let displayChange   = changeParam;
  if (!displayTendered && isPaid) {
    const cashTotal = (o.payments || []).filter(p => p.method === "cash").reduce((s,p) => s+p.amount, 0);
    displayTendered = cashTotal;
    displayChange   = +(cashTotal - o.total).toFixed(2);
    if (displayChange < 0) displayChange = 0;
  }

  const now = new Date(o.paidAt || o.createdAt);
  const dateStr = now.toLocaleDateString("en-LK", { year: "numeric", month: "long", day: "2-digit" });
  const timeStr = now.toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit" });

  // Items
  const itemsHtml = o.items.map(i => `
    <div class="row"><span class="item-name">${i.qty} x ${i.name}</span><span>${c}${i.lineTotal.toFixed(2)}</span></div>
    ${i.modifiers && i.modifiers.length ? `<div class="item-mod">${i.modifiers.map(m => `+ ${m.option}`).join(", ")}</div>` : ""}
    ${i.notes ? `<div class="item-note">↳ ${i.notes}</div>` : ""}
  `).join("");

  const METHOD_ICON  = { cash: "💵", card: "💳", wallet: "📱", online: "🏦", loyalty: "💛", giftcard: "🎁" };
  const METHOD_LABEL = { cash: "Cash", card: "Card", wallet: "Digital Wallet", online: "Online Transfer", loyalty: "Loyalty Points", giftcard: "Gift Card" };
  const paymentsHtml = (o.payments || []).map(p => `
    <div class="row">
      <span>${METHOD_ICON[p.method] || ""} ${METHOD_LABEL[p.method] || p.method}</span>
      <span>${c}${p.amount.toFixed(2)}</span>
    </div>`).join("") || `<div class="row muted"><span>—</span><span>No payment yet</span></div>`;

  const taxHtml = showVat ? `
    <div class="row muted"><span>Service Charge</span><span>${c}${o.serviceCharge.toFixed(2)}</span></div>
    <div class="row muted"><span>VAT</span><span>${c}${o.vat.toFixed(2)}</span></div>` : "";

  // Cash tendered & change row (only when tendered amount > 0)
  const tenderedHtml = displayTendered > 0 ? `
    <hr class="dashed">
    <div class="row"><span>${METHOD_ICON["cash"]} Cash Tendered</span><span>${c}${displayTendered.toFixed(2)}</span></div>
    ${displayChange > 0 ? `<div class="row change-row"><span>Balance</span><span>${c}${displayChange.toFixed(2)}</span></div>` : ""}
  ` : "";

  // Balance due (for pre-payment / partial bills)
  const balanceHtml = !isPaid ? `
    <hr class="dashed">
    <div class="row balance-row"><span>Balance Due</span><span>${c}${balanceDue.toFixed(2)}</span></div>` : "";

  // Receipt ID (zero-padded)
  const receiptNo = `#${String(o.id).padStart(6,"0")}`;

  document.getElementById("receipt").innerHTML = `
    <!-- ===== HEADER ===== -->
    <div class="receipt-header">
      <div class="receipt-logo">🍽️</div>
      <div class="receipt-biz-name">${bizName.toUpperCase()}</div>
      ${tagline ? `<div class="receipt-tagline">${tagline}</div>` : ""}
      ${address ? `<div class="receipt-meta">📍 ${address}</div>` : ""}
      ${phone   ? `<div class="receipt-meta">📞 ${phone}</div>` : ""}
      ${email   ? `<div class="receipt-meta">✉ ${email}</div>` : ""}
      ${s.taxRegNo ? `<div class="receipt-meta">TRN: ${s.taxRegNo}</div>` : ""}
      ${o.orderType && o.orderType !== "dine-in"
        ? `<div style="margin-top:6px;"><span class="badge-pill">${o.orderType.toUpperCase()}</span></div>` : ""}
    </div>

    <hr class="solid">

    <!-- ===== ORDER INFO ===== -->
    <div class="row"><span>Receipt</span><span>${receiptNo}</span></div>
    ${o.fiscalNumber ? `<div class="row"><span>Fiscal Invoice</span><span>${o.fiscalNumber}</span></div>` : ""}
    <div class="row"><span>Date</span><span>${dateStr}</span></div>
    <div class="row"><span>Time</span><span>${timeStr}</span></div>
    <div class="row"><span>Table / Order</span><span>${o.tableName}</span></div>
    <div class="row"><span>Served by</span><span>${o.staffName}</span></div>
    ${o.customerName ? `<div class="row"><span>Customer</span><span>${o.customerName}</span></div>` : ""}
    ${o.customerPhone ? `<div class="row"><span>Phone</span><span>${o.customerPhone}</span></div>` : ""}
    ${o.note ? `<div class="row muted" style="margin-top:4px;"><span>Note</span><span style="max-width:55%;text-align:right;font-style:italic;">${o.note}</span></div>` : ""}

    <hr class="dashed">

    <!-- ===== ITEMS ===== -->
    <div class="row muted" style="padding-bottom:4px; border-bottom:1px solid #eee; margin-bottom:6px;">
      <span>DESCRIPTION</span><span>AMOUNT</span>
    </div>
    ${itemsHtml}

    <hr class="dashed">

    <!-- ===== TOTALS ===== -->
    <div class="row"><span>Subtotal</span><span>${c}${o.subtotal.toFixed(2)}</span></div>
    ${o.discount ? `<div class="row" style="color:#b23b30;"><span>Discount (${o.discount.type==="percent" ? o.discount.value+"%" : "fixed"})</span><span>-${c}${o.discount.amount.toFixed(2)}</span></div>` : ""}
    ${o.promo && o.promo.amount ? `<div class="row" style="color:#b23b30;"><span>Promo (${o.promo.name})</span><span>-${c}${o.promo.amount.toFixed(2)}</span></div>` : ""}
    ${taxHtml}
    <div class="row total-row"><span>TOTAL</span><span>${c}${o.total.toFixed(2)}</span></div>

    <hr class="dashed">

    <!-- ===== PAYMENT ===== -->
    <div class="row muted" style="margin-bottom:4px;"><span>PAYMENT RECEIVED</span><span></span></div>
    ${paymentsHtml}
    ${tenderedHtml}
    ${balanceHtml}

    <!-- ===== PAID / UNPAID STAMP ===== -->
    <div class="badge-row" style="margin-top:14px;">
      <span class="badge-pill ${isPaid ? "badge-paid" : "badge-unpaid"}">${isPaid ? "✓  PAID" : "⚠  UNPAID"}</span>
    </div>

    <hr class="dashed" style="margin-top:14px;">

    <!-- ===== BARCODE ===== -->
    <div class="barcode-area">
      <div class="barcode-lines">|||||| |||| ||||||| |||| ||||||</div>
      <div class="barcode-num">${receiptNo}</div>
    </div>

    <hr class="dashed">

    <!-- ===== FOOTER ===== -->
    <div class="receipt-footer">
      <div class="thank-you">${footer.toUpperCase()}</div>
      <div>Please retain this receipt</div>
      ${phone ? `<div>📞 ${phone}</div>` : ""}
      <div style="margin-top:6px; font-size:9px; color:#ccc;">Powered by RapidSolutions</div>
    </div>
  `;

  document.title = `Receipt ${receiptNo} — ${bizName}`;

  // Auto-print (used by the payment screen and History reprint, which load
  // this page inside a hidden iframe). Wait for any logo image to finish
  // decoding first, otherwise the sheet can come out missing it.
  if (params.get("print") === "1") {
    const imgs = [...document.images].filter((i) => !i.complete);
    const ready = imgs.length
      ? Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; })))
      : Promise.resolve();
    // Cap the wait so a broken image can never block the print
    await Promise.race([ready, new Promise((r) => setTimeout(r, 2000))]);
    requestAnimationFrame(() => setTimeout(() => window.print(), 60));
  }
}

loadReceipt();

})();
