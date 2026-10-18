"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Store, Plus, Trash2, Pencil, MapPin, Phone, Image as ImageIcon, X, Wrench, Users, Printer, Copy,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Branch {
  id: number;
  name: string;
  address: string;
  phone: string;
  status: "active" | "maintenance" | "disabled";
  imageUrl?: string;
}

interface CreatedUser { id: number; name: string; role: string; pin: string }
const NEW_BRANCH_ROLES = [
  { role: "manager", label: "Manager" },
  { role: "cashier", label: "Cashier" },
  { role: "kitchen", label: "Kitchen" },
  { role: "server",  label: "Server" },
];

export default function BranchesPage() {
  const toast = useToast();
  const { user, selectBranch, branchId } = useAuth();
  const [list, setList] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Branch | null>(null);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ branch: string; users: CreatedUser[] } | null>(null);

  const load = () => {
    setLoading(true);
    apiGet<Branch[]>("/branches").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function remove(b: Branch) {
    if (!confirm(`Delete branch "${b.name}"? This cannot be undone.`)) return;
    try { await apiDelete(`/branches/${b.id}`); setList((p) => p.filter((x) => x.id !== b.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function setStatus(b: Branch, status: Branch["status"]) {
    try {
      const u = await apiPatch<Branch>(`/branches/${b.id}`, { status });
      setList((p) => p.map((x) => (x.id === u.id ? u : x)));
      toast.push("ok", `${b.name} → ${status}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const canManage = user?.role === "superManager" || user?.role === "admin";

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Branches" subtitle={`${list.length} branches`} icon={Store}>
          {canManage && (
            <button onClick={() => { setEdit(null); setOpen(true); }} className="btn btn-primary btn-sm">
              <Plus size={14} /> New branch
            </button>
          )}
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No branches" hint={canManage ? "Add one above." : "Ask your super manager."} icon={<Store size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((b) => {
              const active = b.id === branchId;
              const inMaintenance = b.status === "maintenance";
              return (
                <div key={b.id} className="rounded-xl overflow-hidden"
                  style={{
                    background: "var(--panel-2)",
                    border: active ? "1.5px solid var(--olive)" : "1px solid var(--line)",
                    opacity: inMaintenance ? 0.75 : 1,
                  }}>
                  {b.imageUrl ? (
                    <div className="h-32 bg-cover bg-center" style={{ backgroundImage: `url(${b.imageUrl})` }} />
                  ) : (
                    <div className="h-32 flex items-center justify-center" style={{ background: "var(--panel)" }}>
                      <Store size={32} style={{ color: "var(--muted)" }} />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-[15px] text-ink truncate">{b.name}</h3>
                          {active && <span className="pill pill-olive">Current</span>}
                          {inMaintenance && <span className="pill pill-warn"><Wrench size={10} /> Maintenance</span>}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => { setEdit(b); setOpen(true); }} className="btn btn-ghost btn-sm !px-2" title="Edit">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => remove(b)} className="btn btn-ghost btn-sm !px-2" title="Delete">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                    {b.address && <div className="text-[12px] text-muted flex items-start gap-1 mb-1"><MapPin size={12} className="mt-0.5 shrink-0" /><span>{b.address}</span></div>}
                    {b.phone && <div className="text-[12px] text-muted flex items-center gap-1 mb-3"><Phone size={12} /> {b.phone}</div>}

                    <div className="flex gap-2 mt-2 flex-wrap">
                      {canManage && (
                        <Link href={`/staff?branch=${b.id}&new=1`} className="btn btn-soft btn-sm" title="Add a manager or staff member to this branch">
                          <Users size={13} /> Add staff
                        </Link>
                      )}
                      {canManage && (
                        <Link href={`/staff?branch=${b.id}`} className="btn btn-ghost btn-sm" title="See and move the staff of this branch">
                          Staff list
                        </Link>
                      )}
                      {canManage && b.status !== "maintenance" && (
                        <button onClick={() => setStatus(b, "maintenance")} className="btn btn-ghost btn-sm">
                          <Wrench size={13} /> Maintenance
                        </button>
                      )}
                      {canManage && b.status === "maintenance" && (
                        <button onClick={() => setStatus(b, "active")} className="btn btn-soft btn-sm">
                          Reopen
                        </button>
                      )}
                      {canManage && !active && (
                        <button onClick={() => selectBranch(b.id)} className="btn btn-primary btn-sm ml-auto">
                          Switch
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Screen>

      {open && (
        <BranchEditor
          existing={edit}
          onClose={() => { setOpen(false); setEdit(null); }}
          onDone={(res) => {
            setOpen(false); setEdit(null); load(); toast.push("ok", "Saved");
            if (res?.createdUsers?.length) setCreated({ branch: res.name, users: res.createdUsers });
          }}
        />
      )}

      {created && <CreatedAccounts branch={created.branch} users={created.users} onClose={() => setCreated(null)} />}
    </div>
  );
}

function BranchEditor({ existing, onClose, onDone }: {
  existing: Branch | null; onClose: () => void;
  onDone: (created?: { name: string; createdUsers?: CreatedUser[] }) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    address: existing?.address || "",
    phone: existing?.phone || "",
    status: (existing?.status || "active") as "active" | "maintenance" | "disabled",
    imageUrl: existing?.imageUrl || "",
  });
  const [busy, setBusy] = useState(false);
  // New branch: which sign-in accounts to create for it (all ticked by default).
  const [roles, setRoles] = useState<string[]>(NEW_BRANCH_ROLES.map((r) => r.role));
  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 3_000_000) { toast.push("bad", "Image too large (max 3 MB)"); return; }
    const r = new FileReader();
    r.onload = () => setF((p) => ({ ...p, imageUrl: String(r.result) }));
    r.readAsDataURL(file);
  }
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      if (existing) { await apiPatch(`/branches/${existing.id}`, f); onDone(); }
      else {
        const res = await apiPost<{ name: string; createdUsers?: CreatedUser[] }>("/branches", { ...f, createUsers: roles });
        onDone(res);
      }
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? "Edit branch" : "New branch"} onClose={onClose} width={460}>
      <div className="space-y-3">
        <div className="flex gap-3 items-start">
          <div className="size-24 rounded-xl overflow-hidden flex items-center justify-center shrink-0"
            style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
            {f.imageUrl ? <img src={f.imageUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={28} className="text-muted" />}
          </div>
          <div className="flex-1 space-y-2">
            <label className="btn btn-ghost btn-sm cursor-pointer">
              <ImageIcon size={13} /> Upload photo
              <input type="file" accept="image/*" className="hidden" onChange={pickImage} />
            </label>
            {f.imageUrl && (
              <button onClick={() => setF({ ...f, imageUrl: "" })} className="btn btn-ghost btn-sm">
                <X size={13} /> Remove
              </button>
            )}
            <div className="text-[11px] text-muted">Up to 3 MB</div>
          </div>
        </div>
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Address</label>
          <input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Phone</label>
            <input className="inp" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label className="lbl">Status</label>
            <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as "active" | "maintenance" | "disabled" })}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="disabled">Disabled</option>
            </select></div>
        </div>
        {!existing && (
          <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
            <div className="text-[13px] font-semibold text-ink flex items-center gap-2 mb-1"><Users size={15} /> Sign-in accounts for this branch</div>
            <p className="text-[11.5px] text-muted mb-2">
              One account per ticked role, named after the branch (e.g. &quot;{(f.name.trim() || "Beach") + " Cashier"}&quot;), each with its own PIN.
              You&apos;ll see the PINs once, right after creating.
            </p>
            <div className="flex flex-wrap gap-2">
              {NEW_BRANCH_ROLES.map((r) => {
                const on = roles.includes(r.role);
                return (
                  <label key={r.role} className="flex items-center gap-2 px-3 py-1.5 rounded-full border cursor-pointer text-[12.5px] font-semibold"
                    style={on ? { background: "var(--olive-wash)", borderColor: "var(--olive)", color: "var(--olive-700)" } : { background: "var(--panel)", borderColor: "var(--line)", color: "var(--muted)" }}>
                    <input type="checkbox" className="accent-[var(--olive)]" checked={on}
                      onChange={(e) => setRoles((p) => e.target.checked ? [...p, r.role] : p.filter((x) => x !== r.role))} />
                    {r.label}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : roles.length ? `Create branch + ${roles.length} account${roles.length === 1 ? "" : "s"}` : "Create branch"}
        </button>
      </div>
    </Modal>
  );
}

/* Shown once after a branch is created: the new accounts and their PINs. */
function CreatedAccounts({ branch, users, onClose }: { branch: string; users: CreatedUser[]; onClose: () => void }) {
  const toast = useToast();
  const text = `${branch} - sign-in PINs\n` + users.map((u) => `${u.name} (${u.role}): ${u.pin}`).join("\n");
  function print() {
    const w = window.open("", "_blank", "width=420,height=600");
    if (!w) { toast.push("bad", "Allow pop-ups to print, or copy the list instead"); return; }
    const esc = (v: string) => v.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    w.document.write(`<html><head><title>${esc(branch)} PINs</title></head><body style="font-family:system-ui;padding:16px">` +
      `<h2 style="margin:0 0 4px">${esc(branch)}</h2><p style="margin:0 0 12px;color:#555">Sign-in PINs - give each person their own, then destroy this paper.</p>` +
      users.map((u) => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:8px 0"><span>${esc(u.name)}</span><b style="font-family:monospace;font-size:18px">${u.pin}</b></div>`).join("") +
      `</body></html>`);
    w.document.close(); w.focus(); w.print();
  }
  return (
    <Modal open title={`Accounts created for ${branch}`} onClose={onClose} width={460}>
      <p className="text-[12.5px] text-muted mb-3">
        Give each person their own PIN. <b>This is the only time the PINs are shown</b> - they can change them
        later in My Profile, and a manager can reset them in Users.
      </p>
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--line)" }}>
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: "var(--line-soft)" }}>
            <div>
              <div className="text-[13.5px] font-semibold text-ink">{u.name}</div>
              <div className="text-[11.5px] text-muted capitalize">{u.role}</div>
            </div>
            <span className="mono text-[18px] font-bold tracking-widest">{u.pin}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={print} className="btn btn-ghost flex-1"><Printer size={14} /> Print</button>
        <button onClick={async () => { try { await navigator.clipboard.writeText(text); toast.push("ok", "Copied"); } catch { toast.push("bad", "Copy failed"); } }}
          className="btn btn-ghost flex-1"><Copy size={14} /> Copy</button>
        <button onClick={onClose} className="btn btn-primary flex-1">Done</button>
      </div>
    </Modal>
  );
}
