(async () => {
// loyalty.js — the Loyalty add-on dashboard: rules, top members, activity.
const staff = requireLogin();
if (staff) renderNav("loyalty", staff);

const cur = () => (typeof posCurrency === "function" ? posCurrency() : "$");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const canEdit = staff && ["superManager", "manager", "admin"].includes(staff.role);

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

async function load() {
  const res = await api("/api/loyalty/report");
  if (!res.ok) return;
  const d = await res.json();
  const s = d.settings || {};

  document.getElementById("lyIssued").textContent = Math.round(d.issued || 0);
  document.getElementById("lyRedeemed").textContent = Math.round(d.redeemed || 0);
  const outstanding = (d.top || []).reduce((a, c) => a + (c.loyaltyPoints || 0), 0);
  document.getElementById("lyOutstanding").textContent = Math.round(outstanding);
  document.getElementById("lyMembers").textContent = (d.top || []).length;

  // Rules — plain English + an editable form for managers
  const per = s.loyaltyEarnPer || 100, pts = s.loyaltyEarnPoints || 1, val = s.loyaltyRedeemValue || 1, min = s.loyaltyMinRedeem || 0;
  document.getElementById("lyRulesPlain").innerHTML =
    `Earn <strong>${pts}</strong> point${pts == 1 ? "" : "s"} for every <strong>${cur()}${per}</strong> spent. ` +
    `Each point is worth <strong>${cur()}${val}</strong> at redemption.` +
    (min > 0 ? ` Minimum <strong>${min}</strong> points to redeem.` : "");
  if (canEdit) {
    document.getElementById("lyRulesForm").style.display = "grid";
    document.getElementById("lyRulesActions").style.display = "flex";
    document.getElementById("ly_earnPoints").value = pts;
    document.getElementById("ly_earnPer").value = per;
    document.getElementById("ly_redeemValue").value = val;
    document.getElementById("ly_minRedeem").value = min;
    document.getElementById("lyRulesActions").innerHTML = `<button class="btn btn-primary" id="ly_save">Save rules</button>`;
    document.getElementById("ly_save").onclick = saveRules;
  }

  // Top members
  const top = d.top || [];
  document.getElementById("lyTop").innerHTML = top.length ? `
    <table><thead><tr><th style="padding:8px 18px;">#</th><th>Member</th><th>Phone</th><th style="text-align:right; padding-right:18px;">Points</th></tr></thead>
    <tbody>${top.map((c, i) => `<tr>
      <td style="padding:8px 18px; color:var(--muted);">${i + 1}</td>
      <td style="font-weight:600;">${esc(c.name) || "—"}</td>
      <td class="mono" style="color:var(--muted);">${esc(c.phone)}</td>
      <td class="mono" style="text-align:right; padding-right:18px; font-weight:700; color:var(--accent);">${Math.round(c.loyaltyPoints)}</td>
    </tr>`).join("")}</tbody></table>`
    : `<div class="empty-state" style="padding:20px;">No members with points yet.</div>`;

  // Activity
  const rec = d.recent || [];
  document.getElementById("lyActivity").innerHTML = rec.length ? `
    <table><thead><tr><th style="padding:8px 18px;">When</th><th>Phone</th><th>Type</th><th>Note</th><th style="text-align:right; padding-right:18px;">Points</th></tr></thead>
    <tbody>${rec.map((r) => `<tr>
      <td style="padding:8px 18px; color:var(--muted); font-size:12px;">${new Date(r.createdAt).toLocaleString()}</td>
      <td class="mono" style="color:var(--muted);">${esc(r.phone)}</td>
      <td><span class="badge ${r.type === "earn" ? "badge-paid" : "badge-dirty"}">${esc(r.type)}</span></td>
      <td style="font-size:12px; color:var(--muted);">${esc(r.note)}</td>
      <td class="mono" style="text-align:right; padding-right:18px; font-weight:700; color:${r.points >= 0 ? "var(--success)" : "var(--danger)"};">${r.points >= 0 ? "+" : ""}${Math.round(r.points)}</td>
    </tr>`).join("")}</tbody></table>`
    : `<div class="empty-state" style="padding:20px;">No loyalty activity yet.</div>`;
}

async function saveRules() {
  const body = {
    loyaltyEarnPoints: parseFloat(document.getElementById("ly_earnPoints").value) || 0,
    loyaltyEarnPer: parseFloat(document.getElementById("ly_earnPer").value) || 1,
    loyaltyRedeemValue: parseFloat(document.getElementById("ly_redeemValue").value) || 0,
    loyaltyMinRedeem: parseFloat(document.getElementById("ly_minRedeem").value) || 0,
  };
  const res = await api("/api/loyalty/settings", { method: "PUT", json: body });
  if (!res.ok) { const e = await res.json().catch(() => ({})); return toast(e.error || "Could not save"); }
  toast("Loyalty rules saved");
  if (window.posInitSettings) { try { await window.posInitSettings(); } catch (_) {} }
  load();
}

if (staff && !blockIfNoBranchSelected(staff, document.getElementById("lyTop"))) load();

})();
