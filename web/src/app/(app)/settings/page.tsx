"use client";

import { useEffect, useRef, useState } from "react";
import { Save, Star, Gift, Tag, CalendarCheck, Image as ImageIcon, Plus, Trash2, Palette, X, Printer, RefreshCw } from "lucide-react";
import { apiGet, apiPut, apiPost } from "@/lib/api";
import { PageHeader, PageLoader, Screen, useToast } from "@/components/ui";
import { fetchSettings, applyAccent, setAccentPreview, isLight, type HomeBanner } from "@/lib/settings";
import { resizeImageFile, type ResizeOptions } from "@/lib/image";
import { printQrCardsToAgent } from "@/lib/printing";
import StorageSettings from "@/components/StorageSettings";

interface Settings {
  businessName: string;
  businessTagline: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  currencySymbol: string;
  serviceChargeRate: number;
  vatRate: number;
  cardFeePercent: number;
  receiptFooterText: string;
  enabledAddons: string[];
  homeBanners?: HomeBanner[];
  logoUrl?: string;
  loginBgUrl?: string;
  loginPanelImageUrl?: string;
  accentColor?: string;
  publicBaseUrl?: string;
  qrOrderAutoKitchen?: boolean;
  wifiSsid?: string;
  wifiPassword?: string;
  printAgentUrl?: string;
  printAgentEnabled?: boolean;
  printPaperWidth?: number;
  kitchenPrinterName?: string;
  paymentPrinterName?: string;
  qrPrinterName?: string;
  dailyReportEnabled?: boolean;
  dailyReportTime?: string;
}

interface QrNet { publicBaseUrl: string; suggestedUrl: string; lanUrls: string[]; ipMismatch: boolean }

const THEME_PRESETS = [
  { name: "Golden",   color: "#f6990d" },
  { name: "Ocean",    color: "#1a6fa8" },
  { name: "Forest",   color: "#2d7a3e" },
  { name: "Crimson",  color: "#b91c1c" },
  { name: "Violet",   color: "#6d28d9" },
  { name: "Teal",     color: "#0e7490" },
  { name: "Rose",     color: "#be185d" },
  { name: "Slate",    color: "#475569" },
];

