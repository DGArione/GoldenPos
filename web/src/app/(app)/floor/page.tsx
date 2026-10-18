"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Plus, CreditCard, RefreshCw, Armchair, QrCode, Pencil, Trash2,
  LayoutGrid, Settings as SettingsIcon, Printer, AlertTriangle,
} from "lucide-react";
import { qrSvg, qrDataUrl, wifiQrText } from "@/lib/qr";
import { printHtmlSilently } from "@/lib/receipt";
import { agentReady, printQrCardsToAgent } from "@/lib/printing";
import type { PublicSettings } from "@/lib/settings";
import { apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { Order, TableRow } from "@/lib/types";
import { PageHeader, PageLoader, Screen, useToast, Modal, EmptyState } from "@/components/ui";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  open:     { bg: "var(--ok-wash)",    fg: "var(--ok-ink)",    label: "Open" },
  ordered:  { bg: "var(--olive-wash)", fg: "var(--olive-700)", label: "Ordered" },
  occupied: { bg: "var(--olive-wash)", fg: "var(--olive-700)", label: "Occupied" },
  reserved: { bg: "var(--warn-wash)",  fg: "var(--warn-ink)",  label: "Reserved" },
  dirty:    { bg: "var(--panel-2)",    fg: "var(--muted)", label: "Needs bussing" },
};

