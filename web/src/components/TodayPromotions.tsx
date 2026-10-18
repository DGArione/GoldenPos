"use client";

/*
 * Today's promotions for staff (every role, servers included).
 * Today's offers are highlighted; offers that run on other days are listed
 * underneath so staff know what is coming. Data: GET /promotions/today.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tag, Eye, EyeOff, CalendarDays } from "lucide-react";
import { apiGet } from "@/lib/api";

export interface StaffPromotion {
  id: number; name: string; headline: string; detail: string; note: string; type: string;
  items: { menuItemId: number; qty: number; name: string }[];
  days: number[]; availableToday: boolean; showToCustomers: boolean;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REFRESH_MS = 5 * 60 * 1000;

/** Active promotions for the current branch (refreshes every few minutes). */
export function useTodayPromotions() {
  const [list, setList] = useState<StaffPromotion[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => apiGet<{ promotions: StaffPromotion[] }>("/promotions/today")
      .then((r) => { if (alive) setList(Array.isArray(r?.promotions) ? r.promotions : []); })
      .catch(() => { if (alive) setList([]); });
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return list;
}

/** Ids of dishes that are part of an offer running today. */
export function todayOfferItemIds(list: StaffPromotion[] | null): Set<number> {
  return new Set((list || []).filter((p) => p.availableToday).flatMap((p) => p.items.map((i) => i.menuItemId)));
}

function daysText(days: number[]) {
  return days.length ? days.map((d) => DAY[d]).join(", ") : "Every day";
}

/** Card for the home page / dashboard. Renders nothing when there are no promotions. */
export function TodayPromotionsCard({ list, manageLink = false }: { list: StaffPromotion[] | null; manageLink?: boolean }) {
  if (!list || !list.length) return null;
  const today = list.filter((p) => p.availableToday);
  const later = list.filter((p) => !p.availableToday);
  return (
    <section className="gb-card p-4 md:p-5" aria-label="Promotions">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-[16px] font-semibold text-ink flex items-center gap-2">
          <Tag size={17} style={{ color: "var(--olive-text)" }} /> Today&apos;s promotions
          <span className="pill pill-olive" style={{ fontSize: 10.5 }}>{today.length}</span>
        </h2>
        {manageLink && <Link href="/promotions" className="text-[12.5px] font-semibold underline underline-offset-2" style={{ color: "var(--olive-text)" }}>Manage</Link>}
      </div>

      {today.length ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {today.map((p) => (
            <div key={p.id} className="rounded-xl p-3.5 flex flex-col gap-1"
              style={{ background: "var(--olive-wash)", border: "1.5px solid var(--olive)" }}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[19px] font-bold leading-tight" style={{ color: "var(--olive-700)" }}>{p.headline}</span>
                <span className="pill" title={p.showToCustomers ? "Customers see this on the QR menu" : "Staff only - not shown on the QR menu"}
                  style={{ fontSize: 10, background: "var(--panel)", color: p.showToCustomers ? "var(--ok-ink)" : "var(--muted)" }}>
                  {p.showToCustomers ? <><Eye size={10} /> On QR menu</> : <><EyeOff size={10} /> Staff only</>}
                </span>
              </div>
              <div className="text-[14px] font-semibold text-ink">{p.name}</div>
              <div className="text-[12.5px] text-muted leading-snug">{p.detail}</div>
              {p.days.length > 0 && <div className="text-[11.5px] text-muted flex items-center gap-1"><CalendarDays size={11} /> {daysText(p.days)}</div>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted">No promotion runs today.</p>
      )}

      {later.length > 0 && (
        <div className="mt-3 pt-3 border-t border-line-soft">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">Other days</div>
          <div className="flex flex-col gap-1">
            {later.map((p) => (
              <div key={p.id} className="text-[12.5px] text-muted flex flex-wrap gap-x-2">
                <span className="font-semibold text-ink">{p.name}</span>
                <span>{p.headline} · {daysText(p.days)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** One-line strip for Order Entry: today's offers only. */
export function TodayPromotionsStrip({ list }: { list: StaffPromotion[] | null }) {
  const today = (list || []).filter((p) => p.availableToday);
  if (!today.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "thin" }} aria-label="Today's promotions">
      <span className="flex items-center gap-1 text-[11.5px] font-bold uppercase tracking-wider shrink-0" style={{ color: "var(--olive-text)" }}>
        <Tag size={13} /> Today
      </span>
      {today.map((p) => (
        <div key={p.id} title={p.detail} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] leading-tight"
          style={{ background: "var(--olive-wash)", border: "1px solid var(--olive)" }}>
          <span className="font-bold" style={{ color: "var(--olive-700)" }}>{p.headline}</span>
          <span className="text-ink font-semibold"> · {p.name}</span>
          <span className="text-muted"> · {p.detail}</span>
        </div>
      ))}
    </div>
  );
}
