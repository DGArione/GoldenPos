"use client";

/*
 * Customer menu for a scanned table QR (works on Wi-Fi and mobile data).
 * Reads like a printed beach-café menu: sections per category, dish photos,
 * add / adjust right on the dish, one tap to send to the cashier.
 * Self-contained styling - independent of the staff POS theme.
 */

import { useEffect, useMemo, useRef, useState } from "react";

interface TableInfo { ok: boolean; branchId: number; branchName: string; branchActive: boolean; tableId: number; tableName: string; businessName: string }
interface MenuItem { id: number; name: string; price: number; category: string; imageUrl?: string; soldOut?: boolean; tags?: string }
interface MenuResp { items?: MenuItem[]; categories?: string[]; currency?: string; rates?: { serviceCharge: number; vat: number }; error?: string }
interface Line { id: number; name: string; price: number; qty: number; imageUrl?: string }
interface Offer {
  id: number; name: string; headline: string; detail: string; note: string; type: string;
  items: { menuItemId: number; qty: number; name: string }[]; days: number[]; availableToday: boolean;
}
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
interface TrackedItem { name: string; qty: number; status: "pending" | "preparing" | "ready" }
interface TrackedOrder {
  id: number; displayNum: string; status: string; paymentStatus: string; total: number;
  createdAt: string; readyAt: string | null; dispatchedAt: string | null; items: TrackedItem[];
}

const API = "/api";
const POLL_MS = 8000;
const KEEP_MS = 12 * 3600 * 1000;   // the server also only answers for 12 h

// Orders this phone placed at this table: [{ id, at }] in localStorage.
// Storage can be blocked (private mode) - then tracking just lasts this visit.
type Saved = { id: number; at: number };
const storeKey = (token: string) => `gp-orders-${token}`;
function readSaved(token: string): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(token)) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && x.id > 0 && Date.now() - x.at < KEEP_MS) : [];
  } catch { return []; }
}
function writeSaved(token: string, list: Saved[]) {
  try { localStorage.setItem(storeKey(token), JSON.stringify(list.slice(-20))); } catch { /* ignore */ }
}

// Order status -> customer-facing step (0..4). -1 = cancelled.
const STEPS = ["Sent", "Accepted", "Cooking", "Ready", "Served"];
function stepOf(o: TrackedOrder): number {
  switch (o.status) {
    case "new": return 0;
    case "pending": return 1;
    case "preparing": return 2;
    case "ready": return 3;
    case "dispatched": case "served": case "completed": return 4;
    case "voided": return -1;
    default: return 1;
  }
}
function headlineOf(o: TrackedOrder): [string, string] {
  switch (stepOf(o)) {
    case 0: return ["Waiting for the cashier", "Your order has arrived. Our cashier will check it and send it to the kitchen."];
    case 1: return ["Sent to the kitchen", "The kitchen has your order and will start on it shortly."];
    case 2: return ["Being prepared", "Our chefs are cooking your food right now."];
    case 3: return ["Ready - on its way", "Your food is ready and coming to your table."];
    case 4: return ["Served", o.paymentStatus === "paid" ? "Enjoy your meal! Your bill is settled - thank you." : "Enjoy your meal! Ask us for the bill whenever you're ready."];
    default: return ["Order cancelled", "We couldn't take this order. Please ask a waiter - we're happy to help."];
  }
}
const isActive = (o: TrackedOrder) => { const s = stepOf(o); return s >= 0 && s < 4; };
function timeOf(s: string | null) {
  if (!s) return "";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const C = {
  bg: "#f3ebdb",      // sand
  paper: "#fbf7ef",
  ink: "#24211b",
  muted: "#7a705d",
  faint: "#a89c83",
  line: "#e2d5bb",
  sea: "#1d5c63",     // deep lagoon
  seaD: "#15464c",
  sun: "#c8711f",     // sunset
  sunSoft: "#f6e3c9",
};
const SERIF = "'Fraunces', Georgia, serif";
const SANS = "'Hanken Grotesk', system-ui, -apple-system, sans-serif";

// Soft, stable tint per dish for photo-less cards.
const TINTS = ["#e9dcc2", "#dfe6da", "#f0d9c4", "#dbe4e4", "#eadfd0", "#e6dccd"];
function tintFor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return TINTS[h % TINTS.length]; }
function initialsOf(s: string) {
  const w = s.replace(/\(.*?\)/g, "").split(/\s+/).filter((x) => /[A-Za-z]/.test(x));
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase() || "•";
}
// "Avocado Toast (Two Fried Egg)" -> name + small description line
function splitName(n: string): [string, string] {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(n);
  return m ? [m[1], m[2]] : [n, ""];
}

