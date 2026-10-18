"use client";

import { useEffect, useState } from "react";
import { PackageSearch, Plus, Receipt } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Ingredient { id: number; name: string; unit: string }
interface Supplier { id: number; name: string }
interface PurchaseItem { ingredientId: number; name: string; qty: number; unit: string; cost: number }
interface Purchase {
  id: number;
  supplierName: string;
  items?: PurchaseItem[] | string;
  total: number;
  note: string;
  createdAt: string;
}

export default function PurchasesPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Purchase[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      apiGet<Purchase[]>("/purchases"),
      apiGet<Ingredient[]>("/inventory"),
      apiGet<Supplier[]>("/suppliers"),
    ])
      .then(([p, i, s]) => {
        setList(Array.isArray(p) ? p : []);
        setIngredients(Array.isArray(i) ? i : []);
        setSuppliers(Array.isArray(s) ? s : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  function parseItems(p: Purchase): PurchaseItem[] {
    if (Array.isArray(p.items)) return p.items;
    try { return JSON.parse((p.items as string) || "[]"); } catch { return []; }
  }

  const total = list.reduce((s, p) => s + (p.total || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Purchases" subtitle={`${list.length} purchases · ${money(total, currency)}`} icon={PackageSearch}>
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> New purchase
          </button>
        </PageHeader>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No purchases yet" hint="Record a purchase and the ingredient is added to stock automatically." icon={<Receipt size={30} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">When</th>
                  <th>Supplier</th>
                  <th>Items</th>
                  <th className="text-right pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const its = parseItems(p);
                  return (
                    <tr key={p.id} className="border-t border-line-soft">
                      <td className="py-2.5 text-muted">{(p.createdAt || "").replace("T", " ").slice(0, 16)}</td>
                      <td className="font-medium">{p.supplierName || <span className="text-muted italic">—</span>}</td>
                      <td className="text-[12.5px]">
                        {its.map((it, i) => (
                          <span key={i} className="pill pill-olive mr-1" style={{ padding: "1px 7px", fontSize: 10 }}>
                            {it.qty} {it.unit} {it.name}
                          </span>
                        ))}
                      </td>
                      <td className="text-right pr-4 mono font-semibold">{money(p.total, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Screen>

      {open && (
        <PurchaseModal
          ingredients={ingredients}
          suppliers={suppliers}
          currency={currency}
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load(); toast.push("ok", "Purchase recorded"); }}
        />
      )}
    </div>
  );
}

function PurchaseModal({
  ingredients, suppliers, currency, onClose, onDone,
}: {
  ingredients: Ingredient[];
  suppliers: Supplier[];
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    supplierId: suppliers[0]?.id ? String(suppliers[0].id) : "",
    ingredientId: ingredients[0]?.id ? String(ingredients[0].id) : "",
    qty: "",
    cost: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    const qty = Number(f.qty);
    const cost = Number(f.cost);
    if (!qty || qty <= 0) { toast.push("bad", "Qty must be greater than 0"); return; }
    setBusy(true);
    try {
      await apiPost("/purchases", {
        ingredientId: f.ingredientId ? Number(f.ingredientId) : null,
        supplierId: f.supplierId ? Number(f.supplierId) : null,
        qty,
        cost,
        note: f.note,
      });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  const ing = ingredients.find((x) => x.id === Number(f.ingredientId));
  return (
    <Modal open title="New purchase" onClose={onClose} width={460}>
      <div className="space-y-3">
        <div><label className="lbl">Supplier</label>
          <select className="inp" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
            <option value="">— Walk-in / cash —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label className="lbl">Ingredient</label>
          <select className="inp" value={f.ingredientId} onChange={(e) => setF({ ...f, ingredientId: e.target.value })}>
            {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Quantity {ing && `(${ing.unit})`}</label>
            <input className="inp mono" inputMode="decimal" autoFocus value={f.qty}
              onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
          <div><label className="lbl">Total cost ({currency.trim()})</label>
            <input className="inp mono" inputMode="decimal" value={f.cost}
              onChange={(e) => setF({ ...f, cost: e.target.value })} /></div>
        </div>
        <div><label className="lbl">Note (optional)</label>
          <input className="inp" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Record purchase (adds to stock)"}
        </button>
      </div>
    </Modal>
  );
}
