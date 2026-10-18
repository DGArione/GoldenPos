"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { visibleNav, groupedNav } from "@/lib/nav";
import { BrandMark } from "@/components/Logo";

// Module accent colours.
const MODULE_COLOR: Record<string, string> = {
  dashboard:    "var(--olive)",
  branches:     "#5b88fc",
  order:        "var(--olive)",
  floor:        "#f52121",
  kitchen:      "#35c344",
  serve:        "#2bc2a6",
  onlineorders: "#5b88fc",
  payment:      "var(--olive)",
  menuadmin:    "#d9772b",
  inventory:    "#35c344",
  suppliers:    "#5b88fc",
  purchases:    "#9d61e8",
  history:      "#5b88fc",
  reports:      "#9d61e8",
  timeclock:    "#5b88fc",
  payroll:      "#35c344",
  staff:        "#7471f6",
  zreport:      "#9d61e8",
  pettycash:    "#e0a040",
  messages:     "#5b88fc",
  customers:    "#d9772b",
  auditlog:     "#9d61e8",
  loyalty:      "#e0a040",
  giftcards:    "#f52121",
  promotions:   "#d9772b",
  reservations: "#5b88fc",
  admin:        "#f52121",
  profile:      "#7471f6",
  settings:     "#515151",
};

type SidebarMode = "expanded" | "collapsed" | "auto";

export function Sidebar({ onLock }: { onLock?: () => void }) {
  const { user, logout } = useAuth();
  const settings = useSettings();
  const pathname = usePathname();
  const [mode, setMode] = useState<SidebarMode>("auto");

  if (!user) return null;
  const items = visibleNav(user.role, settings?.enabledAddons || []);
  const groups = groupedNav(items);

  const width   = mode === "expanded" ? "w-60"      : mode === "collapsed" ? "w-[76px]" : "w-[76px] xl:w-60";
  const center  = mode === "expanded" ? "justify-start" : mode === "collapsed" ? "justify-center" : "justify-center xl:justify-start";
  const wide    = mode === "expanded" ? "flex"   : mode === "collapsed" ? "hidden"   : "hidden xl:flex";
  const wideInl = mode === "expanded" ? "inline" : mode === "collapsed" ? "hidden"   : "hidden xl:inline";
  const wideBlk = mode === "expanded" ? "block"  : mode === "collapsed" ? "hidden"   : "hidden xl:block";
  const narrowOnly = mode === "expanded" ? "hidden" : mode === "collapsed" ? "flex" : "flex xl:hidden";

  function toggle() {
    const isWide =
      mode === "expanded" ||
      (mode === "auto" && typeof window !== "undefined" && window.matchMedia("(min-width:1280px)").matches);
    const next: SidebarMode = isWide ? "collapsed" : "expanded";
    setMode(next);
    try { localStorage.setItem("pos-sidebar", next); } catch {}
  }

  function handleLock() {
    if (onLock) onLock();
    else logout();
  }

  const businessName = settings?.businessName || "Golden Beach";

  return (
    <aside
      className={`flex shrink-0 flex-col rounded-[var(--r-2xl)] py-4 transition-[width] duration-200 ${width}`}
      style={{ background: "var(--panel)", boxShadow: "var(--shadow-sm)" }}
      aria-label="Main navigation"
    >
      {/* ---- Brand + toggle ---- */}
      <div className={`flex items-center gap-2 px-4 ${center}`}>
        <BrandMark size={44} />
        <span className={`min-w-0 flex-1 truncate text-[14px] font-semibold text-ink ${wideBlk}`}>
          {businessName}
        </span>
        <button
          onClick={toggle}
          aria-label="Collapse menu"
          className={`size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink transition-colors ${wide}`}
        >
          <PanelLeftClose size={17} />
        </button>
      </div>

      <button
        onClick={toggle}
        aria-label="Expand menu"
        className={`mx-auto mt-3 size-9 items-center justify-center rounded-lg text-muted hover:bg-panel-2 hover:text-ink transition-colors ${narrowOnly}`}
      >
        <PanelLeftOpen size={17} />
      </button>

      {/* ---- Nav sections ---- */}
      <nav className="scroll-thin mt-4 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {groups.map(({ section, items: sectionItems }) => (
          <div key={section} className="mb-2">
            <p className={`mb-1 mt-2 px-2 text-[10px] font-bold uppercase tracking-wider text-muted ${wideBlk}`}>
              {section}
            </p>
            {sectionItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              const color = MODULE_COLOR[item.key] || "var(--olive)";
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  className={`relative flex h-10 shrink-0 items-center gap-3 rounded-xl px-2 text-[13px] font-medium transition-colors ${center} ${
                    active ? "text-[color:var(--on-accent)]" : "text-muted hover:bg-panel-2 hover:text-ink"
                  }`}
                  style={active ? { background: "var(--olive)", boxShadow: `0 4px 14px -4px color-mix(in srgb, var(--olive) 60%, transparent)` } : {}}
                >
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      background: active ? "rgba(255,255,255,0.22)" : `color-mix(in srgb, ${color} 12%, transparent)`,
                      color: active ? "var(--on-accent)" : color,
                    }}
                  >
                    <Icon size={14} strokeWidth={2.2} />
                  </span>
                  <span className={`flex-1 leading-none ${wideInl}`}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ---- Terminal / lock ---- */}
      <div
        className="mx-3 mt-3 overflow-hidden rounded-xl text-white"
        style={{ background: "var(--kot)" }}
      >
        <div className={`px-4 pb-3 pt-4 ${wideBlk}`}>
          <p className="text-[12px] font-semibold leading-tight">{user.name}</p>
          <p className="text-[11px] opacity-75 mt-0.5 capitalize">{user.role}</p>
        </div>
        <button
          onClick={handleLock}
          title="Lock terminal"
          className={`flex w-full items-center justify-center gap-2 text-[12px] font-semibold transition-colors ${
            mode === "expanded"
              ? "mx-auto mb-3 h-9 w-[calc(100%-1.5rem)] rounded-lg bg-white/15 hover:bg-white/25"
              : mode === "collapsed"
                ? "h-10 bg-white/10 hover:bg-white/20"
                : "h-10 bg-white/10 hover:bg-white/20 xl:mx-auto xl:mb-3 xl:h-9 xl:w-[calc(100%-1.5rem)] xl:rounded-lg xl:bg-white/15 xl:hover:bg-white/25"
          }`}
        >
          <Lock size={14} />
          <span className={wideInl}>Log out</span>
        </button>
      </div>
    </aside>
  );
}