export default function TableMenuPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [menu, setMenu] = useState<MenuResp | null>(null);
  const [err, setErr] = useState("");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [justPlaced, setJustPlaced] = useState<string | null>(null);
  const [orderErr, setOrderErr] = useState("");
  const [tab, setTab] = useState<"menu" | "orders" | "reserve">("menu");
  const [peek, setPeek] = useState<MenuItem | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [trackErr, setTrackErr] = useState(false);
  const lastStep = useRef<Record<number, number>>({});
  const [offers, setOffers] = useState<Offer[]>([]);
  const [saving, setSaving] = useState<{ name: string; amount: number } | null>(null);

  // Remembered orders from an earlier visit (page reload, phone locked).
  useEffect(() => { setSaved(readSaved(token)); }, [token]);

  async function refreshOrders(list: Saved[] = saved) {
    if (!list.length) { setOrders([]); return; }
    try {
      const r = await fetch(`${API}/public/table-orders?token=${encodeURIComponent(token)}&ids=${list.map((x) => x.id).join(",")}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !Array.isArray(j.orders)) throw new Error();
      const next: TrackedOrder[] = j.orders;
      // Gentle buzz when an order becomes ready.
      next.forEach((o) => {
        const s = stepOf(o), prev = lastStep.current[o.id];
        if (prev !== undefined && prev < 3 && s === 3) { try { navigator.vibrate?.([180, 90, 180]); } catch { /* ignore */ } }
        lastStep.current[o.id] = s;
      });
      setOrders(next); setTrackErr(false);
      // Forget orders the server no longer returns (older than 12 h).
      if (next.length < list.length) {
        const keep = list.filter((x) => next.some((o) => o.id === x.id));
        setSaved(keep); writeSaved(token, keep);
      }
    } catch { setTrackErr(true); }
  }

  // Poll while something is still on its way; stop when everything is served
  // or the phone screen is off.
  const anyActive = orders.length === 0 ? saved.length > 0 : orders.some(isActive);
  useEffect(() => {
    if (!saved.length) return;
    refreshOrders();
    if (!anyActive) return;
    const tick = () => { if (document.visibilityState === "visible") refreshOrders(); };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [saved, anyActive]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setErr("");
    try {
      const t = await fetch(`${API}/public/table?token=${encodeURIComponent(token)}`).then((r) => r.json());
      if (!t || t.error) { setErr(t?.error || "This QR code is not recognised."); return; }
      setInfo(t);
      const m: MenuResp = await fetch(`${API}/public/menu?branchId=${t.branchId}`).then((r) => r.json());
      if (!m || m.error || !Array.isArray(m.items)) { setErr(m?.error ? `Menu: ${m.error}` : "The menu could not be loaded."); return; }
      setMenu(m);
      // Offers the restaurant chose to show (never blocks the menu).
      fetch(`${API}/public/promotions?token=${encodeURIComponent(token)}`).then((r) => r.json())
        .then((o) => setOffers(Array.isArray(o?.promotions) ? o.promotions : [])).catch(() => {});
    } catch {
      setErr("We couldn't reach the restaurant. Check your internet and try again.");
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const cur = menu?.currency || "Rs. ";
  const money = (n: number) => `${cur}${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const items = menu?.items || [];

  const cats = useMemo(() => {
    const withItems = new Set(items.map((i) => i.category));
    const ordered = (menu?.categories || []).filter((c) => withItems.has(c));
    Array.from(withItems).forEach((c) => { if (!ordered.includes(c)) ordered.push(c); });
    return ordered;
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = q.trim().length > 0;
  const groups = useMemo(() => {
    if (searching) {
      const s = q.toLowerCase();
      return [{ name: "", list: items.filter((i) => i.name.toLowerCase().includes(s) || (i.tags || "").toLowerCase().includes(s)) }];
    }
    const pick = cat === "All" ? cats : [cat];
    return pick.map((c) => ({ name: c, list: items.filter((i) => i.category === c) }));
  }, [menu, cat, q, cats]); // eslint-disable-line react-hooks/exhaustive-deps

  const offerItemIds = useMemo(() => new Set(offers.filter((o) => o.availableToday).flatMap((o) => o.items.map((i) => i.menuItemId))), [offers]);

  // Ask the restaurant what the cart saves - same rules as the real bill.
  const cartKey = cart.map((l) => `${l.id}x${l.qty}`).join(",");
  useEffect(() => {
    if (!cart.length) { setSaving(null); return; }
    const t = setTimeout(() => {
      fetch(`${API}/public/promo-preview`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, items: cart.map((l) => ({ menuItemId: l.id, qty: l.qty })) }) })
        .then((r) => r.json()).then((r) => setSaving(r?.promo && r.promo.amount > 0 ? r.promo : null)).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [cartKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function addOffer(o: Offer) {
    const byId = new Map(items.map((i) => [i.id, i]));
    setCart((prev) => {
      const next = [...prev];
      for (const c of o.items) {
        const it = byId.get(c.menuItemId); if (!it || it.soldOut) continue;
        const i = next.findIndex((l) => l.id === it.id);
        const have = i >= 0 ? next[i].qty : 0;
        const need = o.type === "daily" ? Math.max(1, have) : Math.max(c.qty, have);
        if (need === have) continue;
        if (i >= 0) next[i] = { ...next[i], qty: need };
        else next.push({ id: it.id, name: it.name, price: it.price, qty: need, imageUrl: it.imageUrl });
        if (o.type === "daily") break;   // daily deal: any one listed dish is enough
      }
      return next;
    });
    // Show the cart so the customer sees the offer applied (it closes itself if nothing could be added).
    setOrderErr(""); setCartOpen(true);
  }

  const qtyOf = (id: number) => cart.find((l) => l.id === id)?.qty || 0;
  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  function add(it: MenuItem) {
    if (it.soldOut) return;
    setCart((prev) => {
      const i = prev.findIndex((l) => l.id === it.id);
      if (i >= 0) { const c = [...prev]; c[i] = { ...c[i], qty: c[i].qty + 1 }; return c; }
      return [...prev, { id: it.id, name: it.name, price: it.price, qty: 1, imageUrl: it.imageUrl }];
    });
  }
  function changeQty(id: number, d: number) {
    setCart((prev) => prev.map((l) => l.id === id ? { ...l, qty: Math.max(0, l.qty + d) } : l).filter((l) => l.qty > 0));
  }

  async function placeOrder(customerName: string, customerPhone: string) {
    if (!cart.length) return;
    setPlacing(true); setOrderErr("");
    try {
      const r = await fetch(`${API}/public/table-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, items: cart.map((l) => ({ menuItemId: l.id, qty: l.qty })), note, customerName, customerPhone }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      if (r.orderId) {
        const list = [...saved.filter((x) => x.id !== r.orderId), { id: Number(r.orderId), at: Date.now() }];
        setSaved(list); writeSaved(token, list);
      }
      setJustPlaced(r.displayNum || "");
      setCart([]); setNote(""); setCartOpen(false);
      setTab("orders");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setOrderErr(e instanceof Error ? e.message : "Your order didn't go through. Please try again.");
    } finally { setPlacing(false); }
  }

  // ── states ────────────────────────────────────────────────
  if (err) return (
    <Shell>
      <div style={{ textAlign: "center", padding: "90px 28px" }}>
        <Plate />
        <p style={{ fontFamily: SERIF, fontSize: 21, color: C.ink, margin: "18px 0 6px" }}>Sorry about that</p>
        <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.5, margin: 0 }}>{err}</p>
        <p style={{ fontSize: 13.5, color: C.faint, marginTop: 18 }}>A waiter will be happy to take your order at the table.</p>
        <button onClick={load} style={{ ...pillBtn, marginTop: 18 }}>Try again</button>
      </div>
    </Shell>
  );
  if (!info || !menu) return <Shell><Skeleton /></Shell>;

  const rates = menu.rates || { serviceCharge: 0, vat: 0 };

  return (
    <Shell>
      {/* masthead */}
      <header style={{ padding: "34px 24px 8px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.28em", textTransform: "uppercase", color: C.sun, fontWeight: 700 }}>
          {info.branchName && info.branchName !== info.businessName ? info.branchName : "Menu"}
        </div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 36, lineHeight: 1.05, color: C.sea, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          {info.businessName}
        </h1>
        <Wave />
        <p style={{ fontSize: 14.5, color: C.muted, margin: "2px auto 0", maxWidth: 330, lineHeight: 1.5 }}>
          You&apos;re at <b style={{ color: C.ink }}>{info.tableName}</b>. Choose what you fancy and we&apos;ll bring it over.
        </p>
      </header>

      {/* menu / book switch */}
      <div style={{ display: "flex", justifyContent: "center", gap: 22, margin: "18px 0 6px" }}>
        {(saved.length ? (["menu", "orders", "reserve"] as const) : (["menu", "reserve"] as const)).map((t) => (
          <button key={t} onClick={() => { setTab(t); if (t !== "orders") setJustPlaced(null); }}
            style={{ background: "none", border: "none", padding: "4px 2px", cursor: "pointer", fontFamily: SANS, fontSize: 14.5, fontWeight: 700,
              color: tab === t ? C.ink : C.faint, borderBottom: `2px solid ${tab === t ? C.sun : "transparent"}`, display: "inline-flex", alignItems: "center", gap: 6 }}>
            {t === "menu" ? "Order here" : t === "orders" ? "My orders" : "Book a table"}
            {t === "orders" && orders.some(isActive) && (
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: C.sun, animation: "gp-pulse 1.4s ease-in-out infinite" }} />
            )}
          </button>
        ))}
      </div>

      {tab === "orders" ? (
        <OrdersView orders={orders} waiting={saved.length > 0 && orders.length === 0 && !trackErr} offline={trackErr}
          justPlaced={justPlaced} tableName={info.tableName} money={money}
          onMore={() => { setJustPlaced(null); setTab("menu"); window.scrollTo({ top: 0 }); }} />
      ) : tab === "reserve" ? (
        <ReserveForm branchId={info.branchId} />
      ) : (
        <>
          {/* sticky category bar + search */}
          <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(243,235,219,.94)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", borderBottom: `1px solid ${C.line}`, padding: "10px 0 0" }}>
            <div style={{ padding: "0 16px 8px" }}>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 13, top: 10, color: C.faint, fontSize: 15 }}>⌕</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Looking for something?" inputMode="search"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px 10px 34px", borderRadius: 999, border: `1px solid ${C.line}`, background: C.paper, color: C.ink, fontSize: 15, outline: "none", fontFamily: SANS }} />
              </div>
            </div>
            {!searching && cats.length > 1 && (
              <nav style={{ display: "flex", gap: 20, overflowX: "auto", padding: "2px 18px 0", scrollbarWidth: "none" }}>
                {["All", ...cats].map((c) => (
                  <button key={c} onClick={() => { setCat(c); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                    style={{ flex: "none", background: "none", border: "none", cursor: "pointer", padding: "6px 0 9px", fontFamily: SANS, fontSize: 14, fontWeight: 700,
                      color: cat === c ? C.ink : C.muted, borderBottom: `2.5px solid ${cat === c ? C.sun : "transparent"}` }}>
                    {c}
                  </button>
                ))}
              </nav>
            )}
          </div>

          <main style={{ padding: "4px 16px 130px" }}>
            {orders.filter(isActive).slice(0, 1).map((o) => (
              <button key={o.id} onClick={() => { setTab("orders"); window.scrollTo({ top: 0 }); }}
                style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14,
                  border: `1px solid ${C.line}`, background: C.paper, cursor: "pointer", textAlign: "left", fontFamily: SANS }}>
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: C.sun, flexShrink: 0, animation: "gp-pulse 1.4s ease-in-out infinite" }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: C.ink }}>
                  Order <b>{o.displayNum}</b> · {headlineOf(o)[0]}
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.sea }}>Track ›</span>
              </button>
            ))}
            {!searching && offers.length > 0 && (
              <section style={{ marginTop: 18 }} aria-label="Offers">
                <div style={{ fontSize: 11.5, letterSpacing: ".2em", textTransform: "uppercase", color: C.sun, fontWeight: 700, margin: "0 2px 8px" }}>
                  {offers.some((o) => o.availableToday) ? "Today's offers" : "Offers"}
                </div>
                <div style={{ display: "flex", gap: 10, overflowX: "auto", scrollSnapType: "x mandatory", paddingBottom: 4, scrollbarWidth: "none" }}>
                  {offers.map((o) => (
                    <OfferCard key={o.id} o={o} single={offers.length === 1} onAdd={() => addOffer(o)} />
                  ))}
                </div>
              </section>
            )}
            {!items.length ? (
              <Empty title="The menu isn't online yet" body="Please call a waiter - we'll take your order at the table." />
            ) : groups.every((g) => !g.list.length) ? (
              <Empty title={`Nothing called “${q}”`} body="Try another word, or browse the sections above." />
            ) : groups.map((g) => g.list.length ? (
              <section key={g.name || "results"} style={{ marginTop: 22 }}>
                {g.name && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "0 2px 10px" }}>
                    <h2 style={{ fontFamily: SERIF, fontSize: 23, fontWeight: 600, color: C.ink, margin: 0 }}>{g.name}</h2>
                    <span style={{ flex: 1, borderBottom: `1px dashed ${C.line}`, transform: "translateY(-5px)" }} />
                    <span style={{ fontSize: 12, color: C.faint }}>{g.list.length}</span>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {g.list.map((it) => (
                    <Dish key={it.id} it={it} qty={qtyOf(it.id)} money={money} onOffer={offerItemIds.has(it.id)}
                      onOpen={() => setPeek(it)} onAdd={() => add(it)} onMinus={() => changeQty(it.id, -1)} />
                  ))}
                </div>
              </section>
            ) : null)}
          </main>
        </>
      )}

      {/* cart bar */}
      {tab === "menu" && count > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, padding: "10px 14px calc(14px + env(safe-area-inset-bottom))", background: "linear-gradient(rgba(243,235,219,0), rgba(243,235,219,.95) 35%)", zIndex: 30 }}>
          <button onClick={() => { setOrderErr(""); setCartOpen(true); }}
            style={{ width: "100%", maxWidth: 560, margin: "0 auto", display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderRadius: 16, border: "none",
              background: C.sea, color: "#fff", fontFamily: SANS, fontSize: 15.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 12px 28px -12px rgba(21,70,76,.7)" }}>
            <span style={{ background: "rgba(255,255,255,.18)", borderRadius: 8, minWidth: 26, height: 26, display: "grid", placeItems: "center", fontSize: 13.5 }}>{count}</span>
            <span style={{ flex: 1, textAlign: "left" }}>Review order</span>
            <span>{saving ? <><s style={{ opacity: .6, fontWeight: 500, marginRight: 6 }}>{money(total)}</s>{money(Math.max(0, total - saving.amount))}</> : money(total)}</span>
          </button>
        </div>
      )}

      {peek && (
        <DishSheet it={peek} qty={qtyOf(peek.id)} money={money} onClose={() => setPeek(null)}
          onAdd={() => add(peek)} onMinus={() => changeQty(peek.id, -1)} />
      )}

      {cartOpen && (
        <CartSheet cart={cart} money={money} note={note} setNote={setNote} changeQty={changeQty} total={total} saving={saving}
          rates={rates} placing={placing} error={orderErr} tableName={info.tableName}
          onClose={() => setCartOpen(false)} onPlace={placeOrder} />
      )}
    </Shell>
  );
}

/* ── pieces ─────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: SANS, WebkitFontSmoothing: "antialiased" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
      <style>{`nav::-webkit-scrollbar{display:none} @keyframes gp-up{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}} @keyframes gp-pulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function Wave() {
  return (
    <svg width="120" height="14" viewBox="0 0 120 14" aria-hidden style={{ display: "block", margin: "12px auto 10px" }}>
      <path d="M2 8 C 12 1, 22 1, 32 8 S 52 15, 62 8 S 82 1, 92 8 S 112 15, 118 8" fill="none" stroke={C.sun} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Plate() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden style={{ display: "block", margin: "0 auto" }}>
      <circle cx="32" cy="32" r="22" fill={C.paper} stroke={C.line} strokeWidth="2" />
      <circle cx="32" cy="32" r="14" fill="none" stroke={C.line} strokeWidth="1.5" />
      <path d="M6 14v14M3 14v8a3 3 0 0 0 6 0v-8M58 14c-3 2-4 7-4 11h4v15" fill="none" stroke={C.faint} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Thumb({ it, size, radius = 14 }: { it: { name: string; imageUrl?: string }; size: number | string; radius?: number }) {
  const [broken, setBroken] = useState(false);
  const box: React.CSSProperties = { width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: "hidden" };
  if (it.imageUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={it.imageUrl} alt={it.name} loading="lazy" decoding="async" onError={() => setBroken(true)}
        style={{ ...box, objectFit: "cover", display: "block", background: tintFor(it.name) }} />
    );
  }
  return (
    <div aria-hidden style={{ ...box, background: tintFor(it.name), display: "grid", placeItems: "center" }}>
      <span style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: typeof size === "number" ? size * 0.34 : 40, color: "rgba(36,33,27,.38)" }}>{initialsOf(it.name)}</span>
    </div>
  );
}

function Stepper({ qty, onAdd, onMinus, big = false }: { qty: number; onAdd: () => void; onMinus: () => void; big?: boolean }) {
  const h = big ? 44 : 34;
  if (!qty) {
    return (
      <button onClick={(e) => { e.stopPropagation(); onAdd(); }}
        style={{ height: h, padding: big ? "0 26px" : "0 16px", borderRadius: 999, border: `1.5px solid ${C.sea}`, background: big ? C.sea : C.paper,
          color: big ? "#fff" : C.sea, fontFamily: SANS, fontWeight: 700, fontSize: big ? 15.5 : 14, cursor: "pointer" }}>
        Add
      </button>
    );
  }
  const b: React.CSSProperties = { width: h, height: h, border: "none", background: "transparent", color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1 };
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", height: h, borderRadius: 999, background: C.sea, color: "#fff" }}>
      <button aria-label="One less" onClick={onMinus} style={b}>−</button>
      <span style={{ minWidth: 18, textAlign: "center", fontWeight: 700, fontSize: big ? 16 : 14.5 }}>{qty}</span>
      <button aria-label="One more" onClick={onAdd} style={b}>+</button>
    </div>
  );
}

function Dish({ it, qty, money, onOffer, onOpen, onAdd, onMinus }: {
  it: MenuItem; qty: number; money: (n: number) => string; onOffer?: boolean; onOpen: () => void; onAdd: () => void; onMinus: () => void;
}) {
  const [title, desc] = splitName(it.name);
  return (
    <article onClick={onOpen}
      style={{ display: "flex", gap: 14, padding: 12, borderRadius: 18,
        background: onOffer && !it.soldOut ? "#fbeedd" : C.paper,
        border: qty ? `1px solid ${C.sea}` : onOffer && !it.soldOut ? `1.5px solid ${C.sun}` : `1px solid ${C.line}`,
        cursor: "pointer", opacity: it.soldOut ? 0.55 : 1, transition: "border-color .15s" }}>
      <Thumb it={it} size={92} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, lineHeight: 1.22, color: C.ink }}>
          {title}
          {onOffer && !it.soldOut && (
            <span style={{ display: "inline-block", marginLeft: 7, verticalAlign: "3px", fontFamily: SANS, fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em",
              textTransform: "uppercase", color: "#fff", background: C.sun, borderRadius: 6, padding: "2px 6px" }}>Offer</span>
          )}
        </div>
        {desc && <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.4, marginTop: 3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{desc}</div>}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: C.sun }}>{money(it.price)}</span>
          {it.soldOut
            ? <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em" }}>Sold out today</span>
            : <Stepper qty={qty} onAdd={onAdd} onMinus={onMinus} />}
        </div>
      </div>
    </article>
  );
}

function OfferCard({ o, single, onAdd }: { o: Offer; single: boolean; onAdd: () => void }) {
  const when = o.days.length && o.days.length < 7 ? o.days.map((d) => DAY_SHORT[d]).join(", ") : "";
  return (
    <div style={{ flex: single ? "1 1 auto" : "0 0 78%", maxWidth: single ? "none" : 320, scrollSnapAlign: "start", borderRadius: 18, padding: "14px 15px",
      background: o.availableToday ? `linear-gradient(135deg, ${C.sea} 0%, ${C.seaD} 100%)` : C.paper,
      color: o.availableToday ? "#fff" : C.ink, border: o.availableToday ? "none" : `1px dashed ${C.line}`, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 600, lineHeight: 1.05, color: o.availableToday ? "#ffd9a8" : C.sun }}>{o.headline}</div>
      <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{o.name}</div>
      <div style={{ fontSize: 13, lineHeight: 1.4, opacity: .85 }}>{o.detail}</div>
      {o.note && <div style={{ fontSize: 12.5, lineHeight: 1.4, opacity: .8, fontStyle: "italic" }}>{o.note}</div>}
      <div style={{ flex: 1 }} />
      {o.availableToday ? (
        <button onClick={onAdd} style={{ alignSelf: "flex-start", marginTop: 8, padding: "8px 14px", borderRadius: 999, border: "none", background: "#fff", color: C.seaD,
          fontFamily: SANS, fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>Add to my order</button>
      ) : (
        <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: C.muted }}>Available {when || "on other days"}</div>
      )}
      {o.availableToday && when && <div style={{ fontSize: 11.5, opacity: .75 }}>Every {when}</div>}
    </div>
  );
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(25,22,16,.5)", zIndex: 50, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div ref={ref} onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 600, background: C.bg, borderRadius: "24px 24px 0 0", maxHeight: "90vh", overflowY: "auto", animation: "gp-up .22s ease-out",
          paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: C.line, margin: "10px auto 0" }} />
        {children}
      </div>
    </div>
  );
}

function DishSheet({ it, qty, money, onClose, onAdd, onMinus }: {
  it: MenuItem; qty: number; money: (n: number) => string; onClose: () => void; onAdd: () => void; onMinus: () => void;
}) {
  const [title, desc] = splitName(it.name);
  return (
    <Sheet onClose={onClose}>
      <div style={{ padding: "14px 18px 22px" }}>
        <Thumb it={it} size="100%" radius={18} />
        <div style={{ fontSize: 11.5, letterSpacing: ".18em", textTransform: "uppercase", color: C.sun, fontWeight: 700, marginTop: 16 }}>{it.category}</div>
        <h3 style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 600, color: C.ink, margin: "4px 0 6px", lineHeight: 1.15 }}>{title}</h3>
        {desc && <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.5, margin: 0 }}>{desc}</p>}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
          <span style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 600, color: C.sun }}>{money(it.price)}</span>
          {it.soldOut
            ? <span style={{ fontWeight: 700, color: C.muted }}>Sold out today</span>
            : <Stepper big qty={qty} onAdd={onAdd} onMinus={onMinus} />}
        </div>
        {qty > 0 && <button onClick={onClose} style={{ ...pillBtn, width: "100%", marginTop: 16, background: "transparent", color: C.sea, border: `1.5px solid ${C.sea}` }}>Keep browsing</button>}
      </div>
    </Sheet>
  );
}

