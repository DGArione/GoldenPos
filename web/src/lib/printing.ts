import type { PublicSettings } from "./settings";
import { qrCardRaster, type QrCardInput } from "./qrcard";

export interface PrintLine {
  qty: number;
  name: string;
  lineTotal?: number;
  notes?: string;
  modifiers?: Array<{ option?: string; name?: string }>;
}

export interface KitchenPrintOrder {
  id: number;
  displayNum?: string;
  createdAt?: string;
  tableName?: string;
  orderType?: string;
  customerName?: string;
  note?: string;
  items?: PrintLine[];
}

/** fetch with a hard timeout so a dead agent never freezes the till. */
async function postJson(url: string, body: unknown, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

/** Resolve the agent endpoint. On the till itself we call the agent directly;
 *  on another LAN device (waiter tablet) "localhost" would be the tablet, so we
 *  go through the till's own web server, which proxies /print-agent/* to it. */
export function agentUrl(settings: Partial<PublicSettings> | null | undefined, path: "print" | "drawer" | "printers"): string {
  const configured = (settings?.printAgentUrl || "http://localhost:9110/print").trim();
  let url: URL;
  try { url = new URL(configured); } catch { url = new URL("http://localhost:9110/print"); }
  const agentIsLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  const onTill = typeof window === "undefined" || /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);
  if (agentIsLocal && !onTill) return `${window.location.origin}/print-agent/${path}`;
  url.pathname = `/${path}`; url.search = ""; url.hash = "";
  return url.toString();
}

export function agentReady(settings: Partial<PublicSettings> | null | undefined, role: "kitchen" | "payment" | "qr"): boolean {
  if (!settings?.printAgentEnabled) return false;
  const name = role === "kitchen" ? settings.kitchenPrinterName : role === "qr" ? settings.qrPrinterName : settings.paymentPrinterName;
  return !!String(name || "").trim();
}

export async function sendToConfiguredPrinter(
  settings: Partial<PublicSettings> | null | undefined,
  job: { type: string; title: string; text: string; printerRole: "kitchen" | "payment"; printerName?: string; copies?: number; barcodeData?: string; openDrawer?: boolean },
): Promise<boolean> {
  if (!agentReady(settings, job.printerRole)) return false;
  const configuredPrinter = job.printerRole === "kitchen" ? settings!.kitchenPrinterName : settings!.paymentPrinterName;
  // Do not print to a caller-provided or Windows-default printer unless this role is configured.
  const printerName = String(configuredPrinter || "").trim();
  const url = agentUrl(settings, "print");
  try {
    const response = await postJson(url, { ...job, printerName, copies: job.copies || 1, width: Number(settings!.printPaperWidth) || 48 });
    return response.ok;
  } catch {
    return false;
  }
}

export async function printKitchenTicket(order: KitchenPrintOrder, settings: Partial<PublicSettings> | null | undefined): Promise<boolean> {
  if (!settings?.printAgentEnabled || !settings.kitchenPrinterName) return false;
  const width = Number(settings.printPaperWidth) || 48;
  const center = (value: string) => value.slice(0, width);
  const lines = [
    center("*** KITCHEN ORDER ***"),
    center(order.displayNum || `#${order.id}`),
    center(`${order.tableName || ""} · ${(order.orderType || "dine-in").toUpperCase()}`),
    new Date(order.createdAt || Date.now()).toLocaleString(),
    "-".repeat(width),
  ];
  (order.items || []).forEach((item) => {
    lines.push(`${item.qty}x ${item.name}`);
    (item.modifiers || []).forEach((modifier) => lines.push(`  + ${modifier.option || modifier.name || "Option"}`));
    if (item.notes) lines.push(`  NOTE: ${item.notes}`);
  });
  lines.push("-".repeat(width));
  if (order.customerName) lines.push(`Customer: ${order.customerName}`);
  if (order.note) lines.push(`Order note: ${order.note}`);
  return sendToConfiguredPrinter(settings, { type: "kot", title: "Kitchen Order Ticket", text: lines.join("\n"), printerRole: "kitchen", copies: 1 });
}

/** Print table QR cards on the QR printer chosen in Settings (one card per
 *  table, each cut). Returns how many were printed; 0 with ok=false means the
 *  QR printer isn't set up, so the caller can fall back to browser printing. */
export async function printQrCardsToAgent(
  settings: Partial<PublicSettings> | null | undefined,
  cards: QrCardInput[],
  printerOverride?: string,
): Promise<{ ok: boolean; printed: number; error?: string }> {
  const printerName = String(printerOverride || settings?.qrPrinterName || "").trim();
  if (!settings?.printAgentEnabled && !printerOverride) return { ok: false, printed: 0 };
  if (!printerName) return { ok: false, printed: 0 };
  const dots = (Number(settings?.printPaperWidth) || 48) >= 42 ? 576 : 384;
  const url = agentUrl(settings, "print");
  let printed = 0;
  for (const card of cards) {
    try {
      const raster = qrCardRaster(card, dots);
      const res = await postJson(url, { type: "qr", title: "", printerRole: "qr", printerName, copies: 1, raster, text: `QR card - ${card.tableName}` }, 20000);
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }));
        return { ok: printed > 0, printed, error: (d as { error?: string }).error || `Print agent returned ${res.status}` };
      }
      printed++;
    } catch (e) {
      return { ok: printed > 0, printed, error: e instanceof Error ? e.message : "Print agent not reachable" };
    }
  }
  return { ok: true, printed };
}

/** Pulse the cash drawer through the configured payment receipt printer.
 * Call only after a successful cash payment; failure must not undo the payment.
 */
export async function openCashDrawer(settings: Partial<PublicSettings> | null | undefined): Promise<boolean> {
  if (!agentReady(settings, "payment")) return false;
  const url = agentUrl(settings, "drawer");
  try {
    const response = await postJson(url, { printerName: String(settings!.paymentPrinterName).trim() }, 5000);
    return response.ok;
  } catch { return false; }
}
