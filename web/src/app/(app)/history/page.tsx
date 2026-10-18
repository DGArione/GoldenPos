"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History as HistoryIcon, Search, Receipt, RefreshCw, X, Printer, Undo2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings, discountAmount } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import type { Order } from "@/lib/types";
import { printReceipt } from "@/lib/receipt";

type Filter = "all" | "paid" | "unpaid" | "refunded" | "voided";

const MGR_ROLES = ["admin", "superManager", "manager"];

export default function HistoryPage() {
  const toast = useToast();
  const settings = useSettings();
  const { user } = useAuth();
  const isManager = !!user && MGR_ROLES.includes(user.role);
  const currency = settings?.currencySymbol || "Rs. ";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<Order | null>(null);
  const [refundTarget, setRefundTarget] = useState<Order | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Order[]>("/orders")
      .then((d) => setOrders(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const refundTotal = (o: Order) =>
    (o.payments || []).filter((p) => p.type === "refund").reduce((s, p) => s + Math.abs(p.amount || 0), 0);

  const shown = useMemo(() => {
    let list = [...orders];
    if (filter === "paid") list = list.filter((o) => o.paymentStatus === "paid");
    else if (filter === "unpaid") list = list.filter((o) => o.paymentStatus !== "paid" && o.paymentStatus !== "refunded" && o.status !== "voided");
    else if (filter === "refunded") list = list.filter((o) => (o.payments || []).some((p) => p.type === "refund"));
    else if (filter === "voided") list = list.filter((o) => o.status === "voided");
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter((o) =>
        (o.displayNum || "").toLowerCase().includes(s) ||
        (o.tableName || "").toLowerCase().includes(s) ||
        (o.customerName || "").toLowerCase().includes(s) ||
        (o.customerPhone || "").includes(s),
      );
    }
    return list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [orders, filter, q]);

  async function doRefund(o: Order, body: { amount: number; method: string; reason: string; pin?: string; code?: string }) {
    const res = await apiPost<Order>(`/orders/${o.id}/refund`, body);
    toast.push("ok", `${o.displayNum} — ${money(body.amount, currency)} refunded`);
    // merge the updated order back into the list
    setOrders((prev) => prev.map((x) => (x.id === o.id ? res : x)));
    if (detail && detail.id === o.id) setDetail(res);
    setRefundTarget(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="History" subtitle="Every order ever rung in" icon={HistoryIcon}>
          <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="inp pl-9" placeholder="Search by #, table, name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {(["all", "paid", "unpaid", "refunded", "voided"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={filter === f
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? <PageLoader /> : !shown.length ? (
          <EmptyState title="No orders found" hint="Try another filter or search." icon={<Receipt size={30} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-2.5">#</th>
                  <th>When</th>
                  <th>Table / Customer</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th className="text-right pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-line-soft cursor-pointer hover:bg-panel-2"
                    onClick={() => setDetail(o)}
                  >
                    <td className="py-2.5 font-semibold mono">{o.displayNum}</td>
                    <td className="text-muted text-[12px] whitespace-nowrap">
                      {(o.createdAt || "").replace("T", " ").slice(0, 16)}
                    </td>
                    <td className="text-[12.5px]">
                      {o.tableName || "—"}
                      {o.customerName && <span className="text-muted"> · {o.customerName}</span>}
                    </td>
                    <td className="text-muted text-[12px]">{o.items.length} items</td>
                    <td>
                      <span className={`pill ${o.status === "voided" ? "pill-bad" : o.paymentStatus === "refunded" ? "pill-bad" : o.paymentStatus === "paid" ? "pill-ok" : "pill-warn"}`}>
                        {o.status === "voided" ? "cancelled" : o.paymentStatus}
                      </span>
                      {o.paymentStatus !== "refunded" && refundTotal(o) > 0 && (
                        <span className="pill pill-warn ml-1" title="Partially refunded">part. refund</span>
                      )}
                    </td>
                    <td className="text-right pr-4 mono font-semibold">
                      {money(o.grandTotal || o.total, currency)}
                      {refundTotal(o) > 0 && (
                        <div className="text-[11px] font-normal" style={{ color: "var(--bad-ink)" }}>−{money(refundTotal(o), currency)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Screen>

      {detail && (
        <OrderDetail
          order={detail}
          currency={currency}
          settings={settings}
          refundTotal={refundTotal(detail)}
          onClose={() => setDetail(null)}
          onRefund={() => setRefundTarget(detail)}
        />
      )}

      {refundTarget && (
        <RefundModal
          order={refundTarget}
          currency={currency}
          isManager={isManager}
          alreadyRefunded={refundTotal(refundTarget)}
          onClose={() => setRefundTarget(null)}
          onSubmit={(body) => doRefund(refundTarget, body)}
        />
      )}
    </div>
  );
}

function RefundModal({
  order, currency, isManager, alreadyRefunded, onClose, onSubmit,
}: {
  order: Order;
  currency: string;
  isManager: boolean;
  alreadyRefunded: number;
  onClose: () => void;
  onSubmit: (body: { amount: number; method: string; reason: string; pin?: string; code?: string }) => Promise<void>;
}) {
  const paid = order.amountPaid || 0;
  const [amount, setAmount] = useState<string>(paid > 0 ? paid.toFixed(2) : "");
  // What each gift card still has on this order (payments minus earlier refunds).
  const giftNet: Record<string, number> = {};
  for (const p of order.payments || []) if (p.method === "giftcard" && p.code) giftNet[p.code] = (giftNet[p.code] || 0) + (Number(p.amount) || 0);
  const giftCodes = Object.keys(giftNet).filter((c) => giftNet[c] > 0.001);
  const [pmethod, setPmethod] = useState<string>(giftCodes.length && giftCodes.reduce((a, c) => a + giftNet[c], 0) >= paid - 0.01 ? "giftcard" : "cash");
  const [gcode, setGcode] = useState<string>(giftCodes[0] || "");
  const [reason, setReason] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const amt = Number(amount) || 0;

  async function submit() {
    setErr("");
    if (amt <= 0) { setErr("Enter a refund amount greater than zero."); return; }
    if (amt > paid + 0.01) { setErr(`Refund cannot exceed the amount paid (${money(paid, currency)}).`); return; }
    if (!reason.trim()) { setErr("A reason is required."); return; }
    if (!isManager && !pin.trim()) { setErr("A manager approval PIN is required."); return; }
    if (pmethod === "giftcard" && amt > (giftNet[gcode] || 0) + 0.01) { setErr(`Only ${money(giftNet[gcode] || 0, currency)} was paid with card ${gcode}.`); return; }
    setBusy(true);
    try {
      await onSubmit({ amount: amt, method: pmethod, reason: reason.trim(), pin: pin.trim() || undefined, code: pmethod === "giftcard" ? gcode : undefined });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refund failed");
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Refund — ${order.displayNum}`} onClose={onClose} width={440}>
      <div className="rounded-xl p-3 mb-4 text-[12.5px]" style={{ background: "var(--panel-2)" }}>
        <div className="flex justify-between"><span className="text-muted">Order total</span><span className="mono font-semibold">{money(order.grandTotal || order.total, currency)}</span></div>
        <div className="flex justify-between mt-1"><span className="text-muted">Amount paid</span><span className="mono font-semibold">{money(paid, currency)}</span></div>
        {alreadyRefunded > 0 && (
          <div className="flex justify-between mt-1"><span className="text-muted">Already refunded</span><span className="mono font-semibold" style={{ color: "var(--bad-ink)" }}>−{money(alreadyRefunded, currency)}</span></div>
        )}
      </div>

      <label className="eyebrow">Refund amount ({currency.trim()})</label>
      <div className="flex gap-2 mb-1">
        <input className="inp mono" type="number" min="0" step="0.01" value={amount}
          onChange={(e) => setAmount(e.target.value)} autoFocus />
        <button className="btn btn-ghost btn-sm whitespace-nowrap" onClick={() => setAmount(paid.toFixed(2))} type="button">Full</button>
      </div>

      <label className="eyebrow mt-3">Refund to</label>
      <div className="flex gap-1.5 p-1 rounded-full mb-3" style={{ background: "var(--panel-2)" }}>
        {["cash", "card", "online", ...(giftCodes.length ? ["giftcard"] : [])].map((m) => (
          <button key={m} type="button" onClick={() => setPmethod(m)}
            className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
            style={pmethod === m ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>
            {m === "giftcard" ? "Gift card" : m}
          </button>
        ))}
      </div>
      {pmethod === "giftcard" && (
        <div className="mb-3 text-[12px] text-muted">
          {giftCodes.length > 1 ? (
            <select className="inp mb-1" value={gcode} onChange={(e) => setGcode(e.target.value)}>
              {giftCodes.map((c) => <option key={c} value={c}>{c} - paid {money(giftNet[c], currency)}</option>)}
            </select>
          ) : <div className="mono text-ink">{gcode} - paid {money(giftNet[gcode] || 0, currency)}</div>}
          The money goes back onto this card and is recorded in its history.
        </div>
      )}

      <label className="eyebrow">Reason</label>
      <input className="inp mb-3" placeholder="e.g. wrong item, customer complaint…" value={reason} onChange={(e) => setReason(e.target.value)} />

      {!isManager && (
        <>
          <label className="eyebrow">Manager approval PIN</label>
          <input className="inp mono mb-3" type="password" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value)} />
        </>
      )}

      {err && <div className="rounded-lg p-2.5 mb-3 text-[12.5px]" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>{err}</div>}

      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-danger flex-1" onClick={submit} disabled={busy}>
          <Undo2 size={15} /> {busy ? "Refunding…" : `Refund ${money(amt, currency)}`}
        </button>
      </div>
    </Modal>
  );
}

function OrderDetail({ order, currency, settings, refundTotal, onClose, onRefund }: { order: Order; currency: string; settings: ReturnType<typeof useSettings>; refundTotal: number; onClose: () => void; onRefund: () => void }) {
  const refundLines = (order.payments || []).filter((p) => p.type === "refund");
  const canRefund = order.status !== "voided" && (order.amountPaid || 0) > 0;
  return (
    <Modal open title={`Order ${order.displayNum}`} onClose={onClose} width={520}>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="pill pill-olive">{order.orderType}</span>
        <span className={`pill ${order.status === "voided" ? "pill-bad" : order.paymentStatus === "paid" ? "pill-ok" : "pill-warn"}`}>
          {order.status === "voided" ? "cancelled" : order.paymentStatus}
        </span>
        <span className="text-[12.5px] text-muted ml-auto">
          {(order.createdAt || "").replace("T", " ").slice(0, 16)}
        </span>
      </div>

      {(order.tableName || order.customerName) && (
        <div className="text-[13px] text-muted mb-3">
          {order.tableName && <>Table: <span className="text-ink font-medium">{order.tableName}</span></>}
          {order.customerName && <> {order.tableName ? "·" : ""} {order.customerName} ({order.customerPhone})</>}
        </div>
      )}

      <div className="flex flex-col gap-1 mb-4 max-h-[280px] overflow-y-auto">
        {order.items.map((it, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg px-3 py-2" style={{ background: "var(--panel-2)" }}>
            <span className="mono text-[13px] font-semibold text-muted min-w-[26px]">{it.qty}×</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-ink">{it.name}</div>
              {it.modifiers?.map((m, j) => <div key={j} className="text-[11px] text-muted">+ {m.option}</div>)}
              {it.notes && <div className="text-[11px] italic" style={{ color: "var(--olive-700)" }}>“{it.notes}”</div>}
            </div>
            <div className="mono text-[13px] font-semibold whitespace-nowrap">{money(it.lineTotal, currency)}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-4" style={{ background: "var(--panel-2)" }}>
        <TotalLine label="Subtotal" value={money(order.subtotal, currency)} />
        {discountAmount(order.discount) > 0 && <TotalLine label="Discount" value={`−${money(discountAmount(order.discount), currency)}`} warn />}
        {order.serviceCharge > 0 && <TotalLine label="Service" value={money(order.serviceCharge, currency)} />}
        {order.vat > 0 && <TotalLine label="VAT" value={money(order.vat, currency)} />}
        <div className="divider my-2" />
        <TotalLine label="Total" value={money(order.grandTotal || order.total, currency)} big />
        {refundTotal > 0 && <TotalLine label="Refunded" value={`−${money(refundTotal, currency)}`} warn />}
      </div>

      {refundLines.length > 0 && (
        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--bad-wash)" }}>
          <div className="eyebrow mb-2" style={{ color: "var(--bad-ink)" }}>Refund history</div>
          <div className="flex flex-col gap-2">
            {refundLines.map((p, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-[12px]">
                <div className="min-w-0">
                  <div className="text-ink font-medium capitalize">{p.method === "giftcard" ? `Gift card ${p.code || ""}` : p.method} refund{p.reason ? ` — ${p.reason}` : ""}</div>
                  <div className="text-muted text-[11px]">
                    {(p.paidAt || "").replace("T", " ").slice(0, 16)}
                    {p.approvedBy ? ` · ${p.approvedBy}` : p.byStaffName ? ` · ${p.byStaffName}` : ""}
                  </div>
                </div>
                <span className="mono font-semibold whitespace-nowrap" style={{ color: "var(--bad-ink)" }}>−{money(Math.abs(p.amount), currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-4">
        <button onClick={() => printReceipt(order, settings, { reprint: true })} className="btn btn-ghost flex-1">
          <Printer size={14} /> Reprint receipt
        </button>
        {canRefund && (
          <button onClick={onRefund} className="btn btn-danger flex-1">
            <Undo2 size={15} /> Refund
          </button>
        )}
      </div>
      {order.status === "voided" && order.voidData && (
        <div className="mt-4 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>
          Cancelled by {order.voidData.byStaffName || "staff"}
          {order.voidData.reason ? ` — "${order.voidData.reason}"` : ""}
        </div>
      )}
    </Modal>
  );
}

function TotalLine({ label, value, big, warn }: { label: string; value: string; big?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between items-center" style={{ fontSize: big ? 15 : 12.5, marginBottom: big ? 0 : 4 }}>
      <span className="text-muted" style={{ fontWeight: big ? 600 : 400 }}>{label}</span>
      <span
        className="mono"
        style={{ fontWeight: big ? 700 : 600, color: warn ? "var(--bad-ink)" : big ? "var(--olive-700)" : "var(--ink)" }}
      >
        {value}
      </span>
    </div>
  );
}
