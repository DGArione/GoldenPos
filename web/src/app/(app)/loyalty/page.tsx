"use client";

import { useEffect, useState } from "react";
import { Star, TrendingUp, Gift, Settings as SettingsIcon, History as HistoryIcon } from "lucide-react";
import { apiGet, apiPut } from "@/lib/api";
import { useSettings, money } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface TopCust { id: number; name?: string; phone?: string; loyaltyPoints: number }
interface Ledger { id: number; type: string; points: number; phone?: string; note?: string; byStaffName?: string; createdAt?: string }
interface Settings { loyaltyEarnPoints: number; loyaltyEarnPer: number; loyaltyRedeemValue: number; loyaltyMinRedeem: number }
interface Report { top: TopCust[]; issued: number; redeemed: number; recent: Ledger[]; settings: Settings }

export default function LoyaltyPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [r, setR] = useState<Report | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const load = () => apiGet<Report>("/loyalty/report").then(setR).catch(() => {});
  useEffect(() => { load(); }, []);

  if (!r) return <PageLoader label="Loading loyalty" />;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader
          title="Loyalty"
          subtitle={`Earn ${r.settings.loyaltyEarnPoints} pt per ${currency}${r.settings.loyaltyEarnPer} · ${currency}${r.settings.loyaltyRedeemValue} per point`}
          icon={Star}
        >
          <button onClick={() => setEditOpen(true)} className="btn btn-ghost btn-sm">
            <SettingsIcon size={14} /> Rules
          </button>
        </PageHeader>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Tile icon={<Star size={16} />}       label="Points issued"    value={String(Math.round(r.issued))} accent />
          <Tile icon={<Gift size={16} />}       label="Points redeemed"  value={String(Math.round(r.redeemed))} />
          <Tile icon={<TrendingUp size={16} />} label="Members"          value={String(r.top.length)} />
        </div>
      </Screen>

      <div className="grid lg:grid-cols-5 gap-3">
        <Screen className="lg:col-span-2">
          <h2 className="text-[15px] font-semibold text-ink mb-4 flex items-center gap-2">
            <Star size={15} style={{ color: "var(--olive-text)" }} /> Top members
          </h2>
          {!r.top.length ? (
            <EmptyState title="No members yet" hint="Points accrue when a customer is attached to a paid order." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {r.top.map((c, i) => (
                <div
                  key={c.id || i}
                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                  style={{ background: "var(--panel-2)" }}
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold"
                    style={{ background: "var(--olive)", color: "var(--on-accent)" }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">
                      {c.name || c.phone || "Guest"}
                    </div>
                    {c.phone && c.name && <div className="text-[11px] text-muted truncate">{c.phone}</div>}
                  </div>
                  <span className="pill pill-clay">{Math.round(c.loyaltyPoints)} pts</span>
                </div>
              ))}
            </div>
          )}
        </Screen>

        <Screen className="lg:col-span-3">
          <h2 className="text-[15px] font-semibold text-ink mb-4 flex items-center gap-2">
            <HistoryIcon size={15} style={{ color: "var(--olive-text)" }} /> Recent activity
          </h2>
          {!r.recent.length ? (
            <EmptyState title="No activity yet" hint="Earn and redeem events will show here." />
          ) : (
            <div className="flex flex-col gap-1">
              {r.recent.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-[12.5px]"
                  style={{ background: "var(--panel-2)" }}
                >
                  <span className={`pill ${l.type === "earn" ? "pill-ok" : l.type === "redeem" ? "pill-info" : "pill-warn"}`}>
                    {({ earn: "earned", redeem: "spent", return: "given back", reverse: "taken back", adjust: "adjusted" } as Record<string, string>)[l.type] || l.type}
                  </span>
                  <span
                    className="mono font-semibold"
                    style={{ color: l.points >= 0 ? "var(--ok-ink)" : "var(--bad-ink)" }}
                  >
                    {l.points >= 0 ? "+" : ""}{Math.round(l.points)} pts
                  </span>
                  <span className="text-muted flex-1 truncate">
                    {l.phone || l.note || "—"}
                  </span>
                  <span className="text-muted text-[11px] whitespace-nowrap">
                    {(l.createdAt || "").replace("T", " ").slice(0, 16)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Screen>
      </div>

      {editOpen && (
        <RulesEditor
          current={r.settings}
          currency={currency}
          onClose={() => setEditOpen(false)}
          onDone={() => { setEditOpen(false); load(); toast.push("ok", "Rules updated"); }}
        />
      )}
    </div>
  );
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  const bg = accent ? "var(--olive)" : "var(--panel-2)";
  const fg = accent ? "var(--on-accent)" : "var(--ink)";
  const iconColor = accent ? "var(--on-accent)" : "var(--olive-text)";
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: iconColor }}>
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[20px] font-semibold leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function RulesEditor({ current, currency, onClose, onDone }: { current: Settings; currency: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    loyaltyEarnPoints:  String(current.loyaltyEarnPoints || 1),
    loyaltyEarnPer:     String(current.loyaltyEarnPer || 100),
    loyaltyRedeemValue: String(current.loyaltyRedeemValue || 1),
    loyaltyMinRedeem:   String(current.loyaltyMinRedeem || 0),
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await apiPut("/loyalty/settings", {
        loyaltyEarnPoints:  Number(f.loyaltyEarnPoints)  || 0,
        loyaltyEarnPer:     Number(f.loyaltyEarnPer)     || 100,
        loyaltyRedeemValue: Number(f.loyaltyRedeemValue) || 0,
        loyaltyMinRedeem:   Number(f.loyaltyMinRedeem)   || 0,
      });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title="Loyalty rules" onClose={onClose} width={460}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Points earned</label>
            <input className="inp mono" value={f.loyaltyEarnPoints} onChange={(e) => setF({ ...f, loyaltyEarnPoints: e.target.value })} /></div>
          <div><label className="lbl">Per spent ({currency.trim()})</label>
            <input className="inp mono" value={f.loyaltyEarnPer} onChange={(e) => setF({ ...f, loyaltyEarnPer: e.target.value })} /></div>
          <div><label className="lbl">Value of 1 point ({currency.trim()})</label>
            <input className="inp mono" value={f.loyaltyRedeemValue} onChange={(e) => setF({ ...f, loyaltyRedeemValue: e.target.value })} /></div>
          <div><label className="lbl">Min pts to redeem</label>
            <input className="inp mono" value={f.loyaltyMinRedeem} onChange={(e) => setF({ ...f, loyaltyMinRedeem: e.target.value })} /></div>
        </div>
        <p className="text-[11.5px] text-muted">
          Example: 1 point per {currency}100 means a {money(1000, currency)} order earns 10 points,
          worth {money(10 * Number(f.loyaltyRedeemValue || 1), currency)} off the next bill.
        </p>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : "Save rules"}
        </button>
      </div>
    </Modal>
  );
}
