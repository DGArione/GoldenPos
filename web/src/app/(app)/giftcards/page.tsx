"use client";

import { useEffect, useState } from "react";
import { Gift, Plus, Search, Ban, CheckCircle2, Copy, Printer, History, Download } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { sendToConfiguredPrinter } from "@/lib/printing";
import { printHtmlSilently } from "@/lib/receipt";
import { code128DataUrl, code128Svg } from "@/lib/barcode";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface GiftCard {
  id: number;
  code: string;
  initialBalance: number;
  balance: number;
  status: "active" | "disabled";
  recipientName?: string;
  note?: string;
  issuedByName?: string;
  createdAt?: string;
}
interface Report { count: number; issued: number; outstanding: number; redeemed: number }
export interface LedgerEntry {
  id: number; cardId: number; code: string; orderId: number | null; orderNum: string;
  type: string; amount: number; balanceAfter: number | null; byStaffName: string; note: string; createdAt: string;
}
const TYPE_LABEL: Record<string, string> = {
  issue: "Issued", redeem: "Used to pay", refund: "Refunded to card",
  "void-return": "Returned (order voided)", disable: "Card disabled", enable: "Card re-enabled",
};
const when = (s: string) => { const d = new Date(s.includes("T") ? s : s.replace(" ", "T")); return isNaN(d.getTime()) ? s : d.toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); };

