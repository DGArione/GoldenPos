"use client";

/*
 * Serve - the cashier's list of food the kitchen has marked Ready.
 *
 *   Kitchen marks a ticket Ready  ->  it appears here with a chime
 *   Cashier taps "Served"         ->  order complete; customer's phone shows Served
 *
 * Mis-tap? "Undo" puts it back for 10 minutes (managers any time).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { HandPlatter, Check, RefreshCw, RotateCcw, Timer, ChefHat, BellRing } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Order } from "@/lib/types";
import { useAuth, isManager } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, useToast } from "@/components/ui";

interface Board { ready: Order[]; served: Order[]; cooking: number }

const POLL_MS = 5000;
const UNDO_MS = 10 * 60 * 1000;

function parseTime(s?: string | null) {
  if (!s) return 0;
  const t = new Date(s.includes("T") ? s : s.replace(" ", "T")).getTime();
  return isNaN(t) ? 0 : t;
}
const minsSince = (s: string | null | undefined, now: number) => { const t = parseTime(s); return t ? Math.max(0, Math.floor((now - t) / 60000)) : 0; };
const clock = (s?: string | null) => { const t = parseTime(s); return t ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; };

// Short chime for "new food at the pass". Browsers only allow sound after the
// page has been touched once, so the sound is unlocked on the first tap.
let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* no audio */ }
}
function chime() {
  try {
    if (!audioCtx || audioCtx.state !== "running") return;
    [880, 1320].forEach((f, i) => {
      const o = audioCtx!.createOscillator(), g = audioCtx!.createGain();
      o.frequency.value = f; o.type = "sine";
      const t0 = audioCtx!.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      o.connect(g).connect(audioCtx!.destination); o.start(t0); o.stop(t0 + 0.4);
    });
  } catch { /* ignore */ }
}

export default function ServePage() {
  const toast = useToast();
  const { user } = useAuth();
  const boss = isManager(user) || user?.role === "admin";
  const [board, setBoard] = useState<Board>({ ready: [], served: [], cooking: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<number> | null>(null);
  const toastRef = useRef(toast); toastRef.current = toast;

  const load = useCallback(async () => {
    try {
      const b = await apiGet<Board>("/orders/serve-board");
      const ready = Array.isArray(b.ready) ? b.ready : [];
      // Chime for food that wasn't on the list last time (not on first load).
      if (seen.current) {
        const fresh = ready.filter((o) => !seen.current!.has(o.id));
        if (fresh.length) {
          chime();
          toastRef.current.push("ok", fresh.length === 1
            ? `Ready: ${fresh[0].tableName || "Order"} · ${fresh[0].displayNum}`
            : `${fresh.length} orders ready at the pass`);
        }
      }
      seen.current = new Set(ready.map((o) => o.id));
      setBoard({ ready, served: Array.isArray(b.served) ? b.served : [], cooking: Number(b.cooking) || 0 });
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 15000);
    window.addEventListener("pointerdown", unlockAudio);
    return () => { clearInterval(t); clearInterval(c); window.removeEventListener("pointerdown", unlockAudio); };
  }, [load]);

  async function act(o: Order, action: "serve" | "unserve") {
    setBusy(o.id);
    try {
      await apiPost<Order>(`/orders/${o.id}/${action}`, {});
      toast.push("ok", action === "serve"
        ? `${o.tableName || o.displayNum} served - order complete`
        : `${o.displayNum} is back on the Ready list`);
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
      load();
    }
  }

  if (loading) return <PageLoader label="Loading ready orders" />;

  return (
    <div>
      <PageHeader title="Serve" subtitle="Food the kitchen has marked Ready. Tap Served when it reaches the table - that completes the order." icon={HandPlatter}>
        <span className="pill pill-olive" title="Tickets the kitchen is still cooking">
          <ChefHat size={12} /> {board.cooking} cooking
        </span>
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      {!board.ready.length ? (
        <EmptyState
          title="Nothing waiting to be served"
          hint={board.cooking
            ? `${board.cooking} ticket${board.cooking === 1 ? " is" : "s are"} still cooking - you'll hear a chime when food is ready.`
            : "When the kitchen marks food ready it appears here with a chime."}
          icon={<BellRing size={34} />}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
          {board.ready.map((o) => {
            const waited = minsSince(o.readyAt || o.createdAt, now);
            return (
              <div key={o.id} className="gb-card overflow-hidden flex flex-col"
                style={waited >= 10 ? { borderColor: "var(--bad)", borderWidth: 2 } : {}}>
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-2" style={{ background: "var(--ok-wash)" }}>
                  <div className="min-w-0">
                    <div className="font-semibold text-[17px] text-ink leading-tight truncate">{o.tableName || "No table"}</div>
                    <div className="text-[12px] text-muted">
                      {o.displayNum}{o.orderType && o.orderType !== "dine-in" && <> · <span className="capitalize">{o.orderType}</span></>}
                      {o.customerName && <> · {o.customerName}</>}
                    </div>
                  </div>
                  <span className={`pill ${waited >= 10 ? "pill-bad" : waited >= 5 ? "pill-warn" : "pill-ok"}`} title="Minutes since the kitchen marked it ready">
                    <Timer size={11} />{waited}m
                  </span>
                </div>

                <div className="p-3 flex flex-col gap-1 flex-1">
                  {o.items.map((it, i) => (
                    <div key={i} className="text-[13.5px] text-ink">
                      <span className="font-semibold">{it.qty}×</span> {it.name}
                      {it.modifiers?.map((m, j) => <div key={j} className="text-[11px] text-muted pl-5">+ {m.option}</div>)}
                      {it.notes && <div className="text-[11px] italic pl-5" style={{ color: "var(--olive-700)" }}>“{it.notes}”</div>}
                    </div>
                  ))}
                  {o.note && <div className="text-[12px] mt-1" style={{ color: "var(--olive-700)" }}>Note: {o.note}</div>}
                </div>

                <div className="p-2.5 border-t border-line-soft">
                  <button disabled={busy === o.id} onClick={() => act(o, "serve")}
                    className="btn btn-olive btn-lg w-full" style={{ background: "var(--ok)", borderColor: "var(--ok)" }}>
                    <Check size={17} /> {busy === o.id ? "Saving…" : "Served"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {board.served.length > 0 && (
        <div className="mt-6">
          <div className="text-[12px] font-semibold uppercase tracking-wider text-muted mb-2">Served in the last 3 hours</div>
          <div className="gb-card divide-y" style={{ borderColor: "var(--line-soft)" }}>
            {board.served.map((o) => {
              const canUndo = boss || (o.servedById === user?.id && now - parseTime(o.dispatchedAt) < UNDO_MS);
              return (
                <div key={o.id} className="px-3.5 py-2.5 flex items-center gap-3 text-[13px]" style={{ borderColor: "var(--line-soft)" }}>
                  <span className="text-muted w-16 shrink-0">{clock(o.dispatchedAt)}</span>
                  <span className="font-semibold text-ink truncate">{o.tableName || "-"}</span>
                  <span className="text-muted">{o.displayNum}</span>
                  <span className="ml-auto text-muted truncate">{o.servedById === user?.id ? "by you" : `by ${o.servedByName || "staff"}`}</span>
                  {canUndo && (
                    <button disabled={busy === o.id} onClick={() => act(o, "unserve")} className="btn btn-ghost btn-sm" title="Mistake? Put it back on the Ready list">
                      <RotateCcw size={13} /> Undo
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
