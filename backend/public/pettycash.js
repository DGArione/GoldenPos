(async () => {
// pettycash.js — Phase 5: simple cash-drawer ledger. Manager/Super Manager/
// Finance can record entries; balance = sum(in) - sum(out).
const staff = requireLogin();
if (staff) renderNav("pettycash", staff);

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

async function load() {
  const res = await api("/api/petty-cash");
  if (!res.ok) { document.getElementById("ledgerRows").innerHTML = `<tr><td colspan="5" class="empty-state">No access.</td></tr>`; return; }
  const { entries, balance } = await res.json();
  const c = posCurrency();
  document.getElementById("balance").textContent = `${c}${balance.toFixed(2)}`;
  document.getElementById("balance").style.color = balance < 0 ? "var(--danger)" : "var(--success)";

  document.getElementById("ledgerRows").innerHTML = entries.length
    ? entries.map((e) => `
        <tr>
          <td>${new Date(e.createdAt).toLocaleString()}</td>
          <td><span class="badge ${e.type === "in" ? "badge-open" : "badge-dirty"}">${e.type === "in" ? "cash in" : "cash out"}</span></td>
          <td>${e.reason || "—"}</td>
          <td>${e.recordedBy}</td>
          <td class="mono" style="text-align:right; color:${e.type === "in" ? "var(--success)" : "var(--danger)"};">${e.type === "in" ? "+" : "-"}${c}${e.amount.toFixed(2)}</td>
        </tr>`).join("")
    : `<tr><td colspan="5" class="empty-state">No petty cash entries yet.</td></tr>`;
}

document.getElementById("addEntryBtn").onclick = async () => {
  const type = document.getElementById("entryType").value;
  const amount = document.getElementById("entryAmount").value;
  const reason = document.getElementById("entryReason").value.trim();
  if (!amount || Number(amount) <= 0) return showToast("Enter a valid amount");
  const res = await api("/api/petty-cash", { method: "POST", json: { type, amount, reason } });
  if (!res.ok) { showToast("Could not record entry"); return; }
  document.getElementById("entryAmount").value = "";
  document.getElementById("entryReason").value = "";
  showToast(type === "in" ? "Cash in recorded" : "Cash out recorded");
  load();
};

if (staff) load();

})();
