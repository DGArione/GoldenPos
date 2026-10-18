"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, ChefHat, Check, Bike, RefreshCw, X, Printer } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { Order } from "@/lib/types";
import { printKitchenTicket } from "@/lib/printing";
import { PageHeader, PageLoader, EmptyState, Screen, useToast } from "@/components/ui";

export default function OnlineOrdersPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"online" | "table" | "history">("table");
  const tabPicked = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Order[]>("/orders?all=1");
      const list = (Array.isArray(d) ? d : []).filter((o) => (o.source === "online" || o.source === "qr"));
      setOrders(list);
      // Open on whichever tab has orders waiting (table QR first) until the user picks one.
      if (!tabPicked.current) {
        const waitingTable = list.some((o) => o.source === "qr" && o.status === "new");
        const waitingOnline = list.some((o) => o.source === "online" && o.status === "new");
        setTab(waitingTable ? "table" : waitingOnline ? "online" : "table");
      }
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);

  async function advance(o: Order, status: string) {
    try { await apiPatch(`/orders/${o.id}/status`, { status }); toast.push("ok", `${o.displayNum} → ${status}`); load(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function accept(o: Order) {
    try {
      await apiPost(`/orders/${o.id}/accept`);
      if (settings?.printAgentEnabled && settings.kitchenPrinterName) {
        const printed = await printKitchenTicket(o, settings);
        if (!printed) toast.push("bad", `Accepted ${o.displayNum}, but the kitchen ticket could not print. Check Printer Management.`);
        else toast.push("ok", `Accepted ${o.displayNum} — sent to kitchen and printed`);
      } else {
        toast.push("ok", `Accepted ${o.displayNum} — sent to kitchen`);
      }
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function reject(o: Order) {
    const reason = prompt("Reason for rejection:");
    if (!reason) return;
    try {
      await apiPost(`/orders/${o.id}/reject`, { reason });
      toast.push("ok", `Rejected ${o.displayNum}`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const waiting = (src: string) => orders.filter((o) => o.source === src && o.status === "new").length;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Online orders" subtitle="Website orders, table QR orders, and approval history" icon={Globe}>
          <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
        </PageHeader>

        <div className="flex gap-2 mb-3 flex-wrap">
          <button className={`btn btn-sm ${tab === "table" ? "btn-primary" : "btn-ghost"}`} onClick={() => { tabPicked.current = true; setTab("table"); }}>
            Table Orders (QR){waiting("qr") > 0 && <span className="ml-1.5 rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: "var(--bad)" }}>{waiting("qr")}</span>}
          </button>
          <button className={`btn btn-sm ${tab === "online" ? "btn-primary" : "btn-ghost"}`} onClick={() => { tabPicked.current = true; setTab("online"); }}>
            Online Orders{waiting("online") > 0 && <span className="ml-1.5 rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: "var(--bad)" }}>{waiting("online")}</span>}
          </button>
          <button className={`btn btn-sm ${tab === "history" ? "btn-primary" : "btn-ghost"}`} onClick={() => { tabPicked.current = true; setTab("history"); }}>History (approved & rejected)</button>
        </div>
        {loading ? <PageLoader /> : !orders.filter(o => tab === "history" ? o.status !== "new" : (o.source === (tab === "table" ? "qr" : "online") && o.status === "new")).length ? (
          <EmptyState title={tab === "history" ? "No order history" : tab === "table" ? "No table orders" : "No online orders"} hint={tab === "history" ? "Accepted and rejected web/table orders will appear here." : tab === "table" ? "New QR/table orders will appear here for staff approval." : "New website orders will appear here for staff approval."} icon={<Globe size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {orders.filter(o => tab === "history" ? o.status !== "new" : (o.source === (tab === "table" ? "qr" : "online") && o.status === "new")).map((o) => (
              <div key={o.id} className="rounded-xl overflow-hidden" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--olive-wash)" }}>
                  <span className="font-semibold text-ink">{o.displayNum}</span>
                  <span className="pill pill-olive capitalize">{o.status}</span>
                </div>
                <div className="p-4">
                  <div className="text-sm font-medium text-ink">{o.customerName || o.tableName || "Online guest"}</div>
                  {o.customerPhone && <div className="text-[12px] text-muted">{o.customerPhone}</div>}
                  {o.customerAddress && <div className="text-[12px] text-muted mt-0.5">{o.customerAddress}</div>}

                  <div className="my-3 space-y-1">
                    {o.items.map((it, i) => (
                      <div key={i} className="flex justify-between text-[13px]">
                        <span>{it.qty}× {it.name}</span>
                        <span className="mono text-muted">{money(it.lineTotal, currency)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between font-semibold border-t border-line-soft pt-2">
                    <span>Total</span>
                    <span className="mono" style={{ color: "var(--olive-700)" }}>{money(o.total, currency)}</span>
                  </div>

                  <div className="flex gap-2 mt-3 flex-wrap">
                    {o.status === "voided" ? <span className="text-xs text-red-500">Rejected / voided</span> : o.status === "new" ? (
                      <>
                        <button onClick={() => reject(o)} className="btn btn-danger btn-sm">
                          <X size={13} /> Reject
                        </button>
                        <button onClick={() => accept(o)} className="btn btn-kot btn-sm flex-1">
                          <ChefHat size={13} /> Accept &amp; send to kitchen
                        </button>
                      </>
                    ) : o.status === "preparing" ? (
                      <button onClick={() => advance(o, "ready")} className="btn btn-primary btn-sm flex-1">
                        <Check size={13} /> Ready
                      </button>
                    ) : o.status === "ready" ? (
                      <button onClick={() => advance(o, "dispatched")} className="btn btn-soft btn-sm flex-1">
                        <Bike size={13} /> Dispatch
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Screen>
    </div>
  );
}
