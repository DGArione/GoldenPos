(async () => {
// branches.js — superManager only.
const staff = requireLogin();
if (staff) {
  renderNav("branches", staff);
  if (staff.role !== "superManager") {
    document.body.innerHTML = "<div style='padding:40px; text-align:center; color:var(--muted);'>Super admin access only.</div>";
  }
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

async function load() {
  const res = await api("/api/branches");
  const branches = await res.json();
  const dashRes = await api("/api/dashboard/summary");
  const dash = await dashRes.json();
  render(branches, dash.branches);
}

function render(branches, summaries) {
  const listEl = document.getElementById("branchList");
  listEl.innerHTML = branches.map((b) => {
    const s = summaries.find((x) => x.branchId === b.id) || {};
    return `
      <div class="card" style="padding:16px 18px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong style="font-size:15px;">${b.name}</strong>
            <span class="badge badge-${b.status === "active" ? "open" : "dirty"}" style="margin-left:8px;">${b.status}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn" data-action="toggle" data-id="${b.id}" data-status="${b.status}">${b.status === "active" ? "Set Maintenance" : "Set Active"}</button>
            <button class="btn" data-action="enter" data-id="${b.id}">Manage →</button>
            <button class="btn btn-danger" data-action="delete" data-id="${b.id}" data-name="${b.name}">Delete</button>
          </div>
        </div>
        <div style="font-size:13px; color:var(--muted); margin-top:4px;">${b.address || "No address set"}</div>
        <div class="mono" style="display:flex; gap:18px; margin-top:10px; font-size:12px; color:var(--muted);">
          <span>💰 ${posCurrency()}${(s.revenueToday || 0).toFixed(2)} today</span>
          <span>🍳 ${s.inKitchen || 0} in kitchen</span>
          <span>🪑 ${s.openTables || 0} tables in use</span>
          <span style="color:${s.lowStockCount ? "var(--danger)" : "var(--muted)"};">📦 ${s.lowStockCount || 0} low stock</span>
        </div>
      </div>`;
  }).join("") || `<div class="empty-state">No branches yet.</div>`;

  listEl.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.onclick = async () => {
      const newStatus = btn.dataset.status === "active" ? "maintenance" : "active";
      await api(`/api/branches/${btn.dataset.id}`, { method: "PUT", json: { status: newStatus } });
      load();
    };
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.onclick = async () => {
      const confirmText = prompt(`Type DELETE to confirm removing branch "${btn.dataset.name}". This cannot be undone.`);
      if (confirmText !== "DELETE") return;
      await api(`/api/branches/${btn.dataset.id}`, { method: "DELETE" });
      showToast(`Branch "${btn.dataset.name}" deleted`);
      load();
    };
  });
  listEl.querySelectorAll('[data-action="enter"]').forEach((btn) => {
    btn.onclick = () => {
      localStorage.setItem("posActiveBranchId", btn.dataset.id);
      window.location.href = "order";
    };
  });
}

document.getElementById("addBtn").onclick = async () => {
  const name = document.getElementById("newName").value.trim();
  const address = document.getElementById("newAddress").value.trim();
  if (!name) return showToast("Branch name required");
  await api("/api/branches", { method: "POST", json: { name, address } });
  document.getElementById("newName").value = "";
  document.getElementById("newAddress").value = "";
  showToast(`Added ${name}`);
  load();
};

if (staff && staff.role === "superManager") load();

})();
