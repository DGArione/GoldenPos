"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  TrendingUp, ShoppingBag, ChefHat, Grid3x3, AlertTriangle, RotateCcw,
  Banknote, CreditCard, Globe, Wallet, Gift, Star, LayoutDashboard, Tag, Flame, Store,
  ArrowUpRight, CalendarDays, FileBarChart2, Package, Users, Clock3,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageLoader } from "@/components/ui";
import { Banners } from "@/components/Banners";
import { TodayPromotionsCard, useTodayPromotions } from "@/components/TodayPromotions";

interface Method { gross: number; fee: number; net: number }
interface Branch { id: number; name: string; revenueToday: number; openTables: number; inKitchen: number; lowStockCount: number }
interface Totals { totalRevenue: number; totalOrders: number; totalKitchen: number; totalOpenTables: number; totalLowStock: number; totalRefunds: number; byMethod: Record<string, Method> }
interface Summary { branches: Branch[]; totals: Totals }
interface Report { trend: number[]; orderCount: number; voidedCount: number; voidedTotal: number; refundCount: number; refunds: number; revenue: number }
interface TopItem { name?: string; itemName?: string; qty?: number; quantity?: number; revenue?: number; total?: number }
interface Analytics { items: TopItem[] }
interface PeriodAnalytics {
  summary: { totalRevenue: number; totalOrders: number; totalTips: number; totalDiscounts: number; totalCardFees: number; netRevenue: number; grossSales: number; netSales: number; avgOrderValue: number };
  categoryStats: { category: string; qty: number; revenue: number }[];
  dayOfWeek: { day: string; dayIndex: number; orders: number; revenue: number }[];
  salesByOrderType?: { orderType: string; orders: number; revenue: number }[];
  salesByEmployee?: { staffId: number | null; staffName: string; orders: number; revenue: number }[];
  inventoryCost: { purchases: number; consumed: number };
}
function localDate(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const PALETTE = ["#5598f2", "#2bc2a6", "#f58ba3", "#a78bfa", "#f4b64e", "#56b8d5"];

export default function DashboardPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [sum, setSum] = useState<Summary | null>(null);
  const promos = useTodayPromotions();
  const [week, setWeek] = useState<Report | null>(null);
  const [top, setTop] = useState<Analytics | null>(null);
  const [analyticsFrom, setAnalyticsFrom] = useState(localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [analyticsTo, setAnalyticsTo] = useState(localDate(new Date()));
  const [periodAnalytics, setPeriodAnalytics] = useState<PeriodAnalytics | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState("");

  useEffect(() => {
    let active = true;
    const refreshSummary = () => apiGet<Summary>("/dashboard/summary").then((data) => { if (active) setSum(data); }).catch(() => {});
    refreshSummary();
    apiGet<Report>("/reports/summary?range=week").then((data) => { if (active) setWeek(data); }).catch(() => {});
    apiGet<Analytics>("/analytics/items?range=week").then((data) => { if (active) setTop(data); }).catch(() => {});
    apiGet<PeriodAnalytics>(`/reports/advanced?from=${localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}&to=${localDate(new Date())}`).then((data) => { if (active) setPeriodAnalytics(data); }).catch((e) => { if (active) setPeriodError(e instanceof Error ? e.message : "Could not load analytics"); });
    const timer = setInterval(refreshSummary, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function loadPeriodAnalytics() {
    if (!analyticsFrom || !analyticsTo || analyticsFrom > analyticsTo) { setPeriodError("Choose a valid date range."); return; }
    setPeriodLoading(true); setPeriodError("");
    try {
      const data = await apiGet<PeriodAnalytics>(`/reports/advanced?from=${encodeURIComponent(analyticsFrom)}&to=${encodeURIComponent(analyticsTo)}`);
      setPeriodAnalytics(data);
    } catch (e) { setPeriodError(e instanceof Error ? e.message : "Could not load analytics"); }
    finally { setPeriodLoading(false); }
  }

  if (!sum) return <div style={{ padding: 24, background: "var(--ga-bg, var(--paper))", borderRadius: 22 }}><PageLoader label="Loading restaurant dashboard" /></div>;
  const t = sum.totals;
  const maxTrend = week ? Math.max(1, ...week.trend) : 1;
  const topItems = (top?.items || []).map((i) => ({ name: i.name || i.itemName || "—", qty: i.qty ?? i.quantity ?? 0, revenue: i.revenue ?? i.total ?? 0 })).sort((a, b) => b.revenue - a.revenue).slice(0, 7);
  const payMethods = [
    { name: "Cash", amount: t.byMethod.cash?.gross || 0, color: "#36b8a4", icon: <Banknote size={15} /> },
    { name: "Card", amount: t.byMethod.card?.gross || 0, color: "#609cf1", icon: <CreditCard size={15} /> },
    { name: "Online", amount: t.byMethod.online?.gross || 0, color: "#f29aaf", icon: <Globe size={15} /> },
    { name: "Wallet", amount: t.byMethod.wallet?.gross || 0, color: "#a78bfa", icon: <Wallet size={15} /> },
    { name: "Gift card", amount: t.byMethod.giftcard?.gross || 0, color: "#f0b860", icon: <Gift size={15} /> },
    { name: "Points", amount: t.byMethod.loyalty?.gross || 0, color: "#2bc2a6", icon: <Star size={15} /> },
  ].filter((m, i) => i < 3 || m.amount > 0);
  const paymentTotal = Math.max(1, payMethods.reduce((a, x) => a + x.amount, 0));
  let donutStart = 0;
  const donutStops = payMethods.map((x) => {
    const end = donutStart + x.amount / paymentTotal * 100;
    const part = `${x.color} ${donutStart}% ${end}%`;
    donutStart = end;
    return part;
  });
  const donut = payMethods.every((x) => x.amount === 0) ? "conic-gradient(var(--ga-line) 0 100%)" : `conic-gradient(${donutStops.join(",")})`;
  const trendPoints = (week?.trend || []).map((v, i, arr) => `${arr.length <= 1 ? 50 : 10 + i * 80 / (arr.length - 1)},${90 - v / maxTrend * 72}`).join(" ");
  const weekday = (periodAnalytics?.dayOfWeek || []).slice().sort((a, b) => a.dayIndex - b.dayIndex);
  const maxWeekday = Math.max(1, ...weekday.map((x) => x.revenue));
  const categories = (periodAnalytics?.categoryStats || []).slice().sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  const maxCategory = Math.max(1, ...categories.map((x) => x.revenue));
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="golden-analytics-page" style={{ color: "var(--ga-ink)", background: "var(--ga-bg)", borderRadius: 24, padding: "clamp(12px,2vw,26px)", minHeight: "100%" }}>
      <style>{`
        .golden-analytics-page{--ga-bg:#f2f5fb;--ga-card:#fff;--ga-soft:#f7f9fd;--ga-line:#e7ebf3;--ga-ink:#1e293b;--ga-sub:#526079;--ga-muted:#8792a6;--ga-link:#3477ce}:root[data-theme="dark"] .golden-analytics-page{--ga-bg:var(--paper);--ga-card:var(--panel);--ga-soft:var(--panel-2);--ga-line:var(--line);--ga-ink:var(--ink);--ga-sub:#c3cad6;--ga-muted:var(--muted);--ga-link:#8ab4f5}.golden-analytics-page *{box-sizing:border-box}.ga-card{background:var(--ga-card);border:1px solid var(--ga-line);border-radius:17px;box-shadow:0 5px 18px rgba(36,52,89,.045);min-width:0}.ga-title{font-size:12px;font-weight:800;color:var(--ga-sub);letter-spacing:.01em}.ga-muted{color:var(--ga-muted)}.ga-kpi{border-radius:15px;padding:17px 17px 15px;color:#FFFFFF;min-height:112px;position:relative;overflow:hidden;box-shadow:0 7px 18px rgba(42,61,102,.10)}.ga-kpi:after{content:"";position:absolute;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.12);right:-27px;top:-36px}.ga-kpi-label{font-size:11px;font-weight:700;opacity:.92;position:relative;z-index:1}.ga-kpi-value{font-size:clamp(20px,2vw,28px);font-weight:800;letter-spacing:-.04em;margin-top:12px;line-height:1.1;position:relative;z-index:1;overflow-wrap:anywhere}.ga-kpi-icon{position:absolute;right:14px;bottom:13px;opacity:.8;z-index:1}.ga-filter{border:1px solid var(--ga-line);border-radius:9px;padding:8px 10px;background:var(--ga-card);color:var(--ga-ink);font-size:12px;min-width:0}.ga-link{display:inline-flex;align-items:center;gap:6px;padding:9px 12px;border-radius:10px;background:color-mix(in srgb,#4289e5 12%,var(--ga-card));color:var(--ga-link);font-size:12px;font-weight:800;text-decoration:none}.ga-table{width:100%;border-collapse:collapse;font-size:12px}.ga-table th{font-size:10px;color:var(--ga-muted);text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:10px 8px;border-bottom:1px solid var(--ga-line)}.ga-table td{padding:11px 8px;border-bottom:1px solid var(--ga-line)}.ga-table tr:last-child td{border-bottom:0}.ga-bar{height:7px;border-radius:99px;background:var(--ga-line);overflow:hidden}.ga-bar>span{display:block;height:100%;border-radius:99px}.ga-mini-stat{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;background:var(--ga-soft)}.ga-dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none}@media(max-width:700px){.ga-table{min-width:420px}.ga-scroll{overflow-x:auto}.ga-kpi{padding:14px;min-height:100px}}
      `}</style>
      <Banners banners={settings?.homeBanners} />

      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, margin: "7px 0 21px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 14, color: "white", background: "linear-gradient(135deg,#3f9be9,#5b78eb)", boxShadow: "0 8px 18px #6797e733" }}><LayoutDashboard size={23} /></div>
          <div><div style={{ fontSize: 24, fontWeight: 850, letterSpacing: "-.04em", color: "var(--ga-ink)" }}>Restaurant Dashboard</div><div style={{ color: "var(--ga-muted)", fontSize: 12, marginTop: 3 }}>Business overview · sales, service and operations</div></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid color-mix(in srgb, #25a98f 25%, var(--ga-card))", borderRadius: 99, padding: "8px 11px", background: "color-mix(in srgb, #25a98f 10%, var(--ga-card))", color: "#2bb596", fontSize: 11, fontWeight: 800 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: "#2bc2a6", boxShadow: "0 0 0 4px #2bc2a61c" }} /> LIVE · 15 SEC</span>
          <a className="ga-link" href="/reports"><FileBarChart2 size={15} /> Reports <ArrowUpRight size={13} /></a>
        </div>
      </header>

      <div style={{ marginBottom: 17 }}><TodayPromotionsCard list={promos} manageLink /></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 11 }}><div><div style={{ fontSize: 14, fontWeight: 800 }}>Today's performance</div><div className="ga-muted" style={{ fontSize: 11, marginTop: 3 }}>{todayLabel}</div></div><span style={{ fontSize: 11, color: "var(--ga-muted)" }}>Live overview</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 12, marginBottom: 17 }}>
        <Kpi label="Today's Sales" value={money(t.totalRevenue, currency)} color="linear-gradient(135deg,#539cf3,#4e7fe7)" icon={<TrendingUp size={23} />} />
        <Kpi label="Total Orders" value={String(t.totalOrders)} color="linear-gradient(135deg,#36c7ad,#20a997)" icon={<ShoppingBag size={23} />} />
        <Kpi label="Kitchen Queue" value={String(t.totalKitchen)} color="linear-gradient(135deg,#f59ab0,#ec789a)" icon={<ChefHat size={23} />} />
        <Kpi label="Open Tables" value={String(t.totalOpenTables)} color="linear-gradient(135deg,#aa91f3,#8b72e8)" icon={<Grid3x3 size={23} />} />
        <Kpi label="Low Stock Alerts" value={String(t.totalLowStock)} color="linear-gradient(135deg,#f6bd61,#ed9a38)" icon={<AlertTriangle size={23} />} />
        <Kpi label="Refunds Today" value={money(t.totalRefunds, currency)} color="linear-gradient(135deg,#55bdcf,#349bbd)" icon={<RotateCcw size={23} />} />
      </div>

      <section className="ga-card" style={{ padding: "15px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div><div style={{ fontSize: 14, fontWeight: 800 }}>Sales & performance analytics</div><div className="ga-muted" style={{ fontSize: 11, marginTop: 3 }}>Choose a period to update revenue, categories and staff performance</div></div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7 }}>
            <input aria-label="Analytics from date" type="date" value={analyticsFrom} onChange={(e) => setAnalyticsFrom(e.target.value)} className="ga-filter" />
            <span className="ga-muted" style={{ fontSize: 11 }}>to</span>
            <input aria-label="Analytics to date" type="date" value={analyticsTo} onChange={(e) => setAnalyticsTo(e.target.value)} className="ga-filter" />
            <button onClick={loadPeriodAnalytics} disabled={periodLoading} className="ga-link" style={{ border: 0, cursor: "pointer" }}>{periodLoading ? "Loading…" : "Apply filters"}</button>
          </div>
        </div>
        {periodError && <div style={{ color: "#d9485f", fontSize: 12, marginBottom: 12 }}>{periodError}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10 }}>
          <MiniKpi icon={<TrendingUp size={16} />} label="Net sales" value={money(periodAnalytics?.summary.netSales ?? week?.revenue ?? 0, currency)} tint="#eaf3ff" color="#4289e5" />
          <MiniKpi icon={<ShoppingBag size={16} />} label="Paid orders" value={String(periodAnalytics?.summary.totalOrders ?? week?.orderCount ?? 0)} tint="#e8faf5" color="#25a98f" />
          <MiniKpi icon={<Tag size={16} />} label="Discounts" value={money(periodAnalytics?.summary.totalDiscounts ?? 0, currency)} tint="#fff0f4" color="#dc7597" />
          <MiniKpi icon={<Package size={16} />} label="Stock purchases" value={money(periodAnalytics?.inventoryCost.purchases ?? 0, currency)} tint="#f2edff" color="#8b72df" />
          <MiniKpi icon={<Package size={16} />} label="Stock consumed" value={money(periodAnalytics?.inventoryCost.consumed ?? 0, currency)} tint="#fff6e6" color="#d88a28" />
          <MiniKpi icon={<TrendingUp size={16} />} label="Average order" value={money(periodAnalytics?.summary.avgOrderValue ?? 0, currency)} tint="#e8f8fc" color="#369db8" />
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))", gap: 15, marginBottom: 16 }}>
        <section className="ga-card" style={{ padding: 17 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, marginBottom: 8 }}><div><div className="ga-title">SALES BY VALUE</div><div style={{ fontSize: 21, fontWeight: 850, letterSpacing: "-.03em", marginTop: 7 }}>{money(week?.revenue || 0, currency)}</div><div className="ga-muted" style={{ fontSize: 11 }}>Last 7 days</div></div><span style={{ color: "#4a97ec", background: "color-mix(in srgb, #3889df 13%, var(--ga-card))", padding: "6px 8px", borderRadius: 8, fontSize: 10, fontWeight: 800 }}>WEEK</span></div>
          {week?.trend?.length ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 165, overflow: "visible" }}><defs><linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5798ef" stopOpacity=".28"/><stop offset="100%" stopColor="#5798ef" stopOpacity="0"/></linearGradient></defs><path d={`M ${trendPoints.split(" ").join(" L ")} L 90 100 L 10 100 Z`} fill="url(#salesFill)"/><polyline points={trendPoints} fill="none" stroke="#5598f2" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>{week.trend.map((v,i)=>{const x=week.trend.length<=1?50:10+i*80/(week.trend.length-1);const y=90-v/maxTrend*72;return <circle key={i} cx={x} cy={y} r="2.1" fill="var(--ga-card)" stroke="#5598f2" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>;})}</svg> : <Empty>No sales trend available yet.</Empty>}
          <div style={{ display: "flex", justifyContent: "space-between", color: "var(--ga-muted)", fontSize: 10, marginTop: 4 }}><span>6 days ago</span><span>Today</span></div>
        </section>

        <section className="ga-card" style={{ padding: 17 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, marginBottom: 14 }}><div><div className="ga-title">SALES BY DAY OF WEEK</div><div style={{ fontSize: 13, fontWeight: 750, marginTop: 7 }}>Revenue distribution</div></div><span style={{ color: "#26ae95", background: "color-mix(in srgb, #1e9e88 13%, var(--ga-card))", padding: "6px 8px", borderRadius: 8, fontSize: 10, fontWeight: 800 }}>PERIOD</span></div>
          {weekday.length ? <div style={{ display: "flex", alignItems: "end", gap: 9, height: 180, padding: "8px 2px 0" }}>{weekday.map((d, i) => <div key={d.dayIndex} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "end", alignItems: "center", gap: 7, minWidth: 0 }}><div title={money(d.revenue, currency)} style={{ fontSize: 9, color: "var(--ga-muted)", whiteSpace: "nowrap" }}>{d.revenue > 0 ? Math.round(d.revenue / 1000) + "k" : ""}</div><div style={{ width: "100%", maxWidth: 31, height: `${Math.max(3, d.revenue / maxWeekday * 100)}%`, borderRadius: "6px 6px 2px 2px", background: i === new Date().getDay() ? "linear-gradient(180deg,#3bc7ae,#1ba58f)" : "linear-gradient(180deg,#a9e6db,#55c6b4)", minHeight: 4 }} /><span style={{ fontSize: 10, color: "var(--ga-muted)" }}>{d.day.slice(0,3)}</span></div>)}</div> : <Empty>Choose a date range with completed sales to see weekday performance.</Empty>}
        </section>

        <section className="ga-card" style={{ padding: 17 }}>
          <div className="ga-title">PAYMENT METHOD BREAKDOWN</div><div style={{ fontSize: 13, fontWeight: 750, marginTop: 7, marginBottom: 16 }}>Cash / Card / Online</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", gap: 16, flexWrap: "wrap" }}><div style={{ width: 142, height: 142, borderRadius: "50%", background: donut, display: "grid", placeItems: "center", position: "relative", flex: "none" }}><div style={{ width: 88, height: 88, borderRadius: "50%", background: "var(--ga-card)", display: "grid", placeItems: "center", textAlign: "center" }}><div><div style={{ fontSize: 10, color: "var(--ga-muted)" }}>TODAY</div><strong style={{ display: "block", fontSize: 14, color: "var(--ga-ink)" }}>{money(paymentTotal === 1 && payMethods.every(x=>x.amount===0) ? 0 : paymentTotal, currency)}</strong></div></div></div><div style={{ flex: 1, minWidth: 120, display: "grid", gap: 13 }}>{payMethods.map((m) => <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="ga-dot" style={{ background: m.color }} /> <span style={{ color: "var(--ga-sub)", fontSize: 12, flex: 1 }}>{m.name}</span><strong style={{ fontSize: 12 }}>{money(m.amount, currency)}</strong></div>)}</div></div>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,350px),1fr))", gap: 15, marginBottom: 16 }}>
        <section className="ga-card" style={{ padding: 17 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}><div><div className="ga-title">TOP SELLING PRODUCTS</div><div style={{ fontSize: 13, fontWeight: 750, marginTop: 6 }}>Most popular menu items</div></div><Flame size={18} color="#ed9b40" /></div>
          {topItems.length ? <div className="ga-scroll"><table className="ga-table"><thead><tr><th>Product</th><th>Qty</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead><tbody>{topItems.map((it,i)=><tr key={`${it.name}-${i}`}><td><div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: `${PALETTE[i%PALETTE.length]}1a`, color: PALETTE[i%PALETTE.length], fontSize: 11, fontWeight: 800 }}>{i+1}</span><span style={{ fontWeight: 650, color: "var(--ga-ink)" }}>{it.name}</span></div></td><td style={{ color: "var(--ga-sub)" }}>{it.qty}</td><td style={{ textAlign: "right", fontWeight: 800, whiteSpace: "nowrap" }}>{money(it.revenue,currency)}</td></tr>)}</tbody></table></div> : <Empty>No product sales recorded yet.</Empty>}
        </section>

        <section className="ga-card" style={{ padding: 17 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 17 }}><div><div className="ga-title">CATEGORY PERFORMANCE</div><div style={{ fontSize: 13, fontWeight: 750, marginTop: 6 }}>Sales by menu category</div></div><Store size={18} color="#38b6a3" /></div>
          {categories.length ? <div style={{ display: "grid", gap: 17 }}>{categories.map((x,i)=><div key={x.category}><div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 7, fontSize: 12 }}><span style={{ fontWeight: 650, color: "var(--ga-sub)" }}>{x.category}</span><span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{money(x.revenue,currency)} <span style={{ color: "var(--ga-muted)", fontWeight: 500 }}>· {x.qty} sold</span></span></div><div className="ga-bar"><span style={{ width: `${Math.max(2,x.revenue/maxCategory*100)}%`, background: PALETTE[i%PALETTE.length] }} /></div></div>)}</div> : <Empty>No category sales for this period.</Empty>}
        </section>

        <section className="ga-card" style={{ padding: 17 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 13 }}><div><div className="ga-title">TEAM PERFORMANCE</div><div style={{ fontSize: 13, fontWeight: 750, marginTop: 6 }}>Sales by employee</div></div><Users size={18} color="#9a82e9" /></div>
          {(periodAnalytics?.salesByEmployee || []).length ? <div style={{ display: "grid", gap: 9 }}>{(periodAnalytics?.salesByEmployee || []).slice().sort((a,b)=>b.revenue-a.revenue).slice(0,6).map((e,i)=><div key={String(e.staffId||e.staffName)} className="ga-mini-stat"><span style={{ width: 32,height:32,borderRadius:11,display:"grid",placeItems:"center",background:`${PALETTE[i%PALETTE.length]}20`,color:PALETTE[i%PALETTE.length],fontWeight:850,fontSize:12 }}>{(e.staffName||"?").slice(0,1).toUpperCase()}</span><div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:12,fontWeight:750,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.staffName||"Unassigned"}</div><div style={{ fontSize:10,color:"var(--ga-muted)",marginTop:3 }}>{e.orders} orders</div></div><strong style={{ fontSize:12,whiteSpace:"nowrap" }}>{money(e.revenue,currency)}</strong></div>)}</div> : <Empty>No employee sales attribution is available for this period.</Empty>}
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,230px),1fr))", gap: 12, marginBottom: 16 }}>
        <QuickCard icon={<Clock3 size={18}/>} title="Kitchen operations" detail={`${t.totalKitchen} order(s) currently in kitchen`} href="/kitchen" color="#dc8a38" />
        <QuickCard icon={<Grid3x3 size={18}/>} title="Floor & tables" detail={`${t.totalOpenTables} open table(s) · manage seating`} href="/floor" color="#4e8ee7" />
        <QuickCard icon={<Package size={18}/>} title="Inventory attention" detail={`${t.totalLowStock} low-stock alert(s) to review`} href="/inventory" color="#24a58d" />
        <QuickCard icon={<FileBarChart2 size={18}/>} title="Detailed reports" detail="Sales, products, payments and operational reports" href="/reports" color="#9276e6" />
      </div>

      {sum.branches.length > 1 && <section className="ga-card" style={{ padding: 17, marginBottom: 16 }}><div className="ga-title" style={{ marginBottom: 13 }}>BRANCH COMPARISON</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>{sum.branches.map((b,i)=><div key={b.id} className="ga-mini-stat"><span style={{ width: 34,height:34,borderRadius:11,display:"grid",placeItems:"center",background:`${PALETTE[i%PALETTE.length]}1b`,color:PALETTE[i%PALETTE.length] }}><Store size={17}/></span><div style={{ flex:1,minWidth:0 }}><div style={{ fontSize:12,fontWeight:800 }}>{b.name}</div><div style={{ fontSize:10,color:"var(--ga-muted)",marginTop:3 }}>{b.openTables} tables · {b.inKitchen} in kitchen · {b.lowStockCount} low stock</div></div><strong style={{ fontSize:12,whiteSpace:"nowrap" }}>{money(b.revenueToday,currency)}</strong></div>)}</div></section>}

      {(settings?.enabledAddons || []).length > 0 && <section className="ga-card" style={{ padding: 17 }}><div className="ga-title" style={{ marginBottom: 12 }}>QUICK ACCESS</div><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{settings!.enabledAddons.includes("loyalty") && <a className="ga-link" href="/loyalty">Loyalty</a>}{settings!.enabledAddons.includes("giftcards") && <a className="ga-link" href="/giftcards">Gift Cards</a>}{settings!.enabledAddons.includes("promotions") && <a className="ga-link" href="/promotions">Promotions</a>}{settings!.enabledAddons.includes("reservations") && <a className="ga-link" href="/reservations">Reservations</a>}</div></section>}
    </div>
  );
}

