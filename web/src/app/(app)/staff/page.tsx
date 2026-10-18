"use client";

import { Suspense, useEffect, useState } from "react";
import {
  Plus, Users as UsersIcon, ShieldCheck, Key, Pause, Play, Trash2,
  Lock, Pencil,
} from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete, getActiveBranchId } from "@/lib/api";
import { useSearchParams } from "next/navigation";
import { money, useSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { Role } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import { KeyRound as KeyRoundIcon, Lock as LockIcon } from "lucide-react";

interface User {
  id: number;
  name: string;
  role: Role;
  payRate: number;
  payType: string;
  authMethod: string;
  username: string | null;
  isHeld: boolean;
  branchId: number | null;
}

// Who may manage whom - mirrors the server rules (backend/src/api.js guardAccount).
const RANK: Record<string, number> = { admin: 4, superManager: 3, manager: 2, finance: 1, server: 1, cashier: 1, kitchen: 1 };
const ALL_ROLES = ["server", "cashier", "kitchen", "finance", "manager", "superManager", "admin"];
function assignableRoles(myRole?: string) {
  return ALL_ROLES.filter((r) => myRole === "admin" || (RANK[r] || 0) < (RANK[myRole || ""] || 0));
}
function canManageUser(me: { id: number; role: string; branchId?: number | null } | null | undefined, u: User) {
  if (!me || me.id === u.id) return false;
  if (me.role === "admin") return true;
  if ((RANK[me.role] || 0) <= (RANK[u.role] || 0)) return false;
  if (me.role === "manager" && (u.branchId ?? null) !== (me.branchId ?? null)) return false;
  return true;
}

interface BranchLite { id: number; name: string }
const BRANCH_FREE = ["admin", "superManager"];   // these roles work across all branches

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  superManager: "Super Manager",
  manager: "Manager",
  finance: "Finance",
  server: "Server",
  cashier: "Cashier",
  kitchen: "Kitchen",
};

const ROLE_PILL: Record<string, string> = {
  admin: "pill-bad",
  superManager: "pill-clay",
  manager: "pill-clay",
  finance: "pill-olive",
  server: "pill-ok",
  cashier: "pill-olive",
  kitchen: "pill-warn",
};

export default function StaffPage() {
  return <Suspense fallback={<PageLoader />}><StaffPageInner /></Suspense>;
}

