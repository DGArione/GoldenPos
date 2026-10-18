"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HomeBanner } from "@/lib/settings";

/**
 * Rotating promotional banner carousel from Golden POS.
 * Shows a dish, promo or house message at the top of the home page.
 * Auto-advances every 6s; arrows to flip through manually.
 */
export function Banners({ banners }: { banners?: HomeBanner[] }) {
  const list = (banners || []).filter((b) => b.title || b.body);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (list.length < 2) return;
    const t = setInterval(() => setI((prev) => (prev + 1) % list.length), 6000);
    return () => clearInterval(t);
  }, [list.length]);

  if (!list.length) return null;

  const banner = list[i];
  const color = banner.color || "var(--olive)";

  return (
    <section
      className="relative rounded-[var(--r-2xl)] overflow-hidden gb-enter"
      style={{
        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, black))`,
        color: "#ffffff",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-center min-h-[160px]">
        <div className="flex-1 min-w-0 p-6 md:p-8">
          <div className="text-[11px] uppercase tracking-wider font-semibold opacity-80 mb-2">
            Today
          </div>
          <h2 className="text-[22px] md:text-[28px] font-semibold leading-tight">
            {banner.title}
          </h2>
          {banner.body && (
            <p className="text-[13px] md:text-[14px] opacity-90 mt-2 max-w-lg leading-relaxed">
              {banner.body}
            </p>
          )}
          {banner.ctaLabel && banner.ctaHref && (
            <Link
              href={banner.ctaHref}
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors"
              style={{ background: "rgba(255,255,255,0.2)", color: "#ffffff" }}
            >
              {banner.ctaLabel} →
            </Link>
          )}
        </div>

        {banner.imageUrl && (
          <img
            src={banner.imageUrl}
            alt=""
            className="hidden md:block h-40 w-40 object-cover shrink-0 rounded-xl mr-6"
          />
        )}
      </div>

      {/* decorative circles */}
      <div
        className="absolute -right-16 -top-16 h-48 w-48 rounded-full"
        style={{ background: "rgba(255,255,255,.08)" }}
        aria-hidden="true"
      />

      {/* arrows + dots when there's more than one */}
      {list.length > 1 && (
        <>
          <button
            onClick={() => setI((prev) => (prev - 1 + list.length) % list.length)}
            aria-label="Previous banner"
            className="absolute left-2 top-1/2 -translate-y-1/2 size-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
            style={{ background: "rgba(255,255,255,.1)" }}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setI((prev) => (prev + 1) % list.length)}
            aria-label="Next banner"
            className="absolute right-2 top-1/2 -translate-y-1/2 size-9 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
            style={{ background: "rgba(255,255,255,.1)" }}
          >
            <ChevronRight size={18} />
          </button>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {list.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                aria-label={`Go to banner ${idx + 1}`}
                className="w-6 h-1 rounded-full transition-all"
                style={{ background: idx === i ? "#ffffff" : "rgba(255,255,255,.4)" }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
