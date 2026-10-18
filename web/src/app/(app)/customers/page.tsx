"use client";

import { useEffect, useState } from "react";
import { Contact, Search, Plus, Phone, MapPin, Star, Receipt } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Customer {
  id: number;
  name: string;
  phone: string;
  address: string;
  loyaltyPoints: number;
  createdAt?: string;
}
interface Order {
  id: number;
  displayNum: string;
  grandTotal: number;
  createdAt: string;
  status: string;
  paymentStatus: string;
}

export default function CustomersPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Customer | null>(null);

  function load(search = "") {
    setLoading(true);
    apiGet<Customer[]>(`/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`)
      .then((d) => setList(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q), 220);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Customers" subtitle={`${list.length} on file`} icon={Contact}>
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
            <Plus size={14} /> New customer
          </button>
        </PageHeader>

        <div className="relative mb-4 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="inp pl-9"
            placeholder="Search by phone or name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No customers" hint={q ? "Try another search." : "Add one with the button above."} icon={<Contact size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => setDetail(c)}
                className="rounded-xl p-4 text-left transition-all hover:shadow-md"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-[color:var(--on-accent)]"
                    style={{ background: "var(--olive)" }}
                  >
                    {(c.name || c.phone).charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink truncate">
                      {c.name || <span className="text-muted italic">(no name)</span>}
                    </div>
                    <div className="text-[11.5px] text-muted flex items-center gap-1 truncate">
                      <Phone size={10} /> {c.phone}
                    </div>
                  </div>
                  {c.loyaltyPoints > 0 && (
                    <span className="pill pill-clay">
                      <Star size={10} /> {Math.round(c.loyaltyPoints)}
                    </span>
                  )}
                </div>
                {c.address && (
                  <div className="text-[11.5px] text-muted flex items-start gap-1">
                    <MapPin size={11} className="mt-0.5 shrink-0" /> <span className="truncate">{c.address}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </Screen>

      {open && <AddCustomer onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(q); toast.push("ok", "Customer added"); }} />}
      {detail && <CustomerDetail customer={detail} currency={currency} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AddCustomer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", phone: "", address: "" });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.phone.trim()) { toast.push("bad", "Phone is required"); return; }
    setBusy(true);
    try { await apiPost("/customers", f); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title="New customer" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div><label className="lbl">Phone <span className="text-bad">*</span></label>
          <input className="inp" value={f.phone} autoFocus onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div><label className="lbl">Name</label>
          <input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Address (optional)</label>
          <input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : "Save customer"}</button>
      </div>
    </Modal>
  );
}

function CustomerDetail({ customer, currency, onClose }: { customer: Customer; currency: string; onClose: () => void }) {
  const [history, setHistory] = useState<Order[] | null>(null);
  useEffect(() => {
    apiGet<{ customer: Customer; orders: Order[] }>(`/customers/${customer.id}`).then((d) => {
      setHistory(d.orders || []);
    }).catch(() => setHistory([]));
  }, [customer.id]);

  return (
    <Modal open title={customer.name || customer.phone} onClose={onClose} width={520}>
      <div className="flex items-center gap-3 mb-4">
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-full text-[18px] font-bold text-[color:var(--on-accent)]"
          style={{ background: "var(--olive)" }}
        >
          {(customer.name || customer.phone).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold text-ink">{customer.name || "No name"}</div>
          <div className="text-[12.5px] text-muted flex items-center gap-1"><Phone size={12} /> {customer.phone}</div>
          {customer.address && <div className="text-[12.5px] text-muted flex items-center gap-1"><MapPin size={12} /> {customer.address}</div>}
        </div>
        {customer.loyaltyPoints > 0 && (
          <span className="pill pill-clay"><Star size={11} /> {Math.round(customer.loyaltyPoints)} pts</span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Receipt size={14} style={{ color: "var(--olive-text)" }} />
        <h3 className="text-[13px] font-semibold text-ink">Recent orders</h3>
      </div>

      {!history ? (
        <div className="text-sm text-muted py-6 text-center">Loading…</div>
      ) : !history.length ? (
        <div className="text-sm text-muted py-6 text-center">No orders yet.</div>
      ) : (
        <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto">
          {history.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]"
              style={{ background: "var(--panel-2)" }}
            >
              <span className="font-semibold mono text-ink min-w-[80px]">{o.displayNum}</span>
              <span className="text-muted flex-1 truncate">{(o.createdAt || "").replace("T", " ").slice(0, 16)}</span>
              <span className="mono font-semibold">{money(o.grandTotal, currency)}</span>
              <span className={`pill ${o.paymentStatus === "paid" ? "pill-ok" : "pill-warn"}`}>{o.paymentStatus}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