function StaffPageInner() {
  const toast = useToast();
  const { user } = useAuth();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pinOf, setPinOf] = useState<User | null>(null);
  const [passOf, setPassOf] = useState<User | null>(null);
  const [authOf, setAuthOf] = useState<User | null>(null);
  const [editOf, setEditOf] = useState<User | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const search = useSearchParams();
  const presetBranch = search?.get("branch") ? Number(search.get("branch")) : null;
  // Super managers and admins choose the branch for each user.
  const pickBranch = user?.role === "superManager" || user?.role === "admin";

  useEffect(() => {
    if (!pickBranch) return;
    apiGet<BranchLite[]>("/branches").then((b) => setBranches(Array.isArray(b) ? b : [])).catch(() => {});
    if (presetBranch) { setBranchFilter(String(presetBranch)); if (search?.get("new")) setOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickBranch]);
  const branchName = (id: number | null) => id == null ? "All branches" : (branches.find((b) => b.id === id)?.name || `Branch ${id}`);

  const load = () =>
    apiGet<User[]>("/users")
      .then((d) => setList(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const canManagePay = user?.role === "manager" || user?.role === "superManager";
  const canHold      = user?.role === "manager" || user?.role === "superManager" || user?.role === "admin";

  async function toggleHold(u: User) {
    const action = u.isHeld ? "unhold" : "hold";
    if (!confirm(`${u.isHeld ? "Re-enable" : "Suspend"} ${u.name}?`)) return;
    try {
      await apiPost(`/admin/users/${u.id}/${action}`);
      toast.push("ok", `${u.name} ${u.isHeld ? "re-enabled" : "suspended"}`);
      setLoading(true); load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resetPin(u: User) {
    const pin = prompt(`New PIN for ${u.name} (4-10 digits):`);
    if (!pin || pin.length < 4) return;
    try {
      await apiPost(`/admin/users/${u.id}/reset-pin`, { pin });
      toast.push("ok", `PIN reset for ${u.name}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resetPassword(u: User) {
    const pass = prompt(`New temporary password for ${u.name} (6+ chars):`);
    if (!pass || pass.length < 6) return;
    try {
      await apiPost(`/admin/users/${u.id}/reset-password`, { tempPassword: pass });
      toast.push("ok", `Password reset for ${u.name}. They must change on next sign-in.`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const shown = branchFilter === "all" ? list
    : list.filter((u) => u.branchId === Number(branchFilter) || BRANCH_FREE.includes(u.role));

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Users" subtitle={`${shown.length} accounts`} icon={UsersIcon}>
          {pickBranch && branches.length > 0 && (
            <select className="inp !py-1.5 !w-auto text-[13px]" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} aria-label="Show branch">
              <option value="all">All branches</option>
              {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
            </select>
          )}
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> New user
          </button>
        </PageHeader>

        {loading ? <PageLoader /> : !shown.length ? (
          <EmptyState title="No users" icon={<UsersIcon size={30} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">Name</th>
                  <th>Role</th>
                  {pickBranch && <th>Branch</th>}
                  <th>Sign-in</th>
                  {canManagePay && <th>Pay</th>}
                  <th>Status</th>
                  <th className="text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id} className="border-t border-line-soft">
                    <td className="py-2.5 font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          className="size-8 rounded-full flex items-center justify-center text-[12px] font-bold text-[color:var(--on-accent)]"
                          style={{ background: "var(--olive)" }}
                        >
                          {u.name.charAt(0).toUpperCase()}
                        </span>
                        {u.name}
                        {u.id === user?.id && <span className="pill pill-olive" style={{ fontSize: 10 }}>You</span>}
                      </div>
                    </td>
                    <td><span className={`pill ${ROLE_PILL[u.role] || "pill-olive"}`}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    {pickBranch && <td className="text-[12.5px] text-muted">{BRANCH_FREE.includes(u.role) ? "All branches" : branchName(u.branchId)}</td>}
                    <td className="text-muted capitalize">{u.authMethod === "password" ? `@${u.username}` : "PIN"}</td>
                    {canManagePay && (
                      <td className="mono">
                        {u.payRate > 0 ? `${money(u.payRate, currency)}/${u.payType === "hourly" ? "hr" : u.payType}` : "—"}
                      </td>
                    )}
                    <td>
                      {u.isHeld ? (
                        <span className="pill pill-bad">Suspended</span>
                      ) : (
                        <span className="pill pill-ok"><ShieldCheck size={11} /> Active</span>
                      )}
                    </td>
                    <td className="text-right pr-4">
                      {u.id === user?.id ? (
                        <button onClick={() => setEditOf(u)} className="btn btn-soft btn-sm" title="Change your name or PIN">
                          <Pencil size={13} /> Edit
                        </button>
                      ) : !canManageUser(user, u) ? (
                        <span className="text-[11.5px] text-muted" title="Only someone above this role can change it">—</span>
                      ) : (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditOf(u)} className="btn btn-soft btn-sm" title="Edit user">
                          <Pencil size={13} /> Edit
                        </button>
                        {user?.role !== "manager" && (
                        <button onClick={() => setAuthOf(u)} className="btn btn-ghost btn-sm !px-2" title="Change sign-in method (PIN ↔ username/password)">
                          <KeyRoundIcon size={13} />
                        </button>
                        )}
                        {u.authMethod === "pin" ? (
                          <button onClick={() => resetPin(u)} className="btn btn-ghost btn-sm !px-2" title="Reset PIN">
                            <Key size={13} />
                          </button>
                        ) : user?.role === "manager" ? null : (
                          <button onClick={() => resetPassword(u)} className="btn btn-ghost btn-sm !px-2" title="Reset password">
                            <LockIcon size={13} />
                          </button>
                        )}
                        {canHold && (
                          <button onClick={() => toggleHold(u)} className="btn btn-ghost btn-sm !px-2" title={u.isHeld ? "Re-enable" : "Suspend"}>
                            {u.isHeld ? <Play size={13} /> : <Pause size={13} />}
                          </button>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Screen>

      {open && (
        <AddUser
          currentRole={user?.role}
          branchId={user?.branchId ?? null}
          branches={pickBranch ? branches : []}
          defaultBranch={branchFilter !== "all" ? Number(branchFilter) : (Number(getActiveBranchId()) || branches[0]?.id || null)}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); setLoading(true); load(); toast.push("ok", "User created"); }}
        />
      )}

      {editOf && (
        <EditUser
          target={editOf}
          currentRole={user?.role}
          selfId={user?.id}
          showPay={canManagePay}
          branches={pickBranch ? branches : []}
          onClose={() => setEditOf(null)}
          onDone={(msg) => { setEditOf(null); setLoading(true); load(); toast.push("ok", msg); }}
        />
      )}

      {authOf && (
        <SetAuthModal
          user={authOf}
          onClose={() => setAuthOf(null)}
          onDone={() => { setAuthOf(null); setLoading(true); load(); toast.push("ok", "Sign-in method changed"); }}
        />
      )}
    </div>
  );
}

function SetAuthModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<"pin" | "password">(user.authMethod as "pin" | "password");
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
                {m === "pin" ? "Staff PIN" : "Username + password"}
              </button>
            ))}
          </div>
        </div>
        {method === "pin" ? (
          <div><label className="lbl">PIN (4-10 digits)</label>
            <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={10}
              value={pin} autoFocus onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </div>
        ) : (
          <>
            <div><label className="lbl">Username</label>
              <input className="inp" value={username} autoFocus onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div><label className="lbl">Temporary password (6+ chars)</label>
              <input className="inp" type="password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
              <p className="text-[11px] text-muted mt-1">User will be asked to change it on next sign-in.</p>
            </div>
          </>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Change sign-in method"}
        </button>
      </div>
    </Modal>
  );
}

function AddUser({
  currentRole, branchId, branches, defaultBranch, onClose, onDone,
}: {
  currentRole?: Role;
  branchId: number | null;
  branches: BranchLite[];
  defaultBranch: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    name: "",
    role: "server",
    pin: "",
    payRate: "",
    payType: "hourly",
    branch: String(defaultBranch ?? branchId ?? ""),
  });
  const choose = branches.length > 0 && !BRANCH_FREE.includes(f.role);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");

  const roles = assignableRoles(currentRole);

  async function save() {
    if (!f.name.trim() || f.pin.length < 4) {
      setErr("Name and a 4+ digit PIN are required");
      return;
    }
    if (choose && !f.branch) { setErr("Choose the branch this person works at"); return; }
    setBusy(true); setErr("");
    try {
      await apiPost("/users", {
        name: f.name,
        role: f.role,
        pin: f.pin,
        payRate: Number(f.payRate) || 0,
        payType: f.payType,
        branchId: choose ? Number(f.branch) : branchId,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Modal open title="New user" onClose={onClose} width={460}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Role</label>
            <select className="inp" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select></div>
          {branches.length > 0 && (
            <div className="col-span-2"><label className="lbl">Branch</label>
              {choose ? (
                <select className="inp" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
                  <option value="">Choose a branch…</option>
                  {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                </select>
              ) : <div className="inp text-muted">All branches ({ROLE_LABEL[f.role]} accounts are not tied to one branch)</div>}
            </div>
          )}
          <div><label className="lbl">PIN (4-8 digits)</label>
            <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={8}
              value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} /></div>
          <div><label className="lbl">Pay rate</label>
            <input className="inp mono" inputMode="decimal" value={f.payRate}
              onChange={(e) => setF({ ...f, payRate: e.target.value })} /></div>
          <div><label className="lbl">Pay type</label>
            <select className="inp" value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="salary">Salary</option>
            </select></div>
        </div>
        {err && (
          <div className="rounded-lg p-2 text-[12.5px] text-center" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>
            {err}
          </div>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Create user"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------- Edit user ------------------------- */
function EditUser({ target, currentRole, selfId, showPay, branches, onClose, onDone }: {
  target: User; currentRole?: Role; selfId?: number; showPay: boolean; branches: BranchLite[];
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [f, setF] = useState({ name: target.name, role: target.role as string, payRate: String(target.payRate || ""), payType: target.payType || "hourly", pin: "",
    branch: target.branchId ? String(target.branchId) : "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSelf = target.id === selfId;

  const roles = assignableRoles(currentRole);
  const payEditable = showPay && !isSelf;
  const roleOptions = roles.includes(target.role) ? roles : [target.role, ...roles];

  async function save() {
    if (!f.name.trim()) { setErr("Name is required"); return; }
    if (f.pin && !/^\d{4,8}$/.test(f.pin)) { setErr("PIN must be 4 to 8 digits"); return; }
    setBusy(true); setErr("");
    try {
      const body: Record<string, unknown> = { name: f.name.trim() };
      if (!isSelf && f.role !== target.role) body.role = f.role;
      if (payEditable) { body.payRate = Number(f.payRate) || 0; body.payType = f.payType; }
      const branchable = branches.length > 0 && !isSelf && !BRANCH_FREE.includes(f.role);
      if (branchable) {
        if (!f.branch) { setErr("Choose the branch this person works at"); setBusy(false); return; }
        if (Number(f.branch) !== (target.branchId ?? 0)) body.branchId = Number(f.branch);
      }
      await apiPut(`/users/${target.id}`, body);
      if (f.pin && target.authMethod !== "password") await apiPost(`/admin/users/${target.id}/reset-pin`, { pin: f.pin });
      const moved = body.branchId ? ` · moved to ${branches.find((b) => b.id === body.branchId)?.name || "new branch"}` : "";
      onDone(`${f.name.trim()} updated${f.pin ? " · new PIN saved" : ""}${moved}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setErr("");
    try { await apiDelete(`/users/${target.id}`); onDone(`${target.name} deleted`); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete"); setBusy(false); }
  }

  return (
    <Modal open title={`Edit user — ${target.name}`} onClose={onClose} width={480}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Role</label>
            <select className="inp" value={f.role} disabled={isSelf} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select>
            {isSelf && <p className="text-[11px] text-muted mt-1">You can&apos;t change your own role.</p>}
          </div>
          {branches.length > 0 && !isSelf && !BRANCH_FREE.includes(f.role) && (
            <div className="col-span-2"><label className="lbl">Branch</label>
              <select className="inp" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>
                <option value="">Choose a branch…</option>
                {branches.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
              {target.branchId && f.branch && Number(f.branch) !== target.branchId && (
                <p className="text-[11.5px] mt-1" style={{ color: "var(--warn-ink)" }}>{target.name} will work at this branch from now on.</p>
              )}
            </div>
          )}
          {target.authMethod !== "password" ? (
            <div><label className="lbl">New PIN (leave empty to keep)</label>
              <input className="inp mono tracking-widest" type="password" inputMode="numeric" maxLength={8} placeholder="••••"
                value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} /></div>
          ) : (
            <div><label className="lbl">Sign-in</label><div className="inp text-muted">@{target.username} (password)</div></div>
          )}
          {payEditable && <>
            <div><label className="lbl">Pay rate</label>
              <input className="inp mono" inputMode="decimal" value={f.payRate} onChange={(e) => setF({ ...f, payRate: e.target.value })} /></div>
            <div><label className="lbl">Pay type</label>
              <select className="inp" value={f.payType} onChange={(e) => setF({ ...f, payType: e.target.value })}>
                <option value="hourly">Hourly</option><option value="daily">Daily</option><option value="salary">Salary</option>
              </select></div>
          </>}
        </div>
        {err && <div className="rounded-lg p-2 text-[12.5px] text-center" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>{err}</div>}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : "Save changes"}</button>
        {!isSelf && (
          confirmDelete ? (
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost flex-1">Keep user</button>
              <button onClick={remove} disabled={busy} className="btn btn-danger flex-1"><Trash2 size={14} /> Yes, delete {target.name}</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost w-full text-bad"><Trash2 size={14} /> Delete user</button>
          )
        )}
      </div>
    </Modal>
  );
}
