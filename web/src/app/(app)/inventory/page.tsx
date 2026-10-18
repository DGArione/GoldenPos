"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus, Minus, Boxes, AlertTriangle, PackagePlus, Trash2, ArrowLeftRight,
  History as HistoryIcon, Flame, Pencil,
} from "lucide-react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Ingredient {
  id: number;
  name: string;
  unit: string;
  qty: number;
  unitCost: number;
  lowStockThreshold: number;
  supplierId?: number | null;
}
interface Supplier { id: number; name: string }
interface Movement {
  id: number;
  ingredientId: number;
  ingredientName: string;
  type: string;      // adjust | waste | transfer | sale | purchase
  qty: number;
  staffName?: string;
  note?: string;
  createdAt?: string;
}
interface Branch { id: number; name: string }
// (Supplier interface above)

export default function InventoryPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList]       = useState<Ingredient[]>([]);
  const [moves, setMoves]     = useState<Movement[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<"stock" | "movements">("stock");
  const [addOpen, setAddOpen] = useState(false);
  const [editOf, setEditOf]   = useState<Ingredient | null>(null);
  const [wasteOf, setWasteOf] = useState<Ingredient | null>(null);
  const [xferOf, setXferOf]   = useState<Ingredient | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<Ingredient[]>("/inventory"),
      apiGet<Movement[]>("/inventory/movements"),
      apiGet<Branch[]>("/branches").catch(() => []),
      apiGet<Supplier[]>("/suppliers").catch(() => []),
    ])
      .then(([inv, mv, br, sp]) => {
        setList(Array.isArray(inv) ? inv : []);
        setMoves(Array.isArray(mv) ? mv : []);
        setBranches(Array.isArray(br) ? br : []);
        setSuppliers(Array.isArray(sp) ? sp : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function adjust(it: Ingredient, delta: number) {
    try {
      const u = await apiPost<Ingredient>(`/inventory/${it.id}/adjust`, { delta });
      setList((p) => p.map((x) => (x.id === u.id ? u : x)));
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const lowCount = list.filter((i) => i.lowStockThreshold > 0 && i.qty <= i.lowStockThreshold).length;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader
          title="Inventory"
          subtitle={`${list.length} ingredients${lowCount ? ` · ${lowCount} low` : ""}`}
          icon={Boxes}
        >
          <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm">
            <PackagePlus size={14} /> Add item
          </button>
        </PageHeader>

        <div className="flex gap-1.5 p-1 rounded-full self-start" style={{ background: "var(--panel-2)" }}>
          {([["stock", "Stock levels"], ["movements", "Movements"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setTab(v)}
              className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors flex items-center gap-2"
              style={tab === v
                ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--muted)" }}>
              {v === "movements" && <HistoryIcon size={13} />} {label}
            </button>
          ))}
        </div>
      </Screen>

      {loading ? (
        <Screen><PageLoader /></Screen>
      ) : tab === "stock" ? (
        !list.length ? (
          <Screen><EmptyState title="No ingredients yet" hint="Add stock items to track levels." icon={<Boxes size={30} />} /></Screen>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((it) => {
              const low = it.lowStockThreshold > 0 && it.qty <= it.lowStockThreshold;
              const sup = suppliers.find((s) => s.id === it.supplierId);
              return (
                <div
                  key={it.id}
                  className="rounded-xl p-4"
                  style={{
                    background: "var(--panel)",
                    border: low ? "1.5px solid var(--warn)" : "1px solid var(--line)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-[14.5px] text-ink truncate">{it.name}</div>
                      <div className="text-[11.5px] text-muted">
                        {it.unitCost > 0 ? `${money(it.unitCost, currency)} / ${it.unit}` : it.unit}
                        {sup && <> · {sup.name}</>}
                      </div>
                    </div>
                    {low && <span className="pill pill-warn"><AlertTriangle size={11} /> Low</span>}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button onClick={() => adjust(it, -1)}
                        className="size-8 rounded-full flex items-center justify-center transition-colors hover:bg-line"
                        style={{ background: "var(--panel-2)" }}>
                        <Minus size={14} />
                      </button>
                      <span className="mono text-[18px] font-semibold w-16 text-center text-ink">
                        {it.qty} <span className="text-[11px] text-muted font-normal">{it.unit}</span>
                      </span>
                      <button onClick={() => adjust(it, 1)}
                        className="size-8 rounded-full flex items-center justify-center transition-colors hover:bg-line"
                        style={{ background: "var(--panel-2)" }}>
                        <Plus size={14} />
                      </button>
                    </div>

                    <div className="flex gap-1">
                      <button onClick={() => setEditOf(it)} className="btn btn-ghost btn-sm !px-2" title="Edit (name, price, unit, threshold, supplier)">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setWasteOf(it)} className="btn btn-ghost btn-sm !px-2" title="Log waste">
                        <Flame size={13} />
                      </button>
                      {branches.length > 1 && (
                        <button onClick={() => setXferOf(it)} className="btn btn-ghost btn-sm !px-2" title="Transfer to another branch">
                          <ArrowLeftRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <Screen>
          {!moves.length ? (
            <EmptyState title="No movements yet" hint="Adjustments, waste, transfers and sales will show here." />
          ) : (
            <div className="flex flex-col gap-1">
              {moves.slice(0, 100).map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--panel-2)" }}>
                  <span className={`pill ${TYPE_PILL[m.type] || "pill-olive"}`}>{m.type}</span>
                  <span className="font-medium text-ink flex-1 truncate">{m.ingredientName}</span>
                  <span className="mono font-semibold" style={{ color: m.qty >= 0 ? "var(--ok-ink)" : "var(--bad-ink)" }}>
                    {m.qty >= 0 ? "+" : ""}{m.qty}
                  </span>
                  <span className="text-muted text-[11px] whitespace-nowrap">
                    {(m.createdAt || "").replace("T", " ").slice(0, 16)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Screen>
      )}

      {addOpen && (
        <AddItem
          currency={currency}
          suppliers={suppliers}
          onClose={() => setAddOpen(false)}
          onDone={() => { setAddOpen(false); load(); toast.push("ok", "Ingredient added"); }}
        />
      )}
      {editOf && (
        <EditItem
          item={editOf}
          currency={currency}
          suppliers={suppliers}
          onClose={() => setEditOf(null)}
          onDone={() => { setEditOf(null); load(); toast.push("ok", "Ingredient updated"); }}
        />
      )}
      {wasteOf && (
        <WasteModal
          ingredient={wasteOf}
          onClose={() => setWasteOf(null)}
          onDone={() => { setWasteOf(null); load(); toast.push("ok", "Waste logged"); }}
        />
      )}
      {xferOf && (
        <TransferModal
          ingredient={xferOf}
          branches={branches}
          onClose={() => setXferOf(null)}
          onDone={() => { setXferOf(null); load(); toast.push("ok", "Transferred"); }}
        />
      )}
    </div>
  );
}

const TYPE_PILL: Record<string, string> = {
  adjust:  "pill-olive",
  waste:   "pill-bad",
  transfer:"pill-info",
  sale:    "pill-warn",
  purchase:"pill-ok",
};

function AddItem({ currency, suppliers, onClose, onDone }: { currency: string; suppliers: Supplier[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", unit: "pcs", qty: "", unitCost: "", lowStockThreshold: "", supplierId: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      await apiPost("/inventory", {
        name: f.name,
        unit: f.unit,
        qty: Number(f.qty) || 0,
        unitCost: Number(f.unitCost) || 0,
        lowStockThreshold: Number(f.lowStockThreshold) || 0,
        supplierId: f.supplierId ? Number(f.supplierId) : null,
      });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title="Add ingredient" onClose={onClose} width={440}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Unit</label>
            <input className="inp" placeholder="kg, L, pcs…" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
          <div><label className="lbl">Starting qty</label>
            <input className="inp mono" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
          <div><label className="lbl">Cost / unit ({currency.trim()})</label>
            <input className="inp mono" inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></div>
          <div><label className="lbl">Low-stock at</label>
            <input className="inp mono" inputMode="decimal" value={f.lowStockThreshold} onChange={(e) => setF({ ...f, lowStockThreshold: e.target.value })} /></div>
        </div>
        <div><label className="lbl">Preferred supplier (optional)</label>
          <select className="inp" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            <option value="">— None —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Add ingredient"}
        </button>
      </div>
    </Modal>
  );
}

function EditItem({ item, currency, suppliers, onClose, onDone }: { item: Ingredient; currency: string; suppliers: Supplier[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: item.name,
    unit: item.unit,
    qty: String(item.qty),
    unitCost: String(item.unitCost || 0),
    lowStockThreshold: String(item.lowStockThreshold || 0),
    supplierId: item.supplierId ? String(item.supplierId) : "",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      await apiPut(`/inventory/${item.id}`, {
        name: f.name,
        unit: f.unit,
        qty: Number(f.qty) || 0,
        unitCost: Number(f.unitCost) || 0,
        lowStockThreshold: Number(f.lowStockThreshold) || 0,
        supplierId: f.supplierId ? Number(f.supplierId) : null,
      });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Edit — ${item.name}`} onClose={onClose} width={440}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Unit</label>
            <input className="inp" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
          <div><label className="lbl">Quantity</label>
            <input className="inp mono" inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
          <div><label className="lbl">Cost / unit ({currency.trim()})</label>
            <input className="inp mono" inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></div>
          <div><label className="lbl">Low-stock at</label>
            <input className="inp mono" inputMode="decimal" value={f.lowStockThreshold} onChange={(e) => setF({ ...f, lowStockThreshold: e.target.value })} /></div>
        </div>
        <div><label className="lbl">Preferred supplier</label>
          <select className="inp" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            <option value="">— None —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

function WasteModal({ ingredient, onClose, onDone }: { ingredient: Ingredient; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(qty);
    if (!n || n <= 0) { toast.push("bad", "Qty must be greater than 0"); return; }
    setBusy(true);
    try {
      await apiPost("/inventory/waste", { ingredientId: ingredient.id, qty: n, reason });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Log waste — ${ingredient.name}`} onClose={onClose} width={420}>
      <div className="space-y-3">
        <div>
          <label className="lbl">Quantity wasted ({ingredient.unit})</label>
          <input className="inp mono text-[16px]" autoFocus inputMode="decimal" value={qty}
            onChange={(e) => setQty(e.target.value)} />
          <p className="text-[11.5px] text-muted mt-1">Current stock: {ingredient.qty} {ingredient.unit}</p>
        </div>
        <div><label className="lbl">Reason</label>
          <input className="inp" placeholder="e.g. spoiled, dropped, burnt" value={reason}
            onChange={(e) => setReason(e.target.value)} /></div>
        <button onClick={save} disabled={busy} className="btn btn-danger w-full">
          <Trash2 size={15} /> {busy ? "Logging…" : "Log waste"}
        </button>
      </div>
    </Modal>
  );
}

function TransferModal({ ingredient, branches, onClose, onDone }: {
  ingredient: Ingredient; branches: Branch[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [targetBranchId, setTargetBranchId] = useState<string>(String(branches[0]?.id || ""));
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(qty);
    if (!n || n <= 0) { toast.push("bad", "Qty must be greater than 0"); return; }
    if (!targetBranchId) { toast.push("bad", "Pick a target branch"); return; }
    setBusy(true);
    try {
      await apiPost("/inventory/transfer", {
        ingredientId: ingredient.id,
        toBranchId: Number(targetBranchId),
        qty: n,
      });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={`Transfer — ${ingredient.name}`} onClose={onClose} width={420}>
      <div className="space-y-3">
        <div><label className="lbl">To branch</label>
          <select className="inp" value={targetBranchId} onChange={(e) => setTargetBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div><label className="lbl">Quantity ({ingredient.unit})</label>
          <input className="inp mono text-[16px]" autoFocus inputMode="decimal" value={qty}
            onChange={(e) => setQty(e.target.value)} />
          <p className="text-[11.5px] text-muted mt-1">Current: {ingredient.qty} {ingredient.unit}</p></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          <ArrowLeftRight size={15} /> {busy ? "Transferring…" : "Transfer"}
        </button>
      </div>
    </Modal>
  );
}
