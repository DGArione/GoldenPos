(async () => {
// timeclock.js
const staff = requireLogin();
if (staff) renderNav("timeclock", staff);

let openShift = null;

document.getElementById("greeting").textContent = staff ? `Hi, ${staff.name}` : "Hi there";

function tick() {
  if (openShift) {
    const secs = Math.floor((Date.now() - new Date(openShift.clockIn).getTime()) / 1000);
    const h = String(Math.floor(secs / 3600)).padStart(2, "0");
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    document.getElementById("clockDisplay").textContent = `${h}:${m}:${s}`;
  } else {
    document.getElementById("clockDisplay").textContent = "00:00:00";
  }
}

let _lastShiftHash = "";
async function loadStatus() {
  const res = await api(`/api/shifts/open/${staff.id}`);
  openShift = await res.json();
  const btn = document.getElementById("clockBtn");
  const status = document.getElementById("statusLine");
  if (openShift) {
    btn.textContent = "Clock Out";
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-danger");
    status.textContent = `Clocked in since ${new Date(openShift.clockIn).toLocaleTimeString()}`;
  } else {
    btn.textContent = "Clock In";
    btn.classList.add("btn-primary");
    btn.classList.remove("btn-danger");
    status.textContent = "Not currently clocked in";
  }
}

async function loadHistory() {
  const res = await api(`/api/shifts?userId=${staff.id}`);
  const shifts = await res.json();
  // Only re-render if data changed
  const hash = shifts.map(s => s.id + (s.clockOut||'')).join(",");
  if (hash === _lastShiftHash) return;
  _lastShiftHash = hash;
  const listEl = document.getElementById("shiftList");
  if (shifts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No shifts logged yet.</div>`;
    return;
    return;
  }
  listEl.innerHTML = shifts.slice(0, 8).map((s) => {
    const inTime = new Date(s.clockIn).toLocaleString();
    const outTime = s.clockOut ? new Date(s.clockOut).toLocaleTimeString() : "—";
    const hours = s.clockOut ? ((new Date(s.clockOut) - new Date(s.clockIn)) / 3600000).toFixed(2) : "in progress";
    return `<div class="card" style="padding:10px 14px; display:flex; justify-content:space-between; font-size:13px;">
      <span>${inTime} → ${outTime}</span><span class="mono">${hours}${typeof hours === "string" && hours !== "in progress" ? "h" : ""}</span>
    </div>`;
  }).join("");
}

document.getElementById("clockBtn").onclick = async () => {
  const endpoint = openShift ? "/api/shifts/clockout" : "/api/shifts/clockin";
  await api(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: staff.id }),
  });
  await loadStatus();
  await loadHistory();
};

if (staff) {
  loadStatus();
  loadHistory();
  setInterval(tick, 1000);
  setInterval(() => { loadStatus(); loadHistory(); }, 10000); // refresh data every 10s
}

})();
