"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Shield, Users as UsersIcon, Key, KeyRound, Lock, Pause, Play,
  RefreshCw, ScrollText, Package, Download, Upload, Database,
  AlertTriangle, Server, Settings as SettingsIcon, Store, Printer,
  QrCode, Receipt, FileWarning, ArrowLeft, CheckCircle2, HardDrive, Clock, Activity, XCircle, RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, getToken, fetchBootId, clearSession } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, Screen, useToast, Modal, EmptyState } from "@/components/ui";

/** Build an API URL that carries the auth token (for plain <a> downloads). */
function authUrl(path: string) {
  const t = getToken();
  const sep = path.includes("?") ? "&" : "?";
  return `/api${path}${t ? `${sep}_auth=${encodeURIComponent(t)}` : ""}`;
}

interface AdminUser {
  id: number;
  name: string;
  role: string;
  authMethod: "pin" | "password";
  username: string | null;
  isHeld: boolean;
  mustChangePassword?: boolean;
}
interface LoginLog { id: number; name: string; role: string; status: string; at: string; ip: string }
interface HealthCheck { level: "ok" | "warn" | "bad"; msg: string }
interface SystemInfo {
  dbSize: number; uptimeSec: number; nodeVersion: string; lastBackupAt: string | null;
  backups: { name: string; size: number; at: string }[];
  counts: { users: number; menuItems: number; ordersToday: number; ordersTotal: number; openOrders: number; tables: number };
}
const fmtBytes = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const fmtUptime = (s: number) => s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.max(1, Math.floor(s / 60))} min`;
const fmtWhen = (iso?: string | null) => { if (!iso) return "never"; const d = new Date(String(iso).replace(" ", "T")); return isNaN(+d) ? String(iso) : d.toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); };

export default function AdminPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs]   = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetPinOf, setResetPinOf] = useState<AdminUser | null>(null);
  const [resetPassOf, setResetPassOf] = useState<AdminUser | null>(null);
  const [setAuthOf, setSetAuthOf]     = useState<AdminUser | null>(null);
  const [health, setHealth] = useState<HealthCheck[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [agentOk, setAgentOk] = useState<boolean | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [holdOf, setHoldOf] = useState<AdminUser | null>(null);
  const [restoreOf, setRestoreOf] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<AdminUser[]>("/admin/users").catch(() => []),
      apiGet<LoginLog[]>("/admin/login-logs").catch(() => []),
      apiGet<{ checks: HealthCheck[] }>("/settings/health").catch(() => ({ checks: [] as HealthCheck[] })),
      apiGet<SystemInfo>("/admin/system-info").catch(() => null),
    ]).then(([u, l, h, i]) => {
      setUsers(Array.isArray(u) ? u : []);
      setLogs(Array.isArray(l) ? l : []);
      setHealth(Array.isArray(h?.checks) ? h.checks : []);
      setInfo(i);
    }).finally(() => setLoading(false));
    // Printer helper runs on the till; reach it directly there, or via the till from a tablet.
    const onTill = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    fetch(onTill ? "http://127.0.0.1:9110/health" : "/print-agent/health").then((r) => setAgentOk(r.ok)).catch(() => setAgentOk(false));
  }, []);
  useEffect(load, [load]);

  async function toggleHold(u: AdminUser) {
    const action = u.isHeld ? "unhold" : "hold";
    setHoldOf(null);
    try {
      await apiPost(`/admin/users/${u.id}/${action}`);
      toast.push("ok", `${u.name} ${u.isHeld ? "re-enabled" : "suspended"}`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function backupDb() {
    setBackingUp(true);
    try {
      const r = await apiPost<{ ok: boolean; file?: string }>("/settings/backup");
      toast.push("ok", `Backup saved${r.file ? `: ${r.file}` : ""}`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Backup failed"); }
    finally { setBackingUp(false); }
  }

  // Restore: the backend checks the file, saves a safety copy, then restarts
  // with the chosen backup. We wait for the new server and go to the PIN screen.
  async function restoreBackup(name: string) {
    setRestoreOf(null);
    setRestoring(true);
    try {
      const before = await fetchBootId();
      await apiPost("/admin/backups/restore", { name, confirm: true });
      const t0 = Date.now();
      while (Date.now() - t0 < 120000) {
        await new Promise((r) => setTimeout(r, 2000));
        const now = await fetchBootId().catch(() => null);
        if (now && now !== before) break;
      }
      clearSession();
      window.location.href = "/login";
    } catch (e) {
      setRestoring(false);
      toast.push("bad", e instanceof Error ? e.message : "Restore failed");
    }
  }

  // A backup file from a USB stick / another computer: .db goes into the list,
  // a "Download all data" .json file is loaded with the data import.
  async function pickRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(await file.text());
        if (!confirm(`Replace ALL current data with "${file.name}"? Make a backup first if you are not sure.`)) return;
        await apiPost("/settings/import", { ...data, confirm: true });
        toast.push("ok", "Data restored from file");
        clearSession(); window.location.href = "/login";
        return;
      }
      const dataBase64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("Could not read the file")); r.readAsDataURL(file);
      });
      const r = await apiPost<{ ok: boolean; name: string }>("/admin/backups/upload", { dataBase64 });
      toast.push("ok", "Backup file checked - press Restore to use it");
      load();
      setRestoreOf(r.name);
    } catch (err) { toast.push("bad", err instanceof Error ? err.message : "That file can't be used"); }
  }

  async function wipeTestData() {
    setConfirmWipe(false);
    try { await apiPost("/settings/reset-test-data"); toast.push("ok", "Test data cleared"); load(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const canAdmin = user?.role === "admin" || user?.role === "superManager";
  const isAdmin = user?.role === "admin";

  if (!canAdmin) {
    return <EmptyState title="Not available" hint="Only an administrator or super manager can open this page." icon={<Shield size={32} />} />;
  }
  if (loading) return <PageLoader label="Loading admin" />;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button onClick={() => router.push("/")} className="btn btn-ghost btn-sm"><ArrowLeft size={15} /> Back to main page</button>
          <button onClick={load} className="btn btn-ghost btn-sm ml-auto"><RefreshCw size={14} /> Refresh</button>
        </div>
        <PageHeader title="System Admin" subtitle="Is everything working? Backups, health and user access" icon={Shield} />

        {/* Status at a glance */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <StatusCard icon={<Activity size={18} />} label="POS server" ok
            value="Running" sub={info ? `for ${fmtUptime(info.uptimeSec)}` : ""} />
          <StatusCard icon={<Printer size={18} />} label="Printer helper" ok={agentOk !== false}
            value={agentOk == null ? "Checking…" : agentOk ? "Running" : "Not running"} sub={agentOk === false ? "Restart the POS" : "Bills & kitchen tickets"} />
          <StatusCard icon={<Database size={18} />} label="Last backup" ok={!!info?.lastBackupAt}
            value={fmtWhen(info?.lastBackupAt)} sub={info ? `${info.backups.length} backup${info.backups.length === 1 ? "" : "s"} kept` : ""} />
          <StatusCard icon={<HardDrive size={18} />} label="Database" ok
            value={info ? fmtBytes(info.dbSize) : "—"} sub={info ? `${info.counts.ordersTotal} orders · ${info.counts.menuItems} menu items` : ""} />
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mb-5">
          {/* Health checks as traffic lights */}
          <div className="rounded-xl p-4" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
            <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-ink"><Server size={16} style={{ color: "var(--olive-text)" }} /> Health check</div>
            {!health.length ? <p className="text-sm text-muted">No checks available.</p> : (
              <ul className="flex flex-col gap-2">
                {health.map((c, i) => (
                  <li key={i} className="flex items-start gap-2.5 rounded-lg px-3 py-2 text-[13px]"
                    style={{ background: c.level === "ok" ? "color-mix(in srgb, var(--ok) 10%, var(--panel))" : c.level === "warn" ? "color-mix(in srgb, #e0a040 14%, var(--panel))" : "color-mix(in srgb, var(--bad) 12%, var(--panel))" }}>
                    {c.level === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: "var(--ok-ink)" }} />
                      : c.level === "warn" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "#b7791f" }} />
                      : <XCircle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--bad-ink)" }} />}
                    <span className="text-ink">{c.msg}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Backups */}
          <div className="rounded-xl p-4" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Database size={16} style={{ color: "var(--olive-text)" }} /> Backups</span>
              <button onClick={backupDb} disabled={backingUp} className="btn btn-primary btn-sm ml-auto">
                <Database size={13} /> {backingUp ? "Backing up…" : "Back up now"}
              </button>
            </div>
            <p className="mb-2 text-[12px] text-muted">A backup is made automatically every day. The newest 30 are kept on this computer.{isAdmin && " To go back to one, press Restore."}</p>
            {!info?.backups.length ? <p className="text-sm text-muted">No backups yet — press Back up now.</p> : (
              <ul className="max-h-64 overflow-y-auto flex flex-col gap-1">
                {info.backups.map((b) => (
                  <li key={b.name} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px]" style={{ background: "var(--panel)" }}>
                    <Clock size={13} className="text-muted shrink-0" />
                    <span className="text-ink">{fmtWhen(b.at)}</span>
                    <span className="pill pill-olive" style={{ fontSize: 10 }}>{backupKind(b.name)}</span>
                    <span className="ml-auto text-muted">{fmtBytes(b.size)}</span>
                    {isAdmin && (
                      <button onClick={() => setRestoreOf(b.name)} className="btn btn-ghost btn-sm !py-0.5 !px-2" title="Put the POS back to this backup">
                        <RotateCcw size={12} /> Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && (
              <>
                <button onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm mt-2">
                  <Upload size={13} /> Restore from a file (USB / downloaded)…
                </button>
                <input ref={fileRef} type="file" accept=".db,.json" hidden onChange={pickRestoreFile} />
              </>
            )}
          </div>
        </div>

        {/* Tools */}
        <div className="eyebrow mb-3">Tools</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
          <a href={authUrl("/settings/export")} download={`golden-pos-data-${new Date().toISOString().slice(0, 10)}.json`} className="btn btn-ghost">
            <Download size={14} /> Download all data (file)
          </a>
          <a href={authUrl("/fiscal/export")} download={`fiscal-export-${new Date().toISOString().slice(0, 10)}.json`} className="btn btn-ghost">
            <Receipt size={14} /> Download fiscal export
          </a>
          <Link href="/settings" className="btn btn-ghost"><SettingsIcon size={14} /> Settings</Link>
          <button onClick={() => setConfirmWipe(true)} className="btn btn-danger"><AlertTriangle size={14} /> Clear test data</button>
        </div>

        <div className="eyebrow mb-3">Shortcuts</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <Link href="/branches" className="btn btn-ghost"><Store size={14} /> Branches</Link>
          <Link href="/menu-admin" className="btn btn-ghost"><Package size={14} /> Menu, categories, stations</Link>
          <Link href="/audit" className="btn btn-ghost"><FileWarning size={14} /> Change audit log</Link>
        </div>
      </Screen>

      {/* ---- Users table ---- */}
      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4">User access</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                <th className="py-2.5">Name</th>
                <th>Role</th>
                <th>Sign-in</th>
                <th>Status</th>
                <th className="text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line-soft">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="size-8 rounded-full flex items-center justify-center text-[12px] font-bold"
                        style={{ background: u.role === "admin" ? "var(--bad)" : "var(--olive)", color: u.role === "admin" ? "#fff" : "var(--on-accent)" }}>
                        {u.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="font-medium text-ink">{u.name}</span>
                      {u.id === user?.id && <span className="pill pill-olive" style={{ fontSize: 10 }}>You</span>}
                    </div>
                  </td>
                  <td><span className={`pill ${u.role === "admin" ? "pill-bad" : u.role === "superManager" ? "pill-clay" : "pill-olive"}`}>{u.role}</span></td>
                  <td className="text-muted">
                    {u.authMethod === "password" ? <>@{u.username}</> : "PIN"}
                    {u.mustChangePassword && <span className="pill pill-warn ml-2">must change</span>}
                  </td>
                  <td>{u.isHeld ? <span className="pill pill-bad">suspended</span> : <span className="pill pill-ok">active</span>}</td>
                  <td className="text-right pr-4">
                    {u.id === user?.id ? (
                      <span className="text-[11.5px] text-muted" title="Change your own PIN in My profile. Another admin manages your account.">your account</span>
                    ) : (
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setSetAuthOf(u)} className="btn btn-ghost btn-sm !px-2" title="Change sign-in method">
                        <KeyRound size={13} />
                      </button>
                      {u.authMethod === "pin" ? (
                        <button onClick={() => setResetPinOf(u)} className="btn btn-ghost btn-sm !px-2" title="Reset PIN">
                          <Key size={13} />
                        </button>
                      ) : (
                        <button onClick={() => setResetPassOf(u)} className="btn btn-ghost btn-sm !px-2" title="Reset password">
                          <Lock size={13} />
                        </button>
                      )}
                      <button onClick={() => setHoldOf(u)} className="btn btn-ghost btn-sm !px-2" title={u.isHeld ? "Re-enable" : "Suspend"}>
                        {u.isHeld ? <Play size={13} /> : <Pause size={13} />}
                      </button>
                    </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Screen>

      {/* ---- Recent login activity ---- */}
      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4 flex items-center gap-2">
          <ScrollText size={15} style={{ color: "var(--olive-text)" }} /> Recent logins
        </h2>
        {!logs.length ? (
          <EmptyState title="No login activity yet" />
        ) : (
          <div className="flex flex-col gap-1">
            {logs.slice(0, 30).map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--panel-2)" }}>
                {l.status === "ok" ? <CheckCircle2 size={16} style={{ color: "var(--ok-ink)" }} /> : <XCircle size={16} style={{ color: "var(--bad-ink)" }} />}
                <span className="font-medium text-ink">{l.name || "Unknown"}</span>
                <span className="text-muted">{l.status === "ok" ? "signed in" : "failed sign-in"}{l.role ? ` · ${l.role}` : ""}</span>
                <span className="text-muted ml-auto">{fmtWhen(l.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Screen>

      {confirmWipe && (
        <Modal open title="Clear test data?" onClose={() => setConfirmWipe(false)} width={420}>
          <p className="text-sm text-ink">This deletes <b>all orders, shifts and notifications</b>. Users, menu and settings are kept. This cannot be undone — make a backup first.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setConfirmWipe(false)} className="btn btn-ghost flex-1">Cancel</button>
            <button onClick={wipeTestData} className="btn btn-danger flex-1"><AlertTriangle size={14} /> Yes, clear it</button>
          </div>
        </Modal>
      )}
      {restoreOf && <RestoreModal name={restoreOf} onClose={() => setRestoreOf(null)} onRestore={() => restoreBackup(restoreOf)} />}

      {restoring && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(20,18,12,.72)" }}>
          <div className="rounded-2xl p-6 text-center max-w-sm" style={{ background: "var(--panel)" }}>
            <RefreshCw size={28} className="mx-auto animate-spin" style={{ color: "var(--olive-text)" }} />
            <p className="mt-3 text-[15px] font-semibold text-ink">Restoring the backup…</p>
            <p className="mt-1 text-[13px] text-muted">The POS restarts with the restored data. This takes about 20 seconds - don&apos;t turn the computer off. You will then sign in again.</p>
          </div>
        </div>
      )}

      {holdOf && (
        <Modal open title={`${holdOf.isHeld ? "Re-enable" : "Suspend"} ${holdOf.name}?`} onClose={() => setHoldOf(null)} width={380}>
          <p className="text-sm text-muted">{holdOf.isHeld ? "They will be able to sign in again." : "They won't be able to sign in until re-enabled."}</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setHoldOf(null)} className="btn btn-ghost flex-1">Cancel</button>
            <button onClick={() => toggleHold(holdOf)} className={`btn flex-1 ${holdOf.isHeld ? "btn-primary" : "btn-danger"}`}>{holdOf.isHeld ? "Re-enable" : "Suspend"}</button>
          </div>
        </Modal>
      )}
      {resetPinOf && (
        <ResetPinModal
          user={resetPinOf}
          onClose={() => setResetPinOf(null)}
          onDone={() => { setResetPinOf(null); load(); toast.push("ok", "PIN reset"); }}
        />
      )}
      {resetPassOf && (
        <ResetPasswordModal
          user={resetPassOf}
          onClose={() => setResetPassOf(null)}
          onDone={() => { setResetPassOf(null); load(); toast.push("ok", "Password reset"); }}
        />
      )}
      {setAuthOf && (
        <SetAuthModal
          user={setAuthOf}
          onClose={() => setSetAuthOf(null)}
          onDone={() => { setSetAuthOf(null); load(); toast.push("ok", "Sign-in method changed"); }}
        />
      )}
    </div>
  );
}

function StatusCard({ icon, label, value, sub, ok }: { icon: React.ReactNode; label: string; value: string; sub?: string; ok: boolean }) {
  return (
    <div className="rounded-xl p-4" style={{ background: ok ? "color-mix(in srgb, var(--ok) 8%, var(--panel))" : "color-mix(in srgb, var(--bad) 10%, var(--panel))", border: `1px solid ${ok ? "color-mix(in srgb, var(--ok) 30%, transparent)" : "color-mix(in srgb, var(--bad) 35%, transparent)"}` }}>
      <div className="mb-2 flex items-center gap-2" style={{ color: ok ? "var(--ok-ink)" : "var(--bad-ink)" }}>
        {icon}<span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        <span className="ml-auto size-2.5 rounded-full" style={{ background: ok ? "var(--ok)" : "var(--bad)" }} />
      </div>
      <div className="text-[18px] font-semibold leading-tight text-ink">{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

function AdminTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: "var(--olive-text)" }}>
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[20px] font-semibold text-ink leading-none">{value}</div>
    </div>
  );
}

function ResetPinModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pin.length < 4) { toast.push("bad", "PIN must be at least 4 digits"); return; }
    setBusy(true);
    try { await apiPost(`/admin/users/${user.id}/reset-pin`, { pin }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Reset PIN — ${user.name}`} onClose={onClose} width={360}>
      <div className="space-y-3">
        <div><label className="lbl">New PIN (4-10 digits)</label>
          <input className="inp mono text-[16px] tracking-widest" type="password" inputMode="numeric" maxLength={10}
            value={pin} autoFocus onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Reset PIN"}
        </button>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pass.length < 6) { toast.push("bad", "At least 6 characters"); return; }
    setBusy(true);
    try { await apiPost(`/admin/users/${user.id}/reset-password`, { tempPassword: pass }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Reset password — ${user.name}`} onClose={onClose} width={360}>
      <div className="space-y-3">
        <div><label className="lbl">Temporary password (6+ chars)</label>
          <input className="inp" type="password" value={pass} autoFocus onChange={(e) => setPass(e.target.value)} /></div>
        <p className="text-[11.5px] text-muted">User will be asked to change it on next sign-in.</p>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Reset password"}
        </button>
      </div>
    </Modal>
  );
}

function SetAuthModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<"pin" | "password">(user.authMethod);
  const [pin, setPin] = useState("");
  const [username, setUsername] = useState(user.username || "");
  const [tempPassword, setTempPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const payload = method === "pin"
        ? { authMethod: "pin", pin }
        : { authMethod: "password", username, tempPassword };
      await apiPost(`/admin/users/${user.id}/set-auth`, payload);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Sign-in method — ${user.name}`} onClose={onClose} width={420}>
      <div className="space-y-3">
        <div>
          <label className="lbl">Method</label>
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {(["pin", "password"] as const).map((m) => (
              <button key={m} onClick={() => setMethod(m)}
                className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={method === m
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        {method === "pin" ? (
          <div><label className="lbl">New PIN (4-10 digits)</label>
            <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={10}
              value={pin} autoFocus onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></div>
        ) : (
          <>
            <div><label className="lbl">Username</label>
              <input className="inp" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} /></div>
            <div><label className="lbl">Temporary password (6+ chars)</label>
              <input className="inp" type="password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} /></div>
          </>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Change sign-in method"}
        </button>
      </div>
    </Modal>
  );
}

function backupKind(name: string) {
  if (name.includes("before-restore")) return "safety copy";
  if (name.startsWith("uploaded-")) return "from file";
  if (name.includes("manual")) return "manual";
  return "daily";
}

/** Shows what is inside a backup, then asks once before restoring it. */
function RestoreModal({ name, onClose, onRestore }: { name: string; onClose: () => void; onRestore: () => void }) {
  const [sum, setSum] = useState<{ users: number; menuItems: number; orders: number; lastOrderAt: string | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiGet<{ users: number; menuItems: number; orders: number; lastOrderAt: string | null }>(`/admin/backups/inspect?name=${encodeURIComponent(name)}`)
      .then(setSum).catch((e) => setError(e instanceof Error ? e.message : "Could not read this backup"));
  }, [name]);
  return (
    <Modal open title="Restore this backup?" onClose={onClose} width={440}>
      <div className="space-y-3 text-[13.5px]">
        <div className="rounded-lg px-3 py-2 mono text-[12px] text-muted" style={{ background: "var(--panel-2)" }}>{name}</div>
        {error ? (
          <p className="rounded-lg p-2 text-center" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>{error}</p>
        ) : !sum ? <p className="text-muted">Checking the backup…</p> : (
          <>
            <ul className="grid grid-cols-3 gap-2 text-center">
              <li className="rounded-lg p-2" style={{ background: "var(--panel-2)" }}><div className="text-[17px] font-bold text-ink">{sum.orders}</div><div className="text-[11px] text-muted">orders</div></li>
              <li className="rounded-lg p-2" style={{ background: "var(--panel-2)" }}><div className="text-[17px] font-bold text-ink">{sum.menuItems}</div><div className="text-[11px] text-muted">menu items</div></li>
              <li className="rounded-lg p-2" style={{ background: "var(--panel-2)" }}><div className="text-[17px] font-bold text-ink">{sum.users}</div><div className="text-[11px] text-muted">users</div></li>
            </ul>
            <p className="text-muted">Last order in this backup: <b className="text-ink">{fmtWhen(sum.lastOrderAt)}</b></p>
            <p className="text-ink">The POS goes back to exactly this point. Anything entered after it (orders, menu changes, users) will no longer be shown.</p>
            <p className="text-muted">A safety copy of today&apos;s data is saved first, so you can undo this by restoring the &quot;safety copy&quot;.</p>
          </>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn btn-ghost flex-1">Cancel</button>
          <button onClick={onRestore} disabled={!sum} className="btn btn-danger flex-1"><RotateCcw size={14} /> Restore</button>
        </div>
      </div>
    </Modal>
  );
}
