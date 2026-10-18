(async () => {
// zreport.js — Phase 5: generate and review immutable end-of-day closeout
// reports. Generation is Manager/Super Manager only; Finance can view.
const staff = requireLogin();
if (staff) {
  renderNav("zreport", staff);
  if (!isManagerRole(staff)) document.getElementById("generateCard").style.display = "none";
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function todayRange() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

document.getElementById("todayBtn").onclick = () => {
  const { from, to } = todayRange();
  document.getElementById("fromDate").value = from;
  document.getElementById("toDate").value = to;
};
document.getElementById("todayBtn").click(); // default to today's range

document.getElementById("generateBtn").onclick = async () => {
  const fromDate = document.getElementById("fromDate").value;
  const toDate = document.getElementById("toDate").value;
  if (!fromDate || !toDate) return showToast("Pick a date range first");
  const res = await api("/api/zreports", { method: "POST", json: { fromDate, toDate } });
  if (!res.ok) { showToast("Could not generate report"); return; }
  showToast("Z-Report generated");
  load();
};

function reportCard(z) {
  const c = posCurrency();
  return `
    <div class="card" style="padding:0; overflow:hidden;">
      <div class="ticket-header" style="display:flex; justify-content:space-between; align-items:center;">
        <span>Z-Report #${z.id} · ${new Date(z.fromDate).toLocaleDateString()} → ${new Date(z.toDate).toLocaleDateString()}</span>
        <span style="font-size:11px; color:var(--muted); text-transform:none; letter-spacing:0;">by ${z.generatedBy} · ${new Date(z.generatedAt).toLocaleString()}</span>
      </div>
      <div style="padding:16px 18px; display:grid; grid-template-columns: repeat(4, 1fr); gap:14px;">
        <div><div style="font-size:11px; color:var(--muted);">Orders</div><div class="mono" style="font-weight:700; font-size:16px;">${z.orderCount}</div></div>
        <div><div style="font-size:11px; color:var(--muted);">Gross Sales</div><div class="mono" style="font-weight:700; font-size:16px;">${c}${z.grossSales.toFixed(2)}</div></div>
        <div><div style="font-size:11px; color:var(--muted);">Discounts</div><div class="mono" style="font-weight:700; font-size:16px; color:var(--danger);">-${c}${z.totalDiscounts.toFixed(2)}</div></div>
        <div><div style="font-size:11px; color:var(--muted);">Net Sales</div><div class="mono" style="font-weight:700; font-size:16px; color:var(--success);">${c}${z.netSales.toFixed(2)}</div></div>
      </div>
      <div style="padding:0 18px 16px; display:grid; grid-template-columns: repeat(4, 1fr); gap:14px; font-size:13px; color:var(--muted);">
        <div>Service Charge<br><span class="mono" style="color:var(--text);">${c}${z.totalServiceCharge.toFixed(2)}</span></div>
        <div>VAT<br><span class="mono" style="color:var(--text);">${c}${z.totalVat.toFixed(2)}</span></div>
        <div>Voided Orders<br><span class="mono" style="color:var(--text);">${z.voidedCount} (${c}${z.voidedTotal.toFixed(2)})</span></div>
        <div>Cash / Card / Wallet<br><span class="mono" style="color:var(--text);">${c}${z.paymentBreakdown.cash.toFixed(0)} / ${c}${z.paymentBreakdown.card.toFixed(0)} / ${c}${z.paymentBreakdown.wallet.toFixed(0)}</span></div>
      </div>
      <div class="no-print" style="padding:0 18px 16px;">
        <button class="btn" onclick="window.print()" style="font-size:12px; padding:6px 10px;">🖨️ Print</button>
      </div>
    </div>`;
}

async function load() {
  const res = await api("/api/zreports");
  if (!res.ok) { document.getElementById("reportList").innerHTML = `<div class="empty-state">No access.</div>`; return; }
  const reports = await res.json();
  document.getElementById("reportList").innerHTML = reports.length
    ? reports.map(reportCard).join("")
    : `<div class="empty-state">No Z-Reports generated yet.</div>`;
}

if (staff) load();

})();
