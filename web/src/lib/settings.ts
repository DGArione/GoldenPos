"use client";

import { useEffect, useState } from "react";
import { apiGet } from "./api";

export interface HomeBanner {
  title: string;
  body: string;
  color?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface PublicSettings {
  businessName: string;
  businessTagline: string;
  businessAddress: string;
  businessPhone: string;
  logoUrl: string;
  loginBgUrl?: string;
  loginPanelImageUrl?: string;
  accentColor?: string;
  currencySymbol: string;
  serviceChargeRate: number;
  vatRate: number;
  cardFeePercent: number;
  enabledAddons: string[];
  defaultOrderType: string;
  homeBanners?: HomeBanner[];
  /** Public base URL used for customer-facing QR links (menu / ordering). */
  publicBaseUrl?: string;
  qrOrderAutoKitchen?: boolean;
  printAgentUrl?: string;
  printAgentEnabled?: boolean;
  printPaperWidth?: number;
  kitchenPrinterName?: string;
  paymentPrinterName?: string;
  /** Windows printer used for table QR cards (Settings → Printer management). */
  qrPrinterName?: string;
}

/** Apply the brand accent colour from settings. Only --accent is set; every
 *  other brand shade (light + dark mode) is derived from it in globals.css.
 *  The choice is remembered so the next page load paints in it straight away. */
export function applyAccent(color?: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // clear per-shade overrides written by older versions
  ["--olive", "--brand", "--olive-700", "--olive-300", "--olive-wash", "--clay", "--brand-soft"].forEach((v) => root.style.removeProperty(v));
  const ok = !!color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color);
  if (ok) root.style.setProperty("--accent", color!);
  else root.style.removeProperty("--accent");          // back to Golden orange
  // Very light brand colours (yellow, mint...): dark text on brand buttons and
  // a darker brand shade for brand-coloured text (rules in globals.css).
  root.style.removeProperty("--on-accent");
  if (ok && isLight(color!)) root.setAttribute("data-accent-tone", "light");
  else root.removeAttribute("data-accent-tone");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", ok ? color! : "#f6990d");
  try { if (ok) localStorage.setItem("gb-accent", color!); else localStorage.removeItem("gb-accent"); } catch {}
}

/** True when white text would be hard to read on this colour. */
export function isLight(c: string): boolean {
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const lin = (i: number) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return L > 0.5;
}

let cache: PublicSettings | null = null;
let cacheAt = 0;
const MAX_AGE_MS = 15_000;   // other tills pick up colour/name/logo changes within ~15 s
const listeners = new Set<(s: PublicSettings) => void>();
let refresher: ReturnType<typeof setInterval> | null = null;
/** While Settings is open its unsaved colour preview must not be overwritten. */
let previewing = false;
export function setAccentPreview(on: boolean) { previewing = on; }

export async function fetchSettings(force = false): Promise<PublicSettings> {
  if (cache && !force && Date.now() - cacheAt < MAX_AGE_MS) return cache;
  const s = await apiGet<PublicSettings>("/public/settings");
  cache = s; cacheAt = Date.now();
  if (!previewing) applyAccent(s.accentColor);
  listeners.forEach((fn) => { try { fn(s); } catch {} });
  return s;
}

export function clearSettingsCache() { cache = null; cacheAt = 0; }

export function useSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(cache);
  useEffect(() => {
    let alive = true;
    fetchSettings().then((s) => alive && setSettings(s)).catch(() => {});
    const fn = (s: PublicSettings) => { if (alive) setSettings(s); };
    listeners.add(fn);
    if (!refresher && typeof window !== "undefined") {
      refresher = setInterval(() => {
        if (listeners.size && document.visibilityState === "visible") fetchSettings(true).catch(() => {});
      }, MAX_AGE_MS);
    }
    return () => { alive = false; listeners.delete(fn); };
  }, []);
  return settings;
}

/** Read the money value off an order discount, whether it's a number or a
 *  {amount} object (the backend returns the object form). */
export function discountAmount(d: number | { amount?: number } | null | undefined): number {
  if (!d) return 0;
  if (typeof d === "number") return d;
  return Number(d.amount) || 0;
}

export function money(amount: number, currency = "Rs. "): string {
  const n = Number(amount) || 0;
  const body = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${currency}${body}`;
}
