(async () => {
// Online Orders has separate queues for web orders, QR/table orders and a history.
const staff = requireLogin();
if (staff) renderNav("onlineorders", staff);
const ordersEl = document.getElementById("orders");
let currentTab = "online", _hash = "";
const esc = s => String(s ?? "").replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const isTable = o => o.source === "qr" || (!!o.tableId && o.orderType === "dine-in") || (/^table\s/i.test(o.tableName || ""));
const isWeb = o => !isTable(o) && (o.source === "online" || !o.staffId || o.staffName === "Online Order");
const isHistory = o => o.status === "voided" || o.status === "completed" || o.status === "served" || (!!o.staffId && (o.source === "online" || o.source === "qr" || o.staffName !== "Online Order") && o.status !== "new") || (o.status !== "new" && (isWeb(o) || isTable(o)));
function ensureTabs() {
  if (document.getElementById("onlineOrderTabs")) return;
  const tabs = document.createElement("div"); tabs.id = "onlineOrderTabs";
  tabs.style = "display:flex;gap:8px;flex-wrap:wrap;margin:0 0 16px";
  tabs.innerHTML = `<button class="btn" data-tab="online">Online Orders</button><button class="btn" data-tab="table">Table Orders</button><button class="btn" data-tab="history">History</button>`;
  ordersEl.parentNode.insertBefore(tabs, ordersEl);
  tabs.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { currentTab = b.dataset.tab; _hash = ""; paintTabs(); load(); });
  paintTabs();
}
function paintTabs(){ document.querySelectorAll("#onlineOrderTabs [data-tab]").forEach(b => { b.classList.toggle("btn-primary", b.dataset.tab === currentTab); }); }
async function load() {
  const res = await api("/api/orders?status=new,pending,preparing,ready,dispatched,voided");
  if (!res.ok) return;
  const all = await res.json();
  let orders;
  if (currentTab === "table") orders = all.filter(o => isTable(o) && o.status === "new");
  else if (currentTab === "history") orders = all.filter(o => isHistory(o));
  else orders = all.filter(o => isWeb(o) && o.status === "new");
  orders = orders.filter(o => o.paymentStatus !== "paid" || currentTab === "history");
  orders.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  const h = currentTab + JSON.stringify(orders.map(o => [o.id,o.status,o.paymentStatus]));
  if (h === _hash) return; _hash = h; render(orders);
}
function render(orders) {
  if (!orders.length) { ordersEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${currentTab === "history" ? "No approved or rejected orders in history." : currentTab === "table" ? "No new table orders awaiting approval." : "No new online orders awaiting approval."}</div>`; return; }
  ordersEl.innerHTML = "";
  orders.forEach(o => {
    const isNew = o.status === "new", rejected = o.status === "voided";
    const placed = new Date(o.createdAt), mins = Math.max(0, Math.floor((Date.now()-placed.getTime())/60000));
    const card = document.createElement("div"); card.className = "card"; card.style = "padding:16px;" + (isNew ? "border:1.5px solid var(--warning);" : "");
    card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px"><div><strong>${esc(o.displayNum || "#"+o.id)} · ${esc(o.tableName || "Online")}</strong><div style="font-size:11px;color:var(--muted)">${esc(o.createdAt || "")} · ${mins}m ago</div></div><span class="badge" style="height:max-content">${rejected ? "REJECTED" : isNew ? "NEW" : "APPROVED"}</span></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${esc(o.orderType || "dine-in")} · ${esc(o.customerName || "no name")}${o.customerPhone ? " · "+esc(o.customerPhone):""}</div>
    <div style="font-size:13px;margin-bottom:8px">${(o.items||[]).map(i=>`<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>${Number(i.qty)||1}× ${esc(i.name)}</span><span class="mono">${posCurrency()}${Number(i.lineTotal||0).toFixed(2)}</span></div>`).join("")}</div>
    ${o.note ? `<div style="font-size:12px;color:var(--warning);margin-bottom:8px">📝 ${esc(o.note)}</div>`:""}
    <div class="mono" style="font-weight:700;margin-bottom:12px;font-size:15px">${posCurrency()}${Number(o.grandTotal||o.total||0).toFixed(2)}</div>
    ${isNew ? `<div style="display:flex;gap:8px"><button class="btn btn-danger" data-reject="${o.id}" style="flex:1">Reject</button><button class="btn btn-primary" data-accept="${o.id}" style="flex:2">✓ Accept &amp; Send to Kitchen</button></div>` : `<div style="font-size:12px;color:${rejected?'var(--danger)':'var(--success)'}">${rejected ? 'Rejected order' : 'Accepted — sent to kitchen'}</div>`}`;
    const accept = card.querySelector("[data-accept]"); if (accept) accept.onclick = async () => { accept.disabled=true; const r=await api(`/api/orders/${o.id}/accept`,{method:"POST"}); if(!r.ok){const e=await r.json().catch(()=>({}));showToast(e.error||"Could not accept order");accept.disabled=false;return;} showToast("Accepted and sent to kitchen. Moved to History."); _hash="";load(); };
    const reject = card.querySelector("[data-reject]"); if (reject) reject.onclick = async () => { const reason=prompt("Reason for rejecting this order:",""); if(reason===null)return; const r=await api(`/api/orders/${o.id}/reject`,{method:"POST",json:{reason:reason.trim()||"Rejected by staff"}}); if(!r.ok){showToast("Could not reject order");return;} showToast("Order rejected and moved to History");_hash="";load(); };
    ordersEl.appendChild(card);
  });
}
if (staff) { ensureTabs(); load(); setInterval(load,5000); }
})();