function CartSheet({ cart, money, note, setNote, changeQty, total, saving, rates, placing, error, tableName, onClose, onPlace }: {
  cart: Line[]; money: (n: number) => string; note: string; setNote: (v: string) => void;
  changeQty: (id: number, d: number) => void; total: number; saving: { name: string; amount: number } | null; rates: { serviceCharge: number; vat: number };
  placing: boolean; error: string; tableName: string; onClose: () => void; onPlace: (name: string, phone: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const extras = [rates.serviceCharge > 0 ? `${rates.serviceCharge}% service charge` : "", rates.vat > 0 ? `${rates.vat}% VAT` : ""].filter(Boolean);
  useEffect(() => { if (!cart.length) onClose(); }, [cart.length, onClose]);
  return (
    <Sheet onClose={onClose}>
      <div style={{ padding: "12px 18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, color: C.sea, margin: 0 }}>Your order</h3>
          <span style={{ fontSize: 13, color: C.muted }}>{tableName}</span>
        </div>
        <div style={{ marginTop: 10 }}>
          {cart.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <Thumb it={l} size={46} radius={10} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink, lineHeight: 1.3 }}>{splitName(l.name)[0]}</div>
                <div style={{ fontSize: 13, color: C.sun, fontWeight: 700, marginTop: 2 }}>{money(l.price * l.qty)}</div>
              </div>
              <Stepper qty={l.qty} onAdd={() => changeQty(l.id, 1)} onMinus={() => changeQty(l.id, -1)} />
            </div>
          ))}
        </div>

        <label style={lbl}>Anything for the kitchen?</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Less spicy, no onions, bring the drinks first…"
          style={{ ...inp, resize: "none" }} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label style={lbl}>Your name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" style={inp} /></div>
          <div style={{ flex: 1 }}><label style={lbl}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" inputMode="tel" style={inp} /></div>
        </div>

        {saving && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 16, padding: "10px 12px", borderRadius: 12, background: C.sunSoft }}>
            <span style={{ fontSize: 13.5, color: C.ink, fontWeight: 600 }}>🎉 Offer: {saving.name}</span>
            <span style={{ fontSize: 14, color: C.sun, fontWeight: 800, whiteSpace: "nowrap" }}>−{money(saving.amount)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 0 2px" }}>
          <span style={{ fontSize: 14.5, color: C.muted }}>Food total</span>
          <span style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, color: C.ink }}>
            {saving && <s style={{ fontSize: 15, color: C.faint, fontWeight: 500, marginRight: 8 }}>{money(total)}</s>}
            {money(Math.max(0, total - (saving?.amount || 0)))}
          </span>
        </div>
        {extras.length > 0 && <div style={{ fontSize: 12.5, color: C.faint, textAlign: "right" }}>{extras.join(" + ")} added to the bill</div>}
        <p style={{ fontSize: 12.5, color: C.faint, margin: "10px 0 0" }}>You pay at the end - no payment needed now.</p>

        {error && (
          <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "#f7dfd6", color: "#8a2f17", fontSize: 13.5, lineHeight: 1.4 }}>{error}</div>
        )}
        <button onClick={() => onPlace(name, phone)} disabled={placing}
          style={{ width: "100%", marginTop: 14, padding: 16, borderRadius: 16, border: "none", background: placing ? C.faint : C.sea, color: "#fff",
            fontFamily: SANS, fontSize: 16, fontWeight: 700, cursor: placing ? "default" : "pointer" }}>
          {placing ? "Sending…" : "Send my order"}
        </button>
      </div>
    </Sheet>
  );
}

