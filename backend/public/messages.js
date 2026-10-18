(async () => {
let _lastMsgHash = "";
// messages.js — staff messaging. New threads: Manager/Super Manager only.
// Replies: any participant. Also surfaced inline in the notification bell.
const staff = requireLogin();
if (staff) renderNav("messages", staff);

const canCompose = staff && ["manager", "superManager"].includes(staff.role);
if (staff && !canCompose) document.getElementById("newMessageBtn").style.display = "none";

let threads = [];
let activeThreadId = null;

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

async function loadThreads() {
  const res = await api("/api/messages/threads");
  const newThreads = await res.json();
  // Only re-render thread list if data changed
  const hash = newThreads.map(t => t.threadId + t.unread + t.messageCount).join(",");
  if (hash === _lastMsgHash) return;
  _lastMsgHash = hash;
  threads = newThreads;
  renderThreadList();
}

function renderThreadList() {
  const el = document.getElementById("threadList");
  el.innerHTML = threads.length ? threads.map((t) => `
    <button data-thread="${t.threadId}" style="width:100%; text-align:left; padding:14px 18px; border:none; border-bottom:1px solid var(--border-soft); background:${t.threadId === activeThreadId ? "var(--accent-soft)" : "transparent"}; cursor:pointer; font-family:inherit;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="font-size:13px;">${t.to}</strong>
        ${t.unread ? `<span class="nav-dot" style="position:static;">●</span>` : ""}
      </div>
      <div style="font-size:12px; color:var(--muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.lastMessage.fromName}: ${t.lastMessage.body}</div>
      <div style="font-size:10px; color:var(--muted); margin-top:2px;">${new Date(t.lastMessage.createdAt).toLocaleString()}</div>
    </button>`).join("") : `<div class="empty-state">No conversations yet.</div>`;

  el.querySelectorAll("[data-thread]").forEach((btn) => {
    btn.onclick = () => openThread(Number(btn.dataset.thread));
  });
}

async function openThread(threadId) {
  activeThreadId = threadId;
  renderThreadList();
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("threadView").style.display = "flex";

  const res = await api(`/api/messages/thread/${threadId}`);
  const msgs = await res.json();
  const root = msgs[0];
  const other = root.fromUserId === staff.id ? (root.toName || `${root.toRole === "all" ? "Everyone" : root.toRole} (broadcast)`) : root.fromName;
  document.getElementById("threadHeader").innerHTML = `<strong>${other}</strong>`;
  document.getElementById("threadMessages").innerHTML = msgs.map((m) => `
    <div style="max-width:70%; align-self:${m.fromUserId === staff.id ? "flex-end" : "flex-start"};">
      <div style="background:${m.fromUserId === staff.id ? "var(--accent)" : "var(--neutral-bg)"}; color:${m.fromUserId === staff.id ? "white" : "var(--text)"}; padding:10px 14px; border-radius:12px; font-size:13px;">${m.body}</div>
      <div style="font-size:10px; color:var(--muted); margin-top:3px; text-align:${m.fromUserId === staff.id ? "right" : "left"};">${m.fromName} · ${new Date(m.createdAt).toLocaleTimeString()}</div>
    </div>`).join("");
  document.getElementById("threadMessages").scrollTop = 999999;
  loadThreads(); // refresh unread state in the list
}

document.getElementById("sendReplyBtn").onclick = async () => {
  const input = document.getElementById("replyInput");
  if (!input.value.trim() || !activeThreadId) return;
  const res = await api("/api/messages", { method: "POST", json: { parentId: activeThreadId, body: input.value.trim() } });
  if (!res.ok) { showToast("Could not send"); return; }
  input.value = "";
  openThread(activeThreadId);
};
document.getElementById("replyInput").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("sendReplyBtn").click(); });

// ---------- Compose new message (Manager/Super Manager only) ----------
document.getElementById("newMessageBtn").onclick = async () => {
  const usersRes = await api("/api/users");
  const users = (await usersRes.json()).filter((u) => u.id !== staff.id);

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal">
      <h3 style="margin-top:0;">New Message</h3>
      <label style="font-size:13px; font-weight:600;">Send to</label>
      <select id="composeTarget" style="width:100%; padding:8px; margin:4px 0 10px; border:1px solid var(--border); border-radius:6px;">
        <optgroup label="Individual">
          ${users.map((u) => `<option value="user:${u.id}">${u.name} (${u.role})</option>`).join("")}
        </optgroup>
        <optgroup label="Broadcast (this branch)">
          <option value="role:server">All Servers</option>
          <option value="role:cashier">All Cashiers</option>
          <option value="role:kitchen">All Kitchen Staff</option>
          <option value="role:all">Everyone</option>
        </optgroup>
      </select>
      <label style="font-size:13px; font-weight:600;">Message</label>
      <textarea id="composeBody" rows="4" style="width:100%; padding:8px; margin:4px 0 14px; border:1px solid var(--border); border-radius:6px; font-family:inherit;"></textarea>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="composeCancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary" id="composeSend" style="flex:1;">Send</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector("#composeCancel").onclick = () => backdrop.remove();
  backdrop.querySelector("#composeSend").onclick = async () => {
    const target = backdrop.querySelector("#composeTarget").value;
    const body = backdrop.querySelector("#composeBody").value.trim();
    if (!body) return showToast("Write a message first");
    const [kind, value] = target.split(":");
    const payload = kind === "user" ? { toUserId: Number(value), body } : { toRole: value, body };
    const res = await api("/api/messages", { method: "POST", json: payload });
    if (!res.ok) { const err = await res.json(); return showToast(err.error || "Could not send"); }
    backdrop.remove();
    showToast("Message sent");
    loadThreads();
  };
};

if (staff) { loadThreads(); setInterval(loadThreads, 12000); }

})();
