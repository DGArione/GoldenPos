(async () => {
// staff.js
const staff = requireLogin();
// ══════════════════════════════════════════════════════════════
// DISCOUNT / VOID PERMISSIONS
// ══════════════════════════════════════════════════════════════
// These are per-branch. They control how much a non-manager can discount
// without a manager PIN, and whether servers/cashiers may void at all.
async function loadPermissions() {
  const panel = document.getElementById("permissionsPanel");
  if (!panel) return;

  const canEdit = ["superManager", "manager"].includes(staff.role);
  let perms;
  try {
    const res = await api("/api/permissions");
    if (!res.ok) throw new Error("load failed");
    perms = await res.json();
  } catch (_) {
    panel.innerHTML = `<div style="color:var(--danger); font-size:13px;">Could not load permissions.</div>`;
    return;
  }

  panel.innerHTML = `
    <div style="font-size:12px; color:var(--muted); margin-bottom:14px;">
      Applies to this branch only. Managers and above are never restricted.
    </div>

    <div class="settings-row" style="align-items:flex-start;">
      <label style="flex:1;">
        Self-approve discount limit %
        <br/><span style="font-size:11px; color:var(--muted); font-weight:400;">
          Percent discounts up to this need no PIN. Anything higher — and every
          fixed-amount discount — needs a manager PIN.
        </span>
      </label>
      <input id="permDiscount" type="number" step="0.5" min="0" max="100"
             value="${Number(perms.serverMaxDiscountPercent || 0).toFixed(2)}"
             style="width:110px;" ${canEdit ? "" : "disabled"} />
    </div>

    <div class="settings-row">
      <label style="flex:1;">Servers can void orders
        <br/><span style="font-size:11px; color:var(--muted); font-weight:400;">Voiding restores stock and frees the table.</span>
      </label>
      <input id="permServerVoid" type="checkbox" ${perms.allowServerVoid ? "checked" : ""}
             style="width:18px; height:18px;" ${canEdit ? "" : "disabled"} />
    </div>

    <div class="settings-row">
      <label style="flex:1;">Cashiers can void orders</label>
      <input id="permCashierVoid" type="checkbox" ${perms.allowCashierVoid ? "checked" : ""}
             style="width:18px; height:18px;" ${canEdit ? "" : "disabled"} />
    </div>

    ${canEdit
      ? `<button class="btn btn-primary" id="permSaveBtn" style="margin-top:12px;">Save Permissions</button>
         <span id="permSaved" style="margin-left:10px; font-size:12px; color:var(--success); opacity:0; transition:opacity .2s;">Saved ✓</span>`
      : `<div style="font-size:12px; color:var(--muted); margin-top:10px;">Only managers can change these.</div>`}
  `;

  if (!canEdit) return;

  document.getElementById("permSaveBtn").onclick = async () => {
    const btn = document.getElementById("permSaveBtn");
    const pct = Number(document.getElementById("permDiscount").value);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      showToast("Discount limit must be between 0 and 100");
      return;
    }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Saving…";
    try {
      const res = await api("/api/permissions", {
        method: "PUT",
        json: {
          serverMaxDiscountPercent: pct,
          allowServerVoid:  document.getElementById("permServerVoid").checked,
          allowCashierVoid: document.getElementById("permCashierVoid").checked,
        },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        showToast(e.error || "Could not save permissions");
      } else {
        const saved = document.getElementById("permSaved");
        saved.style.opacity = "1";
        setTimeout(() => (saved.style.opacity = "0"), 1800);
        showToast("Permissions saved");
      }
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  };
}

if (staff) {
  renderNav("staff", staff);
  if (!isManagerRole(staff) && staff.role !== 'admin') {
    document.body.innerHTML = "<div style='padding:40px;text-align:center;color:var(--muted);'>Manager access only.</div>";
  } else if (staff.role === "superManager" || staff.role === "admin") {
    document.getElementById("pageTitle").textContent = "Users (All Branches)";
    document.getElementById("newBranch").style.display = "block";
    document.getElementById("newRole").insertAdjacentHTML("beforeend", `<option value="superManager">Super Manager</option>`);
  }
}

const rowsEl = document.getElementById("rows");
function showToast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

async function loadBranchOptions() {
  if (staff.role !== "superManager" && staff.role !== "admin") return;
  const res = await api("/api/branches");
  const branches = await res.json();
  window._branches = branches;
  document.getElementById("newBranch").innerHTML = branches.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
}

let _lastUsersHash = '';

async function load() {
  const res = await api("/api/users");
  const list = await res.json();
  // Only re-render if data changed — prevents flicker on auto-refresh
  const hash = JSON.stringify(list.map(u => u.id + u.name + u.role + u.isHeld + u.authMethod));
  if (hash === _lastUsersHash) return;
  _lastUsersHash = hash;
  render(list);
}

function render(list) {
  rowsEl.innerHTML = "";
  list.forEach(u => {
    const row = document.createElement("div");
    row.className = "card";
    row.style = "padding:14px 16px; margin-bottom:8px;";
    const payLabel = `${posCurrency()}${(u.payRate||0).toFixed(2)}/${u.payType==='daily'?'day':'hr'}`;
    const authBadge = u.authMethod === 'password'
      ? `<span class="badge" style="background:var(--accent-soft);color:var(--accent-dark);">🔑 Password</span>`
      : `<span class="badge" style="background:var(--neutral-bg);color:var(--muted);">🔢 PIN</span>`;
    const holdBadge = u.isHeld
      ? `<span class="badge badge-voided">🔒 Held</span>` : '';

    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
        <strong>${u.name}</strong>
        <span class="badge badge-${u.role==='superManager'?'admin':u.role}">${u.role}</span>
        ${authBadge} ${holdBadge}
        <span class="mono" style="color:var(--muted);font-size:12px;">${payLabel}</span>
        ${u.branchId ? `<span style="font-size:11px;color:var(--muted);">Branch #${u.branchId}</span>` : ''}
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn" data-action="edit" style="font-size:12px;">✏️ Edit</button>
        ${(staff.role==='admin'||staff.role==='superManager')?`
          <button class="btn" data-action="setauth" style="font-size:12px;">🔐 Auth</button>
          <button class="btn ${u.isHeld?'btn-primary':'btn-danger'}" data-action="hold" style="font-size:12px;">${u.isHeld?'✅ Unhold':'🔒 Hold'}</button>
        `:''}
        <button class="btn btn-danger" data-action="delete" style="font-size:12px;">Remove</button>
      </div>
      <!-- Edit panel (hidden) -->
      <div data-edit-panel style="display:none; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-soft);">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input data-field="name" value="${u.name}" placeholder="Name" style="flex:2; min-width:120px;"/>
          <input data-field="payRate" type="number" step="0.01" value="${u.payRate||0}" placeholder="Pay rate" style="width:90px;"/>
          <select data-field="payType" style="width:100px;">
            <option value="hourly" ${u.payType!=='daily'?'selected':''}>Hourly</option>
            <option value="daily"  ${u.payType==='daily'?'selected':''}>Daily</option>
          </select>
          ${staff.role === 'superManager' ? `<select data-field="branchId" style="flex:1; min-width:120px;" id="editBranch_${u.id}">
            <option value="">All Branches</option>
          </select>` : ''}
          <button class="btn btn-primary" data-action="save" style="font-size:12px;">Save</button>
        </div>
      </div>
      <!-- Auth panel (admin/superManager only, hidden) -->
      <div data-auth-panel style="display:none; margin-top:12px; padding:14px; background:var(--neutral-bg); border-radius:8px; border:1px solid var(--border);">
        <div style="font-size:12px; font-weight:700; margin-bottom:10px; color:var(--accent);">🔐 Change login method for ${u.name}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end;">
          <div>
            <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">Method</div>
            <select data-auth-method style="width:130px; font-size:13px;">
              <option value="pin"      ${(u.authMethod||'pin')!=='password'?'selected':''}>🔢 PIN</option>
              <option value="password" ${u.authMethod==='password'?'selected':''}>🔑 Password</option>
            </select>
          </div>
          <span data-pin-field>
            <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">New PIN</div>
            <input data-field="pin" placeholder="e.g. 1234" style="width:100px;" maxlength="8" type="number"/>
          </span>
          <span data-pw-fields style="display:none;">
            <div style="font-size:11px; color:var(--muted); margin-bottom:3px;">Username</div>
            <input data-field="username" placeholder="e.g. john" value="${u.username||''}" style="width:120px; margin-right:6px;"/>
            <div style="font-size:11px; color:var(--muted); margin-bottom:3px; margin-top:6px;">Temp Password (min 6 chars)</div>
            <input data-field="tempPw" type="password" placeholder="They'll change on login" style="width:180px;"/>
          </span>
          <button class="btn btn-primary" data-action="saveauth" style="font-size:12px; align-self:flex-end;">Apply</button>
        </div>
      </div>
    `;

    // Toggle pin vs password fields when select changes
    const authSel = row.querySelector('[data-auth-method]');
    if (authSel) {
      authSel.addEventListener('change', () => toggleAuthFields(authSel));
      // Set initial state based on current authMethod
      if (u.authMethod === 'password') toggleAuthFields(authSel);
    }

    // Edit toggle
    row.querySelector('[data-action="edit"]').onclick = () => {
      const p = row.querySelector('[data-edit-panel]');
      p.style.display = p.style.display === 'none' ? '' : 'none';
    };
    // Save edit
    row.querySelector('[data-action="save"]').onclick = async () => {
      const name    = row.querySelector('[data-field="name"]').value.trim();
      const payRate = parseFloat(row.querySelector('[data-field="payRate"]').value) || 0;
      const payType = row.querySelector('[data-field="payType"]').value;
      const branchSel = row.querySelector('[data-field="branchId"]');
      const branchId  = branchSel ? branchSel.value || null : undefined;
      const body = { name, payRate, payType };
      if (branchId !== undefined) body.branchId = branchId;
      const res = await api(`/api/users/${u.id}`, { method: "PUT", json: body });
      if (!res.ok) { const e = await res.json(); return showToast(e.error||"Save failed"); }
      showToast(`${name} updated`); load();
    };

    // Populate branch dropdown in edit panel if superManager
    if ((staff.role === 'superManager' || staff.role === 'admin') && window._branches) {
      const brSel = row.querySelector(`#editBranch_${u.id}`);
      if (brSel) {
        window._branches.forEach(b => {
          const o = document.createElement('option');
          o.value = b.id; o.textContent = b.name;
          if (b.id === u.branchId) o.selected = true;
          brSel.appendChild(o);
        });
      }
    }
    // Delete
    row.querySelector('[data-action="delete"]').onclick = async () => {
      if (!confirm(`Remove ${u.name}?`)) return;
      const res = await api(`/api/users/${u.id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); return showToast(e.error||"Cannot remove"); }
      load();
    };
    // Auth (admin + superManager)
    if (staff.role === 'admin' || staff.role === 'superManager') {
      row.querySelector('[data-action="setauth"]').onclick = () => {
        const p = row.querySelector('[data-auth-panel]');
        p.style.display = p.style.display === 'none' ? '' : 'none';
      };
      row.querySelector('[data-action="saveauth"]').onclick = async () => {
        const authMethod = row.querySelector('[data-auth-method]').value;
        let body = { authMethod };
        if (authMethod === 'pin') {
          body.pin = row.querySelector('[data-field="pin"]').value.trim();
          if (!body.pin || body.pin.length < 4) return showToast("Enter a PIN (minimum 4 digits)");
        } else {
          body.username     = row.querySelector('[data-field="username"]').value.trim();
          body.tempPassword = row.querySelector('[data-field="tempPw"]').value;
          if (!body.username) return showToast("Username is required");
          if (!body.tempPassword || body.tempPassword.length < 6) return showToast("Temporary password must be at least 6 characters");
        }
        try {
          const res = await api(`/api/admin/users/${u.id}/set-auth`, { method: "POST", json: body });
          const data = await res.json();
          if (!res.ok) return showToast(`Error: ${data.error || res.status}`);
          showToast(`✅ Auth updated for ${u.name}. ${authMethod === 'password' ? 'They must change password on next login.' : 'PIN updated.'}`);
          load();
        } catch(e) {
          showToast("Network error — check console");
          console.error(e);
        }
      };
      // Hold/Unhold — check button text to get live state, not stale u object
      row.querySelector('[data-action="hold"]').onclick = async () => {
        const holdBtn = row.querySelector('[data-action="hold"]');
        const currentlyHeld = holdBtn.textContent.trim().startsWith('✅');
        const endpoint = currentlyHeld ? `/api/admin/users/${u.id}/unhold` : `/api/admin/users/${u.id}/hold`;
        const res = await api(endpoint, { method: "POST", json: {} });
        if (!res.ok) { const e = await res.json(); return showToast(e.error||"Failed"); }
        showToast(currentlyHeld ? `${u.name} account unblocked ✅` : `${u.name} account held 🔒`);
        load();
      };
    }
    rowsEl.appendChild(row);
  });
}

function toggleAuthFields(sel) {
  const card = sel.closest('[data-auth-panel]');
  if (!card) return;
  const isPw = sel.value === 'password';
  card.querySelector('[data-pin-field]').style.display  = isPw ? 'none' : '';
  card.querySelector('[data-pw-fields]').style.display  = isPw ? '' : 'none';
}

// Toggle new-user auth fields
function toggleNewAuthFields() {
  const method = document.getElementById("newAuthMethod").value;
  document.getElementById("newPinFields").style.display = method === "pin"      ? "flex"   : "none";
  document.getElementById("newPwFields").style.display  = method === "password" ? "flex"   : "none";
}
// Wire up with addEventListener (more reliable than onchange attribute)
document.getElementById("newAuthMethod").addEventListener("change", toggleNewAuthFields);

document.getElementById("addBtn").onclick = async () => {
  const name       = document.getElementById("newName").value.trim();
  const role       = document.getElementById("newRole").value;
  const payRate    = parseFloat(document.getElementById("newPayRate").value) || 0;
  const payType    = document.getElementById("newPayType").value;
  const branchId   = (staff.role === "superManager" || staff.role === "admin") ? document.getElementById("newBranch").value : staff.branchId;
  const authMethod = document.getElementById("newAuthMethod").value;

  if (!name) return showToast("Name is required");

  let body = { name, role, branchId, payRate, payType, authMethod };

  if (authMethod === "pin") {
    const pin = document.getElementById("newPin").value.trim();
    if (!pin || pin.length < 4) return showToast("Enter a PIN (minimum 4 digits)");
    body.pin = pin;
  } else {
    const username = document.getElementById("newUsername").value.trim();
    const tempPw   = document.getElementById("newTempPw").value;
    if (!username) return showToast("Username is required for password login");
    if (!tempPw || tempPw.length < 6) return showToast("Temporary password must be at least 6 characters");
    body.username     = username;
    body.tempPassword = tempPw;
    body.pin          = "0000"; // placeholder — user won't use PIN
  }

  const res = await api("/api/users", { method: "POST", json: body });
  if (!res.ok) { const e = await res.json(); return showToast(e.error || "Could not add user"); }

  // Clear form
  document.getElementById("newName").value    = "";
  document.getElementById("newPin").value     = "";
  document.getElementById("newUsername").value = "";
  document.getElementById("newTempPw").value  = "";
  document.getElementById("newPayRate").value = "";
  showToast(`✅ Added ${name} (${authMethod === "password" ? "password login" : "PIN login"})`);
  load();
};

if (staff && (isManagerRole(staff) || staff.role === 'admin')) {
  loadBranchOptions();
  load();
  loadPermissions();
  setInterval(load, 15000); // refresh every 15s, only re-renders if data changed
}

})();
