// auth.js — shared by every screen.
// Auth: signed token stored in localStorage, sent via X-Auth-Token header.
// Branch selection: stored in localStorage so it persists across tabs/restarts.

function currentUser() {
  const raw = localStorage.getItem("posUser");
  return raw ? JSON.parse(raw) : null;
}

function currentToken() {
  return localStorage.getItem("posToken") || null;
}

function setCurrentUser(user, token) {
  localStorage.setItem("posUser", JSON.stringify(user));
  if (token) localStorage.setItem("posToken", token);
}

function requireLogin() {
  const user = currentUser();
  const token = currentToken();
  if (!user || !token) {
    window.location.href = "login";
    return null;
  }
  return user;
}

function logout() {
  localStorage.removeItem("posUser");
  localStorage.removeItem("posToken");
  // Keep posActiveBranchId so re-login lands on the same branch
  window.location.href = "login";
}

function isManagerRole(user) {
  return user && (user.role === "manager" || user.role === "superManager");
}

function isFinanceRole(user) {
  return user && user.role === "finance";
}
function canViewFinanceData(user) {
  return isManagerRole(user) || isFinanceRole(user);
}

function blockIfNoBranchSelected(user, containerEl) {
  if (user.role !== "superManager") return false;
  const active = localStorage.getItem("posActiveBranchId");
  if (active) return false;
  containerEl.innerHTML = `
    <div style="padding:60px 20px; text-align:center; color:var(--muted);">
      <div style="font-size:15px; font-weight:600; color:var(--text); margin-bottom:6px;">Pick a branch to continue</div>
      <div style="font-size:13px;">This screen needs one branch selected — use the branch dropdown in the sidebar, or visit <a href="branches" style="color:var(--accent);">Branches</a>.</div>
    </div>`;
  return true;
}

// ── Authenticated fetch ───────────────────────────────────────
async function api(url, options = {}) {
  const token   = currentToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["X-Auth-Token"] = token;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.json);
  }

  // Node.js backend serves the API under a clean "/api" base (relative, so it
  // works whether the app is hosted at the domain root or in a sub-path).
  let finalUrl = url.replace(/^\//, "");

  // Also pass token as a query param — this bypasses any proxy
  // configuration that strips custom headers before they reach the server.
  if (token) {
    finalUrl += (finalUrl.includes("?") ? "&" : "?") + "_auth=" + encodeURIComponent(token);
  }

  // Append branchId for superManager on ALL requests (GET, POST, PUT, DELETE)
  // The API reads branchId from query string for superManager role
  const activeBranchId = localStorage.getItem("posActiveBranchId");
  const user = currentUser();
  if (user && user.role === "superManager" && activeBranchId && !finalUrl.includes("branchId=")) {
    finalUrl += (finalUrl.includes("?") ? "&" : "?") + `branchId=${activeBranchId}`;
  }

  const res = await fetch(finalUrl, { ...options, headers });

  // Token expired or invalid — force re-login
  if (res.status === 401) {
    logout();
    return res;
  }

  return res;
}

// ── Manager verification modal (replaces prompt()) ────────────
// Injects a styled overlay if one doesn't already exist, then resolves
// with { ok: boolean, user?: object } when the manager submits or cancels.
function verifyManagerPin() {
  return new Promise((resolve) => {
    // Reuse existing modal if already in DOM
    let overlay = document.getElementById("_managerPinOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "_managerPinOverlay";
      overlay.innerHTML = `
        <div id="_managerPinBox" style="
          position:fixed;inset:0;z-index:9999;display:flex;align-items:center;
          justify-content:center;background:rgba(0,0,0,.55);">
          <div style="
            background:var(--card,#fff);border-radius:12px;padding:28px 32px;
            width:320px;box-shadow:0 8px 32px rgba(0,0,0,.25);text-align:center;">
            <div style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--text,#111);">
              Manager Approval Required
            </div>
            <div style="font-size:13px;color:var(--muted,#777);margin-bottom:18px;">
              Enter a manager PIN to continue.
            </div>
            <input id="_managerPinInput" type="password" inputmode="numeric"
              maxlength="8"
              placeholder="Manager PIN"
              style="width:100%;box-sizing:border-box;padding:10px 14px;
                font-size:20px;letter-spacing:6px;border:1px solid var(--border,#ddd);
                border-radius:8px;text-align:center;outline:none;margin-bottom:10px;">
            <div id="_managerPinError" style="color:#e74c3c;font-size:12px;min-height:18px;margin-bottom:10px;"></div>
            <div style="display:flex;gap:10px;">
              <button id="_managerPinCancel"
                style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border,#ddd);
                  background:transparent;cursor:pointer;font-size:14px;color:var(--text,#111);">
                Cancel
              </button>
              <button id="_managerPinSubmit"
                style="flex:1;padding:10px;border-radius:8px;border:none;
                  background:var(--accent,#8a5a34);color:#fff;cursor:pointer;font-size:14px;font-weight:600;">
                Confirm
              </button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }

    const input  = document.getElementById("_managerPinInput");
    const errEl  = document.getElementById("_managerPinError");
    const submit = document.getElementById("_managerPinSubmit");
    const cancel = document.getElementById("_managerPinCancel");

    // Reset state
    input.value  = "";
    errEl.textContent = "";
    overlay.style.display = "";
    setTimeout(() => input.focus(), 50);

    function close() {
      overlay.style.display = "none";
      submit.removeEventListener("click", onSubmit);
      cancel.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKey);
    }

    async function onSubmit() {
      const pin = input.value.trim();
      if (!pin) { errEl.textContent = "Enter a PIN."; return; }
      submit.disabled = true;
      submit.textContent = "Checking…";
      try {
        const res = await api("/api/auth/verify-manager", { method: "POST", json: { pin } });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          errEl.textContent = "Incorrect or non-manager PIN.";
          input.value = "";
          input.focus();
          submit.disabled = false;
          submit.textContent = "Confirm";
          return;
        }
        close();
        resolve({ ok: true, user: data.user });
      } catch (e) {
        errEl.textContent = "Connection error.";
        submit.disabled = false;
        submit.textContent = "Confirm";
      }
    }

    function onCancel() { close(); resolve({ ok: false }); }
    function onKey(e)   { if (e.key === "Enter") onSubmit(); }

    submit.addEventListener("click", onSubmit);
    cancel.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKey);
  });
}

// Order number formatting
function orderNum(id) {
  return "#" + String(id).padStart(4, "0");
}
