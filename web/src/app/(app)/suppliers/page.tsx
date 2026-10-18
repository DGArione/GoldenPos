"use client";

import { useEffect, useState } from "react";
import { Truck, Plus, Pencil, Trash2, Phone, Mail } from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Supplier {
  id: number;
  name: string;
  contact: string;
  email: string;
  notes: string;
}

export default function SuppliersPage() {
  const toast = useToast();
  const [list, setList] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);

  const load = () => {
    setLoading(true);
    apiGet<Supplier[]>("/suppliers").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function remove(s: Supplier) {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    try { await apiDelete(`/suppliers/${s.id}`); setList((p) => p.filter((x) => x.id !== s.id)); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Suppliers" subtitle={`${list.length} on file`} icon={Truck}>
          <button onClick={() => setEdit("new")} className="btn btn-primary btn-sm">
            <Plus size={14} /> New supplier
          </button>
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No suppliers yet" hint="Add one above to track where your ingredients come from." icon={<Truck size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((s) => (
              <div key={s.id} className="rounded-xl p-4"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">{s.name}</div>
                    {s.contact && (
                      <div className="text-[12px] text-muted flex items-center gap-1 mt-0.5">
                        <Phone size={11} /> {s.contact}
                      </div>
                    )}
                    {s.email && (
                      <div className="text-[12px] text-muted flex items-center gap-1">
                        <Mail size={11} /> {s.email}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEdit(s)} className="btn btn-ghost btn-sm !px-2"><Pencil size={13} /></button>
                    <button onClick={() => remove(s)} className="btn btn-ghost btn-sm !px-2"><Trash2 size={13} /></button>
                  </div>
                </div>
                {s.notes && <div className="text-[11.5px] text-muted italic mt-2">{s.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </Screen>

      {edit && (
        <SupplierEditor
          existing={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onDone={() => { setEdit(null); load(); toast.push("ok", "Saved"); }}
        />
      )}
    </div>
  );
}

function SupplierEditor({ existing, onClose, onDone }: { existing: Supplier | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    contact: existing?.contact || "",
    email: existing?.email || "",
    notes: existing?.notes || "",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      if (existing) await apiPut(`/suppliers/${existing.id}`, f);
      else await apiPost("/suppliers", f);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? `Edit — ${existing.name}` : "New supplier"} onClose={onClose} width={460}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Contact / phone</label>
            <input className="inp" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></div>
          <div><label className="lbl">Email</label>
            <input className="inp" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <div><label className="lbl">Notes</label>
          <textarea className="inp" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : "Create supplier"}
        </button>
      </div>
    </Modal>
  );
}
