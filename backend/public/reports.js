(async () => {
// reports.js
const staff = requireLogin();
if (staff) { renderNav("reports", staff); }

let activeRange = "today";
let reportData  = null;
const METHOD_LABEL = { cash: "💵 Cash", card: "💳 Card", online: "🏦 Online Transfer", wallet: "📱 Wallet" };

// Range tabs
document.querySelectorAll("#rangeTabs .tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll("#rangeTabs .tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeRange = btn.dataset.range;
    loadSummary();
  };
});

async function loadSummary() {
  const res  = await api(`/api/reports/summary?range=${activeRange}`);
  const data = await res.json();
  document.getElementById("kpiRevenue").textContent = posCurrency() + (data.revenue||0).toFixed(2);
  document.getElementById("kpiOrders").textContent  = data.orderCount || 0;
  const avg = data.orderCount ? (data.revenue / data.orderCount) : 0;
  document.getElementById("kpiAvg").textContent     = posCurrency() + avg.toFixed(2);
  document.getElementById("kpiVoids").textContent   = `${data.voidedCount||0} (${posCurrency()}${(data.voidedTotal||0).toFixed(2)})`;
  const rf = document.getElementById("kpiRefunds");
  if (rf) rf.textContent = `${data.refundCount||0} (${posCurrency()}${(data.refunds||0).toFixed(2)})`;
}

// Setup date pickers
const today = new Date();
const fmt = d => d.toISOString().slice(0,10);
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
document.getElementById("rptFrom").value = fmt(monthStart);
document.getElementById("rptTo").value   = fmt(today);

