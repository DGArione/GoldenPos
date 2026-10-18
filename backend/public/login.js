// login.js — handles PIN and Password login modes
// PIN_MAX_LEN: max digits the PIN pad will accept before requiring Enter.
// Set this to match the longest PIN in use at your restaurant (default 8).
// The server accepts any PIN of 4+ digits regardless of this value.
const PIN_MAX_LEN = 8;
let pin = "";
let currentMode = "pin"; // "pin" | "password" | "changePassword"
let pendingUser  = null;  // user who needs to change password
let pendingToken = null;  // token for the pending user (used during change-password flow)

// Load settings, then give the login page its own theme when one is chosen
// (Settings → Login Page → Login page theme). Empty = match the app theme.
if (window.posInitSettings) {
  window.posInitSettings().then((s) => {
    if (s && s.loginThemeId && window.posApplyThemeById) window.posApplyThemeById(s.loginThemeId);
  }).catch(() => {});
}

// ── Mode switching ────────────────────────────────────────────
function switchMode(mode) {
  currentMode = mode;
  document.getElementById("pinMode").style.display        = mode === "pin"      ? "" : "none";
  document.getElementById("passwordMode").style.display   = mode === "password" ? "" : "none";
  document.getElementById("changePasswordMode").style.display = "none";
  document.getElementById("btnChoosePin").style.background = mode === "pin"      ? "var(--accent)" : "";
  document.getElementById("btnChoosePin").style.color      = mode === "pin"      ? "white" : "";
  document.getElementById("btnChoosePw").style.background  = mode === "password" ? "var(--accent)" : "";
  document.getElementById("btnChoosePw").style.color       = mode === "password" ? "white" : "";
  document.getElementById("loginSubtitle").textContent = mode === "pin" ? "Enter your staff PIN" : "Enter your username & password";
  document.getElementById("errorMsg").textContent = "";
  if (mode === "pin") { pin = ""; renderDots(); }
  if (mode === "password") setTimeout(() => document.getElementById("pwUsername").focus(), 50);
}

// ── PIN pad ───────────────────────────────────────────────────
function renderDots() {
  // Always show PIN_MAX_LEN slots so the user knows how many digits to enter
  const slots = Math.max(PIN_MAX_LEN, pin.length);
  document.getElementById("pinDots").innerHTML = Array.from({ length: slots }, (_, i) =>
    `<div class="pin-dot${i < pin.length ? " filled" : ""}"></div>`).join("");
}

function renderNumpad() {
  const keys   = ["1","2","3","4","5","6","7","8","9","clear","0","go"];
  const numpad = document.getElementById("numpad");
  numpad.innerHTML = keys.map(k => {
    if (k === "clear") return `<button class="pin-btn pin-btn-clear" data-key="clear">⌫</button>`;
    if (k === "go")    return `<button class="pin-btn pin-btn-go"    data-key="go">Enter</button>`;
    return `<button class="pin-btn" data-key="${k}">${k}</button>`;
  }).join("");
  numpad.querySelectorAll("button").forEach(btn => { btn.onclick = () => handleKey(btn.dataset.key); });
}

function handleKey(key) {
  document.getElementById("errorMsg").textContent = "";
  if (key === "clear") { pin = ""; renderDots(); return; }
  if (key === "go")    { attemptPinLogin(); return; }
  // Accept digits up to PIN_MAX_LEN but never auto-submit —
  // staff must always press Enter so typos can be corrected with ⌫
  if (pin.length < PIN_MAX_LEN) {
    pin += key;
    renderDots();
  }
}

// ── PIN login ─────────────────────────────────────────────────
async function attemptPinLogin() {
  if (!pin) return;
  try {
    const res  = await fetch("api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById("errorMsg").textContent = data.error || "Incorrect PIN. Try again.";
      pin = ""; renderDots(); return;
    }
    finishLogin(data, data.token);
  } catch (e) {
    document.getElementById("errorMsg").textContent = "Connection error. Try again.";
    pin = ""; renderDots();
  }
}

