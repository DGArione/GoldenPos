(async () => {
// giftcards.js — issue, list, and show scannable gift cards.
const staff = requireLogin();
if (staff) renderNav("giftcards", staff);

const cur = () => (typeof posCurrency === "function" ? posCurrency() : "$");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const canManage = staff && ["superManager", "manager", "admin"].includes(staff.role);

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

let CARDS = [];

async function load() {
  const [cRes, rRes] = await Promise.all([api("/api/giftcards"), api("/api/giftcards/report")]);
  CARDS = cRes.ok ? await cRes.json() : [];
  const rep = rRes.ok ? await rRes.json() : { count: 0, issued: 0, redeemed: 0, outstanding: 0 };
  const tile = (l, v, cls) => `<div class="stat ${cls || ""}"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`;
  document.getElementById("gcReport").innerHTML =
    tile("Active cards", rep.count, "muted") + tile("Issued value", cur() + rep.issued.toFixed(2)) +
    tile("Redeemed", cur() + rep.redeemed.toFixed(2), "neg") + tile("Outstanding", cur() + rep.outstanding.toFixed(2), "pos");
  render();
}

function render() {
  const q = (document.getElementById("gcSearch").value || "").trim().toUpperCase();
  const list = CARDS.filter((c) => !q || c.code.includes(q) || (c.recipientName || "").toUpperCase().includes(q));
  const el = document.getElementById("gcList");
  if (!list.length) { el.innerHTML = `<div class="empty-state">No gift cards yet.</div>`; return; }
  el.innerHTML = list.map((c) => `
    <div class="card" style="padding:14px 18px; margin-bottom:10px; ${c.status === "active" ? "" : "opacity:.55;"}">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <span class="mono" style="font-weight:700; font-size:15px;">${esc(c.code)}</span>
          <span class="badge ${c.status === "active" ? "badge-paid" : "badge-dirty"}" style="margin-left:6px;">${c.status}</span>
          <div style="font-size:12px; color:var(--muted); margin-top:3px;">${esc(c.recipientName) || "—"} · issued by ${esc(c.issuedByName)} · ${new Date(c.createdAt).toLocaleDateString()}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-size:18px; font-weight:700; color:var(--accent);">${cur()}${c.balance.toFixed(2)}</div>
          <div style="font-size:11px; color:var(--muted);">of ${cur()}${c.initialBalance.toFixed(2)}</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm" data-show="${c.id}">Show / Print</button>
          ${canManage ? `<button class="btn btn-sm" data-toggle="${c.id}">${c.status === "active" ? "Disable" : "Enable"}</button>` : ""}
        </div>
      </div>
    </div>`).join("");
  el.querySelectorAll("[data-show]").forEach((b) => b.onclick = () => showCard(CARDS.find((x) => x.id == b.dataset.show)));
  el.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = async () => {
    await api(`/api/giftcards/${b.dataset.toggle}/toggle`, { method: "POST", json: {} });
    load();
  });
}

function showCard(c) {
  const barcode = window.renderBarcode ? window.renderBarcode(c.code) : "";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:380px; text-align:center;">
      <div style="font-size:13px; font-weight:700; color:var(--muted); letter-spacing:.06em; text-transform:uppercase;">Gift Card</div>
      <div style="font-size:30px; font-weight:800; color:var(--accent); margin:6px 0;">${cur()}${c.balance.toFixed(2)}</div>
      <div style="background:#fff; padding:12px; border-radius:8px; display:inline-block; margin:8px 0;">${barcode}</div>
      <div class="mono" style="font-size:16px; letter-spacing:2px; font-weight:700;">${esc(c.code)}</div>
      ${c.recipientName ? `<div style="font-size:13px; color:var(--muted); margin-top:6px;">For ${esc(c.recipientName)}</div>` : ""}
      <div style="display:flex; gap:8px; margin-top:16px;">
        <button class="btn" id="gc_close" style="flex:1;">Close</button>
        <button class="btn btn-primary" id="gc_print" style="flex:1;">🖨️ Print</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#gc_close").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#gc_print").onclick = () => {
    const w = document.createElement("iframe");
    w.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(w);
    w.srcdoc = `<!DOCTYPE html><html><body style="text-align:center;font-family:sans-serif;padding:16px;">
      <h3 style="margin:4px;">Gift Card — ${cur()}${c.balance.toFixed(2)}</h3>
      <div>${barcode}</div><div style="font-family:monospace;font-size:18px;letter-spacing:2px;font-weight:700;">${esc(c.code)}</div>
      </body></html>`;
    w.onload = () => { try { w.contentWindow.focus(); w.contentWindow.print(); } catch (_) {} setTimeout(() => w.remove(), 60000); };
  };
}

function openIssue() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" style="width:360px;">
      <h3 style="margin-top:0;">Issue Gift Card</h3>
      <div class="f"><label>Amount (${cur()})</label><input id="gi_amount" type="number" step="0.01" min="1" placeholder="e.g. 1000"/></div>
      <div class="f"><label>Recipient (optional)</label><input id="gi_name" placeholder="Name"/></div>
      <div class="f"><label>Note (optional)</label><input id="gi_note" placeholder="e.g. birthday gift"/></div>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="btn" id="gi_cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="gi_go" style="flex:1;">Issue</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector("#gi_cancel").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
  backdrop.querySelector("#gi_go").onclick = async () => {
    const amount = parseFloat(backdrop.querySelector("#gi_amount").value);
    if (!amount || amount <= 0) return toast("Enter an amount");
    const res = await api("/api/giftcards", { method: "POST", json: { amount, recipientName: backdrop.querySelector("#gi_name").value.trim(), note: backdrop.querySelector("#gi_note").value.trim() } });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return toast(r.error || "Could not issue");
    close(); await load(); toast(`Issued ${r.code}`); showCard(r);
  };
}

const newBtn = document.getElementById("newCardBtn");
if (newBtn) { newBtn.style.display = canManage ? "" : "none"; newBtn.onclick = openIssue; }
document.getElementById("gcSearch").addEventListener("input", render);

if (staff && !blockIfNoBranchSelected(staff, document.getElementById("gcList"))) load();

})();