export default function FloorPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [tables, setTables] = useState<TableRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<TableRow | null>(null);
  const [edit, setEdit] = useState<TableRow | "new" | null>(null);
  const [floor, setFloor] = useState<string>("all");
  const [qrOf, setQrOf] = useState<TableRow | null>(null);

  const canEdit = user?.role === "manager" || user?.role === "superManager";

  const load = useCallback(async () => {
    try {
      const [t, o] = await Promise.all([apiGet<TableRow[]>("/tables"), apiGet<Order[]>("/orders")]);
      setTables(Array.isArray(t) ? t : []);
      setOrders((Array.isArray(o) ? o : []).filter((x) => x.status !== "voided" && x.status !== "completed"));
    } catch { toast.push("bad", "Could not load floor"); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);

  const orderFor = (tid: number) => orders.find((o) => o.tableId === tid && o.paymentStatus !== "paid");

  async function setStatus(t: TableRow, status: string) {
    try { await apiPatch(`/tables/${t.id}`, { status }); setSel(null); load(); toast.push("ok", `${t.name} marked ${status}`); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function remove(t: TableRow) {
    if (!confirm(`Delete table "${t.name}"?`)) return;
    try { await apiDelete(`/tables/${t.id}`); setSel(null); load(); toast.push("ok", "Deleted"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function printQrCards(list: TableRow[]) {
    try {
      const info = await apiGet<QrInfo>("/qr/info");
      const base = qrBase(info);
      if (!base) { toast.push("bad", "Set the QR address first: Settings → Online ordering & QR"); return; }
      if (info.ipMismatch) toast.push("bad", "Warning: the QR address doesn't match this computer's current address — see Settings → Online ordering & QR");
      if (await printCardsOnQrPrinter(list, base, info, settings, toast)) return;
      const ok = await printHtmlSilently(qrCardsHtml(list, base, info, settings?.businessName || "Restaurant"));
      toast.push(ok ? "ok" : "bad", ok ? `Printing ${list.length} table card${list.length === 1 ? "" : "s"}` : "Could not print");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Could not print"); }
  }

  async function regenerateQr(t: TableRow) {
    try {
      const u = await apiPost<TableRow>(`/tables/${t.id}/qr-regenerate`);
      setTables((p) => p.map((x) => (x.id === u.id ? u : x)));
      if (qrOf?.id === t.id) setQrOf(u);
      toast.push("ok", `QR regenerated for ${t.name}`);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  async function resetFloor() {
    if (!confirm("Reset the whole floor? All tables marked open.")) return;
    try { await apiPost("/tables/reset-floor"); load(); toast.push("ok", "Floor reset"); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  const floors = useMemo(() => {
    const set = new Set<string>();
    for (const t of tables) set.add(t.floor || "Main");
    return Array.from(set);
  }, [tables]);

  const shown = useMemo(() => {
    return tables.filter((t) => floor === "all" || (t.floor || "Main") === floor);
  }, [tables, floor]);

  if (loading) return <PageLoader label="Loading floor" />;

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Floor" subtitle="Tap a table to open a ticket or settle up" icon={LayoutGrid}>
          {canEdit && (
            <>
              <button onClick={() => setEdit("new")} className="btn btn-primary btn-sm">
                <Plus size={14} /> New table
              </button>
              <button onClick={resetFloor} className="btn btn-ghost btn-sm" title="Mark all tables open">
                <RefreshCw size={14} /> Reset floor
              </button>
            </>
          )}
          {tables.length > 0 && (
            <button onClick={() => printQrCards(tables)} className="btn btn-ghost btn-sm" title="Print a QR ordering card for every table">
              <Printer size={14} /> Print all table QR cards
            </button>
          )}
          <button onClick={load} className="btn btn-ghost btn-sm" title="Refresh"><RefreshCw size={14} /></button>
        </PageHeader>

        {/* Floor tabs (multi-floor support) */}
        {floors.length > 1 && (
          <div className="flex gap-1.5 p-1 rounded-full self-start mb-4" style={{ background: "var(--panel-2)" }}>
            <button onClick={() => setFloor("all")}
              className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
              style={floor === "all"
                ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--muted)" }}>All floors</button>
            {floors.map((f) => (
              <button key={f} onClick={() => setFloor(f)}
                className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
                style={floor === f
                  ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--muted)" }}>{f}</button>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mb-4 text-[11.5px]">
          {Object.entries(STATUS_STYLE).filter(([k]) => k !== "occupied").map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full" style={{ background: v.fg }} />{v.label}
            </div>
          ))}
        </div>

        {!shown.length ? (
          <EmptyState title="No tables" hint={canEdit ? "Add one with the button above." : "Ask a manager to add tables."} icon={<Armchair size={30} />} />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {shown.map((t) => {
              const o = orderFor(t.id);
              const style = STATUS_STYLE[t.status] || STATUS_STYLE.open;
              return (
                <button
                  key={t.id}
                  onClick={() => setSel(t)}
                  className="rounded-xl p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                  style={{
                    background: style.bg,
                    border: `1.5px solid ${style.fg}`,
                    minHeight: 110,
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-bold text-[16px] text-ink">{t.name}</div>
                      <div className="text-[11px] text-muted flex items-center gap-1">
                        <Users size={11} /> {t.seats}
                      </div>
                    </div>
                    <span className="pill" style={{ background: "color-mix(in srgb, var(--panel) 75%, transparent)", color: style.fg, fontSize: 10 }}>
                      {style.label}
                    </span>
                  </div>
                  {o && (
                    <div className="text-[11.5px] mt-2">
                      <div className="font-semibold mono" style={{ color: style.fg }}>{o.displayNum}</div>
                      <div className="mono font-bold text-ink">{money(o.total, currency)}</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Screen>

      {/* Table action modal */}
      {sel && (
        <Modal open title={sel.name} onClose={() => setSel(null)} width={440}>
          {(() => {
            const o = orderFor(sel.id);
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                  <span className="pill pill-olive"><Users size={11} /> {sel.seats} seats</span>
                  <span className="pill" style={{ background: STATUS_STYLE[sel.status]?.bg, color: STATUS_STYLE[sel.status]?.fg }}>
                    {STATUS_STYLE[sel.status]?.label}
                  </span>
                  {sel.floor && <span className="pill pill-info">Floor: {sel.floor}</span>}
                </div>

                {o ? (
                  <>
                    <div className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
                      <div className="font-semibold text-ink">{o.displayNum}</div>
                      <div className="text-[12px] text-muted">{o.items.length} items</div>
                      <div className="mono font-bold text-[16px] mt-1" style={{ color: "var(--olive-700)" }}>
                        {money(o.total, currency)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => router.push(`/order?tableId=${sel.id}`)} className="btn btn-ghost flex-1">
                        <Plus size={14} /> Add items
                      </button>
                      <button onClick={() => router.push(`/payment?orderId=${o.id}`)} className="btn btn-primary flex-1">
                        <CreditCard size={14} /> Pay
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={() => router.push(`/order?tableId=${sel.id}`)} className="btn btn-primary w-full btn-lg">
                    <Plus size={15} /> Start new order
                  </button>
                )}

                <div className="flex gap-2 pt-2 border-t border-line-soft flex-wrap">
                  <button onClick={() => setStatus(sel, "open")}      className="btn btn-ghost btn-sm">Open</button>
                  <button onClick={() => setStatus(sel, "reserved")}  className="btn btn-ghost btn-sm">Reserve</button>
                  <button onClick={() => setStatus(sel, "dirty")}     className="btn btn-ghost btn-sm">Needs bussing</button>
                </div>

                {canEdit && (
                  <div className="flex gap-2 pt-2 border-t border-line-soft">
                    <button onClick={() => { setEdit(sel); setSel(null); }} className="btn btn-ghost btn-sm flex-1">
                      <Pencil size={13} /> Edit
                    </button>
                    <button onClick={() => { setQrOf(sel); setSel(null); }} className="btn btn-ghost btn-sm flex-1">
                      <QrCode size={13} /> QR code
                    </button>
                    <button onClick={() => remove(sel)} className="btn btn-danger btn-sm">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Create/edit table */}
      {edit && (
        <TableEditor
          existing={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onDone={() => { setEdit(null); load(); toast.push("ok", "Saved"); }}
        />
      )}

      {/* QR dialog */}
      {qrOf && (
        <QrModal
          table={qrOf}
          onClose={() => setQrOf(null)}
          onRegenerate={() => regenerateQr(qrOf)}
        />
      )}
    </div>
  );
}

function TableEditor({
  existing, onClose, onDone,
}: {
  existing: TableRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    name: existing?.name || "",
    seats: String(existing?.seats || 4),
    floor: existing?.floor || "Main",
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.name.trim()) { toast.push("bad", "Name required"); return; }
    setBusy(true);
    try {
      const payload = { name: f.name, seats: Number(f.seats) || 1, floor: f.floor };
      if (existing) await apiPatch(`/tables/${existing.id}`, payload);
      else await apiPost("/tables", payload);
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }
  return (
    <Modal open title={existing ? `Edit ${existing.name}` : "New table"} onClose={onClose} width={400}>
      <div className="space-y-3">
        <div><label className="lbl">Name</label>
          <input className="inp" autoFocus placeholder="e.g. T1 or Beach 2" value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="lbl">Seats</label>
            <input className="inp mono" type="number" min={1} value={f.seats}
              onChange={(e) => setF({ ...f, seats: e.target.value })} /></div>
          <div><label className="lbl">Floor / area</label>
            <input className="inp" placeholder="Main, Beach, Rooftop…" value={f.floor}
              onChange={(e) => setF({ ...f, floor: e.target.value })} /></div>
        </div>
        <button onClick={save} disabled={busy} className="btn btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : "Create table"}
        </button>
      </div>
    </Modal>
  );
}

interface QrInfo { publicBaseUrl: string; suggestedUrl: string; lanUrls: string[]; wifiSsid: string; wifiPassword: string; ipMismatch: boolean }
/** A public https name (Cloudflare / Tailscale) rather than this PC's Wi-Fi IP. */
const isOnlineAddress = (u: string) => /^https:\/\//i.test(u) && !/^https:\/\/(\d+\.){3}\d+/.test(u);
const qrBase = (i: QrInfo | null) => ((i?.publicBaseUrl || i?.suggestedUrl || "").replace(/\/+$/, ""));
const escHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Send the cards to the QR printer chosen in Settings → Printer management.
 *  Returns true when that printer handled it; false = not set up / failed, so
 *  the caller falls back to the browser print window. */
async function printCardsOnQrPrinter(
  list: TableRow[], base: string, info: QrInfo, settings: PublicSettings | null,
  toast: { push: (kind: "ok" | "bad", msg: string) => void },
): Promise<boolean> {
  if (!agentReady(settings, "qr")) return false;
  const online = isOnlineAddress(base);
  const wifiOn = !online && !!info.wifiSsid;
  const cards = list.map((t) => ({
    biz: settings?.businessName || "Restaurant",
    tableName: t.name,
    url: `${base}/t/${t.qrToken || t.id}`,
    wifiText: wifiOn ? wifiQrText(info.wifiSsid, info.wifiPassword) : undefined,
    wifiLabel: wifiOn ? `${info.wifiSsid}${info.wifiPassword ? "  ·  Password: " + info.wifiPassword : ""}` : undefined,
    footer: online
      ? (info.wifiSsid ? `Free Wi-Fi: ${info.wifiSsid}${info.wifiPassword ? " · " + info.wifiPassword : ""}` : "Works on Wi-Fi or mobile data")
      : "Your order goes to our cashier, then the kitchen.",
  }));
  const r = await printQrCardsToAgent(settings, cards);
  if (r.ok && r.printed === cards.length) {
    toast.push("ok", `Printed ${r.printed} QR card${r.printed === 1 ? "" : "s"} on ${settings?.qrPrinterName}`);
    return true;
  }
  if (r.printed > 0) { toast.push("bad", `Printed ${r.printed} of ${cards.length} cards, then stopped: ${r.error || "printer error"}`); return true; }
  toast.push("bad", `QR printer "${settings?.qrPrinterName}" did not print (${r.error || "not reachable"}). Opening the normal print window instead.`);
  return false;
}

/** A5-ish printable table cards: big "scan to order" QR, optional "join Wi-Fi" QR. */
function qrCardsHtml(list: TableRow[], base: string, info: QrInfo, biz: string): string {
  // Online address (https, e.g. Cloudflare): works on Wi-Fi AND mobile data, so
  // the card has ONE QR and no "join Wi-Fi" step. Local address: Wi-Fi first.
  const online = isOnlineAddress(base);
  const wifi = !online && info.wifiSsid ? qrSvg(wifiQrText(info.wifiSsid, info.wifiPassword), 4, 1) : "";
  const wifiText = online && info.wifiSsid ? `<div class="wifitext">Free Wi-Fi: <b>${escHtml(info.wifiSsid)}</b>${info.wifiPassword ? ` · Password: <b>${escHtml(info.wifiPassword)}</b>` : ""}</div>` : "";
  const cards = list.map((t) => `
    <section class="card">
      <div class="biz">${escHtml(biz)}</div>
      <div class="table">${escHtml(t.name)}</div>
      ${wifi ? `<div class="step"><b>1</b> Join our Wi-Fi</div><div class="wifi">${wifi}<div class="ssid">${escHtml(info.wifiSsid)}${info.wifiPassword ? `<br>Password: <b>${escHtml(info.wifiPassword)}</b>` : ""}</div></div>
      <div class="step"><b>2</b> Scan to see the menu &amp; order</div>` : `<div class="step">Scan to see the menu &amp; order</div>`}
      <div class="qr">${qrSvg(`${base}/t/${t.qrToken || t.id}`, 8, 2)}</div>
      <div class="foot">${online ? "Works on Wi-Fi or mobile data. " : ""}Your order goes to our cashier, then straight to the kitchen.</div>
      ${wifiText}
    </section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Table QR cards</title><style>
    @page { size: A5 portrait; margin: 10mm; }
    body { margin:0; font-family: Arial, Helvetica, sans-serif; color:#111; }
    .card { page-break-after: always; text-align:center; padding: 6mm 4mm; }
    .card:last-child { page-break-after: auto; }
    .biz { font-size: 18pt; font-weight: 800; }
    .table { font-size: 30pt; font-weight: 900; margin: 2mm 0 5mm; }
    .step { font-size: 14pt; font-weight: 700; margin: 4mm 0 2mm; }
    .step b { display:inline-block; width:9mm; height:9mm; line-height:9mm; border-radius:50%; background:#111; color:#fff; margin-right:2mm; }
    .wifi { display:flex; align-items:center; justify-content:center; gap:5mm; }
    .wifi svg { width: 32mm; height: 32mm; }
    .ssid { font-size: 12pt; text-align:left; }
    .qr svg { width: 80mm; height: 80mm; }
    .foot { font-size: 10pt; color:#444; margin-top: 3mm; }
    .wifitext { font-size: 11pt; margin-top: 4mm; }
  </style></head><body>${cards}</body></html>`;
}

function QrModal({ table, onClose, onRegenerate }: { table: TableRow; onClose: () => void; onRegenerate: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const [info, setInfo] = useState<QrInfo | null>(null);
  useEffect(() => { apiGet<QrInfo>("/qr/info").then(setInfo).catch(() => setInfo(null)); }, []);
  const base = qrBase(info);
  const url = base ? `${base}/t/${table.qrToken || table.id}` : "";
  async function printCard() {
    if (!info || !base) return;
    if (await printCardsOnQrPrinter([table], base, info, settings, toast)) return;
    const ok = await printHtmlSilently(qrCardsHtml([table], base, info, settings?.businessName || "Restaurant"));
    toast.push(ok ? "ok" : "bad", ok ? `Printing card for ${table.name}` : "Could not print");
  }
  return (
    <Modal open title={`QR for ${table.name}`} onClose={onClose} width={380}>
      <div className="flex flex-col items-center gap-3">
        {url ? (
          <img src={qrDataUrl(url, 8, 2)} alt={`QR for ${table.name}`} width={240} height={240}
            className="rounded-xl" style={{ background: "#fff", padding: 6 }} />
        ) : <div className="py-10 text-sm text-muted">Loading…</div>}
        <div className="text-[12px] text-muted font-mono break-all text-center">{url}</div>
        {info?.ipMismatch && (
          <div className="flex gap-2 text-[12px] rounded-lg px-3 py-2" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>
            <AlertTriangle size={15} className="shrink-0" />
            <span>This QR points to <b>{info.publicBaseUrl}</b>, but this computer is now <b>{info.lanUrls[0] || "offline"}</b>. Customers can&apos;t open it. Fix it in Settings → Online ordering &amp; QR.</span>
          </div>
        )}
        {info && isOnlineAddress(info.publicBaseUrl) && (
          <div className="text-[12px] text-center rounded-lg px-3 py-2" style={{ background: "var(--ok-wash)", color: "var(--ok-ink)" }}>
            Online address — this QR works on Wi-Fi <b>and</b> mobile data.
          </div>
        )}
        {info && !info.publicBaseUrl && (
          <div className="text-[12px] text-center rounded-lg px-3 py-2" style={{ background: "var(--warn-wash)", color: "var(--warn-ink)" }}>
            Using this computer&apos;s current address. Save it in <strong>Settings → Online ordering &amp; QR</strong> and reserve the IP in your router so printed QR codes keep working.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 w-full">
          <button onClick={printCard} disabled={!url} className="btn btn-primary col-span-2"><Printer size={14} /> Print table card</button>
          <button onClick={() => navigator.clipboard.writeText(url).then(() => toast.push("ok", "Link copied")).catch(() => {})} className="btn btn-ghost">
            Copy link
          </button>
          <button onClick={onRegenerate} className="btn btn-ghost">
            <RefreshCw size={13} /> New code
          </button>
        </div>
      </div>
    </Modal>
  );
}
