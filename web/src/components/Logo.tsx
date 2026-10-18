"use client";

import { useSettings } from "@/lib/settings";
import { initials } from "@/lib/image";

/**
 * The restaurant's mark: the uploaded logo (Settings → Appearance) or, when
 * none is set, initials from the business name on the brand colour.
 * `onDark` = placed on a coloured/dark background (login brand panel).
 */
export function BrandMark({ size = 40, onDark = false, rounded = "rounded-xl" }: { size?: number; onDark?: boolean; rounded?: string }) {
  const settings = useSettings();
  const logo = settings?.logoUrl || "";
  const name = settings?.businessName || "";
  if (logo) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden ${rounded}`}
        style={{ width: size, height: size, background: "#fff", boxShadow: onDark ? "0 2px 8px rgba(0,0,0,.18)" : "inset 0 0 0 1px var(--line-soft)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={name ? `${name} logo` : "Logo"} className="h-full w-full object-contain" style={{ padding: Math.round(size * 0.08) }} />
      </span>
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center font-bold ${onDark ? "text-white" : "text-[color:var(--on-accent)]"} ${rounded}`}
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.38), letterSpacing: "-0.02em",
        background: onDark ? "rgba(255,255,255,.2)" : "var(--olive)",
        backdropFilter: onDark ? "blur(8px)" : undefined,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

// Kept for compatibility with older imports.
export function LogoMark({ size = 40 }: { size?: number }) {
  return <BrandMark size={size} rounded="rounded-2xl" />;
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  const settings = useSettings();
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={compact ? 32 : 40} />
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-ink">{settings?.businessName || "Restaurant"}</div>
          <div className="text-[10px] font-semibold tracking-wider text-muted uppercase mt-0.5">
            Restaurant · POS
          </div>
        </div>
      )}
    </div>
  );
}
