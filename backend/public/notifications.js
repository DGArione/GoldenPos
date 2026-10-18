(async () => {
// notifications.js — full notifications feed. Nothing is marked read just by
// viewing the list; a notification clears only when you click it (or use
// "Mark all read"), so alerts persist until the staff member acts on them.
const staff = requireLogin();
if (staff) renderNav("notifications", staff);

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// A friendly icon for each notification type.
const TYPE_ICON = {
  order:      "🧾",
  payment:    "💳",
  refund:     "↩️",
  kitchen:    "👨‍🍳",
  lowstock:   "📦",
  low_stock:  "📦",
  reservation:"📅",
  message:    "💬",
  shift:      "⏰",
  giftcard:   "🎁",
  loyalty:    "⭐",
  waste:      "🗑️",
  transfer:   "🔁",
  online:     "🌐",
  qr:         "📱",
};
function iconFor(n) { return TYPE_ICON[(n.type || "").toLowerCase()] || "🔔"; }

// Relative time ("3m ago"), falling back to a full date for older items.
function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 7)  return d + "d ago";
  return new Date(iso).toLocaleDateString();
}

let ROWS = [];

async function load() {
  const res = await api("/api/notifications");
  ROWS = res.ok ? await res.json() : [];
  render();
}

async function markRead(id) {
  try { await api(`/api/notifications/${id}/read`, { method: "POST" }); } catch (_) {}
  const row = ROWS.find((n) => String(n.id) === String(id));
  if (row) row.read = true;
  render();
  if (typeof refreshNavNotifCount === "function") refreshNavNotifCount();
}

async function markAll() {
  try { await api("/api/notifications/read-all", { method: "POST" }); } catch (_) {}
  ROWS.forEach((n) => (n.read = true));
  render();
  if (typeof refreshNavNotifCount === "function") refreshNavNotifCount();
}

function render() {
  const filter = document.getElementById("notifFilter").value;
  const rows = filter === "unread" ? ROWS.filter((n) => !n.read) : ROWS;
  const el = document.getElementById("notifPageList");

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state" style="padding:60px 20px;">
      <div style="font-size:40px;margin-bottom:10px;">🎉</div>
      ${filter === "unread" ? "No unread notifications." : "No notifications yet."}
    </div>`;
    return;
  }

  el.innerHTML = `<div class="card" style="padding:0; overflow:hidden;">` +
    rows.map((n) => `
      <div class="notif-row${n.read ? " read" : ""}" data-id="${n.id}">
        <div class="notif-row-icon">${iconFor(n)}</div>
        <div class="notif-row-main">
          <div class="notif-row-msg">${esc(n.message)}</div>
          <div class="notif-row-meta">${relTime(n.createdAt)}${n.type ? ` · ${esc(n.type)}` : ""}</div>
        </div>
        ${n.read
          ? `<span class="notif-row-tag">Read</span>`
          : `<button type="button" class="notif-row-btn" data-mark="${n.id}">Mark read</button>`}
      </div>`).join("") +
    `</div>`;

  // Click a row → mark it read. The explicit button does the same without
  // bubbling anywhere else.
  el.querySelectorAll(".notif-row").forEach((rowEl) => {
    rowEl.onclick = () => { if (!rowEl.classList.contains("read")) markRead(rowEl.getAttribute("data-id")); };
  });
  el.querySelectorAll("[data-mark]").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); markRead(btn.getAttribute("data-mark")); };
  });
}

document.getElementById("notifFilter").onchange = render;
document.getElementById("notifMarkAllBtn").onclick = markAll;

load();
setInterval(load, 20000);
})();