function toCsv(rows: LedgerEntry[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Date", "Card", "What happened", "Order", "Amount", "Balance after", "By", "Note"];
  const body = rows.map((r) => [r.createdAt, r.code, TYPE_LABEL[r.type] || r.type, r.orderNum || (r.orderId ? "#" + r.orderId : ""), r.amount, r.balanceAfter ?? "", r.byStaffName, r.note].map(esc).join(","));
  return [head.map(esc).join(","), ...body].join("\r\n");
}
function downloadCsv(name: string, rows: LedgerEntry[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function GiftCardsPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [list, setList] = useState<GiftCard[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState(false);
  const [history, setHistory] = useState<GiftCard | null>(null);
  const [activity, setActivity] = useState<LedgerEntry[] | null>(null);
  const { user } = useAuth();
  const canSeeAll = !!user && ["manager", "superManager", "admin", "finance"].includes(user.role);

  const load = () => {
    setLoading(true);
    Promise.all([apiGet<GiftCard[]>("/giftcards"), apiGet<Report>("/giftcards/report")])
      .then(([l, r]) => { setList(Array.isArray(l) ? l : []); setReport(r); })
      .catch(() => {})
      .finally(() => setLoading(false));
    if (canSeeAll) apiGet<LedgerEntry[]>("/giftcards/ledger?limit=200").then((a) => setActivity(Array.isArray(a) ? a : [])).catch(() => setActivity([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [canSeeAll]);

  async function toggle(c: GiftCard) {
    try {
      const u = await apiPost<GiftCard>(`/giftcards/${c.id}/toggle`);
      setList((p) => p.map((x) => (x.id === u.id ? u : x)));
      toast.push("ok", `${c.code} ${u.status === "active" ? "re-enabled" : "disabled"}`);
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  function copyCode(code: string) {
    try { navigator.clipboard.writeText(code); toast.push("ok", `${code} copied`); }
    catch { toast.push("bad", "Could not copy"); }
  }

  // Prints ONLY a large, easy-to-scan barcode (+ the code under it).
  // Thermal printer first (native barcode = sharpest); silent browser print as fallback.
  async function printCard(c: GiftCard) {
    const sent = await sendToConfiguredPrinter(settings, {
      type: "barcode", title: "", text: c.code, barcodeData: c.code, printerRole: "payment", copies: 1,
    });
    if (sent) { toast.push("ok", `Barcode for ${c.code} sent to the printer`); return; }
    const svg = code128Svg(c.code, { module: 3, height: 110, fontSize: 22 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${c.code}</title>
      <style>@page { size: 80mm auto; margin: 4mm; } body { margin:0; text-align:center; }
      svg { width: 72mm; height: auto; }</style></head><body>${svg}</body></html>`;
    const ok = await printHtmlSilently(html);
    toast.push(ok ? "ok" : "bad", ok ? `Barcode for ${c.code} printed` : "Could not print — check the payment printer");
  }

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Gift Cards" subtitle={`${list.length} cards on file`} icon={Gift}>
          <button onClick={() => setLookup(true)} className="btn btn-ghost btn-sm"><Search size={14} /> Look up</button>
          <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm"><Plus size={14} /> New card</button>
        </PageHeader>

        {report && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Active cards"  value={String(report.count)} />
            <Tile label="Issued"       value={money(report.issued, currency)} accent />
            <Tile label="Outstanding"  value={money(report.outstanding, currency)} />
            <Tile label="Redeemed"     value={money(report.redeemed, currency)} />
          </div>
        )}
      </Screen>

      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4">Recent cards</h2>
        {loading ? <PageLoader /> : !list.length ? (
          <EmptyState title="No gift cards yet" hint="Create your first card above." icon={<Gift size={30} />} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((c) => (
              <div
                key={c.id}
                className="rounded-xl p-4 relative overflow-hidden"
                style={{
                  background: c.status === "active"
                    ? "linear-gradient(135deg, var(--olive) 0%, var(--olive-700) 100%)"
                    : "var(--panel-2)",
                  color: c.status === "active" ? "var(--on-accent)" : "var(--muted)",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="pill"
                      style={{
                        background: c.status === "active" ? "rgba(255,255,255,.2)" : "var(--bad-wash)",
                        color: c.status === "active" ? "var(--on-accent)" : "var(--bad-ink)",
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setHistory(c)}
                      className="opacity-80 hover:opacity-100"
                      title="History - every use of this card"
                    >
                      <History size={14} />
                    </button>
                    <button
                      onClick={() => printCard(c)}
                      className="opacity-80 hover:opacity-100"
                      title="Print barcode"
                    >
                      <Printer size={14} />
                    </button>
                    <button
                      onClick={() => toggle(c)}
                      className="opacity-80 hover:opacity-100"
                      title={c.status === "active" ? "Disable card" : "Re-enable card"}
                    >
                      {c.status === "active" ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                    </button>
                  </div>
                </div>
                <div className="mono text-[20px] font-semibold my-3">{money(c.balance, currency)}</div>
                {/* Scannable barcode (CODE128) */}
                <div className="rounded-md bg-white p-1.5 mb-2">
                  <img
                    src={code128DataUrl(c.code, { module: 2, height: 60, showText: false })}
                    alt={c.code}
                    className="w-full h-10 object-contain"
                    onError={(e) => { (e.currentTarget.style.display = "none"); }}
                  />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="font-mono text-[13px] tracking-wider">{c.code}</code>
                  <button
                    onClick={() => copyCode(c.code)}
                    className="opacity-70 hover:opacity-100"
                    title="Copy code"
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <div className="text-[11px] opacity-85">
                  of {money(c.initialBalance, currency)}
                  {c.recipientName && <> · for {c.recipientName}</>}
                </div>
                {c.note && <div className="text-[11px] opacity-70 italic mt-1">{c.note}</div>}
              </div>
            ))}
          </div>
        )}
      </Screen>

      {canSeeAll && (
        <Screen>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Gift card activity</h2>
              <p className="text-[12px] text-muted">Every issue, payment, refund and disable - newest first.</p>
            </div>
            {!!activity?.length && (
              <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`gift-card-activity-${new Date().toISOString().slice(0, 10)}.csv`, activity)}>
                <Download size={14} /> Download (Excel)
              </button>
            )}
          </div>
          {activity === null ? <PageLoader /> : !activity.length ? (
            <EmptyState title="No activity yet" hint="Card payments and refunds will be listed here." icon={<History size={28} />} />
          ) : <LedgerTable rows={activity} currency={currency} showCard onCard={(code) => { const c = list.find((x) => x.code === code); if (c) setHistory(c); }} />}
        </Screen>
      )}

      {history && <HistoryModal card={history} currency={currency} onClose={() => setHistory(null)} />}
      {open && <IssueModal currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); toast.push("ok", "Gift card issued"); }} />}
      {lookup && <LookupModal currency={currency} onClose={() => setLookup(false)} onHistory={(c) => { setLookup(false); setHistory(c); }} />}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  const bg = accent ? "var(--olive)" : "var(--panel-2)";
  const fg = accent ? "var(--on-accent)" : "var(--ink)";
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: accent ? "var(--on-accent)" : "var(--muted)", opacity: accent ? 0.85 : 1 }}>{label}</div>
      <div className="mono text-[19px] font-semibold mt-1 leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function IssueModal({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const n = Number(amount);
    if (!n || n <= 0) { toast.push("bad", "Amount is required"); return; }
    setBusy(true);
    try { await apiPost("/giftcards", { amount: n, recipientName, note }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title="Issue gift card" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div><label className="lbl">Amount ({currency.trim()})</label>
          <input className="inp mono text-[18px] text-right" inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="lbl">Recipient name (optional)</label>
          <input className="inp" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} /></div>
        <div><label className="lbl">Note (optional)</label>
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">{busy ? "Issuing…" : "Issue card"}</button>
      </div>
    </Modal>
  );
}

function LookupModal({ currency, onClose, onHistory }: { currency: string; onClose: () => void; onHistory: (c: GiftCard) => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [card, setCard] = useState<GiftCard | null>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    if (!code.trim()) return;
    setBusy(true); setCard(null);
    try { const g = await apiGet<GiftCard>(`/giftcards/lookup?code=${encodeURIComponent(code.toUpperCase().trim())}`); setCard(g); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Not found"); }
    finally { setBusy(false); }
  }
  return (
    <Modal open title="Look up card" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div><label className="lbl">Card code</label>
          <input className="inp mono uppercase tracking-widest" placeholder="GCXXXXXXXXXX" value={code} autoFocus
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && check()} /></div>
        <button onClick={check} disabled={busy} className="btn btn-primary w-full">{busy ? "Checking…" : "Check balance"}</button>
        {card && (
          <div className="rounded-xl p-4 mt-3" style={{ background: "var(--olive)", color: "var(--on-accent)" }}>
            <div className="text-[11px] uppercase tracking-wider opacity-80">Available balance</div>
            <div className="mono text-2xl font-semibold mt-1">{money(card.balance, currency)}</div>
            <div className="text-[11.5px] opacity-85 mt-1">
              of {money(card.initialBalance, currency)} · {card.status}
              {card.recipientName && <> · for {card.recipientName}</>}
            </div>
          </div>
        )}
        {card && (
          <button onClick={() => onHistory(card)} className="btn btn-ghost w-full"><History size={14} /> See every use of this card</button>
        )}
      </div>
    </Modal>
  );
}

function LedgerTable({ rows, currency, showCard, onCard }: { rows: LedgerEntry[]; currency: string; showCard?: boolean; onCard?: (code: string) => void }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-muted text-[11px] uppercase tracking-wider">
            <th className="py-2 px-1 font-semibold">When</th>
            {showCard && <th className="py-2 px-1 font-semibold">Card</th>}
            <th className="py-2 px-1 font-semibold">What happened</th>
            <th className="py-2 px-1 font-semibold">Order</th>
            <th className="py-2 px-1 font-semibold text-right">Amount</th>
            <th className="py-2 px-1 font-semibold text-right">Balance after</th>
            <th className="py-2 px-1 font-semibold">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line-soft align-top">
              <td className="py-2 px-1 whitespace-nowrap text-muted">{when(r.createdAt)}</td>
              {showCard && (
                <td className="py-2 px-1">
                  <button className="mono text-ink underline-offset-2 hover:underline" onClick={() => onCard?.(r.code)}>{r.code}</button>
                </td>
              )}
              <td className="py-2 px-1 text-ink">
                {TYPE_LABEL[r.type] || r.type}
                {r.note && <div className="text-[11px] text-muted">{r.note}</div>}
              </td>
              <td className="py-2 px-1 mono text-ink whitespace-nowrap">{r.orderNum || (r.orderId ? `#${r.orderId}` : "")}</td>
              <td className="py-2 px-1 mono text-right whitespace-nowrap font-semibold"
                style={{ color: r.amount < 0 ? "var(--bad-ink)" : r.amount > 0 ? "var(--ok-ink)" : "var(--muted)" }}>
                {r.amount === 0 ? "-" : `${r.amount > 0 ? "+" : "−"}${money(Math.abs(r.amount), currency)}`}
              </td>
              <td className="py-2 px-1 mono text-right whitespace-nowrap text-ink">{r.balanceAfter === null ? "" : money(r.balanceAfter, currency)}</td>
              <td className="py-2 px-1 text-muted">{r.byStaffName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryModal({ card, currency, onClose }: { card: GiftCard; currency: string; onClose: () => void }) {
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [cur, setCur] = useState<GiftCard>(card);
  const [error, setError] = useState("");
  useEffect(() => {
    apiGet<{ card: GiftCard; entries: LedgerEntry[] }>(`/giftcards/${card.id}/ledger`)
      .then((r) => { setRows(r.entries || []); if (r.card) setCur(r.card); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the history"));
  }, [card.id]);
  const used = rows ? rows.filter((r) => r.type === "redeem").reduce((a, r) => a - r.amount, 0) : 0;
  const back = rows ? rows.filter((r) => r.type === "refund" || r.type === "void-return").reduce((a, r) => a + r.amount, 0) : 0;
  return (
    <Modal open title={`Card ${cur.code}`} onClose={onClose} width={760}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <Tile label="Loaded" value={money(cur.initialBalance, currency)} />
        <Tile label="Used" value={money(used, currency)} />
        <Tile label="Put back" value={money(back, currency)} />
        <Tile label="Balance now" value={money(cur.balance, currency)} accent />
      </div>
      {error ? <p className="text-[13px]" style={{ color: "var(--bad-ink)" }}>{error}</p>
        : rows === null ? <PageLoader />
        : !rows.length ? <EmptyState title="No history recorded" hint="Cards issued before this update have no earlier record." icon={<History size={26} />} />
        : <>
            <LedgerTable rows={rows} currency={currency} />
            <div className="flex justify-end mt-3">
              <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(`gift-card-${cur.code}.csv`, rows)}><Download size={14} /> Download (Excel)</button>
            </div>
          </>}
    </Modal>
  );
}
