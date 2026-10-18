"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSettings, money } from "@/lib/settings";
import { visibleNav } from "@/lib/nav";
import { apiGet } from "@/lib/api";
import { Screen } from "@/components/ui";
import { Banners } from "@/components/Banners";
import { TodayPromotionsCard, useTodayPromotions } from "@/components/TodayPromotions";

interface DashSummary {
  totals?: {
    totalRevenue?: number;
    totalOrders?: number;
    totalKitchen?: number;
    totalOpenTables?: number;
  };
}

// Module accent colours (same palette as the Sidebar).
const MODULE_COLOR: Record<string, string> = {
  dashboard: "var(--olive)", branches: "#5b88fc", order: "var(--olive)", floor: "#f52121",
  kitchen: "#35c344", serve: "#2bc2a6", onlineorders: "#5b88fc", payment: "var(--olive)", menuadmin: "#d9772b",
  inventory: "#35c344", history: "#5b88fc", reports: "#9d61e8", timeclock: "#5b88fc",
  payroll: "#35c344", staff: "#7471f6", zreport: "#9d61e8", pettycash: "#e0a040",
  messages: "#5b88fc", customers: "#d9772b", auditlog: "#9d61e8", loyalty: "#e0a040",
  giftcards: "#f52121", promotions: "#d9772b", reservations: "#5b88fc",
};

export default function HomePage() {
  const { user } = useAuth();
  const settings = useSettings();
  const [sum, setSum] = useState<DashSummary | null>(null);

  const promos = useTodayPromotions();
  const items = user ? visibleNav(user.role, settings?.enabledAddons || []).filter((i) => i.key !== "settings") : [];

  useEffect(() => {
    apiGet<DashSummary>("/dashboard/summary").then(setSum).catch(() => {});
  }, []);

  const currency = settings?.currencySymbol || "Rs. ";
  const showStats =
    sum && (user?.role === "manager" || user?.role === "superManager" || user?.role === "finance");

  return (
    <div className="flex flex-col gap-3">
      {/* Promotional banners (from Settings → Home banners) */}
      <Banners banners={settings?.homeBanners} />

      {/* Hero / welcome */}
      <Screen className="relative overflow-hidden">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="eyebrow mb-2">
              {settings?.businessName || "Golden Beach Restaurant"}
            </div>
            <h1 className="text-[28px] md:text-[32px] font-semibold text-ink leading-tight">
              Welcome back, {user?.name?.split(" ")[0]}
            </h1>
            <p className="text-sm text-muted mt-2 max-w-md">
              Pick up where you left off — the house is yours.
            </p>
          </div>

          {showStats && (
            <div className="grid grid-cols-2 gap-3 min-w-[320px]">
              <MiniStat label="Sales today" value={money(sum!.totals?.totalRevenue || 0, currency)} accent />
              <MiniStat label="Orders"      value={String(sum!.totals?.totalOrders ?? 0)} />
              <MiniStat label="In kitchen"  value={String(sum!.totals?.totalKitchen ?? 0)} />
              <MiniStat label="Open tables" value={String(sum!.totals?.totalOpenTables ?? 0)} />
            </div>
          )}
        </div>

        {/* decorative blob */}
        <div
          className="absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, var(--olive) 0%, transparent 70%)" }}
          aria-hidden="true"
        />
      </Screen>

      {/* Today's promotions - every role sees them */}
      <TodayPromotionsCard list={promos} manageLink={user?.role === "manager" || user?.role === "superManager"} />

      {/* Quick access */}
      <Screen>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-ink">Quick access</h2>
          <span className="text-[11.5px] text-muted">{items.length} modules</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {items.map((item) => {
            const Icon = item.icon;
            const color = MODULE_COLOR[item.key] || "var(--olive)";
            return (
              <Link
                key={item.key}
                href={item.href}
                className="group relative flex flex-col gap-3 rounded-xl p-4 transition-all hover:shadow-md"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}
              >
                <span
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--muted)" }}
                >
                  <ArrowUpRight size={15} />
                </span>
                <span
                  className="flex size-10 items-center justify-center rounded-xl"
                  style={{
                    background: `color-mix(in srgb, ${color} 14%, transparent)`,
                    color,
                  }}
                >
                  <Icon size={18} strokeWidth={2.1} />
                </span>
                <span className="text-[13.5px] font-semibold text-ink leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </Screen>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: accent ? "var(--olive-wash)" : "var(--panel-2)",
        border: "1px solid var(--line-soft)",
      }}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div
        className="mono text-[19px] font-semibold mt-1 leading-none"
        style={{ color: accent ? "var(--olive-700)" : "var(--ink)" }}
      >
        {value}
      </div>
    </div>
  );
}
