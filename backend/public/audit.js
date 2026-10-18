(async () => {
// audit.js — change-audit trail viewer.
const staff = requireLogin();
if (staff) renderNav("audit", staff);

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const METHOD_COLOR = { POST: "var(--success)", PUT: "var(--accent)", PATCH: "var(--accent)", DELETE: "var(--danger)" };
let ROWS = [];

async function load() {
  const res = await api("/api/audit-log?limit=400");
  ROWS = res.ok ? await res.json() : [];
  render();
}

// Turn /orders/42/refund → "refund order 42", etc. — a friendlier action label.
function actionLabel(r) {
  const p = (r.path || "").replace(/^\//, "");
  return `${r.method} ${p}`;
}

function render() {
  const q = (document.getElementById("auditSearch").value || "").toLowerCase();
  const rows = ROWS.filter((r) => !q || (r.userName + " " + r.path + " " + r.summary + " " + r.method).toLowerCase().includes(q));
  const el = document.getElementById("auditList");
  if (!rows.length) { el.innerHTML = `<div class="empty-state">No audit entries${q ? " match your filter" : " yet"}.</div>`; return; }
  el.innerHTML = `
    <div class="card" style="padding:0; overflow:hidden;">
      <table><thead><tr>
        <th style="padding:9px 14px;">When</th><th>User</th><th>Action</th><th>Details</th>
      </tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td style="padding:8px 14px; color:var(--muted); font-size:12px; white-space:nowrap;">${new Date(r.createdAt).toLocaleString()}</td>
        <td style="white-space:nowrap;"><strong>${esc(r.userName)}</strong> <span class="badge badge-${r.role === "admin" || r.role === "superManager" ? "admin" : r.role}" style="font-size:10px;">${esc(r.role)}</span></td>
        <td class="mono" style="font-size:12px; color:${METHOD_COLOR[r.method] || "var(--text)"};">${esc(actionLabel(r))}</td>
        <td style="font-size:11px; color:var(--muted); max-width:380px; overflow:hidden; text-overflow:ellipsis;">${esc(r.summary || "")}</td>
      </tr>`).join("")}
      </tbody></table>
    </div>`;
}

document.getElementById("auditSearch").addEventListener("input", render);
if (staff) load();

})();
