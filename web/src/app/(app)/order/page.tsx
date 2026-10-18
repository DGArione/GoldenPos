"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search, Plus, Minus, Trash2, Flame, Send, CreditCard, ShoppingBag,
  User, UserPlus, X, Pause, Play, RotateCcw, Timer, ClipboardList,
} from "lucide-react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { printKitchenTicket } from "@/lib/printing";
import { useAuth } from "@/lib/auth";
import { MenuItem, CartLine, TableRow, Order, ModifierGroup } from "@/lib/types";
import { PageLoader, EmptyState, useToast, Modal } from "@/components/ui";
import { TodayPromotionsStrip, todayOfferItemIds, useTodayPromotions } from "@/components/TodayPromotions";

interface Customer {
  id: number;
  name: string;
  phone: string;
  address: string;
  loyaltyPoints?: number;
}
interface HeldOrder {
  id: number;
  label: string;
  staffName: string;
  orderType: string;
  tableId: number | null;
  tableName: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  items: CartLine[];
  note: string;
  priority: string;
  heldAt: string;
}

type OrderType = "dine-in" | "takeaway" | "delivery";

function OrderInner() {
  const router = useRouter();
  const params = useSearchParams();
  const settings = useSettings();
  const toast = useToast();
  const { user } = useAuth();
  const currency = settings?.currencySymbol || "Rs. ";

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>("All");
  const [q, setQ] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const [tableId, setTableId] = useState<number | null>(null);
  const [priority, setPriority] = useState(false);
  const [note, setNote] = useState("");
  const [cust, setCust] = useState({ name: "", phone: "", address: "" });
  const [sending, setSending] = useState(false);
  const [modItem, setModItem] = useState<MenuItem | null>(null);
  const [custLookupOpen, setCustLookupOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Resizable cart panel width (px). Remembered per terminal.
  const [cartWidth, setCartWidth] = useState(380);
  const dragging = useRef(false);
  useEffect(() => {
    try { const w = Number(localStorage.getItem("pos-cart-width")); if (w >= 300 && w <= 640) setCartWidth(w); } catch {}
  }, []);
  useEffect(() => {
    function move(e: MouseEvent) {
      if (!dragging.current) return;
      const w = Math.min(640, Math.max(300, window.innerWidth - e.clientX - 20));
      setCartWidth(w);
    }
    function up() {
      if (dragging.current) { dragging.current = false; document.body.style.cursor = ""; try { localStorage.setItem("pos-cart-width", String(cartWidth)); } catch {} }
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [cartWidth]);

  const canManageSeq = user?.role === "manager" || user?.role === "superManager";

  // Keyboard shortcuts: F2 search, F4 send to kitchen, F8 send & pay, F9 hold.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === "F4" && !inField) { e.preventDefault(); send(false); }
      else if (e.key === "F8" && !inField) { e.preventDefault(); send(true); }
      else if (e.key === "F9" && !inField) { e.preventDefault(); holdOrder(); }
      else if (e.key === "/" && !inField) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, orderType, tableId, cust, note, priority, sending]);

  const loadHeld = useCallback(() => {
    apiGet<HeldOrder[]>("/held-orders").then((d) => setHeldOrders(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      apiGet<{ items?: MenuItem[] } | MenuItem[]>("/menu"),
      apiGet<string[] | { name: string }[]>("/categories"),
      apiGet<TableRow[]>("/tables"),
    ]).then(([m, c, t]) => {
      const items = Array.isArray(m) ? m : m.items || [];
      setMenu(items.filter((i) => !i.soldOut));
      const catNames = Array.isArray(c) ? c.map((x) => (typeof x === "string" ? x : x.name)) : [];
      setCats(catNames.length ? catNames : Array.from(new Set(items.map((i) => i.category))));
      setTables(Array.isArray(t) ? t : []);
    }).catch(() => toast.push("bad", "Could not load the menu"))
      .finally(() => setLoading(false));
    const presetTable = params.get("tableId");
    if (presetTable) setTableId(Number(presetTable));
    loadHeld();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promos = useTodayPromotions();
  const offerIds = useMemo(() => todayOfferItemIds(promos), [promos]);

  const filtered = useMemo(() => {
    let list = menu;
    if (activeCat !== "All") list = list.filter((i) => i.category === activeCat);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = menu.filter((i) => i.name.toLowerCase().includes(s) || (i.plu || "").includes(s));
    }
    return list;
  }, [menu, activeCat, q]);

  function addLine(item: MenuItem, modifiers: CartLine["modifiers"] = [], qty = 1, notes = "") {
    const modTotal = modifiers.reduce((s, m) => s + m.priceDelta, 0);
    setCart((prev) => {
      if (!modifiers.length && !notes) {
        const idx = prev.findIndex((c) => c.menuItemId === item.id && !c.modifiers.length && !c.notes);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = { ...copy[idx], qty: copy[idx].qty + qty, lineTotal: +(copy[idx].basePrice * (copy[idx].qty + qty)).toFixed(2) };
          return copy;
        }
      }
      return [...prev, {
        menuItemId: item.id, name: item.name, basePrice: item.price, qty,
        modifiers, notes, stationId: item.stationId ?? null,
        lineTotal: +((item.price + modTotal) * qty).toFixed(2),
      }];
    });
  }

  function onItemClick(item: MenuItem) {
    if (item.modifiers && item.modifiers.length) setModItem(item);
    else addLine(item);
  }

  function changeQty(i: number, delta: number) {
    setCart((prev) => {
      const copy = [...prev];
      const line = copy[i];
      if (!line) return prev;
      const unit = line.lineTotal / line.qty;
      const nextQty = Math.max(1, line.qty + delta);
      copy[i] = { ...line, qty: nextQty, lineTotal: +(unit * nextQty).toFixed(2) };
      return copy;
    });
  }

  const subtotal = cart.reduce((s, c) => s + c.lineTotal, 0);

  // Live promotion preview — the backend auto-applies the best promo on send,
  // this just shows the customer/cashier what will come off.
  const [promo, setPromo] = useState<{ name: string; amount: number } | null>(null);
  useEffect(() => {
    if (!cart.length) { setPromo(null); return; }
    const t = setTimeout(() => {
      apiPost<{ promo: { name: string; amount: number } | null }>("/promotions/preview", {
        items: cart.map((c) => ({ menuItemId: c.menuItemId, qty: c.qty, lineTotal: c.lineTotal })),
      }).then((r) => setPromo(r.promo && r.promo.amount > 0 ? r.promo : null)).catch(() => setPromo(null));
    }, 300);
    return () => clearTimeout(t);
  }, [cart]);

  async function send(thenPay: boolean) {
    if (!cart.length || sending) return;
    setSending(true);
    const walkInLabel = { takeaway: "Takeaway", delivery: "Delivery", "dine-in": "Walk-in" }[orderType];
    try {
      const order = await apiPost<Order>("/orders", {
        tableId: orderType === "dine-in" ? tableId : null,
        items: cart,
        orderType,
        note,
        tableNameOverride: orderType === "dine-in" && tableId ? (tables.find((t) => t.id === tableId)?.name || "Table") : walkInLabel,
        priority: priority ? "high" : "normal",
        customerName: cust.name, customerPhone: cust.phone, customerAddress: cust.address,
      });
      if (settings?.printAgentEnabled && settings.kitchenPrinterName) {
        const printed = await printKitchenTicket({ ...order, items: order.items?.length ? order.items : cart }, settings);
        if (!printed) toast.push("bad", "Order saved, but the kitchen ticket could not print. Check Printer Management.");
      }
      if (thenPay) {
        router.push(`/payment?orderId=${order.id}`);
      } else {
        toast.push("ok", `${order.displayNum} sent to kitchen · ${money(order.total, currency)}`);
        resetCart();
      }
    } catch (e) {
      toast.push("bad", e instanceof Error ? e.message : "Failed to send order");
    } finally { setSending(false); }
  }

  async function holdOrder() {
    if (!cart.length) { toast.push("info", "Nothing to hold"); return; }
    try {
      await apiPost("/held-orders", {
        label: cust.name || tables.find((t) => t.id === tableId)?.name || orderType,
        orderType, tableId, tableName: tables.find((t) => t.id === tableId)?.name || "",
        customerName: cust.name, customerPhone: cust.phone, customerAddress: cust.address,
        items: cart, note, priority: priority ? "high" : "normal",
      });
      toast.push("ok", "Order held");
      resetCart();
      loadHeld();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed to hold"); }
  }

  async function recallHeld(h: HeldOrder) {
    // Hold current cart first if any items so nothing is lost.
    if (cart.length) await holdOrder();
    setCart(h.items);
    setOrderType((h.orderType as OrderType) || "dine-in");
    setTableId(h.tableId || null);
    setCust({ name: h.customerName || "", phone: h.customerPhone || "", address: h.customerAddress || "" });
    setNote(h.note || "");
    setPriority(h.priority === "high");
    try { await apiDelete(`/held-orders/${h.id}`); loadHeld(); }
    catch { /* ignore */ }
    setHeldOpen(false);
    toast.push("ok", `Recalled ${h.label || h.orderType}`);
  }

  function resetCart() {
    setCart([]); setNote(""); setPriority(false);
    setCust({ name: "", phone: "", address: "" });
    setTableId(null);
  }

  async function resetOrderNumber() {
    if (!confirm("Reset today's order number counter back to 1?")) return;
    try {
      await apiPost("/order-sequence/reset");
      toast.push("ok", "Order number counter reset");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
  }

  if (loading) return <PageLoader label="Loading menu" />;

  const typeTabs: OrderType[] = ["dine-in", "takeaway", "delivery"];

  return (
    <div className="flex gap-0 overflow-hidden" style={{ height: "calc(100dvh - 84px)" }}>
      {/* ===== Menu side (its own panel for clear separation) ===== */}
      <div
        className="min-w-0 flex-1 flex flex-col gap-3 min-h-0 rounded-[var(--r-2xl)] p-3 md:p-4"
        style={{ background: "var(--panel)", boxShadow: "var(--shadow-sm)" }}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              className="inp pl-9 pr-16"
              placeholder="Search dish or PLU…  (F2)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10.5px] font-semibold text-muted">
              F2
            </span>
          </div>

          {/* Customer chip or button */}
          {cust.name || cust.phone ? (
            <div
              className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ background: "var(--olive-wash)", color: "var(--olive-700)", border: "1px solid var(--olive)" }}
            >
              <User size={14} />
              <span>{cust.name || cust.phone}</span>
              <button onClick={() => setCust({ name: "", phone: "", address: "" })} aria-label="Clear customer" className="opacity-70 hover:opacity-100">
                <X size={13} />
              </button>
            </div>
          ) : (
            <button onClick={() => setCustLookupOpen(true)} className="btn btn-ghost btn-sm" title="Attach customer">
              <UserPlus size={14} /> Customer
            </button>
          )}

          {/* Hold list */}
          <button onClick={() => setHeldOpen(true)} className="btn btn-ghost btn-sm relative" title="Held orders (recall)">
            <ClipboardList size={14} /> Held
            {heldOrders.length > 0 && (
              <span className="absolute -right-1.5 -top-1.5 pill pill-info" style={{ padding: "0 5px", fontSize: 9 }}>
                {heldOrders.length}
              </span>
            )}
          </button>

          {canManageSeq && (
            <button onClick={resetOrderNumber} className="btn btn-ghost btn-sm" title="Reset today's order number counter back to 1">
              <RotateCcw size={14} /> Reset #
            </button>
          )}
        </div>

        {/* Today's promotions */}
        <TodayPromotionsStrip list={promos} />

        {/* Categories (scrollable row) */}
        {!q && (
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
            {["All", ...cats].map((c) => (
              <button key={c} onClick={() => setActiveCat(c)}
                className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors border shrink-0"
                style={activeCat === c
                  ? { background: "var(--olive)", color: "var(--on-accent)", borderColor: "var(--olive)" }
                  : { background: "var(--panel)", color: "var(--muted)", borderColor: "var(--line)" }}>
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Items grid */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {filtered.map((item) => (
              <button key={item.id} onClick={() => onItemClick(item)}
                className="relative rounded-xl p-3 text-left transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col gap-2 min-h-[96px] justify-between hover:border-[var(--olive)]"
                style={offerIds.has(item.id)
                  ? { background: "var(--olive-wash)", border: "1.5px solid var(--olive)" }
                  : { background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                {offerIds.has(item.id) && (
                  <span className="absolute top-1.5 right-1.5 z-10 rounded-md px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wider"
                    style={{ background: "var(--olive)", color: "var(--on-accent)" }}>Offer</span>
                )}
                {item.imageUrl && (
                  <div
                    className="w-full h-20 rounded-lg bg-cover bg-center -mt-1 -mx-1 mb-1"
                    style={{ backgroundImage: `url(${item.imageUrl})`, width: "calc(100% + 0.5rem)" }}
                  />
                )}
                <div className={`font-medium text-[13px] leading-snug text-ink line-clamp-2 ${offerIds.has(item.id) && !item.imageUrl ? "pr-11" : ""}`}>{item.name}</div>
                <div className="flex items-center justify-between">
                  <span className="mono font-semibold text-[14px]" style={{ color: "var(--olive-700)" }}>{money(item.price, currency)}</span>
                  {item.modifiers && item.modifiers.length > 0 && (
                    <span className="pill pill-olive" style={{ padding: "1px 7px", fontSize: 10 }}>options</span>
                  )}
                </div>
              </button>
            ))}
            {!filtered.length && <div className="col-span-full"><EmptyState title="No dishes found" hint="Try another category or search term." /></div>}
          </div>
        </div>
      </div>

      {/* ===== Drag handle to resize the cart ===== */}
      <div
        onMouseDown={() => { dragging.current = true; document.body.style.cursor = "col-resize"; }}
        className="hidden lg:flex items-center justify-center shrink-0 cursor-col-resize group mx-1"
        style={{ width: 16 }}
        title="Drag to resize the ticket panel"
      >
        <div className="h-20 w-1.5 rounded-full transition-colors group-hover:bg-[var(--olive)] flex items-center justify-center"
          style={{ background: "var(--line)" }}>
          <span className="flex flex-col gap-0.5">
            <span className="w-0.5 h-0.5 rounded-full bg-white/70" />
            <span className="w-0.5 h-0.5 rounded-full bg-white/70" />
            <span className="w-0.5 h-0.5 rounded-full bg-white/70" />
          </span>
        </div>
      </div>

      {/* ===== Cart side (sticky footer always visible) ===== */}
      <aside className="flex flex-col overflow-hidden rounded-[var(--r-2xl)] h-full shrink-0 w-full lg:w-[var(--cart-w)]"
        style={{ background: "var(--panel)", boxShadow: "var(--shadow-sm)", ["--cart-w" as string]: `${cartWidth}px` }}>

        {/* Order type + table + customer form */}
        <div className="p-3 border-b border-line-soft shrink-0">
          <div className="flex gap-1.5 p-1 rounded-full" style={{ background: "var(--panel-2)" }}>
            {typeTabs.map((t) => (
              <button key={t} onClick={() => setOrderType(t)}
                className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
                style={orderType === t ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" } : { color: "var(--muted)" }}>
                {t}
              </button>
            ))}
          </div>
          {orderType === "dine-in" && (
            <select className="inp mt-2.5 !py-2 text-[13px]" value={tableId ?? ""} onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select table (optional)</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.seats} seats{t.status !== "open" ? ` · ${t.status}` : ""}</option>)}
            </select>
          )}
          {orderType !== "dine-in" && (
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <input className="inp !py-2 text-[13px]" placeholder="Customer name" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
              <input className="inp !py-2 text-[13px]" placeholder="Phone" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
              {orderType === "delivery" && <input className="inp !py-2 text-[13px] col-span-2" placeholder="Delivery address" value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value })} />}
            </div>
          )}
        </div>

        {/* Cart lines */}
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {!cart.length ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-muted py-10">
              <ShoppingBag size={30} className="opacity-40" />
              <div className="text-sm">The ticket is empty.<br />Tap a dish to start.</div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {cart.map((line, i) => (
                <div key={i} className="rounded-lg p-2.5" style={{ background: "var(--panel-2)" }}>
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-ink leading-tight">{line.name}</div>
                      {line.modifiers.map((m, j) => <div key={j} className="text-[11px] text-muted">+ {m.option}{m.priceDelta ? ` (${money(m.priceDelta, currency)})` : ""}</div>)}
                      {line.notes && <div className="text-[11px] italic" style={{ color: "var(--olive-700)" }}>“{line.notes}”</div>}
                    </div>
                    <div className="mono text-[13px] font-semibold text-ink whitespace-nowrap">{money(line.lineTotal, currency)}</div>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => changeQty(i, -1)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}><Minus size={13} /></button>
                      <span className="mono text-[13px] font-semibold w-5 text-center">{line.qty}</span>
                      <button onClick={() => changeQty(i, 1)} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}><Plus size={13} /></button>
                    </div>
                    <button onClick={() => setCart(cart.filter((_, idx) => idx !== i))} className="text-muted hover:text-bad transition-colors"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* STICKY footer — note, priority, totals + action buttons */}
        <div className="shrink-0 border-t border-line-soft p-3" style={{ background: "var(--panel)" }}>
          <input
            className="inp !py-2 text-[12.5px] mb-2"
            placeholder="Ticket note (e.g. allergy, rush)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {promo && (
            <div className="flex items-center justify-between mb-2 rounded-lg px-3 py-1.5"
              style={{ background: "var(--ok-wash)", color: "var(--ok-ink)" }}>
              <span className="text-[12px] font-semibold flex items-center gap-1.5">
                <Flame size={12} /> {promo.name}
              </span>
              <span className="mono font-semibold text-[12.5px]">− {money(promo.amount, currency)}</span>
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setPriority(!priority)}
              className={priority ? "btn btn-danger btn-sm" : "btn btn-ghost btn-sm"}
            >
              <Flame size={13} /> {priority ? "Priority" : "Normal"}
            </button>
            <div className="text-[12px] text-muted">
              {promo ? "After promo" : "Subtotal"}
              <span className="mono font-semibold text-ink ml-2">{money(Math.max(0, subtotal - (promo?.amount || 0)), currency)}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={holdOrder}
              disabled={!cart.length || sending}
              className="btn btn-ghost flex-1"
              title="Hold for later (F9)"
            >
              <Pause size={14} /> Hold
            </button>
            <button
              onClick={() => send(false)}
              disabled={!cart.length || sending}
              className="btn btn-kot flex-[2]"
              title="Send to kitchen (F4)"
            >
              <Send size={14} /> {sending ? "Sending…" : "Send to Kitchen"}
            </button>
          </div>
          <button
            onClick={() => send(true)}
            disabled={!cart.length || sending}
            className="btn btn-primary w-full mt-2 btn-lg"
            title="Send & pay (F8)"
          >
            <CreditCard size={15} /> Send &amp; Pay · {money(subtotal, currency)}
          </button>
        </div>
      </aside>

      {modItem && <ModifierModal item={modItem} currency={currency} onClose={() => setModItem(null)} onAdd={(mods, qty, notes) => { addLine(modItem, mods, qty, notes); setModItem(null); }} />}

      {custLookupOpen && (
        <CustomerLookup
          onClose={() => setCustLookupOpen(false)}
          onPick={(c) => { setCust({ name: c.name, phone: c.phone, address: c.address || "" }); setCustLookupOpen(false); toast.push("ok", `Customer ${c.name || c.phone} attached`); }}
        />
      )}

      {heldOpen && (
        <HeldOrdersModal
          held={heldOrders}
          currency={currency}
          onClose={() => setHeldOpen(false)}
          onRecall={recallHeld}
          onDelete={async (h) => {
            if (!confirm(`Discard held order "${h.label || h.orderType}"?`)) return;
            try { await apiDelete(`/held-orders/${h.id}`); loadHeld(); }
            catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
          }}
        />
      )}
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading" />}>
      <OrderInner />
    </Suspense>
  );
}

/* ---------- Modifier modal ---------- */
function ModifierModal({ item, currency, onClose, onAdd }: {
  item: MenuItem;
  currency: string;
  onClose: () => void;
  onAdd: (mods: CartLine["modifiers"], qty: number, notes: string) => void;
}) {
  const groups = (item.modifiers || []) as ModifierGroup[];
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");

  const mods: CartLine["modifiers"] = Object.entries(picked)
    .filter(([, opt]) => opt)
    .map(([group, opt]) => {
      const g = groups.find((x) => x.name === group);
      const o = g?.options.find((o) => o.option === opt);
      return { group, option: opt, priceDelta: o?.priceDelta || 0 };
    });
  const unit = item.price + mods.reduce((s, m) => s + m.priceDelta, 0);

  return (
    <Modal open title={item.name} onClose={onClose} width={480}>
      <div className="space-y-4">
        {/* price header */}
        <div className="flex items-center justify-between -mt-1">
          <span className="text-[12.5px] text-muted">Base price</span>
          <span className="mono font-semibold text-ink">{money(item.price, currency)}</span>
        </div>

        {groups.map((g) => (
          <div key={g.name} className="rounded-xl p-3" style={{ background: "var(--panel-2)" }}>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[12.5px] font-semibold text-ink">{g.name}</span>
              <span className="text-[10.5px] uppercase tracking-wider text-muted">Pick one</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {g.options.map((o) => {
                const active = picked[g.name] === o.option;
                return (
                  <button key={o.option}
                    onClick={() => setPicked((p) => ({ ...p, [g.name]: active ? "" : o.option }))}
                    className="flex flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 border-2 transition-all text-left"
                    style={active
                      ? { background: "var(--olive-wash)", borderColor: "var(--olive)" }
                      : { background: "var(--panel)", borderColor: "var(--line)" }}>
                    <span className="flex items-center gap-1.5 w-full">
                      <span
                        className="size-4 rounded-full border-2 shrink-0 flex items-center justify-center"
                        style={{ borderColor: active ? "var(--olive)" : "var(--input-border)" }}>
                        {active && <span className="size-2 rounded-full" style={{ background: "var(--olive)" }} />}
                      </span>
                      <span className="text-[13px] font-semibold text-ink truncate">{o.option}</span>
                    </span>
                    <span className="text-[11.5px] mono pl-5.5" style={{ color: o.priceDelta ? "var(--olive-700)" : "var(--muted)" }}>
                      {o.priceDelta ? `+ ${money(o.priceDelta, currency)}` : "included"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div>
          <div className="lbl">Note for the kitchen</div>
          <input className="inp" placeholder="e.g. no onion, extra spicy…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-line-soft pt-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="size-9 rounded-full flex items-center justify-center transition-colors hover:bg-line" style={{ background: "var(--panel-2)" }}><Minus size={16} /></button>
            <span className="mono font-semibold w-7 text-center text-[16px]">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="size-9 rounded-full flex items-center justify-center transition-colors hover:bg-line" style={{ background: "var(--panel-2)" }}><Plus size={16} /></button>
          </div>
          <button onClick={() => onAdd(mods, qty, notes)} className="btn btn-primary btn-lg">
            <Plus size={16} /> Add · {money(unit * qty, currency)}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Customer lookup ---------- */
function CustomerLookup({ onClose, onPick }: { onClose: () => void; onPick: (c: Customer) => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"search" | "new">("search");
  const [newC, setNewC] = useState({ name: "", phone: "", address: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      apiGet<Customer[]>(`/customers${q.trim() ? `?search=${encodeURIComponent(q.trim())}` : ""}`)
        .then((d) => setList(Array.isArray(d) ? d : []))
        .catch(() => setList([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  async function createAndAttach() {
    if (!newC.phone.trim()) { toast.push("bad", "Phone is required"); return; }
    setBusy(true);
    try {
      const c = await apiPost<Customer>("/customers", newC);
      onPick(c);
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed to create"); }
    finally { setBusy(false); }
  }

  return (
    <Modal open title="Attach customer" onClose={onClose} width={560}>
      <div className="flex gap-1.5 p-1 rounded-full mb-4" style={{ background: "var(--panel-2)" }}>
        {(["search", "new"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 py-1.5 rounded-full text-[12.5px] font-semibold capitalize transition-colors"
            style={tab === t
              ? { background: "var(--panel)", color: "var(--olive-700)", boxShadow: "var(--shadow-sm)" }
              : { color: "var(--muted)" }}>
            {t === "search" ? "Search existing" : "New customer"}
          </button>
        ))}
      </div>

      {tab === "search" ? (
        <>
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="inp pl-9" placeholder="Search by phone or name…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[320px] overflow-y-auto -mx-1 px-1">
            {loading ? (
              <div className="py-10 text-center text-sm text-muted">Searching…</div>
            ) : !list.length ? (
              <div className="py-10 text-center text-sm text-muted">
                {q ? "Nothing matched. Try “New customer”." : "No customers yet."}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {list.map((c) => (
                  <button key={c.id} onClick={() => onPick(c)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
                    style={{ background: "var(--panel-2)" }}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-[color:var(--on-accent)]" style={{ background: "var(--olive)" }}>
                      {(c.name || c.phone).charAt(0).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[13.5px] text-ink truncate">{c.name || <span className="text-muted italic">(no name)</span>}</div>
                      <div className="text-[11.5px] text-muted truncate">{c.phone}{c.address ? ` · ${c.address}` : ""}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div><label className="lbl">Phone <span className="text-bad">*</span></label>
            <input className="inp" value={newC.phone} autoFocus onChange={(e) => setNewC({ ...newC, phone: e.target.value })} /></div>
          <div><label className="lbl">Name</label>
            <input className="inp" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} /></div>
          <div><label className="lbl">Address</label>
            <input className="inp" value={newC.address} onChange={(e) => setNewC({ ...newC, address: e.target.value })} /></div>
          <button onClick={createAndAttach} disabled={busy} className="btn btn-primary w-full">{busy ? "Saving…" : "Create & attach"}</button>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Held orders list ---------- */
function HeldOrdersModal({
  held, currency, onClose, onRecall, onDelete,
}: {
  held: HeldOrder[];
  currency: string;
  onClose: () => void;
  onRecall: (h: HeldOrder) => void;
  onDelete: (h: HeldOrder) => void;
}) {
  return (
    <Modal open title={`Held orders (${held.length})`} onClose={onClose} width={560}>
      {!held.length ? (
        <div className="text-sm text-muted py-10 text-center">
          No held orders. Press <b>Hold</b> to park an order and come back to it.
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto">
          {held.map((h) => {
            const total = h.items.reduce((s, l) => s + l.lineTotal, 0);
            return (
              <div key={h.id} className="rounded-xl p-3 flex items-start gap-3" style={{ background: "var(--panel-2)" }}>
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-white font-bold text-[13px]"
                  style={{ background: "var(--info)" }}
                >
                  <Timer size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-[13.5px] truncate">
                    {h.label || h.tableName || h.customerName || "Held order"}
                  </div>
                  <div className="text-[11.5px] text-muted">
                    {h.items.length} items · {money(total, currency)} · by {h.staffName}
                  </div>
                  <div className="text-[11px] text-muted">
                    {(h.heldAt || "").replace("T", " ").slice(0, 16)}
                  </div>
                </div>
                <button onClick={() => onDelete(h)} className="btn btn-ghost btn-sm !px-2" title="Discard">
                  <Trash2 size={13} />
                </button>
                <button onClick={() => onRecall(h)} className="btn btn-primary btn-sm">
                  <Play size={13} /> Recall
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