function Kpi({ label, value, color, icon }: { label: string; value: string; color: string; icon: ReactNode }) {
  return <div className="ga-kpi" style={{ background: color }}><div className="ga-kpi-label">{label}</div><div className="ga-kpi-value">{value}</div><span className="ga-kpi-icon">{icon}</span></div>;
}
function MiniKpi({ icon, label, value, tint, color }: { icon: ReactNode; label: string; value: string; tint: string; color: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, background: `color-mix(in srgb, ${color} 11%, var(--ga-card))`, minWidth: 0 }}><span style={{ width: 31, height: 31, borderRadius: 10, display: "grid", placeItems: "center", color, background: "color-mix(in srgb, var(--ga-card) 75%, transparent)", flex: "none" }}>{icon}</span><div style={{ minWidth: 0 }}><div style={{ color: "var(--ga-sub)", fontSize: 10, fontWeight: 700 }}>{label}</div><div style={{ color: "var(--ga-ink)", fontSize: 14, fontWeight: 850, marginTop: 4, overflowWrap: "anywhere" }}>{value}</div></div></div>;
}
function Empty({ children }: { children: ReactNode }) { return <div style={{ minHeight: 115, display: "grid", placeItems: "center", textAlign: "center", color: "var(--ga-muted)", fontSize: 12, padding: 14 }}>{children}</div>; }
function QuickCard({ icon, title, detail, href, color }: { icon: ReactNode; title: string; detail: string; href: string; color: string }) {
  return <a href={href} className="ga-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: 15, textDecoration: "none", color: "inherit", transition: "transform .15s, box-shadow .15s" }}><span style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center", background: `${color}19`, color, flex: "none" }}>{icon}</span><span style={{ minWidth: 0, flex: 1 }}><span style={{ display: "block", fontSize: 12, fontWeight: 800 }}>{title}</span><span style={{ display: "block", fontSize: 10, lineHeight: 1.5, color: "var(--ga-muted)", marginTop: 4 }}>{detail}</span></span><ArrowUpRight size={15} color="#98a3b5" /></a>;
}
