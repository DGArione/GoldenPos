"use client";
// Reports → "Daily card & cash bills": prints the two end-of-day slips
// (card bills, cash bills) on the bill printer. The same slips print
// automatically every night at the time set in Settings → Printer management.
import { useState } from "react";
import { Printer, CreditCard, Banknote } from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { sendToConfiguredPrinter } from "@/lib/printing";
import { printHtmlSilently } from "@/lib/receipt";
import { Modal, useToast } from "@/components/ui";

interface Line { orderNum: string; time: string; table: string; amount: number; serviceCharge?: number; refund?: boolean }
interface DailyBills { date: string; card: Line[]; cash: Line[]; cardTotal: number; cashTotal: number; cardServiceCharge?: number; cashServiceCharge?: number; cardText: string; cashText: string }

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export default function DailyBillsButton() {
  const settings = useSettings();
  const toast = useToast();
  const currency = settings?.currencySymbol || "Rs. ";
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [data, setData] = useState<DailyBills | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(d: string) {
    setData(null);
    try { setData(await apiGet<DailyBills>(`/reports/daily-bills?date=${d}`)); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Could not load the daily bills"); }
  }

  async function print() {
    if (!data) return;
    setBusy(true);
    try {
      const a = await sendToConfiguredPrinter(settings, { type: "report", title: `Daily card bills ${data.date}`, text: data.cardText, printerRole: "payment" });
      const b = a && await sendToConfiguredPrinter(settings, { type: "report", title: `Daily cash bills ${data.date}`, text: data.cashText, printerRole: "payment" });
      if (a && b) { toast.push("ok", `Card and cash bills for ${data.date} sent to ${settings?.paymentPrinterName}`); setOpen(false); return; }
      // No bill printer set up (or it didn't answer): use the normal print window.
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: 80mm auto; margin: 4mm; } body { margin: 0; }
        pre { font: 11px/1.35 "Courier New", monospace; white-space: pre; margin: 0; }
        .slip { page-break-after: always; } .slip:last-child { page-break-after: auto; }
      </style></head><body><div class="slip"><pre>${esc(data.cardText)}</pre></div><div class="slip"><pre>${esc(data.cashText)}</pre></div></body></html>`;
      const ok = await printHtmlSilently(html);
      toast.push(ok ? "ok" : "bad", ok ? "Bill printer not set up - opened the print window instead" : "Could not print");
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setDate(today()); load(today()); }} className="btn btn-primary btn-sm" title="Print today's card bills and cash bills">
        <Printer size={14} /> Daily card &amp; cash bills
      </button>
      {open && (
        <Modal open title="Daily card & cash bills" onClose={() => setOpen(false)} width={460}>
          <label className="lbl">Date</label>
          <input type="date" className="inp w-full" value={date} max={today()} onChange={(e) => { setDate(e.target.value); if (e.target.value) load(e.target.value); }} />
          {!data ? <p className="text-[12px] text-muted mt-4">Loading…</p> : (
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                <div className="flex items-center gap-2 text-[12px] text-muted"><CreditCard size={14} /> Card bills</div>
                <div className="mono text-[18px] font-bold mt-1 text-ink">{money(data.cardTotal, currency)}</div>
                <div className="text-[11px] text-muted">{data.card.length} bill{data.card.length === 1 ? "" : "s"} · service charge {money(data.cardServiceCharge || 0, currency)}</div>
              </div>
              <div className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                <div className="flex items-center gap-2 text-[12px] text-muted"><Banknote size={14} /> Cash bills</div>
                <div className="mono text-[18px] font-bold mt-1 text-ink">{money(data.cashTotal, currency)}</div>
                <div className="text-[11px] text-muted">{data.cash.length} bill{data.cash.length === 1 ? "" : "s"} · service charge {money(data.cashServiceCharge || 0, currency)}</div>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted mt-3">Prints two slips on the bill printer: card bills and cash bills, each with order number, time, table, service charge and amount, plus the service charge total and the grand total.</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Close</button>
            <button className="btn btn-primary" disabled={!data || busy} onClick={print}><Printer size={14} /> {busy ? "Printing…" : "Print both"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
