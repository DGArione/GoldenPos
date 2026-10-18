(async () => {
// payroll.js
const staff = requireLogin();
if (staff) {
  renderNav("payroll", staff);
  if (!canViewFinanceData(staff)) {
    document.body.innerHTML = "<div style='padding:40px; text-align:center; color:var(--muted);'>Manager or Finance access only.</div>";
  }
}

let activeRange = "month";

async function load() {
  const res = await api(`/api/payroll/summary?range=${activeRange}`);
  const data = await res.json();
  render(data);
}

function render(data) {
  const banner = document.getElementById("clockedInBanner");
  if (data.currentlyClockedIn.length) {
    banner.style.display = "block";
    banner.textContent = `🟢 Currently clocked in: ${data.currentlyClockedIn.join(", ")}`;
  } else {
    banner.style.display = "none";
  }

  const rowsEl = document.getElementById("rows");
  if (data.rows.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="4" class="empty-state">No completed shifts in this range yet.</td></tr>`;
    return;
  }
  rowsEl.innerHTML = data.rows.map((r) => `
    <tr>
      <td>${r.userName}</td>
      <td class="mono">${r.payType==='daily' ? (r.days||0)+'d' : r.hours+'h'}</td>
      <td class="mono">${posCurrency()}${(r.payRate||0).toFixed(2)}/${r.payType==='daily'?'day':'hr'}</td>
      <td class="mono" style="font-weight:600;">${posCurrency()}${(r.amountDue||0).toFixed(2)}</td>
    </tr>`).join("");
}

document.querySelectorAll("#rangeTabs .tab").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll("#rangeTabs .tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeRange = btn.dataset.range;
    load();
  };
});

if (staff && canViewFinanceData(staff)) load();

})();