/* ── order tracker ─────────────────────────────────────────── */

function OrdersView({ orders, waiting, offline, justPlaced, tableName, money, onMore }: {
  orders: TrackedOrder[]; waiting: boolean; offline: boolean; justPlaced: string | null;
  tableName: string; money: (n: number) => string; onMore: () => void;
}) {
  const active = orders.filter(isActive);
  const done = orders.filter((o) => !isActive(o));
  return (
    <div style={{ padding: "8px 16px 60px" }}>
      {justPlaced !== null && (
        <div style={{ textAlign: "center", padding: "14px 10px 6px" }}>
          <div style={{ width: 62, height: 62, borderRadius: "50%", background: C.sunSoft, display: "grid", placeItems: "center", margin: "0 auto", fontSize: 28 }}>🙌</div>
          <h2 style={{ fontFamily: SERIF, color: C.sea, fontSize: 25, fontWeight: 600, margin: "12px 0 4px" }}>Thank you!</h2>
          <p style={{ color: C.muted, fontSize: 14.5, lineHeight: 1.5, margin: "0 auto", maxWidth: 330 }}>
            {justPlaced ? <>Order <b style={{ color: C.ink }}>{justPlaced}</b> is on its way to <b style={{ color: C.ink }}>{tableName}</b>.</> : <>Your order is in.</>}{" "}
            Keep this page open to follow it.
          </p>
        </div>
      )}

      {offline && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: C.sunSoft, color: "#7a4a12", fontSize: 13.5, lineHeight: 1.4 }}>
          Can&apos;t reach the restaurant right now - we&apos;ll keep trying. Your order is still with us.
        </div>
      )}
      {waiting && <div style={{ marginTop: 14 }}><div style={{ height: 150, borderRadius: 18, background: C.line, animation: "gp-pulse 1.4s ease-in-out infinite" }} /></div>}

      {active.map((o) => <OrderCard key={o.id} o={o} money={money} />)}

      {done.length > 0 && (
        <>
          {active.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: C.faint, margin: "24px 4px 0" }}>Earlier</div>}
          {done.map((o) => <OrderCard key={o.id} o={o} money={money} compact />)}
        </>
      )}

      <button onClick={onMore} style={{ ...pillBtn, width: "100%", marginTop: 20, padding: 15, borderRadius: 16, background: "transparent", color: C.sea, border: `1.5px solid ${C.sea}` }}>
        Order something else
      </button>
    </div>
  );
}

