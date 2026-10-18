"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Banknote, CreditCard, Percent, Ban, Printer, RefreshCw, CheckCircle2,
  Delete, Star, Gift,
} from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { money, useSettings, discountAmount } from "@/lib/settings";
import { Order } from "@/lib/types";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";
import { printReceipt } from "@/lib/receipt";

function PaymentInner() {
  const params = useSearchParams();
  const settings = useSettings();
  const toast = useToast();
  const currency = settings?.currencySymbol || "Rs. ";

  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [giftCardOpen, setGiftCardOpen] = useState(false);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSelectionIds, setMergeSelectionIds] = useState<number[]>([]);
  // "any" = merge with any open bill (takeaway, delivery, other tables), not just this table
  const [mergeAny, setMergeAny] = useState(false);
  const [confirm, setConfirm] = useState<{ method: "cash" | "card"; amount: number; tendered?: number } | null>(null);

  const load = useCallback(async (selectId?: number) => {
    try {
      const [data, billData] = await Promise.all([
        apiGet<Order[]>("/orders"),
        apiGet<Order[]>("/table-bills?status=open").catch(() => [] as Order[]),
      ]);
      const rawOrders = (Array.isArray(data) ? data : []).filter(
        (o) => o.paymentStatus !== "paid" && o.paymentStatus !== "refunded" && o.status !== "voided",
      );
      const bills = (Array.isArray(billData) ? billData : []).map((b) => ({
        ...b,
        isMergedBill: true,
        grandTotal: Number(b.grandTotal ?? b.total ?? 0),
        total: Number(b.grandTotal ?? b.total ?? 0),
        amountPaid: Number(b.amountPaid || 0),
        priority: "normal",
      } as Order));
      // Do not show original tickets as separate payable rows once they belong to an open merged bill.
      const groupedIds = new Set(bills.flatMap((b) => b.orderIds || []).map(Number));
      const list = [...bills, ...rawOrders.filter((o) => !groupedIds.has(Number(o.id)))];
      list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      setOrders(list);
      if (selectId) {
        const found = list.find((o) => o.id === selectId && !o.isMergedBill);
        if (found) setSelected(found);
      }
    } catch {
      toast.push("bad", "Could not load orders");
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => {
    load(params.get("orderId") ? Number(params.get("orderId")) : undefined);
    const t = setInterval(() => load(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTotal = selected ? Number(selected.isMergedBill ? (selected.grandTotal ?? selected.total) : selected.total) : 0;
  const due = selected ? Math.max(0, selectedTotal - (selected.amountPaid || 0)) : 0;
  const tenderedNum = Number(tendered) || 0;
  const change = tenderedNum > due ? tenderedNum - due : 0;

  // Step 1: ask to confirm. Cash requires a tendered amount to be entered.
  function requestPay(method: "cash" | "card") {
    if (!selected) return;
    if (method === "cash") {
      if (!tendered || tenderedNum <= 0) {
        toast.push("bad", "Enter how much cash the customer gave first");
        return;
      }
      if (tenderedNum < due) {
        toast.push("bad", `Cash given (${money(tenderedNum, currency)}) is less than the amount due`);
        return;
      }
    }
    const amount = method === "cash" ? due : due;
    setConfirm({ method, amount, tendered: method === "cash" ? tenderedNum : undefined });
  }


  // Step 2: settle a single ticket or a merged bill through the normal payment controls.
  async function doPay() {
    if (!selected || !confirm) return;
    setBusy(true);
    try {
      if (selected.isMergedBill) {
        const updated = await apiPost<Order>(`/table-bills/${selected.id}/pay`, { method: confirm.method, amount: confirm.amount });
        const cashTendered = confirm.tendered ?? tenderedNum;
        const changeGiven = confirm.method === "cash" ? Math.max(0, cashTendered - confirm.amount) : 0;
        setTendered(""); setConfirm(null);
        if (updated.paymentStatus === "paid") {
          toast.push("ok", `${updated.displayNum} paid${changeGiven > 0 ? ` · change ${money(changeGiven, currency)}` : ""}`);
          autoPrintAndOpen({ ...updated, total: updated.grandTotal ?? updated.total } as Order, confirm.method === "cash", cashTendered);
          setSelected(null); await load();
        } else {
          setSelected({ ...updated, isMergedBill: true, total: updated.grandTotal ?? updated.total } as Order);
          await load();
        }
        return;
      }
      const updated = await apiPost<Order>(`/orders/${selected.id}/pay`, { method: confirm.method, amount: confirm.amount });
      const cashTendered = confirm.tendered ?? tenderedNum;
      const changeGiven = confirm.method === "cash" ? Math.max(0, cashTendered - confirm.amount) : 0;
      setTendered(""); setConfirm(null);
      if (updated.paymentStatus === "paid") {
        toast.push("ok", `${updated.displayNum} paid${changeGiven > 0 ? ` · change ${money(changeGiven, currency)}` : ""}`);
        autoPrintAndOpen(updated, confirm.method === "cash", cashTendered);
        // Close the settled bill immediately so the cashier returns to the open-payment queue.
        setSelected(null);
        await load();
      } else {
        setSelected(updated);
        toast.push("info", `Recorded ${money(confirm.amount, currency)} — balance remains`);
      }
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Payment failed. If this was a combined payment, check each ticket's balance before retrying.");
      await load();
    } finally { setBusy(false); }
  }

  // Fire-and-forget: the bill prints and the drawer opens in ONE print job.
  // The cashier is never blocked waiting for the printer; problems show as a toast.
  function autoPrintAndOpen(order: Order, isCash: boolean, cashTendered: number) {
    printReceipt(order, settings, { tendered: isCash ? cashTendered : undefined, openDrawer: isCash })
      .then((r) => {
        if (!r.printed) toast.push("bad", "Payment saved, but the bill did not print. Check the payment printer / print agent.");
        if (isCash && !r.drawerOpened) toast.push("bad", "Payment saved, but the cash drawer could not be opened. Check the payment printer / print agent.");
      })
      .catch(() => toast.push("bad", "Payment saved, but printing failed."));
  }

  function printBill() {
    if (!selected) return;
    printReceipt(selected, settings, { tendered: tenderedNum > 0 ? tenderedNum : undefined });
  }

  const quick = selected ? [due, 1000, 2000, 5000] : [];
  const selectedTableOrders = selected && !selected.isMergedBill && selected.tableId && selected.orderType === "dine-in"
    ? orders.filter(o => !o.isMergedBill && o.tableId === selected.tableId && o.orderType === "dine-in" && o.paymentStatus !== "paid" && o.status !== "voided")
    : [];
  // Every other open, unpaid, un-merged ticket — for adding a new order to an existing bill.
  const otherOpenOrders = selected && !selected.isMergedBill
    ? orders.filter(o => !o.isMergedBill && o.paymentStatus !== "paid" && o.status !== "voided" && !(Number(o.amountPaid || 0) > 0.01))
    : [];
  const mergeCandidates = mergeAny ? otherOpenOrders : selectedTableOrders;
  const describe = (o: Order) => [o.orderType === "dine-in" && o.tableName ? o.tableName : (o.orderType || "").replace("-", " "), (o as Order & { customerName?: string }).customerName].filter(Boolean).join(" · ");
  const hasLoyalty = settings?.enabledAddons?.includes("loyalty");
  const hasGiftcards = settings?.enabledAddons?.includes("giftcards");

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Payment" subtitle={`${orders.length} open ticket${orders.length === 1 ? "" : "s"}`} icon={CreditCard}>
          <button onClick={() => load()} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        {loading ? <PageLoader /> : (
          <div className="grid lg:grid-cols-[320px_1fr] gap-4">
            {/* ===== Open ticket list ===== */}
            <div className="flex flex-col gap-2 max-h-[72vh] overflow-y-auto pr-1">
              {selectedTableOrders.length > 1 && (
                <section key="tablebill" className="rounded-2xl p-3.5 mb-1" style={{ background: "linear-gradient(135deg,var(--olive-wash),var(--panel))", border: "1px solid color-mix(in srgb,var(--olive) 35%,var(--line))" }}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div><div className="text-[13px] font-bold text-ink">Table bill · {selected?.tableName}</div><div className="text-[11px] text-muted mt-1">{selectedTableOrders.length} open tickets · kitchen tickets stay separate</div></div>
                    <div className="mono text-[15px] font-bold shrink-0" style={{ color: "var(--olive-700)" }}>{money(selectedTableOrders.reduce((sum,o)=>sum+Math.max(0,o.total-(o.amountPaid||0)),0),currency)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setMergeAny(false); setMergeSelectionIds(selectedTableOrders.map(o=>o.id)); setMergeOpen(true); }} className="btn btn-primary btn-sm">Merge all</button>
                    <button onClick={() => { setMergeAny(false); setMergeSelectionIds([]); setMergeOpen(true); }} className="btn btn-ghost btn-sm">Choose tickets</button>
                  </div>
                  <div className="text-[10.5px] text-muted mt-2">Choose tickets to make separate bills from a larger table group.</div>
                </section>
              )}
              {!orders.length ? (
                <EmptyState
                  title="All settled"
                  hint="No open tickets waiting for payment."
                  icon={<CheckCircle2 size={32} />}
                />
              ) : (
                orders.map((o) => (
                  <button key={o.id} onClick={() => { setSelected(o); setTendered(""); }}
                    className="rounded-xl p-3 text-left transition-all hover:shadow-md"
                    style={{
                      background: selected?.id === o.id ? "var(--olive-wash)" : "var(--panel)",
                      border: selected?.id === o.id ? "1.5px solid var(--olive)" : "1px solid var(--line)",
                    }}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink text-[13.5px] truncate">
                          {o.isMergedBill ? "▦ " : ""}{o.displayNum}
                          {o.tableName && <span className="text-muted ml-1">· {o.tableName}</span>}
                          {o.isMergedBill && <span className="badge badge-ready ml-2">Merged bill · {(o.orderIds || []).length} tickets</span>}
                        </div>
                        <div className="text-[11.5px] text-muted capitalize">
                          {o.orderType} · {o.items.length} items
                          {o.priority === "high" ? " · 🔥" : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="mono font-semibold" style={{ color: "var(--olive-700)" }}>
                          {money(o.total, currency)}
                        </div>
                        {o.paymentStatus === "partial" && <span className="pill pill-warn mt-1">partial</span>}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* ===== Detail + tender ===== */}
            {!selected ? (
              <div className="rounded-xl flex items-center justify-center min-h-[400px]"
                style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                <EmptyState title="Pick a ticket" hint="Select an order on the left to take payment." />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {/* ---- The real printable bill ---- */}
                <div className="rounded-xl p-5" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                  {/* Receipt header */}
                  <div className="text-center pb-3 mb-3 border-b border-line-soft">
                    <div className="font-semibold text-[14px] text-ink">
                      {settings?.businessName || "Golden Beach Restaurant"}
                    </div>
                    {settings?.businessAddress && <div className="text-[11px] text-muted">{settings.businessAddress}</div>}
                    {settings?.businessPhone && <div className="text-[11px] text-muted">{settings.businessPhone}</div>}
                  </div>

                  <div className="flex justify-between items-baseline mb-2 text-[12.5px]">
                    <span className="font-semibold text-ink">{selected.displayNum}</span>
                    <span className="text-muted">{selected.tableName || selected.orderType}</span>
                  </div>
                  <div className="text-[11.5px] text-muted mb-2">
                    {(selected.createdAt || "").replace("T", " ").slice(0, 16)}
                    {selected.customerName && <> · {selected.customerName}</>}
                  </div>
                  <label className="block text-xs text-muted mb-3">Order type
                    <select className="inp mt-1" value={selected.orderType} disabled={selected.paymentStatus === "paid" || selected.isMergedBill || busy}
                      onChange={async (e) => {
                        try {
                          const updated = await apiPatch<Order>(`/orders/${selected.id}/type`, { orderType: e.target.value });
                          setSelected(updated); setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
                          toast.push("ok", `Order type changed to ${updated.orderType}; total recalculated`);
                        } catch (err) { toast.push("bad", err instanceof Error ? err.message : "Could not change order type"); }
                      }}>
                      <option value="dine-in">Dine-in</option><option value="takeaway">Takeaway</option><option value="delivery">Delivery</option>
                    </select>
                  </label>

                  {/* Items */}
                  <div className="space-y-1.5 mb-4 max-h-56 overflow-y-auto">
                    {(Array.isArray(selected.items) ? selected.items : []).map((it, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-[13px]">
                          <span className="text-ink">{it.qty}× {it.name}</span>
                          <span className="mono text-ink font-medium">{money(it.lineTotal, currency)}</span>
                        </div>
                        {it.modifiers?.map((m, j) => (
                          <div key={j} className="pl-5 text-[11px] text-muted">+ {m.option}</div>
                        ))}
                        {it.notes && <div className="pl-5 text-[11px] italic" style={{ color: "var(--olive-700)" }}>“{it.notes}”</div>}
                      </div>
                    ))}
                  </div>

                  {/* Totals */}
                  <div className="border-t border-dashed border-line pt-3 space-y-1 text-[13px]">
                    <Row label="Subtotal" value={money(selected.subtotal, currency)} />
                    {discountAmount(selected.discount) > 0 && <Row label="Discount" value={`– ${money(discountAmount(selected.discount), currency)}`} warn />}
                    {selected.serviceCharge > 0 && <Row label="Service" value={money(selected.serviceCharge, currency)} />}
                    {selected.vat > 0 && <Row label="VAT" value={money(selected.vat, currency)} />}
                    <div className="flex justify-between pt-1.5 text-[16px] font-semibold border-t border-line mt-2 pt-2">
                      <span>Total</span>
                      <span className="mono" style={{ color: "var(--olive-700)" }}>{money(selectedTotal, currency)}</span>
                    </div>
                    {(selected.amountPaid || 0) > 0 && (
                      <Row label="Paid" value={money(selected.amountPaid || 0, currency)} ok />
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5 mt-4 flex-wrap">
                    <button onClick={printBill} className="btn btn-ghost btn-sm">
                      <Printer size={14} /> Print bill
                    </button>
                    <button onClick={() => setDiscountOpen(true)} className="btn btn-ghost btn-sm">
                      <Percent size={14} /> Discount
                    </button>
                    {hasLoyalty && (
                      <button onClick={() => setLoyaltyOpen(true)} className="btn btn-ghost btn-sm">
                        <Star size={14} /> Loyalty
                      </button>
                    )}
                    {hasGiftcards && (
                      <button onClick={() => setGiftCardOpen(true)} className="btn btn-ghost btn-sm">
                        <Gift size={14} /> Gift card
                      </button>
                    )}
                    {selectedTableOrders.length > 1 && (
                      <>
                        <button onClick={() => { setMergeAny(false); setMergeSelectionIds(selectedTableOrders.map(o=>o.id)); setMergeOpen(true); }} className="btn btn-soft btn-sm">
                          Merge all tickets
                        </button>
                        <button onClick={() => { setMergeAny(false); setMergeSelectionIds([]); setMergeOpen(true); }} className="btn btn-ghost btn-sm">
                          Choose tickets
                        </button>
                      </>
                    )}
                    {!selected.isMergedBill && otherOpenOrders.length > 1 && !(Number(selected.amountPaid || 0) > 0.01) && (
                      <button onClick={() => { setMergeAny(true); setMergeSelectionIds([selected.id]); setMergeOpen(true); }} className="btn btn-soft btn-sm" title="Add another order (takeaway, delivery or another table) to this bill">
                        Merge with other bills
                      </button>
                    )}
                    {!selected.isMergedBill && <button onClick={() => setVoidOpen(true)} className="btn btn-danger btn-sm ml-auto">
                      <Ban size={14} /> Void
                    </button>}
                  </div>
                </div>

                {/* ---- Tender panel ---- */}
                <div className="rounded-xl p-5 flex flex-col" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                  {selected.paymentStatus === "paid" ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-6">
                      <CheckCircle2 size={44} style={{ color: "var(--ok-ink)" }} />
                      <div className="text-[20px] font-semibold">Paid in full</div>
                      <div className="text-sm text-muted">Order {selected.displayNum} is settled.</div>
                      <button onClick={printBill} className="btn btn-primary">
                        <Printer size={15} /> Print receipt
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-center mb-3">
                        <div className="text-[11px] uppercase tracking-wider text-muted">Amount due</div>
                        <div className="text-[32px] font-semibold text-ink mono mt-1 leading-none">{money(due, currency)}</div>
                      </div>

                      <input className="inp text-center text-xl mono !py-2.5 mb-2" inputMode="numeric" placeholder="Enter cash given"
                        autoFocus key={selected.id}
                        value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
                        onKeyDown={(e) => { if (e.key === "Enter" && tenderedNum >= due) requestPay("cash"); }} />

                      <div className="grid grid-cols-4 gap-1.5 mb-2">
                        {quick.map((amt, i) => (
                          <button key={i} onClick={() => setTendered(String(Math.round(amt)))} className="btn btn-soft btn-sm !px-1">
                            {i === 0 ? "Exact" : money(amt, "")}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 mb-3">
                        {["1","2","3","4","5","6","7","8","9",".","0","⌫"].map((k) => (
                          <button key={k} onClick={() => setTendered((t) => k === "⌫" ? t.slice(0, -1) : t + k)}
                            className="py-2.5 font-semibold rounded-lg transition active:scale-95"
                            style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                            {k === "⌫" ? <Delete size={16} className="mx-auto" /> : k}
                          </button>
                        ))}
                      </div>

                      {change > 0 && (
                        <div className="text-center text-sm mb-2" style={{ color: "var(--ok-ink)" }}>
                          Change: <span className="mono font-semibold">{money(change, currency)}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 mt-auto">
                        <button onClick={() => requestPay("cash")} disabled={busy} className="btn btn-soft btn-lg">
                          <Banknote size={17} /> Cash
                        </button>
                        <button onClick={() => requestPay("card")} disabled={busy} className="btn btn-primary btn-lg">
                          <CreditCard size={17} /> Card
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Screen>

      {selected && discountOpen && (
        <DiscountModal order={selected} currency={currency} onClose={() => setDiscountOpen(false)}
          onDone={(o) => { setSelected((current) => current ? { ...current, ...o, items: Array.isArray(o.items) ? o.items : current.items ?? [] } : o); setDiscountOpen(false); toast.push("ok", "Discount applied"); }} />
      )}
      {selected && voidOpen && (
        <VoidModal order={selected} onClose={() => setVoidOpen(false)}
          onDone={() => { setVoidOpen(false); setSelected(null); toast.push("ok", "Order voided"); load(); }} />
      )}
      {selected && giftCardOpen && (
        <GiftCardModal order={selected} currency={currency} onClose={() => setGiftCardOpen(false)}
          onDone={(o, info) => {
            setGiftCardOpen(false);
            const merged = { ...selected, ...o, items: Array.isArray(o.items) && o.items.length ? o.items : selected.items ?? [] } as Order;
            const total = Number(merged.isMergedBill ? (merged.grandTotal ?? merged.total) : merged.total);
            const left = Math.max(0, total - Number(merged.amountPaid || 0));
            const cardMsg = info.cardLeft != null ? ` · card balance left ${money(info.cardLeft, currency)}` : "";
            if (merged.paymentStatus === "paid" || left <= 0.009) {
              toast.push("ok", `Gift card paid ${money(info.redeemed, currency)} — bill fully paid${cardMsg}`);
              autoPrintAndOpen({ ...merged, total } as Order, false, 0);
              setSelected(null); setTendered("");
            } else {
              toast.push("ok", `Gift card paid ${money(info.redeemed, currency)}${cardMsg} · ${money(left, currency)} still to pay`);
              setSelected(merged); setTendered("");
            }
            load();
          }} />
      )}
      {selected && loyaltyOpen && (
        <LoyaltyModal order={selected} currency={currency} onClose={() => setLoyaltyOpen(false)}
          onDone={(o) => { setSelected((current) => current ? { ...current, ...o, items: Array.isArray(o.items) ? o.items : current.items ?? [] } : o); setLoyaltyOpen(false); toast.push("ok", "Points redeemed"); load(); }} />
      )}

      {/* Choose any subset of tickets at a table for a separate bill */}
      {selected && mergeOpen && (
        <Modal open title={mergeAny ? `Merge bills · ${selected.displayNum}` : `Choose tickets · ${selected.tableName || "Table"}`} onClose={() => setMergeOpen(false)} width={520}>
          <p className="text-[12px] text-muted mb-3">{mergeAny
            ? "Tick the other orders that belong to the same customer. They will be paid together as one bill; each order still goes to the kitchen on its own."
            : "Select the tickets to include in this bill. Leave the others unpaid to settle them as another bill later."}</p>
          <div className="space-y-2 max-h-[45vh] overflow-y-auto">
            {mergeCandidates.map((o) => {
              const checked = mergeSelectionIds.includes(o.id);
              const balance = Math.max(0, o.total - (o.amountPaid || 0));
              return <label key={o.id} className="flex items-center gap-3 rounded-xl p-3 cursor-pointer" style={{ background: checked ? "var(--olive-wash)" : "var(--panel-2)", border: `1px solid ${checked ? "var(--olive)" : "var(--line)"}` }}>
                <input type="checkbox" checked={checked} onChange={(e) => setMergeSelectionIds(prev => e.target.checked ? [...prev, o.id] : prev.filter(id => id !== o.id))} className="size-4 accent-current" />
                <span className="flex-1 min-w-0"><span className="block text-[13px] font-semibold text-ink">{o.displayNum}</span><span className="block text-[11px] text-muted">{describe(o) ? describe(o) + " · " : ""}{o.items.length} item lines · {o.status}</span></span>
                <span className="mono font-bold text-[13px]">{money(balance, currency)}</span>
              </label>;
            })}
          </div>
          <div className="flex items-center justify-between rounded-xl p-3 mt-4" style={{ background: "var(--panel-2)" }}><span className="text-[12px] text-muted">Selected tickets will become one merged bill</span><strong className="mono text-[19px]" style={{ color: "var(--olive-700)" }}>{money(mergeCandidates.filter(o=>mergeSelectionIds.includes(o.id)).reduce((sum,o)=>sum+Math.max(0,o.total-(o.amountPaid||0)),0),currency)}</strong></div>
          <div className="grid grid-cols-2 gap-2 mt-4"><button onClick={() => setMergeOpen(false)} className="btn btn-ghost">Cancel</button><button disabled={mergeSelectionIds.length < 2 || busy} onClick={async () => {
            if (mergeSelectionIds.length < 2) { toast.push("bad", "Select at least two tickets to merge"); return; }
            setBusy(true);
            try {
              const merged = await apiPost<Order>("/table-bills", { orderIds: mergeSelectionIds, anyType: mergeAny });
              setMergeOpen(false); setTendered("");
              toast.push("ok", `Merged ${mergeSelectionIds.length} tickets into ${merged.displayNum} · ${money(Number(merged.grandTotal ?? merged.total), currency)}`);
              await load();
              setSelected({ ...merged, isMergedBill: true, total: Number(merged.grandTotal ?? merged.total), priority: "normal" } as Order);
              setMergeSelectionIds([]);
            } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Could not merge tickets"); }
            finally { setBusy(false); }
          }} className="btn btn-primary">{busy ? "Merging…" : `Merge ${mergeSelectionIds.length || "selected"} tickets`}</button></div>
          <p className="text-[11px] text-muted mt-3">This only creates the merged bill. After merging, select the new bill in the Payment list to apply a discount, print it, and pay through the normal cash/card controls.</p>
        </Modal>
      )}

      {/* Payment confirmation */}
      {selected && confirm && (
        <Modal open title={"Confirm payment"} onClose={() => setConfirm(null)} width={400}>
          <div className="text-center py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted">
              {confirm.method === "cash" ? "Cash payment" : "Card payment"}
            </div>
            <div className="text-[34px] font-semibold mono mt-1" style={{ color: "var(--olive-700)" }}>
              {money(confirm.amount, currency)}
            </div>
            <div className="text-[13px] text-muted mt-1">{selected.displayNum} · {selected.tableName || selected.orderType}</div>
            {confirm.method === "cash" && (confirm.tendered ?? tenderedNum) > 0 && (
              <div className="mt-3 rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
                <div className="flex justify-between text-[13px]"><span className="text-muted">Cash given</span><span className="mono font-semibold">{money(confirm.tendered ?? tenderedNum, currency)}</span></div>
                <div className="flex justify-between text-[14px] mt-1"><span className="font-semibold">Change</span>
                  <span className="mono font-bold" style={{ color: "var(--ok-ink)" }}>{money(Math.max(0, (confirm.tendered ?? tenderedNum) - confirm.amount), currency)}</span></div>
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setConfirm(null)} className="btn btn-ghost flex-1">Cancel</button>
            <button onClick={doPay} disabled={busy} className="btn btn-primary flex-1">
              {busy ? "Processing…" : "Confirm & pay"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, warn, ok }: { label: string; value: string; warn?: boolean; ok?: boolean }) {
  return (
    <div className="flex justify-between" style={{ color: warn ? "var(--bad-ink)" : ok ? "var(--ok-ink)" : "var(--muted)" }}>
      <span>{label}</span>
      <span className="mono font-medium">{value}</span>
    </div>
  );
}

/* ------------------------- Discount modal ------------------------- */
function DiscountModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order) => void }) {
  // NOTE: backend expects "percent" | "fixed" — sending "amount" silently fell
  // back to percent, so a fixed amount was applied as a percentage. Keep "fixed".
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const hasDiscount = discountAmount(order.discount) > 0;
  async function apply() {
    setBusy(true); setErr("");
    try { const endpoint = order.isMergedBill ? `/table-bills/${order.id}/discount` : `/orders/${order.id}/discount`; const o = await apiPost<Order>(endpoint, { type, value: Number(value) || 0, reason, pin }); onDone(order.isMergedBill ? { ...o, isMergedBill: true, total: Number(o.grandTotal ?? o.total) } : o); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not apply"); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setErr("");
    // value 0 tells the backend to clear the discount
    try { const endpoint = order.isMergedBill ? `/table-bills/${order.id}/discount` : `/orders/${order.id}/discount`; const o = await apiPost<Order>(endpoint, { type: "percent", value: 0, reason: "Discount removed", pin }); onDone(order.isMergedBill ? { ...o, isMergedBill: true, total: Number(o.grandTotal ?? o.total) } : o); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not remove"); }
    finally { setBusy(false); }
  }
  const preview = value
    ? type === "percent"
      ? money((order.subtotal * (Number(value) || 0)) / 100, currency)
      : money(Number(value) || 0, currency)
    : null;
  return (
    <Modal open title="Apply discount" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
          {(["percent", "fixed"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className="flex-1 py-1.5 rounded-full text-[13px] font-semibold capitalize"
              style={type === t ? { background: "var(--panel)", color: "var(--olive-700)" } : { color: "var(--muted)" }}>
              {t === "percent" ? "Percent %" : `Amount (${currency.trim()})`}
            </button>
          ))}
        </div>
        <input className="inp" inputMode="numeric" placeholder={type === "percent" ? "e.g. 10 (%)" : `e.g. 500 (${currency.trim()})`} value={value} onChange={(e) => setValue(e.target.value)} />
        {preview && <div className="text-[12.5px] text-muted">Takes off <span className="font-semibold text-ink">{preview}</span> from {money(order.subtotal, currency)}</div>}
        <input className="inp" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="inp" type="password" placeholder="Manager PIN (required for fixed amounts / over limit)" value={pin} onChange={(e) => setPin(e.target.value)} />
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={apply} disabled={busy} className="btn btn-primary w-full">Apply discount</button>
        {hasDiscount && (
          <button onClick={remove} disabled={busy} className="btn btn-ghost w-full" style={{ color: "var(--bad-ink)" }}>
            Remove current discount
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------- Void modal ------------------------- */
function VoidModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function doVoid() {
    setBusy(true); setErr("");
    try { await apiPost(`/orders/${order.id}/void`, { reason, pin }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not void"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title={`Void ${order.displayNum}`} onClose={onClose} width={420}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Voiding reverses the ticket and returns stock. This needs a manager PIN.</p>
        <input className="inp" placeholder="Reason for void" value={reason} onChange={(e) => setReason(e.target.value)} />
        <input className="inp" type="password" placeholder="Manager PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={doVoid} disabled={busy} className="btn btn-danger w-full">Void order</button>
      </div>
    </Modal>
  );
}

/* ------------------------- Gift card redeem ------------------------- */
function GiftCardModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order, info: { redeemed: number; cardLeft: number | null }) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function apply() {
    const c = code.toUpperCase().trim();
    if (!c || busy) return;
    setBusy(true); setErr("");
    try {
      if (order.isMergedBill) {
        // Combined table bill: pay through the bill itself (not one of its tickets).
        const before = Number(order.amountPaid || 0);
        const bill = await apiPost<Order>(`/table-bills/${order.id}/pay`, { method: "giftcard", code: c });
        const total = Number(bill.grandTotal ?? bill.total ?? 0);
        onDone({ ...bill, isMergedBill: true, total, grandTotal: total, amountPaid: Number(bill.amountPaid || 0) } as Order,
          { redeemed: Math.max(0, Number(bill.amountPaid || 0) - before), cardLeft: null });
      } else {
        // The server answers { order, redeemed, remainingCardBalance }.
        const r = await apiPost<{ order: Order; redeemed: number; remainingCardBalance: number }>(`/orders/${order.id}/giftcard-pay`, { code: c });
        onDone(r.order, { redeemed: Number(r.redeemed) || 0, cardLeft: Number(r.remainingCardBalance) });
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not apply"); setCode(""); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Pay with gift card" onClose={onClose} width={400}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Scan the card's barcode (it types the code and submits automatically), or type the code and press Enter.</p>
        <input className="inp mono uppercase tracking-widest" placeholder="Scan or type · GCXXXXXXXXXX" value={code} autoFocus
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={apply} disabled={busy || !code.trim()} className="btn btn-primary w-full">Apply gift card</button>
      </div>
    </Modal>
  );
}

/* ------------------------- Loyalty redeem ------------------------- */
function LoyaltyModal({ order, currency, onClose, onDone }: { order: Order; currency: string; onClose: () => void; onDone: (o: Order) => void }) {
  const [phone, setPhone] = useState(order.customerPhone || "");
  const [points, setPoints] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function apply() {
    setBusy(true); setErr("");
    try {
      const o = await apiPost<Order>(`/orders/${order.id}/loyalty-redeem`, { phone, points: Number(points) || 0 });
      onDone(o);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not redeem"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Redeem loyalty points" onClose={onClose} width={400}>
      <div className="space-y-3">
        <div><label className="lbl">Customer phone</label>
          <input className="inp" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="lbl">Points to redeem</label>
          <input className="inp mono" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} /></div>
        {err && <div className="text-sm text-bad">{err}</div>}
        <button onClick={apply} disabled={busy} className="btn btn-primary w-full">Redeem</button>
      </div>
    </Modal>
  );
}

export default function PaymentPage() {
  return <Suspense fallback={<PageLoader />}><PaymentInner /></Suspense>;
}