// Branch filter for superManager
if (staff && staff.role === "superManager") {
  document.getElementById("rptBranchWrap").style.display = "";
  api("/api/branches").then(r => r.json()).then(branches => {
    const sel = document.getElementById("rptBranch");
    branches.forEach(b => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
  });
}

document.getElementById("rptLoadBtn").onclick = loadAdvancedReport;

// Quick date presets — set From/To and load immediately.
document.querySelectorAll(".rpt-quick").forEach((btn) => {
  btn.onclick = () => {
    const q  = btn.dataset.quick;
    const to = new Date();
    let from = new Date();
    if (q === "today")        { /* from = today */ }
    else if (q === "yesterday") { from.setDate(to.getDate() - 1); to.setDate(to.getDate() - 1); }
    else if (q === "7")       { from.setDate(to.getDate() - 6); }
    else if (q === "30")      { from.setDate(to.getDate() - 29); }
    else if (q === "month")   { from = new Date(to.getFullYear(), to.getMonth(), 1); }
    document.getElementById("rptFrom").value = fmt(from);
    document.getElementById("rptTo").value   = fmt(to);
    document.querySelectorAll(".rpt-quick").forEach((b) => b.classList.remove("btn-primary"));
    btn.classList.add("btn-primary");
    loadAdvancedReport();
  };
});

async function loadAdvancedReport() {
  const from     = document.getElementById("rptFrom").value;
  const to       = document.getElementById("rptTo").value;
  const branchId = document.getElementById("rptBranch")?.value || "";
  const el       = document.getElementById("reportOutput");
  el.innerHTML   = `<div style="color:var(--muted);padding:20px 0;">Loading report...</div>`;

  let url = `/api/reports/advanced?from=${from}&to=${to}`;
  if (branchId) url += `&branchId=${branchId}`;
  const res  = await api(url);
  reportData = await res.json();

  document.getElementById("rptCsvBtn").style.display = "";
  document.getElementById("rptPdfBtn").style.display = "";

  const s = reportData.summary;
  el.innerHTML = `
    <!-- Summary -->
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Sales Summary · ${from} to ${to}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:10px;">
        <div><div style="font-size:11px;color:var(--muted);">Total Revenue</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--accent);">${posCurrency()}${s.totalRevenue.toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Orders</div><div class="mono" style="font-size:18px;font-weight:700;">${s.totalOrders}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Total Tips</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--accent);">${posCurrency()}${s.totalTips.toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Discounts Given</div><div class="mono" style="font-size:18px;font-weight:700;">${posCurrency()}${s.totalDiscounts.toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Card Fees</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--danger);">−${posCurrency()}${(s.totalCardFees||0).toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Net Received</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--success);">${posCurrency()}${(s.netRevenue||0).toFixed(2)}</div></div>
      </div>
    </div>

    <!-- Sales by order type -->
    ${(reportData.salesByOrderType || []).length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Sales by Order Type</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr><th style="text-align:left;padding:7px;">Order type</th><th style="text-align:right;padding:7px;">Paid orders</th><th style="text-align:right;padding:7px;">Revenue</th></tr></thead>
        <tbody>${reportData.salesByOrderType.map(x => `<tr><td style="padding:7px;">${String(x.orderType || 'Unknown').replace(/-/g,' ')}</td><td class="mono" style="text-align:right;padding:7px;">${x.orders}</td><td class="mono" style="text-align:right;padding:7px;font-weight:700;">${posCurrency()}${Number(x.revenue||0).toFixed(2)}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- Revenue by payment method -->
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:4px;">Revenue by Payment Method</div>
      <div style="font-size:11px; color:var(--muted); margin-bottom:12px;">
        Card fees are deducted at the rate set when each payment was taken.
      </div>
      <table style="width:100%; font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px;">Method</th>
            <th style="text-align:right;padding:6px;">Payments</th>
            <th style="text-align:right;padding:6px;">Collected</th>
            <th style="text-align:right;padding:6px;">Fee</th>
            <th style="text-align:right;padding:6px;">Net Received</th>
          </tr>
        </thead>
        <tbody>
          ${(reportData.paymentMethods || [])
            .filter(m => m.count > 0)
            .map(m => `
            <tr>
              <td style="padding:7px;">${METHOD_LABEL[m.method] || m.method}</td>
              <td class="mono" style="text-align:right;padding:7px;">${m.count}</td>
              <td class="mono" style="text-align:right;padding:7px;">${posCurrency()}${m.gross.toFixed(2)}</td>
              <td class="mono" style="text-align:right;padding:7px;color:${m.fee > 0 ? "var(--danger)" : "var(--muted)"};">${m.fee > 0 ? "−" + posCurrency() + m.fee.toFixed(2) : "—"}</td>
              <td class="mono" style="text-align:right;padding:7px;font-weight:700;color:var(--success);">${posCurrency()}${m.net.toFixed(2)}</td>
            </tr>`).join("")
            || `<tr><td colspan="5" style="padding:12px; color:var(--muted); text-align:center;">No payments in this period.</td></tr>`}
        </tbody>
      </table>
    </div>

    <!-- Item breakdown -->
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Top Items</div>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="color:var(--muted); font-size:11px; border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:6px 0;">Item</th>
          <th style="text-align:right;padding:6px;">Qty Sold</th>
          <th style="text-align:right;padding:6px;">Revenue</th>
        </tr></thead>
        <tbody>${reportData.itemBreakdown.slice(0,20).map(i => `
          <tr style="border-bottom:1px solid var(--border-soft);">
            <td style="padding:7px 0;">${i.name}</td>
            <td class="mono" style="text-align:right;padding:7px;">${i.qty}</td>
            <td class="mono" style="text-align:right;padding:7px;">${posCurrency()}${i.revenue.toFixed(2)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>

    <!-- Sales by employee -->
    ${(reportData.salesByEmployee || []).length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Sales by Employee</div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <thead><tr><th style="text-align:left;padding:7px;">Employee</th><th style="text-align:right;padding:7px;">Paid orders</th><th style="text-align:right;padding:7px;">Revenue</th></tr></thead>
        <tbody>${reportData.salesByEmployee.map(x => `<tr><td style="padding:7px;">${x.staffName || 'Unassigned'}</td><td class="mono" style="text-align:right;padding:7px;">${x.orders}</td><td class="mono" style="text-align:right;padding:7px;font-weight:700;">${posCurrency()}${Number(x.revenue||0).toFixed(2)}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : ''}

    <!-- Staff Tips -->
    ${reportData.staffTips.length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Staff Tips</div>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="color:var(--muted); font-size:11px; border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:6px 0;">Staff</th>
          <th style="text-align:right;padding:6px;">Orders</th>
          <th style="text-align:right;padding:6px;">Total Tips</th>
        </tr></thead>
        <tbody>${reportData.staffTips.map(t => `
          <tr style="border-bottom:1px solid var(--border-soft);">
            <td style="padding:7px 0;">${t.staffName}</td>
            <td class="mono" style="text-align:right;padding:7px;">${t.orderCount}</td>
            <td class="mono" style="text-align:right;padding:7px;color:var(--accent);">${posCurrency()}${t.totalTips.toFixed(2)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <!-- Gross vs Net -->
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Gross vs Net Sales</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px;">
        <div><div style="font-size:11px;color:var(--muted);">Gross Sales</div><div class="mono" style="font-size:18px;font-weight:700;">${posCurrency()}${(s.grossSales||0).toFixed(2)}</div><div style="font-size:10px;color:var(--muted);">before deductions</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Discounts</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--danger);">−${posCurrency()}${(s.totalDiscounts||0).toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Card Fees</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--danger);">−${posCurrency()}${(s.totalCardFees||0).toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Net Sales</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--success);">${posCurrency()}${(s.netSales||0).toFixed(2)}</div><div style="font-size:10px;color:var(--muted);">what you keep</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Avg Order (Ticket)</div><div class="mono" style="font-size:18px;font-weight:700;">${posCurrency()}${(s.avgOrderValue||0).toFixed(2)}</div></div>
      </div>
    </div>

    <!-- Top selling items (PMIX) -->
    ${reportData.itemBreakdown && reportData.itemBreakdown.length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Sales by Item (Product Mix)</div>
      <table style="width:100%; font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:6px;">#</th>
          <th style="text-align:left;padding:6px;">Item</th>
          <th style="text-align:right;padding:6px;">Qty Sold</th>
          <th style="text-align:right;padding:6px;">Revenue</th>
        </tr></thead>
        <tbody>
          ${reportData.itemBreakdown.slice(0, 25).map((it, i) => `
            <tr>
              <td class="mono" style="padding:6px; color:var(--muted);">${i + 1}</td>
              <td style="padding:6px;">${it.name}</td>
              <td class="mono" style="text-align:right;padding:6px;font-weight:700;">${it.qty}</td>
              <td class="mono" style="text-align:right;padding:6px;">${posCurrency()}${Number(it.revenue).toFixed(2)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${reportData.itemBreakdown.length > 25 ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;">Showing top 25 of ${reportData.itemBreakdown.length} items.</div>` : ""}
    </div>` : ""}

    <!-- Category performance -->
    ${reportData.categoryStats && reportData.categoryStats.length ? (() => {
      const maxRev = Math.max(...reportData.categoryStats.map(c => c.revenue), 1);
      return `
      <div class="card" style="padding:18px; margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Category Performance</div>
        ${reportData.categoryStats.map(c => `
          <div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:3px;">
              <span>${c.category} <span style="color:var(--muted);font-size:11px;">(${c.qty} sold)</span></span>
              <span class="mono" style="font-weight:700;">${posCurrency()}${Number(c.revenue).toFixed(2)}</span>
            </div>
            <div style="height:8px; background:var(--neutral-bg); border-radius:4px; overflow:hidden;">
              <div style="height:100%; width:${(c.revenue / maxRev * 100).toFixed(1)}%; background:var(--accent);"></div>
            </div>
          </div>`).join("")}
      </div>`;
    })() : ""}

    <!-- Sales by hour -->
    ${reportData.hourly ? (() => {
      const maxRev = Math.max(...reportData.hourly.map(h => h.revenue), 1);
      const active = reportData.hourly.filter(h => h.orders > 0);
      if (!active.length) return "";
      const ph = reportData.peakHour;
      const fmtHr = (h) => { const ap = h < 12 ? "am" : "pm"; const hr = h % 12 === 0 ? 12 : h % 12; return hr + ap; };
      return `
      <div class="card" style="padding:18px; margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; margin-bottom:4px;">Sales by Hour</div>
        ${ph && ph.orders > 0 ? `<div style="font-size:12px; color:var(--muted); margin-bottom:12px;">Peak: <strong>${fmtHr(ph.hour)}</strong> with ${ph.orders} order(s), ${posCurrency()}${Number(ph.revenue).toFixed(2)}</div>` : ""}
        <div style="display:flex; align-items:flex-end; gap:3px; height:140px; padding-top:10px;">
          ${reportData.hourly.map(h => {
            const pct = h.revenue / maxRev * 100;
            const isPeak = ph && h.hour === ph.hour && h.orders > 0;
            return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;" title="${fmtHr(h.hour)}: ${h.orders} orders, ${posCurrency()}${Number(h.revenue).toFixed(2)}">
              <div style="width:100%; height:${pct}%; min-height:${h.revenue > 0 ? 2 : 0}px; background:${isPeak ? "var(--accent)" : "var(--accent-soft)"}; border-radius:3px 3px 0 0;"></div>
            </div>`;
          }).join("")}
        </div>
        <div style="display:flex; gap:3px; margin-top:4px;">
          ${reportData.hourly.map(h => `<div style="flex:1; text-align:center; font-size:8px; color:var(--muted);">${h.hour % 3 === 0 ? fmtHr(h.hour) : ""}</div>`).join("")}
        </div>
      </div>`;
    })() : ""}

    <!-- Day-of-week trend -->
    ${reportData.dayOfWeek ? (() => {
      const maxRev = Math.max(...reportData.dayOfWeek.map(d => d.revenue), 1);
      const ww = reportData.weekdayVsWeekend || { weekday: 0, weekend: 0 };
      return `
      <div class="card" style="padding:18px; margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Day-of-Week Trend</div>
        <div style="display:flex; align-items:flex-end; gap:8px; height:120px;">
          ${reportData.dayOfWeek.map(d => {
            const pct = d.revenue / maxRev * 100;
            return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;" title="${d.day}: ${d.orders} orders">
              <div style="font-size:10px; color:var(--muted); margin-bottom:2px;" class="mono">${d.revenue > 0 ? posCurrency() + Math.round(d.revenue) : ""}</div>
              <div style="width:100%; height:${pct}%; min-height:${d.revenue > 0 ? 2 : 0}px; background:var(--accent); border-radius:4px 4px 0 0;"></div>
              <div style="font-size:11px; margin-top:4px;">${d.day}</div>
            </div>`;
          }).join("")}
        </div>
        <div style="display:flex; gap:12px; margin-top:14px; font-size:12px;">
          <div style="flex:1; background:var(--neutral-bg); border-radius:8px; padding:10px 12px;">
            <div style="color:var(--muted);">Weekday (Mon–Thu)</div>
            <div class="mono" style="font-size:16px; font-weight:700;">${posCurrency()}${ww.weekday.toFixed(2)}</div>
          </div>
          <div style="flex:1; background:var(--neutral-bg); border-radius:8px; padding:10px 12px;">
            <div style="color:var(--muted);">Weekend (Fri–Sun)</div>
            <div class="mono" style="font-size:16px; font-weight:700;">${posCurrency()}${ww.weekend.toFixed(2)}</div>
          </div>
        </div>
      </div>`;
    })() : ""}

    <!-- Modifier tracking -->
    ${reportData.modifierStats && reportData.modifierStats.length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Modifier &amp; Add-on Tracking</div>
      <table style="width:100%; font-size:13px;">
        <thead><tr><th style="text-align:left;padding:6px;">Add-on / Option</th><th style="text-align:right;padding:6px;">Times Ordered</th></tr></thead>
        <tbody>
          ${reportData.modifierStats.slice(0, 20).map(m => `
            <tr><td style="padding:6px;">${m.name}</td><td class="mono" style="text-align:right;padding:6px;font-weight:700;">${m.count}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <!-- Dead stock -->
    ${reportData.deadStock && reportData.deadStock.length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:4px;">Dead Stock / Low Sellers</div>
      <div style="font-size:11px; color:var(--muted); margin-bottom:12px;">Menu items with zero sales in this period — candidates to cut.</div>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${reportData.deadStock.map(d => `
          <span style="background:var(--neutral-bg); border:1px solid var(--border); border-radius:6px; padding:4px 10px; font-size:12px;">
            ${d.name} <span style="color:var(--muted);">· ${d.category}</span>
          </span>`).join("")}
      </div>
    </div>` : ""}

    <!-- Inventory cost (kept separate from revenue) -->
    ${reportData.inventoryCost ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:4px;">Inventory Cost</div>
      <div style="font-size:11px; color:var(--muted); margin-bottom:12px;">Shown separately — not deducted from revenue figures above.</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px;">
        <div><div style="font-size:11px;color:var(--muted);">Purchases (stock bought)</div><div class="mono" style="font-size:18px;font-weight:700;">${posCurrency()}${(reportData.inventoryCost.purchases||0).toFixed(2)}</div></div>
        <div><div style="font-size:11px;color:var(--muted);">Consumption (stock used)</div><div class="mono" style="font-size:18px;font-weight:700;color:var(--danger);">${posCurrency()}${(reportData.inventoryCost.consumed||0).toFixed(2)}</div><div style="font-size:10px;color:var(--muted);">from closed stock periods</div></div>
      </div>
    </div>` : ""}

    <!-- Voids -->
    ${reportData.voids.length ? `
    <div class="card" style="padding:18px; margin-bottom:16px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:12px;">Voided Orders (${reportData.voids.length})</div>
      ${reportData.voids.map(v => `
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-soft); font-size:13px;">
          <div>
            <span class="mono">${(v.displayNum || orderNum(v.orderId))}</span>
            <span style="color:var(--muted); margin-left:8px;">${v.tableName} · ${v.staffName}</span>
            ${v.reason ? `<span style="color:var(--muted)"> · ${v.reason}</span>` : ""}
          </div>
          <div class="mono" style="color:var(--danger);">${posCurrency()}${Number(v.amount).toFixed(2)}</div>
        </div>`).join("")}
    </div>` : ""}
  `;
}

// ── CSV Download ────────────────────────────────────────────
document.getElementById("rptCsvBtn").onclick = () => {
  if (!reportData) return;
  const s = reportData.summary;
  const rows = [
    ["SALES SUMMARY"],
    ["Period", `${reportData.period.from} to ${reportData.period.to}`],
    ["Total Revenue", s.totalRevenue],
    ["Total Orders", s.totalOrders],
    ["Total Tips", s.totalTips],
    ["Total Discounts", s.totalDiscounts],
    ["Card Fees", (s.totalCardFees||0).toFixed(2)],
    ["Net Received", (s.netRevenue||0).toFixed(2)],
    [],
    ["REVENUE BY PAYMENT METHOD"],
    ["Method", "Payments", "Collected", "Fee", "Net Received"],
    ...(reportData.paymentMethods || []).filter(m => m.count > 0).map(m => [
      (METHOD_LABEL[m.method] || m.method).replace(/[^\x00-\x7F]/g, "").trim(),
      m.count, m.gross.toFixed(2), m.fee.toFixed(2), m.net.toFixed(2),
    ]),
    [],
    ["SALES BY ORDER TYPE"],
    ["Order Type", "Paid Orders", "Revenue"],
    ...(reportData.salesByOrderType || []).map(x => [x.orderType, x.orders, Number(x.revenue || 0).toFixed(2)]),
    [],
    ["SALES BY EMPLOYEE"],
    ["Employee", "Paid Orders", "Revenue"],
    ...(reportData.salesByEmployee || []).map(x => [x.staffName, x.orders, Number(x.revenue || 0).toFixed(2)]),
    [],
    ["ITEM BREAKDOWN"],
    ["Item", "Qty Sold", "Revenue"],
    ...reportData.itemBreakdown.map(i => [i.name, i.qty, i.revenue.toFixed(2)]),
    [],
    ["STAFF TIPS"],
    ["Staff", "Orders", "Total Tips"],
    ...reportData.staffTips.map(t => [t.staffName, t.orderCount, t.totalTips.toFixed(2)]),
    [],
    ["VOIDED ORDERS"],
    ["Order ID", "Table", "Staff", "Amount", "Reason"],
    ...reportData.voids.map(v => [v.orderId, v.tableName, v.staffName, v.amount, v.reason||""]),
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `report_${reportData.period.from}_to_${reportData.period.to}.csv`;
  a.click();
};

// ── PDF Download (client-side using print) ──────────────────
document.getElementById("rptPdfBtn").onclick = () => {
  if (!reportData) return;
  const s    = reportData.summary;
  const cur  = posCurrency();
  const cfg  = window.posSettings || {};
  const biz  = cfg.businessName    || "Restaurant POS";
  const tag  = cfg.businessTagline || "";
  const addr = cfg.businessAddress || "";
  const phone = cfg.businessPhone  || "";
  const email = cfg.businessEmail  || "";
  const money = (n) => cur + Number(n || 0).toFixed(2);
  const stripEmoji = (s) => String(s).replace(/[^\x00-\x7F]/g, "").trim();
  const genAt = new Date().toLocaleString();
  const periodLabel = reportData.period.from === reportData.period.to
    ? reportData.period.from
    : `${reportData.period.from} → ${reportData.period.to}`;

  // Theme colours pulled from the running app so the PDF matches the brand
  const css = getComputedStyle(document.documentElement);
  const accent = (css.getPropertyValue("--accent") || "#8a5a34").trim() || "#8a5a34";
  const ink    = "#1a1a1a";

  const kpi = (label, value, sub, color) => `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-val" style="${color ? `color:${color};` : ""}">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
    </div>`;

  // Reusable horizontal bar-chart block for print (inline styles only)
  const barChart = (rows, maxVal, labelKey, valKey, fmt) => `
    <div class="bars">
      ${rows.map(r => {
        const pct = maxVal > 0 ? (r[valKey] / maxVal * 100) : 0;
        return `
        <div class="bar-row">
          <div class="bar-label">${r[labelKey]}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
          <div class="bar-val">${fmt(r[valKey])}</div>
        </div>`;
      }).join("")}
    </div>`;

  const catMax  = Math.max(...(reportData.categoryStats || []).map(c => c.revenue), 1);
  const dowMax  = Math.max(...(reportData.dayOfWeek || []).map(d => d.revenue), 1);
  const hourMax = Math.max(...(reportData.hourly || []).map(h => h.revenue), 1);
  const activeHours = (reportData.hourly || []).filter(h => h.orders > 0);
  const ph = reportData.peakHour;
  const fmtHr = (h) => { const ap = h < 12 ? "am" : "pm"; const hr = h % 12 === 0 ? 12 : h % 12; return hr + ap; };
  const ww = reportData.weekdayVsWeekend || { weekday: 0, weekend: 0 };

  const html = `
  <!DOCTYPE html><html><head><meta charset="UTF-8"/>
  <title>${biz} — Sales Report ${periodLabel}</title>
  <style>
    :root { --accent:${accent}; }
    * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    body { font-family:'Segoe UI',-apple-system,Arial,sans-serif; color:${ink}; font-size:12px; line-height:1.45; }

    /* Cover / header band */
    .header { background:var(--accent); color:#fff; padding:34px 40px 28px; }
    .header .brand { font-size:26px; font-weight:800; letter-spacing:.3px; }
    .header .tagline { font-size:12px; opacity:.85; margin-top:2px; }
    .header .contact { font-size:11px; opacity:.8; margin-top:8px; }
    .header .report-title { margin-top:18px; font-size:13px; text-transform:uppercase; letter-spacing:2px; opacity:.9; }
    .header .period { font-size:20px; font-weight:700; margin-top:2px; }

    .wrap { padding:28px 40px 40px; }

    /* KPI cards */
    .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:26px; }
    .kpi { border:1px solid #e6e6e6; border-radius:10px; padding:14px 16px; background:#fafafa; }
    .kpi-label { font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#888; }
    .kpi-val { font-size:21px; font-weight:800; margin-top:3px; }
    .kpi-sub { font-size:10px; color:#999; margin-top:1px; }

    /* Section headings */
    h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--accent);
         border-bottom:2px solid var(--accent); padding-bottom:5px; margin:26px 0 12px; }

    /* Tables */
    table { width:100%; border-collapse:collapse; margin-bottom:8px; }
    th { text-align:left; padding:8px 10px; background:var(--accent); color:#fff; font-size:10px;
         text-transform:uppercase; letter-spacing:.5px; }
    th.right, td.right { text-align:right; }
    td { padding:7px 10px; border-bottom:1px solid #eee; font-size:11.5px; }
    tbody tr:nth-child(even) td { background:#f7f7f7; }
    .rank { color:#aaa; width:26px; }

    /* Bar charts */
    .bars { margin:6px 0 10px; }
    .bar-row { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
    .bar-label { width:120px; font-size:11px; flex-shrink:0; }
    .bar-track { flex:1; height:14px; background:#eee; border-radius:7px; overflow:hidden; }
    .bar-fill { height:100%; background:var(--accent); border-radius:7px; }
    .bar-val { width:90px; text-align:right; font-size:11px; font-weight:700; flex-shrink:0; }

    /* Hour columns */
    .hour-chart { display:flex; align-items:flex-end; gap:2px; height:90px; margin:8px 0 2px; }
    .hour-col { flex:1; display:flex; flex-direction:column; justify-content:flex-end; height:100%; }
    .hour-bar { width:100%; background:var(--accent); border-radius:2px 2px 0 0; }
    .hour-axis { display:flex; gap:2px; }
    .hour-tick { flex:1; text-align:center; font-size:7px; color:#aaa; }

    .split { display:flex; gap:14px; margin-top:12px; }
    .split > div { flex:1; background:#fafafa; border:1px solid #eee; border-radius:8px; padding:12px 14px; }
    .split .lbl { font-size:10px; color:#888; text-transform:uppercase; letter-spacing:.5px; }
    .split .amt { font-size:17px; font-weight:800; margin-top:2px; }

    .chips { display:flex; flex-wrap:wrap; gap:6px; }
    .chip { border:1px solid #ddd; border-radius:6px; padding:4px 9px; font-size:11px; background:#fafafa; }
    .chip span { color:#999; }

    .footer { margin-top:34px; padding-top:12px; border-top:1px solid #eee;
              display:flex; justify-content:space-between; font-size:9.5px; color:#aaa; }

    .section { page-break-inside:avoid; }
    @page { margin:0; size:A4; }
    @media print { .wrap { padding:22px 34px 30px; } }
  </style></head>
  <body>
    <div class="header">
      <div class="brand">${biz}</div>
      ${tag ? `<div class="tagline">${tag}</div>` : ""}
      ${(addr || phone || email) ? `<div class="contact">${[addr, phone, email].filter(Boolean).join("  •  ")}</div>` : ""}
      <div class="report-title">Sales Report</div>
      <div class="period">${periodLabel}</div>
    </div>

    <div class="wrap">
      <!-- KPIs -->
      <div class="kpi-grid">
        ${kpi("Gross Sales", money(s.grossSales ?? s.totalRevenue), "before deductions")}
        ${kpi("Net Received", money(s.netRevenue ?? s.netSales), "after fees & discounts", "#1b7f4d")}
        ${kpi("Total Orders", s.totalOrders, "")}
        ${kpi("Avg Ticket", money(s.avgOrderValue), "per order")}
        ${kpi("Tips Collected", money(s.totalTips), "")}
        ${kpi("Discounts", money(s.totalDiscounts), "", "#b3261e")}
        ${kpi("Card Fees", "-" + money(s.totalCardFees), "bank cut", "#b3261e")}
        ${kpi("Voided Orders", reportData.voids.length, "")}
      </div>

      <!-- Payment methods -->
      <div class="section">
        <h2>Revenue by Payment Method</h2>
        <table>
          <thead><tr><th>Method</th><th class="right">Payments</th><th class="right">Collected</th><th class="right">Fee</th><th class="right">Net Received</th></tr></thead>
          <tbody>
            ${(reportData.paymentMethods || []).filter(m => m.count > 0).map(m => `
              <tr>
                <td>${stripEmoji(METHOD_LABEL[m.method] || m.method)}</td>
                <td class="right">${m.count}</td>
                <td class="right">${money(m.gross)}</td>
                <td class="right">${m.fee > 0 ? "-" + money(m.fee) : "—"}</td>
                <td class="right"><strong>${money(m.net)}</strong></td>
              </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">No payments</td></tr>`}
          </tbody>
        </table>
      </div>

      <!-- PMIX -->
      ${reportData.itemBreakdown && reportData.itemBreakdown.length ? `
      <div class="section">
        <h2>Top Selling Items</h2>
        <table>
          <thead><tr><th class="rank">#</th><th>Item</th><th class="right">Qty</th><th class="right">Revenue</th></tr></thead>
          <tbody>
            ${reportData.itemBreakdown.slice(0, 20).map((it, i) => `
              <tr><td class="rank">${i + 1}</td><td>${it.name}</td><td class="right"><strong>${it.qty}</strong></td><td class="right">${money(it.revenue)}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>` : ""}

      <!-- Category performance -->
      ${reportData.categoryStats && reportData.categoryStats.length ? `
      <div class="section">
        <h2>Category Performance</h2>
        ${barChart(reportData.categoryStats, catMax, "category", "revenue", money)}
      </div>` : ""}

      <!-- Sales by hour -->
      ${activeHours.length ? `
      <div class="section">
        <h2>Sales by Hour</h2>
        ${ph && ph.orders > 0 ? `<div style="font-size:11px;color:#666;margin-bottom:6px;">Peak hour: <strong>${fmtHr(ph.hour)}</strong> — ${ph.orders} orders, ${money(ph.revenue)}</div>` : ""}
        <div class="hour-chart">
          ${reportData.hourly.map(h => `<div class="hour-col"><div class="hour-bar" style="height:${hourMax > 0 ? (h.revenue / hourMax * 100).toFixed(1) : 0}%;"></div></div>`).join("")}
        </div>
        <div class="hour-axis">
          ${reportData.hourly.map(h => `<div class="hour-tick">${h.hour % 3 === 0 ? fmtHr(h.hour) : ""}</div>`).join("")}
        </div>
      </div>` : ""}

      <!-- Day of week -->
      ${reportData.dayOfWeek ? `
      <div class="section">
        <h2>Day-of-Week Trend</h2>
        ${barChart(reportData.dayOfWeek, dowMax, "day", "revenue", money)}
        <div class="split">
          <div><div class="lbl">Weekday (Mon–Thu)</div><div class="amt">${money(ww.weekday)}</div></div>
          <div><div class="lbl">Weekend (Fri–Sun)</div><div class="amt">${money(ww.weekend)}</div></div>
        </div>
      </div>` : ""}

      <!-- Modifiers -->
      ${reportData.modifierStats && reportData.modifierStats.length ? `
      <div class="section">
        <h2>Add-ons &amp; Modifiers</h2>
        <table>
          <thead><tr><th>Option</th><th class="right">Times Ordered</th></tr></thead>
          <tbody>${reportData.modifierStats.slice(0, 15).map(m => `<tr><td>${m.name}</td><td class="right"><strong>${m.count}</strong></td></tr>`).join("")}</tbody>
        </table>
      </div>` : ""}

      <!-- Staff tips -->
      ${reportData.staffTips.length ? `
      <div class="section">
        <h2>Staff Tips</h2>
        <table>
          <thead><tr><th>Staff</th><th class="right">Orders</th><th class="right">Total Tips</th></tr></thead>
          <tbody>${reportData.staffTips.map(t => `<tr><td>${t.staffName}</td><td class="right">${t.orderCount}</td><td class="right">${money(t.totalTips)}</td></tr>`).join("")}</tbody>
        </table>
      </div>` : ""}

      <!-- Dead stock -->
      ${reportData.deadStock && reportData.deadStock.length ? `
      <div class="section">
        <h2>Dead Stock / Low Sellers</h2>
        <div style="font-size:10px;color:#999;margin-bottom:8px;">No sales in this period — candidates to cut.</div>
        <div class="chips">
          ${reportData.deadStock.map(d => `<div class="chip">${d.name} <span>· ${d.category}</span></div>`).join("")}
        </div>
      </div>` : ""}

      <!-- Inventory cost -->
      ${reportData.inventoryCost ? `
      <div class="section">
        <h2>Inventory Cost</h2>
        <div style="font-size:10px;color:#999;margin-bottom:8px;">Shown separately from sales — not deducted from revenue.</div>
        <div class="split">
          <div><div class="lbl">Purchases (stock bought)</div><div class="amt">${money(reportData.inventoryCost.purchases)}</div></div>
          <div><div class="lbl">Consumption (stock used)</div><div class="amt" style="color:#b3261e;">${money(reportData.inventoryCost.consumed)}</div></div>
        </div>
      </div>` : ""}

      <!-- Voids -->
      ${reportData.voids.length ? `
      <div class="section">
        <h2>Voided Orders (${reportData.voids.length})</h2>
        <table>
          <thead><tr><th>Order</th><th>Table</th><th>Staff</th><th class="right">Amount</th><th>Reason</th></tr></thead>
          <tbody>${reportData.voids.map(v => `<tr><td>#${String(v.orderId).padStart(4,'0')}</td><td>${v.tableName}</td><td>${v.staffName}</td><td class="right">${money(v.amount)}</td><td>${v.reason || ""}</td></tr>`).join("")}</tbody>
        </table>
      </div>` : ""}

      <div class="footer">
        <span>${biz} · Sales Report · ${periodLabel}</span>
        <span>Generated ${genAt} · Powered by RapidSolutions</span>
      </div>
    </div>
  </body></html>`;

  const win = window.open("", "_blank");
  if (!win) { showToast("Allow pop-ups to download the PDF"); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => setTimeout(() => win.print(), 300);
};

if (staff) loadSummary();

})();