function OrderCard({ o, money, compact = false }: { o: TrackedOrder; money: (n: number) => string; compact?: boolean }) {
  const step = stepOf(o);
  const [title, body] = headlineOf(o);
  const cancelled = step < 0;
  const accent = cancelled ? "#a33a1c" : step >= 3 ? C.sea : C.sun;
  const doneDishes = o.items.filter((i) => i.status === "ready").length;
  const showDishStatus = step >= 1 && step <= 2;
  return (
    <section style={{ marginTop: 14, padding: compact ? "14px 16px" : "18px 16px", borderRadius: 18, background: C.paper, border: `1px solid ${C.line}`, opacity: compact && !cancelled ? 0.85 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>Order {o.displayNum} · {timeOf(o.createdAt)}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{money(o.total)}</span>
      </div>
      <h3 style={{ fontFamily: SERIF, fontSize: compact ? 19 : 23, fontWeight: 600, color: accent, margin: "6px 0 4px", lineHeight: 1.2 }}>{title}</h3>
      {!compact && <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.5, margin: 0 }}>{body}</p>}

      {!cancelled && !compact && (
        <ol aria-label="Order progress" style={{ listStyle: "none", padding: 0, margin: "18px 0 4px", display: "grid", gridTemplateColumns: `repeat(${STEPS.length}, 1fr)` }}>
          {STEPS.map((label, i) => {
            const reached = i <= step, current = i === step;
            return (
              <li key={label} aria-current={current ? "step" : undefined} style={{ position: "relative", textAlign: "center" }}>
                {i > 0 && <span aria-hidden style={{ position: "absolute", top: 9, right: "50%", width: "100%", height: 3, background: reached ? accent : C.line }} />}
                <span aria-hidden style={{ position: "relative", display: "grid", placeItems: "center", width: 21, height: 21, margin: "0 auto", borderRadius: "50%",
                  background: reached ? accent : C.paper, border: `2px solid ${reached ? accent : C.line}`, color: "#fff", fontSize: 11, fontWeight: 700,
                  boxShadow: current ? `0 0 0 5px ${step >= 3 ? "rgba(29,92,99,.15)" : "rgba(200,113,31,.18)"}` : "none",
                  animation: current && step < 4 ? "gp-pulse 1.6s ease-in-out infinite" : "none" }}>
                  {reached && !current ? "✓" : ""}
                </span>
                <span style={{ display: "block", marginTop: 6, fontSize: 11.5, fontWeight: current ? 700 : 500, color: reached ? C.ink : C.faint }}>{label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {!compact && (
        <div style={{ marginTop: 14, borderTop: `1px dashed ${C.line}`, paddingTop: 8 }}>
          {showDishStatus && o.items.length > 1 && (
            <div style={{ fontSize: 12.5, color: C.muted, margin: "2px 0 4px" }}>{doneDishes} of {o.items.length} dishes ready</div>
          )}
          {o.items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 14 }}>
              <span style={{ color: C.muted, minWidth: 24 }}>{it.qty}×</span>
              <span style={{ flex: 1, minWidth: 0, color: C.ink }}>{splitName(it.name)[0]}</span>
              {showDishStatus && <DishChip status={it.status} />}
            </div>
          ))}
        </div>
      )}
      {compact && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{o.items.map((it) => `${it.qty}× ${splitName(it.name)[0]}`).join(", ")}</div>}
    </section>
  );
}

function DishChip({ status }: { status: TrackedItem["status"] }) {
  const s = status === "ready" ? { t: "Ready", bg: "#dbe9e6", fg: C.seaD }
    : status === "preparing" ? { t: "Cooking", bg: C.sunSoft, fg: "#8a4b12" }
    : { t: "Waiting", bg: "#ece4d3", fg: C.muted };
  return <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: s.bg, color: s.fg }}>{s.t}</span>;
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px" }}>
      <Plate />
      <p style={{ fontFamily: SERIF, fontSize: 20, color: C.ink, margin: "16px 0 6px" }}>{title}</p>
      <p style={{ fontSize: 14.5, color: C.muted, margin: 0, lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

function Skeleton() {
  const bar = (w: number | string, h: number, mt = 0): React.CSSProperties => ({ width: w, height: h, borderRadius: 8, background: C.line, marginTop: mt, animation: "gp-pulse 1.4s ease-in-out infinite" });
  return (
    <div style={{ padding: "40px 16px" }}>
      <div style={{ ...bar(90, 10), margin: "0 auto" }} />
      <div style={{ ...bar(220, 30, 12), margin: "12px auto 0" }} />
      <div style={{ ...bar(260, 12, 26), margin: "26px auto 34px" }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: "flex", gap: 14, padding: 12, borderRadius: 18, background: C.paper, border: `1px solid ${C.line}`, marginBottom: 10 }}>
          <div style={{ ...bar(92, 92), borderRadius: 14 }} />
          <div style={{ flex: 1 }}><div style={bar("70%", 16, 4)} /><div style={bar("45%", 12, 10)} /><div style={bar(70, 14, 30)} /></div>
        </div>
      ))}
    </div>
  );
}

