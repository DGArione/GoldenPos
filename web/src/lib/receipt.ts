// Classic 80mm thermal receipt / retail bill printer.
// Produces a real-looking printed bill (not a fancy A4 invoice): business
// header, invoice meta, itemised table, totals, cash/change, tax line, footer.

import type { Order } from "./types";
import type { PublicSettings } from "./settings";
import { sendToConfiguredPrinter, openCashDrawer, agentReady } from "./printing";
import { code128DataUrl } from "./barcode";

interface ReceiptOptions {
  /** cash the customer handed over (optional — shows Tendered + Balance) */
  tendered?: number;
  /** "REPRINT" badge when it's not the original */
  reprint?: boolean;
  /** 58 for narrow printers, 80 for standard (mm) */
  paper?: 58 | 80;
  /** pulse the cash drawer (embedded in the same print job when possible) */
  openDrawer?: boolean;
}

export interface PrintResult {
  printed: boolean;
  via: "agent" | "browser" | "none";
  drawerOpened: boolean;
}

/** Silent browser print through a hidden iframe — no pop-up window, no alert.
 *  With Chrome started in --kiosk-printing mode this prints straight to the
 *  Windows default printer with no dialog. */
export function printHtmlSilently(html: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
      let done = false;
      const finish = (ok: boolean) => { if (done) return; done = true; setTimeout(() => { try { frame.remove(); } catch {} }, 1500); resolve(ok); };
      frame.onload = () => {
        setTimeout(() => {
          try { frame.contentWindow?.focus(); frame.contentWindow?.print(); finish(true); } catch { finish(false); }
        }, 150);
      };
      frame.srcdoc = html;
      document.body.appendChild(frame);
      setTimeout(() => finish(false), 10000);
    } catch { resolve(false); }
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export async function printReceipt(o: Order, settings: Partial<PublicSettings> & { receiptFooterText?: string; taxRegNo?: string } | null, opts: ReceiptOptions = {}): Promise<PrintResult> {

  const cur = settings?.currencySymbol || "Rs. ";
  const biz = settings?.businessName || "Restaurant";
  const widthMm = opts.paper === 58 ? 58 : 80;

  // Gift card part-payments reduce what the customer pays in cash/card.
  const giftPaid = ((o as { payments?: Array<{ method?: string; amount?: number }> }).payments || [])
    .filter((p) => p.method === "giftcard").reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const money = (n: number) => `${cur}${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // 1) Direct thermal print through the local agent (no window, no dialog).
  //    The drawer kick travels inside the same job, so it opens instantly.
  if (settings && agentReady(settings, "payment")) {
    const width = Number(settings.printPaperWidth) || (widthMm === 58 ? 32 : 48);
    const pad = (left: string, right: string) => left + " ".repeat(Math.max(1, width - left.length - right.length)) + right;
    const text: string[] = [];
    text.push(biz.toUpperCase());
    if (settings.businessTagline) text.push(settings.businessTagline);
    if (settings.businessAddress) text.push(settings.businessAddress);
    if (settings.businessPhone) text.push("Tel: " + settings.businessPhone);
    text.push("=".repeat(width), `Bill: ${o.displayNum || o.id}`, `Date: ${(o.createdAt || new Date().toISOString()).replace("T", " ").slice(0, 16)}`);
    text.push(`Type: ${o.orderType || ""}${o.tableName ? " · " + o.tableName : ""}`, "-".repeat(width));
    (o.items || []).forEach((it) => {
      // Full item name: if it doesn't fit beside the price, wrap it and put the price on the last line.
      const label = `${it.qty}x ${it.name}`;
      const price = money(it.lineTotal);
      const room = width - price.length - 1;
      if (label.length <= room) { text.push(pad(label, price)); }
      else {
        const words = label.split(/\s+/); const rows: string[] = []; let cur = "";
        for (const w of words) { if (!cur) cur = w; else if ((cur + " " + w).length <= width) cur += " " + w; else { rows.push(cur); cur = "   " + w; } }
        if (cur.length <= room) rows.push(pad(cur, price)); else { rows.push(cur); rows.push(pad("", price)); }
        text.push(...rows);
      }
      (it.modifiers || []).forEach((m) => text.push(`  + ${m.option}`));
    });
    text.push("-".repeat(width), pad("Subtotal", money(o.subtotal)));
    const disc = typeof o.discount === "number" ? o.discount : Number((o.discount as { amount?: number } | null)?.amount) || 0;
    if (disc > 0) text.push(pad("Discount", "-" + money(disc)));
    if (o.serviceCharge > 0) text.push(pad("Service charge", money(o.serviceCharge)));
    if (o.vat > 0) text.push(pad("VAT / Tax", money(o.vat)));
    text.push("=".repeat(width), pad("TOTAL", money(o.grandTotal || o.total)), "=".repeat(width));
    // Payments already taken (gift card, part payments) so the deduction is visible.
    const pays = ((o as { payments?: Array<{ method?: string; amount?: number; code?: string; type?: string }> }).payments || []).filter((p) => p.type !== "refund");
    const giftLines = pays.filter((p) => p.method === "giftcard");
    giftLines.forEach((p) => text.push(pad(`Gift card ${p.code ? "*" + String(p.code).slice(-4) : ""}`.trim(), "-" + money(Number(p.amount) || 0))));
    if (giftLines.length) {
      const giftSum = giftLines.reduce((a, p) => a + (Number(p.amount) || 0), 0);
      text.push(pad("Balance paid", money(Math.max(0, (o.grandTotal || o.total) - giftSum))));
    }
    if (opts.reprint) text.splice(0, 0, "*** REPRINT ***");
    if (opts.tendered != null) { text.push(pad("Cash tendered", money(opts.tendered))); text.push(pad("Change", money(Math.max(0, opts.tendered - ((o.grandTotal || o.total) - giftPaid))))); }
    text.push("", settings.receiptFooterText || "Thank you — please come again!", "", "Powered by RapidSolutions", "");
    const sent = await sendToConfiguredPrinter(settings, { type: "receipt", title: `Bill ${o.displayNum || o.id}`, text: text.join("\n"), printerRole: "payment", copies: 1, barcodeData: String((o as { id?: number | string }).id ?? o.displayNum ?? "0").replace(/[^A-Za-z0-9]/g, "") || "0", openDrawer: !!opts.openDrawer });
    if (sent) return { printed: true, via: "agent", drawerOpened: !!opts.openDrawer };
    console.warn("[print] payment printer unreachable — falling back to silent browser print");
  }

  // 2) Fallback: silent browser print (hidden iframe) + separate drawer kick.
  const itemRows = o.items.map((it) => {
    const mods = (it.modifiers || []).map((m) =>
      `<tr><td></td><td class="mod" colspan="3">+ ${esc(m.option)}${m.priceDelta ? ` (${money(m.priceDelta)})` : ""}</td></tr>`
    ).join("");
    const note = it.notes ? `<tr><td></td><td class="note" colspan="3">» ${esc(it.notes)}</td></tr>` : "";
    const unit = it.qty ? it.lineTotal / it.qty : it.lineTotal;
    return (
      `<tr class="ln">
        <td class="q">${it.qty}</td>
        <td class="n">${esc(it.name)}</td>
        <td class="u">${money(unit)}</td>
        <td class="a">${money(it.lineTotal)}</td>
      </tr>${mods}${note}`
    );
  }).join("");

  const tendered = opts.tendered;
  const balance = tendered != null ? Math.max(0, tendered - ((o.grandTotal || o.total) - giftPaid)) : null;
  // discount may be a number or a {amount} object depending on the source
  const discVal = typeof o.discount === "number" ? o.discount : Number((o.discount as { amount?: number } | null)?.amount) || 0;

  // Scannable bill identifier (CODE128). Uses the order id so a scan maps back
  // to exactly one bill; falls back to the display number.
  const billCode = String((o as { id?: number | string }).id ?? o.displayNum ?? "").replace(/[^A-Za-z0-9]/g, "") || "0";
  const barcodeUrl = code128DataUrl(billCode, { module: 2, height: 50, showText: false });

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bill ${esc(o.displayNum)}</title>
  <style>
    @page { size: ${widthMm}mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color:#000; width:${widthMm}mm; margin:0 auto; padding:4px 2px; text-align:center; }
    .c { text-align:center; }
    .biz { font-size:16px; font-weight:700; letter-spacing:.5px; }
    .tagline { font-size:11px; font-style:italic; margin-bottom:3px; }
    .sub { font-size:10.5px; color:#333; line-height:1.35; }
    .rule { border:none; border-top:1px dashed #000; margin:6px 0; }
    .ruled { border:none; border-top:2px solid #000; margin:5px 0; }
    .inv { font-size:12px; font-weight:700; text-align:center; letter-spacing:2px; margin:4px 0; }
    table { width:100%; border-collapse:collapse; text-align:left; }
    .meta td { font-size:10.5px; padding:1px 0; }
    .meta td:last-child { text-align:right; }
    thead th { font-size:10px; text-transform:uppercase; border-bottom:1px solid #000; padding:3px 0; text-align:left; }
    thead th.u,thead th.a { text-align:right; }
    .ln td { padding:2px 0; vertical-align:top; font-size:11.5px; font-weight:400; }
    td.q { width:9%; } td.n { width:49%; } td.u { width:19%; text-align:right; } td.a { width:23%; text-align:right; font-weight:700; }
    td.mod,td.note { font-size:10px; color:#444; padding-left:4px; }
    td.note { font-style:italic; }
    .tot td { font-size:11.5px; padding:1.5px 0; }
    .tot td:last-child { text-align:right; }
    .grand td { font-size:15px; font-weight:700; padding-top:4px; }
    .pay td { font-size:11.5px; padding:1px 0; }
    .pay td:last-child { text-align:right; }
    .foot { text-align:center; font-size:10.5px; color:#333; margin-top:8px; line-height:1.4; }
    .badge { text-align:center; font-weight:800; letter-spacing:3px; font-size:11px; border:1px dashed #000; padding:2px; margin-bottom:5px; }
    .bc { text-align:center; margin-top:6px; margin-bottom:12mm; page-break-inside:avoid; }
    .bc img { max-width:80%; height:42px; object-fit:contain; }
    .bcnum { font-size:10px; letter-spacing:2px; margin-top:2px; }
    .foot { padding-bottom:8mm; }
  </style></head><body>
    ${opts.reprint ? `<div class="badge">R E P R I N T</div>` : ``}
    ${settings?.logoUrl ? `<div class="c"><img src="${esc(settings.logoUrl)}" style="max-height:48px;max-width:70%;object-fit:contain"></div>` : ``}
    <div class="c biz">${esc(biz)}</div>
    ${settings?.businessTagline ? `<div class="c sub tagline">${esc(settings.businessTagline)}</div>` : ``}
    <div class="c sub">
      ${settings?.businessAddress ? esc(settings.businessAddress) + "<br>" : ""}
      ${settings?.businessPhone ? "Tel: " + esc(settings.businessPhone) : ""}
      ${(settings as { taxRegNo?: string })?.taxRegNo ? "<br>Tax Reg: " + esc((settings as { taxRegNo?: string }).taxRegNo) : ""}
    </div>
    <div class="inv">TAX INVOICE</div>
    <table class="meta">
      <tr><td>Bill No</td><td>${esc(o.displayNum)}</td></tr>
      <tr><td>Date</td><td>${esc((o.createdAt || new Date().toISOString()).replace("T", " ").slice(0, 16))}</td></tr>
      <tr><td>Type</td><td>${esc(o.orderType)}${o.tableName ? " · " + esc(o.tableName) : ""}</td></tr>
      ${o.staffName ? `<tr><td>Served by</td><td>${esc(o.staffName)}</td></tr>` : ""}
      ${o.customerName ? `<tr><td>Customer</td><td>${esc(o.customerName)}</td></tr>` : ""}
    </table>
    <hr class="rule">
    <table>
      <thead><tr><th class="q">Qty</th><th class="n">Item</th><th class="u">Price</th><th class="a">Amount</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
    <hr class="rule">
    <table class="tot">
      <tr><td>Subtotal</td><td>${money(o.subtotal)}</td></tr>
      ${discVal > 0 ? `<tr><td>Discount</td><td>- ${money(discVal)}</td></tr>` : ""}
      ${o.serviceCharge > 0 ? `<tr><td>Service charge</td><td>${money(o.serviceCharge)}</td></tr>` : ""}
      ${o.vat > 0 ? `<tr><td>VAT / Tax</td><td>${money(o.vat)}</td></tr>` : ""}
    </table>
    <hr class="ruled">
    <table class="tot"><tr class="grand"><td>TOTAL</td><td>${money(o.grandTotal || o.total)}</td></tr></table>
    ${(tendered != null || o.amountPaid || (((o as { payments?: unknown[] }).payments) || []).length) ? `
    <hr class="rule">
    <table class="pay">
      ${tendered != null ? `<tr><td>Cash tendered</td><td>${money(tendered)}</td></tr>` : ""}
      ${balance != null ? `<tr><td>Change</td><td>${money(balance)}</td></tr>` : ""}
      ${(o.amountPaid && tendered == null) ? `<tr><td>Paid</td><td>${money(o.amountPaid)}</td></tr>` : ""}
      ${(((o as { payments?: Array<{ method?: string; amount?: number; code?: string }> }).payments) || []).filter((p) => p.method === "giftcard").map((p) => `<tr><td>Gift card ${p.code ? "*" + esc(String(p.code).slice(-4)) : ""}</td><td>- ${money(Number(p.amount) || 0)}</td></tr>`).join("")}
    </table>` : ""}
    <hr class="rule">
    <div class="bc">
      <img src="${barcodeUrl}" alt="Bill ${esc(billCode)}" onerror="this.style.display='none'">
      <div class="bcnum">${esc(o.displayNum || billCode)}</div>
    </div>
    <div class="foot">
      ${esc((settings as { receiptFooterText?: string })?.receiptFooterText || "Thank you — please come again!")}
      <br>Powered by RapidSolutions
    </div>
    <div style="height:8mm" aria-hidden="true"></div>
  </body></html>`;
  const printed = await printHtmlSilently(html);
  const drawerOpened = opts.openDrawer ? await openCashDrawer(settings) : false;
  return { printed, via: printed ? "browser" : "none", drawerOpened };
}
