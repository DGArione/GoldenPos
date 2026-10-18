"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, LogIn, LogOut, History as HistoryIcon } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, Screen, useToast } from "@/components/ui";

interface Shift {
  id: number;
  userId: number;
  userName?: string;
  clockIn: string;
  clockOut: string | null;
  hours?: number;
}

export default function TimeclockPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [o, h] = await Promise.all([
        apiGet<Shift | null>(`/shifts/open/${user.id}`),
        apiGet<Shift[]>(`/shifts?userId=${user.id}`),
      ]);
      setOpen(o && o.id ? o : null);
      setHistory(Array.isArray(h) ? h : []);
    } catch { /* keep last */ }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    load();
    const t = setInterval(() => setTick(Date.now()), 1000);
    const r = setInterval(load, 15000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [load]);

  async function toggle() {
    if (!user || busy) return;
    setBusy(true);
    try {
      await apiPost(open ? "/shifts/clockout" : "/shifts/clockin", { userId: user.id });
      toast.push("ok", open ? "Clocked out" : "Clocked in");
      await load();
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  if (!user) return null;
  if (loading) return <PageLoader label="Loading shift" />;

  // Running duration display (HH:MM:SS)
  let runningSecs = 0;
  if (open) runningSecs = Math.max(0, Math.floor((tick - new Date(open.clockIn).getTime()) / 1000));
  const h = String(Math.floor(runningSecs / 3600)).padStart(2, "0");
  const m = String(Math.floor((runningSecs % 3600) / 60)).padStart(2, "0");
  const s = String(runningSecs % 60).padStart(2, "0");

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Time Clock" subtitle={`Shift tracking for ${user.name}`} icon={Clock} />

        <div className="flex flex-col items-center gap-5 py-6">
          <div
            className="mono text-[64px] font-semibold leading-none"
            style={{ color: open ? "var(--olive-text)" : "var(--muted)", letterSpacing: "-0.03em" }}
          >
            {h}:{m}:{s}
          </div>

          <p className="text-sm text-muted">
            {open
              ? `Clocked in at ${new Date(open.clockIn).toLocaleTimeString()}`
              : "Not currently clocked in"}
          </p>

          <button
            onClick={toggle}
            disabled={busy}
            className={open ? "btn btn-danger btn-lg" : "btn btn-primary btn-lg"}
            style={{ minWidth: 200 }}
          >
            {open ? <LogOut size={18} /> : <LogIn size={18} />}
            {busy ? "…" : open ? "Clock out" : "Clock in"}
          </button>
        </div>
      </Screen>

      <Screen>
        <div className="flex items-center gap-2 mb-4">
          <HistoryIcon size={17} style={{ color: "var(--olive-text)" }} />
          <h2 className="text-[15px] font-semibold text-ink">Recent shifts</h2>
        </div>

        {!history.length ? (
          <EmptyState title="No shifts yet" hint="Your clock-ins will appear here." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {history.slice(0, 15).map((sh) => {
              const inStr  = new Date(sh.clockIn).toLocaleString();
              const outStr = sh.clockOut ? new Date(sh.clockOut).toLocaleTimeString() : "—";
              const hours = sh.clockOut
                ? ((new Date(sh.clockOut).getTime() - new Date(sh.clockIn).getTime()) / 3600000).toFixed(2) + "h"
                : "in progress";
              return (
                <div
                  key={sh.id}
                  className="flex items-center justify-between rounded-xl px-4 py-2.5 text-[13px]"
                  style={{ background: "var(--panel-2)" }}
                >
                  <span>
                    <span className="text-ink font-medium">{inStr}</span>
                    <span className="text-muted"> → {outStr}</span>
                  </span>
                  <span
                    className="mono font-semibold"
                    style={{ color: sh.clockOut ? "var(--olive-700)" : "var(--ok-ink)" }}
                  >
                    {hours}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Screen>
    </div>
  );
}