function ReserveForm({ branchId }: { branchId: number }) {
  const [f, setF] = useState({ customerName: "", customerPhone: "", partySize: "2", reserveDate: "", reserveTime: "19:00", note: "" });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    if (!f.customerName && !f.customerPhone) { setError("Please add your name or phone number."); return; }
    if (!f.reserveDate || !f.reserveTime) { setError("Pick a date and a time."); return; }
    setBusy(true);
    try {
      const r = await fetch(`${API}/public/reservation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, partySize: Number(f.partySize) || 1, branchId }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "That didn't go through. Please try again."); }
    finally { setBusy(false); }
  }
  if (done) return (
    <div style={{ textAlign: "center", padding: "46px 26px" }}>
      <div style={{ width: 70, height: 70, borderRadius: "50%", background: C.sunSoft, display: "grid", placeItems: "center", margin: "0 auto", fontSize: 30 }}>📅</div>
      <h2 style={{ fontFamily: SERIF, color: C.sea, fontSize: 26, fontWeight: 600, margin: "18px 0 8px" }}>Request received</h2>
      <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.55 }}>We&apos;ll confirm your table shortly. See you soon!</p>
    </div>
  );
  return (
    <div style={{ padding: "8px 18px 40px" }}>
      <p style={{ textAlign: "center", color: C.muted, fontSize: 14.5, margin: "6px 0 10px" }}>Coming back later? Tell us when and we&apos;ll keep a table for you.</p>
      <label style={lbl}>Name</label><input style={inp} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
      <label style={lbl}>Phone</label><input style={inp} inputMode="tel" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.3fr 1fr", gap: 10 }}>
        <div><label style={lbl}>Guests</label><input style={inp} type="number" min={1} value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} /></div>
        <div><label style={lbl}>Date</label><input style={inp} type="date" value={f.reserveDate} onChange={(e) => setF({ ...f, reserveDate: e.target.value })} /></div>
        <div><label style={lbl}>Time</label><input style={inp} type="time" value={f.reserveTime} onChange={(e) => setF({ ...f, reserveTime: e.target.value })} /></div>
      </div>
      <label style={lbl}>Anything we should know?</label>
      <input style={inp} placeholder="Birthday, beach-side table…" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {error && <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "#f7dfd6", color: "#8a2f17", fontSize: 13.5 }}>{error}</div>}
      <button onClick={submit} disabled={busy} style={{ ...pillBtn, width: "100%", marginTop: 18, padding: 15, borderRadius: 16 }}>
        {busy ? "Sending…" : "Request a table"}
      </button>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  padding: "12px 26px", borderRadius: 999, border: "none", background: C.sea, color: "#fff",
  fontFamily: SANS, fontSize: 15, fontWeight: 700, cursor: "pointer",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: C.muted, margin: "14px 2px 6px" };
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 12, border: `1px solid ${C.line}`,
  background: C.paper, color: C.ink, fontSize: 15, outline: "none", fontFamily: SANS,
};