const ADDONS = [
  { key: "loyalty",      label: "Loyalty points", icon: Star },
  { key: "giftcards",    label: "Gift cards",     icon: Gift },
  { key: "promotions",   label: "Promotions",     icon: Tag },
  { key: "reservations", label: "Reservations",   icon: CalendarCheck },
];

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [printerNames, setPrinterNames] = useState<string[]>([]);
  const [printerLoading, setPrinterLoading] = useState(false);
  const [printerSaving, setPrinterSaving] = useState(false);
  const [printerMessage, setPrinterMessage] = useState("");

  // Colour preview is applied live; if the page is left without saving,
  // put the saved colour back so the preview doesn't "stick".
  const savedAccent = useRef<string | undefined>(undefined);
  const [qrNet, setQrNet] = useState<QrNet | null>(null);
  useEffect(() => { apiGet<QrNet>("/qr/info").then(setQrNet).catch(() => {}); }, []);
  // Leaving Settings without saving puts the saved colour back.
  useEffect(() => { setAccentPreview(true); return () => { setAccentPreview(false); applyAccent(savedAccent.current); }; }, []);

  useEffect(() => {
    apiGet<Settings>("/settings")
      .then((data) => { savedAccent.current = data.accentColor; setS({ ...data, homeBanners: data.homeBanners || [] }); })
      .catch(() => toast.push("bad", "Admin access required"));
    // eslint-disable-next-line
  }, []);

  useEffect(() => { if (s) refreshPrinters(); }, [!!s]);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((p) => (p ? { ...p, [k]: v } : p));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await apiPut("/settings", {
        businessName: s.businessName,
        businessTagline: s.businessTagline,
        businessAddress: s.businessAddress,
        businessPhone: s.businessPhone,
        businessEmail: s.businessEmail,
        currencySymbol: s.currencySymbol,
        serviceChargeRate: Number(s.serviceChargeRate) || 0,
        vatRate: Number(s.vatRate) || 0,
        cardFeePercent: Number(s.cardFeePercent) || 0,
        receiptFooterText: s.receiptFooterText,
        homeBanners: s.homeBanners || [],
        logoUrl: s.logoUrl || "",
        loginBgUrl: s.loginBgUrl || "",
        loginPanelImageUrl: s.loginPanelImageUrl || "",
        accentColor: s.accentColor || "",
      });
      // publicBaseUrl / qrOrderAutoKitchen live on a separate endpoint
      await apiPut("/qr/settings", {
        publicBaseUrl: (s.publicBaseUrl || "").trim(),
        qrOrderAutoKitchen: s.qrOrderAutoKitchen !== false,
        wifiSsid: s.wifiSsid || "",
        wifiPassword: s.wifiPassword || "",
      });
      apiGet<QrNet>("/qr/info").then(setQrNet).catch(() => {});
      await savedAndRefresh();
      applyAccent(s.accentColor);
      savedAccent.current = s.accentColor;
      toast.push("ok", "Settings saved");
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function printerListUrl() {
    try { const u = new URL(s?.printAgentUrl || "http://localhost:9110/print"); u.pathname = "/printers"; u.search = ""; u.hash = ""; return u.toString(); }
    catch { return "http://localhost:9110/printers"; }
  }

  async function refreshPrinters() {
    setPrinterLoading(true); setPrinterMessage("");
    try {
      const res = await fetch(printerListUrl());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Agent returned ${res.status}`);
      setPrinterNames(Array.isArray(data.printers) ? data.printers : []);
      setPrinterMessage(data.printers?.length ? `Found ${data.printers.length} Windows printer(s).` : "No Windows printers detected. Confirm both printers are installed in Windows and the print agent is running on this computer.");
    } catch (e) {
      setPrinterNames([]);
      setPrinterMessage(e instanceof Error ? `Cannot reach print agent: ${e.message}` : "Cannot reach print agent. Start Golden POS again and refresh the list.");
    } finally { setPrinterLoading(false); }
  }

  async function savePrinterSettings() {
    if (!s) return;
    setPrinterSaving(true); setPrinterMessage("");
    try {
      const result = await apiPut<{ ok: boolean; printAgentUrl: string; printAgentEnabled: boolean; printPaperWidth: number; kitchenPrinterName: string; paymentPrinterName: string; qrPrinterName: string; dailyReportEnabled: boolean; dailyReportTime: string }>("/print/settings", {
        printAgentUrl: (s.printAgentUrl || "http://localhost:9110/print").trim(),
        printAgentEnabled: !!s.printAgentEnabled,
        printPaperWidth: Number(s.printPaperWidth) || 48,
        kitchenPrinterName: s.kitchenPrinterName || "",
        paymentPrinterName: s.paymentPrinterName || "",
        qrPrinterName: s.qrPrinterName || "",
        dailyReportEnabled: s.dailyReportEnabled !== false,
        dailyReportTime: s.dailyReportTime || "23:30",
      });
      setS((prev) => prev ? { ...prev, ...result } : prev);
      await fetchSettings(true);
      toast.push("ok", "Printer settings saved");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Could not save printer settings"); }
    finally { setPrinterSaving(false); }
  }

  async function testPrinter(role: "kitchen" | "payment") {
    if (!s) return;
    const printerName = role === "kitchen" ? s.kitchenPrinterName : s.paymentPrinterName;
    if (!printerName) { setPrinterMessage(`Select the ${role} printer first.`); return; }
    setPrinterMessage(`Sending test to ${printerName}…`);
    try {
      const res = await fetch((s.printAgentUrl || "http://localhost:9110/print").trim(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test", printerRole: role, printerName, title: `${role} printer test`, copies: 1,
          text: [`*** ${role.toUpperCase()} PRINTER TEST ***`, s.businessName || "Golden POS", new Date().toLocaleString(), "-".repeat(Number(s.printPaperWidth) || 48), "Printer routing is working.", ""].join("\n") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Print agent returned ${res.status}`);
      setPrinterMessage(`Test sent to ${printerName}. Check the printer output.`);
    } catch (e) { setPrinterMessage(e instanceof Error ? `Test failed: ${e.message}` : "Test print failed."); }
  }

  async function testQrPrinter() {
    if (!s) return;
    if (!s.qrPrinterName) { setPrinterMessage("Select the table QR printer first."); return; }
    setPrinterMessage(`Sending a test QR card to ${s.qrPrinterName}…`);
    const base = (s.publicBaseUrl || window.location.origin).replace(/\/+$/, "");
    const r = await printQrCardsToAgent(
      { printAgentUrl: s.printAgentUrl, printAgentEnabled: true, printPaperWidth: s.printPaperWidth, qrPrinterName: s.qrPrinterName },
      [{ biz: s.businessName || "Golden POS", tableName: "QR TEST", url: `${base}/t/test`, footer: new Date().toLocaleString() }],
      s.qrPrinterName,
    );
    setPrinterMessage(r.ok ? `Test QR card sent to ${s.qrPrinterName}. Scan it with a phone to check it reads.` : `Test failed: ${r.error || "print agent not reachable"}`);
  }

  async function toggleAddon(key: string, enabled: boolean) {
    try {
      const r = await apiPost<{ enabledAddons: string[] }>("/admin/addons", { addon: key, enabled });
      set("enabledAddons", r.enabledAddons);
      // Refresh the global settings cache so the Sidebar reacts instantly.
      await fetchSettings(true);
      toast.push("ok", `${key} ${enabled ? "enabled" : "disabled"}`);
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Failed");
    }
  }

  async function savedAndRefresh() {
    await fetchSettings(true);
  }

  function addBanner() {
    const next: HomeBanner = { title: "New promo", body: "", color: "" };
    set("homeBanners", [...(s?.homeBanners || []), next]);
  }
  function updateBanner(idx: number, patch: Partial<HomeBanner>) {
    const list = [...(s?.homeBanners || [])];
    list[idx] = { ...list[idx], ...patch };
    set("homeBanners", list);
  }
  function removeBanner(idx: number) {
    set("homeBanners", (s?.homeBanners || []).filter((_, i) => i !== idx));
  }

  const pct = (v: number) => (v <= 1 ? Math.round(v * 1000) / 10 : v);
  const toFrac = (v: string) => { const n = Number(v) || 0; return n > 1 ? n / 100 : n; };

  if (!s) return <PageLoader label="Loading settings" />;

  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <Screen>
        <PageHeader title="Settings" subtitle="Business identity, taxes and modules">
          <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
            <Save size={14} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </PageHeader>

        <div className="eyebrow mb-4">Business</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name"            value={s.businessName}      onChange={(v) => set("businessName", v)} />
          <Field label="Tagline"         value={s.businessTagline}   onChange={(v) => set("businessTagline", v)} />
          <Field label="Address"         value={s.businessAddress}   onChange={(v) => set("businessAddress", v)} />
          <Field label="Phone"           value={s.businessPhone}     onChange={(v) => set("businessPhone", v)} />
          <Field label="Email"           value={s.businessEmail}     onChange={(v) => set("businessEmail", v)} />
          <Field label="Currency symbol" value={s.currencySymbol}    onChange={(v) => set("currencySymbol", v)} />
        </div>
      </Screen>

      <Screen>
        <div className="eyebrow mb-4">Charges &amp; tax</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Service charge %" mono value={String(pct(s.serviceChargeRate))}
            onChange={(v) => set("serviceChargeRate", toFrac(v) as unknown as number)} />
          <Field label="VAT %" mono value={String(pct(s.vatRate))}
            onChange={(v) => set("vatRate", toFrac(v) as unknown as number)} />
          <Field label="Card fee %" mono value={String(pct(s.cardFeePercent))}
            onChange={(v) => set("cardFeePercent", toFrac(v) as unknown as number)} />
        </div>
        <div className="mt-3">
          <Field label="Receipt footer" value={s.receiptFooterText} onChange={(v) => set("receiptFooterText", v)} />
        </div>
      </Screen>

      {/* ---- Online ordering & QR ---- */}
      <Screen>
        <div className="eyebrow mb-1">Online ordering &amp; QR</div>
        <p className="text-[11.5px] text-muted mb-4">
          The address customers reach your menu at when they scan a table QR code. Leave blank to use this device&rsquo;s
          address (works only on the same network). Set your public domain or tunnel URL so phones can open it anywhere.
        </p>
        {/* This computer's address right now, and whether the saved one still matches */}
        <div className="mb-3 rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
          <div className="text-[12px] text-muted">This computer&apos;s address on the restaurant Wi-Fi right now</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="font-mono text-[14px] font-semibold text-ink">{qrNet?.suggestedUrl || "Not connected to a network"}</code>
            {qrNet?.suggestedUrl && !/^https:\/\/[a-z]/i.test(s.publicBaseUrl || "") && (s.publicBaseUrl || "").replace(/\/+$/, "") !== qrNet.suggestedUrl && (
              <button className="btn btn-primary btn-sm" onClick={() => set("publicBaseUrl", qrNet.suggestedUrl)}>Use this computer&apos;s address</button>
            )}
          </div>
          {/^https:\/\/[a-z]/i.test(s.publicBaseUrl || "") && (
            <div className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--ok-wash)", color: "var(--ok-ink)" }}>
              Online address in use — one QR works for customers on Wi-Fi <b>and</b> mobile data, and this computer&apos;s IP doesn&apos;t matter.
            </div>
          )}
          {qrNet?.ipMismatch && (
            <div className="mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>
              Your table QR codes point to <b>{qrNet.publicBaseUrl}</b>, but this computer is now <b>{qrNet.lanUrls[0] || "offline"}</b>.
              Customers can&apos;t open the menu. Best fix: reserve this computer&apos;s IP in the Wi-Fi router (see the hosting guide) so it never changes, then press “Use this computer&apos;s address”, Save, and reprint the cards.
            </div>
          )}
        </div>
        <Field
          label="QR code address (what customers' phones open)"
          placeholder="http://192.168.1.25:3000  or  https://menu.yourrestaurant.com"
          value={s.publicBaseUrl || ""}
          onChange={(v) => set("publicBaseUrl", v)}
        />
        {s.publicBaseUrl && (
          <div className="text-[11.5px] text-muted mt-2">
            QR codes will point to <code className="font-mono">{(s.publicBaseUrl || "").replace(/\/+$/, "")}/t/&lt;table&gt;</code>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <Field label="Restaurant Wi-Fi name (printed on table cards)" value={s.wifiSsid || ""} onChange={(v) => set("wifiSsid", v)} />
          <Field label="Wi-Fi password" value={s.wifiPassword || ""} onChange={(v) => set("wifiPassword", v)} />
        </div>
        <p className="text-[11.5px] text-muted mt-1">Customers scan the Wi-Fi QR on the table card to join, then the menu QR. Their phone must be on the same Wi-Fi as this computer (not a “guest” network that blocks devices from each other).</p>
        <p className="text-[11.5px] text-muted mt-1"><b>Customers on mobile data:</b> run <code className="font-mono">SETUP-ONLINE-ORDERING.cmd</code> on this computer and paste the <b>https://</b> address it gives you into “QR code address” above. Only the table menu and ordering are published — staff screens stay private.</p>
        <label className="flex items-center gap-2.5 mt-4 cursor-pointer">
          <input type="checkbox" checked={s.qrOrderAutoKitchen !== false}
            onChange={(e) => set("qrOrderAutoKitchen", e.target.checked)} />
          <span className="text-[13px] text-ink">Send QR / online orders straight to the kitchen</span>
        </label>
      </Screen>

      {/* ---- Printer management ---- */}
      <Screen>
        <div className="eyebrow mb-1 flex items-center gap-2"><Printer size={14} /> Printer management</div>
        <p className="text-[11.5px] text-muted mb-4">Choose separate Windows USB printers for kitchen tickets and customer bills. The print agent runs on this POS computer.</p>
        <label className="flex items-center gap-2.5 mb-4 cursor-pointer">
          <input type="checkbox" checked={!!s.printAgentEnabled} onChange={(e) => set("printAgentEnabled", e.target.checked)} />
          <span className="text-[13px] text-ink">Enable direct thermal printing</span>
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Print agent URL" value={s.printAgentUrl || "http://localhost:9110/print"} onChange={(v) => set("printAgentUrl", v)} />
          <div><label className="lbl">Paper width</label><select className="inp w-full" value={String(s.printPaperWidth || 48)} onChange={(e) => set("printPaperWidth", Number(e.target.value))}><option value="48">80 mm (48 columns)</option><option value="32">58 mm (32 columns)</option></select></div>
          <div><label className="lbl">Kitchen printer — KOT tickets</label><select className="inp w-full" value={s.kitchenPrinterName || ""} onChange={(e) => set("kitchenPrinterName", e.target.value)}><option value="">Select kitchen printer</option>{printerNames.map((n) => <option key={n} value={n}>{n}</option>)}{s.kitchenPrinterName && !printerNames.includes(s.kitchenPrinterName) && <option value={s.kitchenPrinterName}>{s.kitchenPrinterName} (saved)</option>}</select><button className="btn btn-ghost btn-sm mt-2" onClick={() => testPrinter("kitchen")}><Printer size={13} /> Test kitchen printer</button></div>
          <div><label className="lbl">Payment printer — bills &amp; receipts</label><select className="inp w-full" value={s.paymentPrinterName || ""} onChange={(e) => set("paymentPrinterName", e.target.value)}><option value="">Select payment printer</option>{printerNames.map((n) => <option key={n} value={n}>{n}</option>)}{s.paymentPrinterName && !printerNames.includes(s.paymentPrinterName) && <option value={s.paymentPrinterName}>{s.paymentPrinterName} (saved)</option>}</select><button className="btn btn-ghost btn-sm mt-2" onClick={() => testPrinter("payment")}><Printer size={13} /> Test payment printer</button></div>
          <div><label className="lbl">Table QR printer — QR cards for tables</label><select className="inp w-full" value={s.qrPrinterName || ""} onChange={(e) => set("qrPrinterName", e.target.value)}><option value="">Not set — use the browser print window</option>{printerNames.map((n) => <option key={n} value={n}>{n}</option>)}{s.qrPrinterName && !printerNames.includes(s.qrPrinterName) && <option value={s.qrPrinterName}>{s.qrPrinterName} (saved)</option>}</select><button className="btn btn-ghost btn-sm mt-2" onClick={testQrPrinter}><Printer size={13} /> Test QR printer</button></div>
        </div>
        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={s.dailyReportEnabled !== false} onChange={(e) => set("dailyReportEnabled", e.target.checked)} />
            <span className="text-[13px] text-ink font-semibold">Print daily card &amp; cash bills automatically</span>
          </label>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[12px] text-muted">Every day at</span>
            <input type="time" className="inp" style={{ width: 130 }} value={s.dailyReportTime || "23:30"} onChange={(e) => set("dailyReportTime", e.target.value)} disabled={s.dailyReportEnabled === false} />
          </div>
          <p className="text-[11px] text-muted mt-2">Two slips on the payment printer: card bills and cash bills (order number, time, table, amount and total). Print any day by hand from Reports &rarr; Daily card &amp; cash bills. The POS computer must be on at that time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button className="btn btn-ghost btn-sm" onClick={refreshPrinters} disabled={printerLoading}><RefreshCw size={13} className={printerLoading ? "animate-spin" : ""} /> {printerLoading ? "Searching…" : "Refresh printer list"}</button>
          <button className="btn btn-primary btn-sm" onClick={savePrinterSettings} disabled={printerSaving}><Save size={13} /> {printerSaving ? "Saving…" : "Save printer settings"}</button>
        </div>
        {printerMessage && <p className="text-[11.5px] text-muted mt-3" role="status">{printerMessage}</p>}
      </Screen>

      {/* ---- Storage & backups ---- */}
      <Screen>
        <StorageSettings />
      </Screen>

      {/* ---- Appearance ---- */}
      <Screen>
        <div className="eyebrow mb-4 flex items-center gap-2"><Palette size={14} /> Appearance</div>

        {/* theme presets */}
        <label className="lbl">Brand / theme colour</label>
        <div className="flex gap-2 flex-wrap mb-3">
          {THEME_PRESETS.map((t) => {
            const active = (s.accentColor || "#f6990d").toLowerCase() === t.color.toLowerCase();
            return (
              <button key={t.name} onClick={() => { set("accentColor", t.color); applyAccent(t.color); }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all"
                style={{
                  background: active ? t.color : "var(--panel-2)",
                  color: active ? (isLight(t.color) ? "#1e1e1e" : "#fff") : "var(--ink)",
                  borderColor: active ? t.color : "var(--line)",
                }}>
                <span className="size-4 rounded-full" style={{ background: t.color, boxShadow: active ? "0 0 0 2px #fff inset" : "none" }} />
                <span className="text-[12.5px] font-semibold">{t.name}</span>
              </button>
            );
          })}
          {/* custom color */}
          <label className="flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer"
            style={{ background: "var(--panel-2)", borderColor: "var(--line)" }}>
            <input type="color" className="size-5 cursor-pointer border-0 bg-transparent p-0"
              value={s.accentColor || "#f6990d"}
              onChange={(e) => { set("accentColor", e.target.value); applyAccent(e.target.value); }} />
            <span className="text-[12.5px] font-semibold">Custom</span>
          </label>
        </div>
        <p className="text-[11.5px] text-muted mb-5">Preview applies instantly. Press <b>Save changes</b> (top of the page) to keep colours and pictures.</p>

        {/* logo + login bg */}
        <div className="grid sm:grid-cols-2 gap-4">
          <ImageField label="Logo / brand image" hint="Shown on the login screen and in the sidebar. A square PNG works best."
            resize={{ maxWidth: 512, maxHeight: 512, keepTransparency: true, maxBytes: 300 * 1024 }} preview="contain"
            value={s.logoUrl || ""} onChange={(v) => set("logoUrl", v)} />
          <ImageField label="Login background" hint="Full-screen photo behind the PIN screen. Any photo — it is resized automatically."
            resize={{ maxWidth: 1920, maxHeight: 1080, maxBytes: 600 * 1024 }}
            value={s.loginBgUrl || ""} onChange={(v) => set("loginBgUrl", v)} />
          <ImageField label="Login side panel picture" hint="Fills the coloured panel with the clock on the PIN screen (e.g. your beach or a signature dish). Darkened slightly so the time stays readable."
            resize={{ maxWidth: 900, maxHeight: 1200, maxBytes: 400 * 1024 }}
            value={s.loginPanelImageUrl || ""} onChange={(v) => set("loginPanelImageUrl", v)} />
        </div>
      </Screen>

      <Screen>
        <div className="flex items-center justify-between mb-4">
          <div className="eyebrow flex items-center gap-2">
            <ImageIcon size={14} /> Home banners
          </div>
          <button onClick={addBanner} className="btn btn-ghost btn-sm">
            <Plus size={13} /> Add banner
          </button>
        </div>

        {!(s.homeBanners || []).length ? (
          <p className="text-sm text-muted">No banners yet. Add one to show a rotating promo at the top of the home page.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(s.homeBanners || []).map((b, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
                <div className="flex items-start gap-3">
                  {/* preview swatch */}
                  <div
                    className="size-10 shrink-0 rounded-lg"
                    style={{
                      background: `linear-gradient(135deg, ${b.color || "var(--olive)"}, color-mix(in srgb, ${b.color || "var(--olive)"} 60%, black))`,
                    }}
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      className="inp"
                      placeholder="Title (e.g. “Fresh Lobster Day”)"
                      value={b.title}
                      onChange={(e) => updateBanner(i, { title: e.target.value })}
                    />
                    <input
                      className="inp"
                      placeholder="Body text"
                      value={b.body}
                      onChange={(e) => updateBanner(i, { body: e.target.value })}
                    />
                    <div className="grid sm:grid-cols-3 gap-2">
                      <div className="relative">
                        <input
                          type="color"
                          className="inp !p-1 h-10 w-full cursor-pointer"
                          value={b.color || "#f6990d"}
                          onChange={(e) => updateBanner(i, { color: e.target.value })}
                          title="Accent colour"
                        />
                      </div>
                      <input
                        className="inp"
                        placeholder="Button text (optional)"
                        value={b.ctaLabel || ""}
                        onChange={(e) => updateBanner(i, { ctaLabel: e.target.value })}
                      />
                      <input
                        className="inp"
                        placeholder="Button link (e.g. /order)"
                        value={b.ctaHref || ""}
                        onChange={(e) => updateBanner(i, { ctaHref: e.target.value })}
                      />
                    </div>
                    <ImageField label="Banner picture (optional)" hint="Shown on the right of the banner."
                      value={b.imageUrl || ""} onChange={(v) => updateBanner(i, { imageUrl: v })}
                      resize={{ maxWidth: 640, maxHeight: 640, maxBytes: 250 * 1024 }} small />
                  </div>
                  <button
                    onClick={() => removeBanner(i)}
                    className="btn btn-ghost btn-sm !px-2"
                    title="Remove banner"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Screen>

      <Screen>
        <div className="eyebrow mb-4">Add-on modules</div>
        <p className="text-sm text-muted mb-3">
          Switch these on to show them in the sidebar.
        </p>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {ADDONS.map((a) => {
            const on = (s.enabledAddons || []).includes(a.key);
            const Icon = a.icon;
            return (
              <button
                key={a.key}
                onClick={() => toggleAddon(a.key, !on)}
                className="flex items-center justify-between rounded-xl px-4 py-3 border transition-colors"
                style={on
                  ? { background: "var(--olive-wash)", borderColor: "var(--olive)" }
                  : { background: "var(--panel)", borderColor: "var(--line)" }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium">
                  <Icon size={16} style={{ color: on ? "var(--olive-text)" : "var(--muted)" }} />
                  {a.label}
                </span>
                <span
                  className="w-10 h-6 rounded-full relative transition-colors"
                  style={{ background: on ? "var(--olive)" : "var(--line)" }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                    style={{ left: on ? 18 : 2 }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </Screen>
    </div>
  );
}

function Field({ label, value, onChange, mono, placeholder }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <input className={`inp ${mono ? "mono" : ""}`} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ImageField({ label, hint, value, onChange, resize, preview = "cover", small }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  resize?: ResizeOptions; preview?: "cover" | "contain"; small?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";                 // allow choosing the same file again
    if (!file) return;
    setBusy(true);
    try {
      const url = await resizeImageFile(file, resize || { maxWidth: 1600, maxHeight: 1600 });
      onChange(url);
      toast.push("ok", "Picture added — press Save changes to keep it");
    } catch (err) {
      toast.push("bad", err instanceof Error ? err.message : "Could not use that picture");
    } finally { setBusy(false); }
  }
  const box = small ? "size-14" : "size-20";
  return (
    <div>
      <label className="lbl">{label}</label>
      <div className="flex gap-3 items-start">
        <div className={`${box} rounded-xl overflow-hidden flex items-center justify-center shrink-0`}
          style={{ background: preview === "contain" ? "#fff" : "var(--panel-2)", border: "1px solid var(--line)" }}>
          {value
            ? <img src={value} alt="" className={`w-full h-full ${preview === "contain" ? "object-contain p-1" : "object-cover"}`} />
            : <ImageIcon size={small ? 18 : 24} className="text-muted" />}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <label className={`btn btn-ghost btn-sm cursor-pointer ${busy ? "opacity-60 pointer-events-none" : ""}`}>
              <ImageIcon size={13} /> {busy ? "Preparing…" : value ? "Change" : "Upload"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={pick} disabled={busy} />
            </label>
            {value && <button type="button" onClick={() => onChange("")} className="btn btn-ghost btn-sm"><X size={13} /> Remove</button>}
          </div>
          {hint && <div className="text-[11px] text-muted">{hint}</div>}
        </div>
      </div>
    </div>
  );
}