// ── Password login ────────────────────────────────────────────
async function attemptPasswordLogin() {
  const username = document.getElementById("pwUsername").value.trim();
  const password = document.getElementById("pwPassword").value;
  if (!username || !password) { document.getElementById("errorMsg").textContent = "Enter username and password."; return; }
  try {
    const res  = await fetch("api/auth/login-password", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById("errorMsg").textContent = data.error || "Incorrect credentials.";
      document.getElementById("pwPassword").value = ""; return;
    }
    if (data.mustChangePassword) {
      pendingUser  = data;
      pendingToken = data.token; // store token so change-password can use it
      showChangePasswordScreen();
      return;
    }
    finishLogin(data, data.token);
  } catch (e) {
    document.getElementById("errorMsg").textContent = "Connection error. Try again.";
  }
}

// ── Force change password ─────────────────────────────────────
function showChangePasswordScreen() {
  document.getElementById("pinMode").style.display        = "none";
  document.getElementById("passwordMode").style.display   = "none";
  document.getElementById("changePasswordMode").style.display = "";
  document.getElementById("loginSubtitle").textContent = "Change your password";
  document.getElementById("errorMsg").textContent = "";
}

async function setNewPassword() {
  const pw1 = document.getElementById("newPw1").value;
  const pw2 = document.getElementById("newPw2").value;
  if (pw1.length < 6) { document.getElementById("errorMsg").textContent = "Password must be at least 6 characters."; return; }
  if (pw1 !== pw2)    { document.getElementById("errorMsg").textContent = "Passwords do not match."; return; }
  try {
    // Use the token issued at login to authenticate the change-password call
    const res = await fetch("api/auth/change-password?_auth=" + encodeURIComponent(pendingToken), {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": pendingToken },
      body:    JSON.stringify({ userId: pendingUser.id, newPassword: pw1 }),
    });
    if (!res.ok) { document.getElementById("errorMsg").textContent = "Failed to set password. Try again."; return; }
    finishLogin(pendingUser, pendingToken);
  } catch (e) {
    document.getElementById("errorMsg").textContent = "Connection error.";
  }
}

// ── After successful login ────────────────────────────────────
function defaultScreenFor(user) {
  if (user.role === "admin")        return "settings";
  if (user.role === "superManager") return "dashboard";
  if (user.role === "manager")      return "dashboard";
  if (user.role === "finance")      return "dashboard";
  if (user.role === "cashier")      return "payment";
  if (user.role === "kitchen")      return "kitchen";
  return "order";
}

async function finishLogin(user, token) {
  // Strip sensitive fields before storing
  const safeUser = { ...user };
  delete safeUser.token;
  delete safeUser.pin;
  delete safeUser.passwordHash;

  localStorage.setItem("posUser",  JSON.stringify(safeUser));
  localStorage.setItem("posToken", token);

  // Branch ID goes into localStorage so it persists across tabs and browser restarts.
  // Only overwrite if the user has a branch assigned, or if no branch is currently saved.
  if (user.branch) {
    localStorage.setItem("posActiveBranchId", user.branch.id);
  } else if (user.role === "superManager") {
    // If the superManager already has a saved branch, keep it.
    // If not (first ever login), pick the first available branch.
    if (!localStorage.getItem("posActiveBranchId")) {
      try {
        const br = await fetch("api/public/branches");
        const branches = await br.json();
        if (branches.length) localStorage.setItem("posActiveBranchId", branches[0].id);
      } catch (e) {}
    }
  }
  window.location.href = defaultScreenFor(user);
}

// ── Keyboard support ──────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (currentMode !== "pin") return;
  if (/^[0-9]$/.test(e.key)) handleKey(e.key);
  else if (e.key === "Backspace") { pin = pin.slice(0, -1); renderDots(); }
  else if (e.key === "Enter") attemptPinLogin();
});

document.addEventListener("keydown", e => {
  if (currentMode === "password" && e.key === "Enter") attemptPasswordLogin();
});

// ── Init ──────────────────────────────────────────────────────
renderDots();
renderNumpad();
switchMode("pin");
