"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Flame, Check, CookingPot, Timer, RefreshCw, ChefHat,
  Ban, History, X as XIcon, CheckCheck, Printer,
} from "lucide-react";
import Link from "next/link";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { Order, Station } from "@/lib/types";
import { useSettings } from "@/lib/settings";
import { printKitchenTicket } from "@/lib/printing";
import { PageHeader, PageLoader, EmptyState, useToast, Modal } from "@/components/ui";

// Live = things the kitchen still needs to cook.
// Ready items leave Live immediately — they are the server's to pick up.
const ACTIVE   = ["pending", "preparing"];
const FINISHED = ["ready", "dispatched", "completed", "voided"];

type View = "active" | "done";

export default function KitchenPage() {
  const toast = useToast();
  const settings = useSettings();
  const [reprintingId, setReprintingId] = useState<number | null>(null);
  const [orders, setOrders]     = useState<Order[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [station, setStation]   = useState<number | "all">("all");
  const [view, setView]         = useState<View>("active");
  const [loading, setLoading]   = useState(true);
  const [now, setNow]           = useState(Date.now());
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([
        apiGet<Order[]>("/orders"),
        apiGet<Station[]>("/stations"),
      ]);
      setOrders(Array.isArray(o) ? o : []);
      setStations(Array.isArray(s) ? s : []);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    const c = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);

  async function setItem(order: Order, idx: number, status: string) {
    try {
      const u = await apiPatch<Order>(`/orders/${order.id}/items/${idx}/status`, { status });
      mergeOrder(u);
    }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resendToKitchen(order: Order) {
    if (!settings?.kitchenPrinterName) {
      toast.push("bad", "No kitchen printer selected. Choose one in Settings → Printer Management.");
      return;
    }
    if (!settings.printAgentEnabled) {
      toast.push("bad", "Direct printing is disabled. Enable it in Settings → Printer Management.");
      return;
    }
    setReprintingId(order.id);
    try {
      const printed = await printKitchenTicket(order, settings);
      if (!printed) {
        toast.push("bad", `Could not resend ${order.displayNum} to the kitchen. Check the printer, paper, and print agent.`);
      } else {
        toast.push("ok", `${order.displayNum} resent to kitchen. No new order was created and sales/order counts are unchanged.`);
      }
    } finally {
      setReprintingId(null);
    }
  }

  // One tap: every waiting dish on this ticket (or just this station's) -> cooking.
  async function start(order: Order) {
    try {
      const u = await apiPost<Order>(`/orders/${order.id}/start`, station === "all" ? {} : { stationId: station });
      mergeOrder(u);
      toast.push("ok", `${order.displayNum} - cooking started`);
    }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function bump(order: Order) {
    try {
      await apiPatch<Order>(`/orders/${order.id}/status`, { status: "ready" });
      toast.push("ok", `${order.displayNum} marked ready`);
      load();
    }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  function mergeOrder(u: Order) {
    setOrders((prev) => prev.map((o) => (o.id === u.id ? u : o)));
  }

  // ── Filter + sort ──
  const shown = useMemo(() => {
    const base = orders.filter((o) => (view === "active" ? ACTIVE.includes(o.status) : FINISHED.includes(o.status)));
    const stationFiltered = station === "all"
      ? base
      : base.filter((o) => o.items.some((it) => it.stationId === station));

    return [...stationFiltered].sort((a, b) => {
      // active: priority first, then oldest first (FIFO queue)
      if (view === "active") {
        if ((a.priority === "high") !== (b.priority === "high")) return a.priority === "high" ? -1 : 1;
        return (a.createdAt || "").localeCompare(b.createdAt || "");
      }
      // done: most recent first
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }, [orders, view, station]);

  const counts = useMemo(() => ({
    active: orders.filter((o) => ACTIVE.includes(o.status)).length,
    done:   orders.filter((o) => FINISHED.includes(o.status)).length,
  }), [orders]);

  if (loading) return <PageLoader label="Loading tickets" />;

  return (
    <div>
      <PageHeader title="Kitchen" subtitle="Live tickets — bump items as they leave the pass." icon={ChefHat}>
        {view === "active" && shown.length > 0 && (
          <button
            onClick={async () => {
              if (!confirm(`Mark all ${shown.length} tickets ready?`)) return;
              try {
                await Promise.all(shown.map((o) => apiPatch(`/orders/${o.id}/status`, { status: "ready" })));
                toast.push("ok", `All ${shown.length} marked ready`);
                load();
              } catch { toast.push("bad", "Some tickets failed"); }
            }}
            className="btn btn-soft btn-sm"
            title="Mark every visible ticket ready"
          >
            <CheckCheck size={14} /> All ready
          </button>
        )}
        <Link href="/menu-admin" className="btn btn-ghost btn-sm" title="Manage kitchen stations">
          <Flame size={14} /> Stations
        </Link>
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      {/* Active / Done tabs */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
          {([["active", "Live", counts.active], ["done", "Today — done & cancelled", counts.done]] as const).map(([v, label, n]) => (
            <button key={v} onClick={() => setView(v)}
              className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors flex items-center gap-2"
              style={view === v
                ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--muted)" }}>
              {v === "done" && <History size={13} />} {label}
              <span className="pill" style={{
                background: view === v ? "var(--olive-wash)" : "var(--panel)",
                color: "var(--olive-700)", padding: "1px 7px", fontSize: 10,
              }}>
                {n}
              </span>
            </button>
          ))}
        </div>

        {/* Station filter */}
        <div className="ml-auto flex gap-2 overflow-x-auto">
          {(["all", ...stations.map((s) => s.id)] as (number | "all")[]).map((s) => {
            const name = s === "all" ? "All stations" : stations.find((x) => x.id === s)?.name || "";
            const on = station === s;
            return (
              <button key={String(s)} onClick={() => setStation(s)}
                className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap border transition-colors"
                style={on
                  ? { background: "var(--olive)", color: "var(--on-accent)", borderColor: "var(--olive)" }
                  : { background: "var(--panel)", color: "var(--muted)", borderColor: "var(--line)" }}>
                {name}
              </button>
            );
          })}
        </div>
      </div>

      {!shown.length ? (
        <EmptyState
          title={view === "active" ? "No live tickets" : "Nothing finished today yet"}
          hint={view === "active"
            ? "New orders will appear here the moment they're sent."
            : "Completed, dispatched or cancelled tickets will show up here."}
          icon={<ChefHat size={34} />}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
          {shown.map((o) => {
            const mins = o.createdAt
              ? Math.max(0, Math.floor((now - new Date(o.createdAt.replace(" ", "T")).getTime()) / 60000))
              : 0;
            const late = mins >= 15 && ACTIVE.includes(o.status);
            const relevant = station === "all" ? o.items : o.items.filter((it) => it.stationId === station);
            const isFinished = FINISHED.includes(o.status);
            const isVoided = o.status === "voided";

            return (
              <div key={o.id} className="gb-card overflow-hidden flex flex-col"
                style={o.priority === "high" && !isFinished
                  ? { borderColor: "var(--bad)", borderWidth: 2 }
                  : isVoided
                    ? { opacity: 0.75 }
                    : {}}>
                {/* Header */}
                <div className="px-3.5 py-2.5 flex items-center justify-between"
                  style={{
                    background: isVoided ? "var(--bad-wash)"
                      : o.status === "ready" ? "var(--ok-wash)"
                      : o.priority === "high" ? "var(--bad-wash)"
                      : "var(--olive-wash)",
                  }}>
                  <div className="flex items-center gap-2">
                    {o.priority === "high" && !isFinished && <Flame size={15} style={{ color: "var(--bad-ink)" }} />}
                    {isVoided && <Ban size={15} style={{ color: "var(--bad-ink)" }} />}
                    <span className="font-semibold text-[14px] text-ink">{o.displayNum}</span>
                  </div>
                  <span className={`pill ${late ? "pill-bad" : isVoided ? "pill-bad" : o.status === "ready" ? "pill-ok" : "pill-olive"}`}>
                    {isVoided ? "Cancelled"
                      : o.status === "ready" ? "Ready"
                      : o.status === "dispatched" ? "Served"
                      : o.status === "completed" ? "Done"
                      : (<><Timer size={11} />{mins}m</>)}
                  </span>
                </div>

                {/* Meta row */}
                <div className="px-3.5 py-1.5 text-[12px] text-muted border-b border-line-soft">
                  {o.tableName} · <span className="capitalize">{o.orderType}</span>
                  {o.customerName && <> · {o.customerName}</>}
                </div>

                {/* Items */}
                <div className="p-3 flex flex-col gap-1.5 flex-1">
                  {relevant.map((it) => {
                    const idx = o.items.indexOf(it);
                    return (
                      <div key={idx} className="rounded-md px-2.5 py-2" style={{ background: "var(--panel-2)" }}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="text-[13px] font-medium text-ink">{it.qty}× {it.name}</div>
                          <StatusDot status={it.status} />
                        </div>
                        {it.modifiers?.map((m, j) => (
                          <div key={j} className="text-[11px] text-muted">+ {m.option}</div>
                        ))}
                        {it.notes && <div className="text-[11px] italic" style={{ color: "var(--olive-700)" }}>“{it.notes}”</div>}

                        {!isFinished && (
                          <div className="flex gap-1.5 mt-1.5">
                            {it.status === "pending" && (
                              <button onClick={() => setItem(o, idx, "preparing")} className="btn btn-soft btn-sm flex-1 !py-1">
                                <CookingPot size={13} /> Cooking
                              </button>
                            )}
                            {it.status !== "ready" && (
                              <button onClick={() => setItem(o, idx, "ready")} className="btn btn-olive btn-sm flex-1 !py-1">
                                <Check size={13} /> Ready
                              </button>
                            )}
                            {it.status === "ready" && (
                              <span className="text-[12px] font-semibold flex items-center gap-1 px-1" style={{ color: "var(--ok-ink)" }}>
                                <Check size={14} /> Ready
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Order-level note */}
                {o.note && (
                  <div className="px-3.5 py-2 text-[12px] border-t border-line-soft" style={{ color: "var(--olive-700)" }}>
                    Note: {o.note}
                  </div>
                )}

                {/* Hand-off to the floor */}
                {o.status === "ready" && (
                  <div className="px-3.5 py-2 text-[12px] border-t border-line-soft font-semibold" style={{ color: "var(--olive-700)" }}>
                    Ready at the pass - the cashier marks it Served
                  </div>
                )}
                {o.status === "dispatched" && o.servedByName && (
                  <div className="px-3.5 py-2 text-[12px] border-t border-line-soft text-muted">Served · marked by {o.servedByName}</div>
                )}

                {/* Cancelled reason */}
                {isVoided && o.voidData && (
                  <div className="px-3.5 py-2 text-[12px] border-t border-line-soft" style={{ color: "var(--bad-ink)" }}>
                    Cancelled by {o.voidData.byStaffName || "staff"}
                    {o.voidData.reason ? ` — "${o.voidData.reason}"` : ""}
                  </div>
                )}

                {/* Resend an existing ticket if the printer ran out of paper. This only reprints; it never creates a new order. */}
                <div className="flex border-t border-line-soft">
                  <button
                    onClick={() => resendToKitchen(o)}
                    disabled={reprintingId === o.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                    style={{ color: "var(--olive-700)", background: "transparent" }}
                    title="Print this existing ticket again; does not create or count a new order"
                  >
                    <Printer size={14} /> {reprintingId === o.id ? "Sending…" : "Resend to kitchen"}
                  </button>
                  {!isFinished && <>
                    <div className="w-px" style={{ background: "var(--line)" }} />
                    <button
                      onClick={() => setCancelOrder(o)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-semibold transition-colors"
                      style={{ color: "var(--bad-ink)", background: "transparent" }}
                      title="Cancel this order (void)"
                    >
                      <Ban size={14} /> Cancel
                    </button>
                    <div className="w-px" style={{ background: "var(--line)" }} />
                    {relevant.some((it) => (it.status || "pending") === "pending") ? (
                      <button
                        onClick={() => start(o)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-semibold text-white transition-colors"
                        style={{ background: "#b86e00" }}
                        title="Mark every waiting dish on this ticket as cooking"
                      >
                        <CookingPot size={15} /> Start cooking
                      </button>
                    ) : (
                      <button
                        onClick={() => bump(o)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[12.5px] font-semibold text-[color:var(--on-accent)] transition-colors"
                        style={{ background: "var(--olive)" }}
                      >
                        <Check size={15} /> All ready
                      </button>
                    )}
                  </>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cancelOrder && (
        <CancelDialog
          order={cancelOrder}
          onClose={() => setCancelOrder(null)}
          onDone={() => {
            toast.push("ok", `${cancelOrder.displayNum} cancelled`);
            setCancelOrder(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "pill-warn",
    preparing: "pill-olive",
    ready: "pill-ok",
  };
  return (
    <span className={`pill ${map[status] || "pill-olive"}`} style={{ padding: "1px 7px", fontSize: 10 }}>
      {status === "preparing" ? "cooking" : status === "pending" ? "waiting" : status}
    </span>
  );
}

/** Cancel-order confirmation with a required reason (routes through POST /orders/:id/void). */
function CancelDialog({
  order, onClose, onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim()) { toast.push("bad", "Please give a short reason"); return; }
    setBusy(true);
    try {
      await apiPost(`/orders/${order.id}/void`, { reason });
      onDone();
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Could not cancel");
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Cancel ${order.displayNum}?`} onClose={onClose} width={440}>
      <p className="text-sm text-muted mb-3">
        This voids the order and returns ingredients to stock. {order.tableName ? `Table ${order.tableName} will be re-opened. ` : ""}
        A reason is required so this shows up on reports.
      </p>
      <div>
        <label className="lbl">Reason</label>
        <input
          className="inp"
          placeholder="e.g. customer changed mind, wrong order…"
          value={reason}
          autoFocus
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="btn btn-ghost flex-1">Keep order</button>
        <button onClick={submit} disabled={busy} className="btn btn-danger flex-1">
          <Ban size={15} /> {busy ? "Cancelling…" : "Cancel order"}
        </button>
      </div>
    </Modal>
  );
}
