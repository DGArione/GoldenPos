"use client";

import { useState } from "react";
import { UserCog, Key, Lock, ShieldCheck, Save, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Screen, useToast } from "@/components/ui";

// Same rule as the server: 8+ characters with letters and numbers.
function passwordProblem(pw: string, confirm: string): string {
  if (pw.length < 8) return "At least 8 characters";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use both letters and numbers";
  if (confirm && pw !== confirm) return "The two new passwords don't match";
  return "";
}

function Secret({ label, value, onChange, numeric, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; numeric?: boolean; autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="lbl">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          inputMode={numeric ? "numeric" : undefined}
          maxLength={numeric ? 8 : 128}
          autoComplete={autoComplete}
          className={`inp pr-10 ${numeric ? "mono tracking-widest" : ""}`}
          value={value}
          onChange={(e) => onChange(numeric ? e.target.value.replace(/\D/g, "") : e.target.value)}
        />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Show"}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted p-1">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const toast = useToast();
  const { user, logout } = useAuth();
  const [name, setName]           = useState(user?.name || "");
  const [cur, setCur]             = useState("");      // current PIN or password
  const [next, setNext]           = useState("");
  const [confirm, setConfirm]     = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [sw, setSw]               = useState({ username: "", currentPin: "", password: "", confirm: "" });
  const [toPin, setToPin]         = useState({ currentPassword: "", pin: "", confirm: "" });
  const [busy, setBusy]           = useState(false);

  if (!user) return null;

  const canApprove = user.role === "manager" || user.role === "superManager" || user.role === "admin";
  const authIsPassword = user.authMethod === "password";
  const pwIssue = authIsPassword ? passwordProblem(next, confirm) : "";
  const pinIssue = !authIsPassword
    ? (next.length < 4 ? "4 to 8 digits" : confirm && next !== confirm ? "The two new PINs don't match" : "")
    : "";
  const swIssue = passwordProblem(sw.password, sw.confirm) || (sw.username.trim().length < 3 ? "Choose a username (3+ characters)" : "");

  async function saveName() {
    if (!name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try { await apiPut("/me", { name }); toast.push("ok", "Name updated"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function saveCredential() {
    if (!cur) { toast.push("bad", authIsPassword ? "Enter your current password" : "Enter your current PIN"); return; }
    if (next !== confirm) { toast.push("bad", "The two new entries don't match"); return; }
    setBusy(true);
    try {
      if (authIsPassword) await apiPost("/me/password", { currentPassword: cur, newPassword: next });
      else await apiPost("/me/login-pin", { currentPin: cur, pin: next });
      setCur(""); setNext(""); setConfirm("");
      toast.push("ok", authIsPassword ? "Password changed - use it next time you sign in" : "PIN changed - use it next time you sign in");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function switchToPassword() {
    if (swIssue) { toast.push("bad", swIssue); return; }
    setBusy(true);
    try {
      await apiPost("/me/password", { currentPassword: sw.currentPin, username: sw.username.trim(), newPassword: sw.password });
      toast.push("ok", "Done - sign in with your username and password from now on");
      setTimeout(() => logout(), 1500);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  async function switchToPin() {
    if (!/^\d{4,8}$/.test(toPin.pin)) { toast.push("bad", "The PIN must be 4 to 8 digits"); return; }
    if (toPin.pin !== toPin.confirm) { toast.push("bad", "The two PINs don't match"); return; }
    setBusy(true);
    try {
      await apiPost("/me/login-method", { to: "pin", currentPassword: toPin.currentPassword, pin: toPin.pin });
      toast.push("ok", "Done - sign in with your PIN from now on");
      setTimeout(() => logout(), 1500);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  async function saveApprovalPin() {
    setBusy(true);
    try {
      await apiPost("/me/approval-pin", { approvalPin });
      setApprovalPin("");
      toast.push("ok", approvalPin ? "Approval PIN set" : "Approval PIN cleared");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <Screen>
        <PageHeader title="My profile" subtitle={`Signed in as ${user.name} (${user.role})`} icon={UserCog} />

        <div className="flex items-center gap-4 mb-5">
          <span
            className="flex size-16 shrink-0 items-center justify-center rounded-2xl text-[color:var(--on-accent)] text-[22px] font-bold"
            style={{ background: "var(--olive)" }}
          >
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <label className="lbl">Display name</label>
            <div className="flex gap-2">
              <input className="inp flex-1" value={name} onChange={(e) => setName(e.target.value)} />
              <button onClick={saveName} disabled={busy} className="btn btn-primary">
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      </Screen>

      {/* ---- Change sign-in credential ---- */}
      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-1 flex items-center gap-2">
          {authIsPassword ? <Lock size={16} /> : <Key size={16} />}
          {authIsPassword ? "Change password" : "Change PIN"}
        </h2>
        <p className="text-[12.5px] text-muted mb-4">
          {authIsPassword
            ? "Enter your current password, then the new one twice. Use at least 8 characters with letters and numbers."
            : "Enter your current PIN, then the new one twice (4 to 8 digits). Every person needs a different PIN."}
        </p>
        <div className="grid sm:grid-cols-3 gap-3 max-w-xl">
          <Secret label={authIsPassword ? "Current password" : "Current PIN"} value={cur} onChange={setCur} numeric={!authIsPassword} autoComplete="current-password" />
          <Secret label={authIsPassword ? "New password" : "New PIN"} value={next} onChange={setNext} numeric={!authIsPassword} autoComplete="new-password" />
          <Secret label={authIsPassword ? "New password again" : "New PIN again"} value={confirm} onChange={setConfirm} numeric={!authIsPassword} autoComplete="new-password" />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={saveCredential} disabled={busy || !cur || !!(authIsPassword ? pwIssue : pinIssue) || next !== confirm} className="btn btn-primary">
            {authIsPassword ? "Change password" : "Change PIN"}
          </button>
          {next && (authIsPassword ? pwIssue : pinIssue) && <span className="text-[12px] text-muted">{authIsPassword ? pwIssue : pinIssue}</span>}
        </div>
      </Screen>

      {/* ---- Admin on a PIN: switch to username + password ---- */}
      {user.role === "admin" && !authIsPassword && (
        <Screen>
          <h2 className="text-[15px] font-semibold text-ink mb-1 flex items-center gap-2">
            <Lock size={16} /> Use a password instead of a PIN
          </h2>
          <p className="text-[12.5px] text-muted mb-3">
            Safer for the admin account. After this you sign in with <b>Sign in with username &amp; password</b> on the login screen -
            your PIN stops working.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
            <div><label className="lbl">Username</label>
              <input className="inp" autoComplete="username" value={sw.username} onChange={(e) => setSw({ ...sw, username: e.target.value })} /></div>
            <Secret label="Current PIN" value={sw.currentPin} onChange={(v) => setSw({ ...sw, currentPin: v })} numeric autoComplete="current-password" />
            <Secret label="New password" value={sw.password} onChange={(v) => setSw({ ...sw, password: v })} autoComplete="new-password" />
            <Secret label="New password again" value={sw.confirm} onChange={(v) => setSw({ ...sw, confirm: v })} autoComplete="new-password" />
          </div>
          <div className="flex items-center gap-2 mt-3 text-[12px]" style={{ color: "var(--warn-ink)" }}>
            <AlertTriangle size={14} /> Write the username and password down somewhere safe.
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={switchToPassword} disabled={busy || !sw.currentPin || !!swIssue} className="btn btn-primary">
              Switch to password sign-in
            </button>
            {(sw.password || sw.username) && swIssue && <span className="text-[12px] text-muted">{swIssue}</span>}
          </div>
        </Screen>
      )}

      {/* ---- Admin on a password: switch back to a PIN ---- */}
      {user.role === "admin" && authIsPassword && (
        <Screen>
          <h2 className="text-[15px] font-semibold text-ink mb-1 flex items-center gap-2">
            <Key size={16} /> Use a PIN instead of a password
          </h2>
          <p className="text-[12.5px] text-muted mb-3">
            After this you sign in with your PIN on the keypad - your username and password stop working.
            A password is safer for the admin account; only switch if you need to.
          </p>
          <div className="grid sm:grid-cols-3 gap-3 max-w-xl">
            <Secret label="Current password" value={toPin.currentPassword} onChange={(v) => setToPin({ ...toPin, currentPassword: v })} autoComplete="current-password" />
            <Secret label="New PIN" value={toPin.pin} onChange={(v) => setToPin({ ...toPin, pin: v })} numeric autoComplete="new-password" />
            <Secret label="New PIN again" value={toPin.confirm} onChange={(v) => setToPin({ ...toPin, confirm: v })} numeric autoComplete="new-password" />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button onClick={switchToPin} disabled={busy || !toPin.currentPassword || toPin.pin.length < 4 || toPin.pin !== toPin.confirm} className="btn btn-primary">
              Switch to PIN sign-in
            </button>
            {toPin.confirm && toPin.pin !== toPin.confirm && <span className="text-[12px] text-muted">The two PINs don&apos;t match</span>}
          </div>
        </Screen>
      )}

      {/* ---- Approval PIN (managers only) ---- */}
      {canApprove && (
        <Screen>
          <h2 className="text-[15px] font-semibold text-ink mb-2 flex items-center gap-2">
            <ShieldCheck size={16} style={{ color: "var(--olive-text)" }} /> Approval PIN
          </h2>
          <p className="text-[12.5px] text-muted mb-3">
            A separate PIN managers use to authorise discounts, voids and refunds.
            Must be different from your sign-in PIN. Leave blank and press save to clear.
          </p>
          <div className="flex gap-2 max-w-sm">
            <input
              type="password"
              inputMode="numeric"
              maxLength={10}
              className="inp mono tracking-widest"
              placeholder="Approval PIN"
              value={approvalPin}
              onChange={(e) => setApprovalPin(e.target.value.replace(/\D/g, ""))}
            />
            <button onClick={saveApprovalPin} disabled={busy} className="btn btn-primary">
              Save
            </button>
          </div>
        </Screen>
      )}
    </div>
  );
}
