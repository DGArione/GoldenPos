// ============================================================
// src/api.js — port of api/index.php (the REST router)
// ------------------------------------------------------------
// handle(ctx) mirrors the original PHP router top-to-bottom. ctx carries
// { method, uri, query, body, headers, remoteAddr, userAgent }. jsonOut()/
// err() throw a Resp that server.js turns into the HTTP response, so a
// matched-and-answered route stops the chain exactly like PHP's exit().
// ============================================================
'use strict';

// This computer's private (LAN) IPv4 addresses, most likely Wi-Fi/Ethernet first.
function lanAddresses() {
  const os = require('os'); const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      const virt = /virtual|vmware|vbox|hyper-v|vethernet|docker|wsl|loopback/i.test(name);
      out.push({ ip: a.address, score: (virt ? 10 : 0) + (a.address.startsWith('192.168.') ? 0 : 1) });
    }
  }
  return out.sort((x, y) => x.score - y.score).map((x) => x.ip);
}
// True when the QR address is a plain IP that this computer no longer has.
function qrIpMismatch(base, lan) {
  try {
    const host = new URL(base).hostname;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;   // a name / public domain: can't tell
    return !lan.includes(host);
  } catch (_) { return false; }
}

const { db } = require('./db');
const H = require('./helpers');
const {
  Resp, jsonOut, err, routeMatch, buildSet, jsonDecode, jsonEncode,
  requireUser, requireRole, branchId, currentUser, checkRateLimit,
  makeToken, verifyPin, hashPin, sha256hex, passwordHash, passwordVerify,
  assertPinAvailable, findManagerByPin, findApproverByPin, assertApprovalPinAvailable, canManage, truncate, safeDate,
  userRow, orderRow, menuRow, ingredientRow, settingsRow, notifRow, shiftRow,
  getSettings, computeTotals, deductInventoryLine, restoreInventory,
  checkLowStock, nextOrderSeqNum, orderNum, addNotification,
  nowStr, isoNow, todayStr, dateAddDays, monthStart, mondayThisWeek, tsSeconds,
  numberFormat, ucfirst, round2, arrColumn, arrSum,
} = H;

const int = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
const flt = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const has = (v) => v !== undefined && v !== null;

// Award loyalty points for a fully-paid order, exactly once. Auto-creates the
// customer by phone if needed so points are never lost, and logs a ledger row.
function awardLoyaltyPoints(dbc, o, oid, s, staffName) {
  const row = dbc.prepare('SELECT loyaltyAwarded FROM orders WHERE id=?'); row.execute([oid]);
  if (int((row.fetch() || {}).loyaltyAwarded || 0)) return;   // already awarded
  const per = flt(s.loyaltyEarnPer) || 100;
  const pts = Math.floor((flt(o.grandTotal) || 0) / per) * (flt(s.loyaltyEarnPoints) || 0);
  if (pts > 0) {
    const cSt = dbc.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?');
    cSt.execute([o.branchId, o.customerPhone]);
    let cust = cSt.fetch();
    if (!cust) {
      dbc.prepare('INSERT INTO customers (branchId,phone,name,address) VALUES (?,?,?,?) ON CONFLICT(branchId,phone) DO NOTHING')
        .execute([o.branchId, o.customerPhone, o.customerName || '', o.customerAddress || '']);
      cSt.execute([o.branchId, o.customerPhone]); cust = cSt.fetch();
    }
    if (cust) {
      dbc.prepare('UPDATE customers SET loyaltyPoints = COALESCE(loyaltyPoints,0) + ? WHERE id=?').execute([pts, int(cust.id)]);
      dbc.prepare('INSERT INTO loyalty_ledger (branchId,customerId,phone,orderId,type,points,note,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
        .execute([o.branchId, int(cust.id), o.customerPhone, oid, 'earn', pts, 'Order ' + (o.displayNum || ('#' + oid)), staffName || '']);
    }
  }
  dbc.prepare('UPDATE orders SET loyaltyAwarded=1 WHERE id=?').execute([oid]);
}

// Price and validate one order line against the SERVER's menu + modifier rules.
// Prices and option deltas come from the database, never the client, and the
// group's required/min/max rules are enforced. Throws err() on any violation.
function priceAndValidateLine(dbc, branchId, i) {
  const mid = int(i.menuItemId);
  const miSt = dbc.prepare('SELECT * FROM menu_items WHERE id=? AND branchId=?');
  miSt.execute([mid, branchId]);
  const miRow = miSt.fetch();
  if (!miRow) err('Invalid menu item: ' + mid, 400);
  const price = flt(miRow.price);
  const name = miRow.name;
  if (miRow.soldOut) err('Sorry — ' + name + ' is sold out', 400);
  const groups = jsonDecode(miRow.modifiers, []) || [];
  const qty = Math.max(1, int(i.qty) || 1);

  // Group the client's selections by group name.
  const byGroup = {};
  for (const m of (Array.isArray(i.modifiers) ? i.modifiers : [])) {
    const gname = String(m.group || '');
    (byGroup[gname] = byGroup[gname] || []).push(m);
  }
  const safeMods = []; let modTotal = 0;
  for (const g of groups) {
    const gmax = Math.max(1, int(g.max) || 1);
    const gmin = g.required ? Math.max(1, int(g.min) || 1) : Math.max(0, int(g.min) || 0);
    const picks = byGroup[g.name] || [];
    if (picks.length < gmin) err(`"${name}": choose at least ${gmin} from "${g.name}"`, 400);
    if (picks.length > gmax) err(`"${name}": choose at most ${gmax} from "${g.name}"`, 400);
    for (const pick of picks) {
      const optName = String(pick.option || pick.name || '');
      const opt = (g.options || []).find((o) => (o.name || o.option) === optName);
      if (!opt) err(`"${name}": invalid option "${optName}" in "${g.name}"`, 400);
      const delta = flt(opt.priceDelta || 0);
      modTotal += delta;
      safeMods.push({ group: g.name, option: (opt.name || opt.option), priceDelta: delta, qtyMultiplier: opt.qtyMultiplier, recipe: opt.recipe || [] });
    }
  }
  // A selection pointing at a group the item doesn't define is rejected.
  for (const gname of Object.keys(byGroup)) {
    if (!groups.find((g) => g.name === gname)) err(`"${name}": unknown modifier group "${gname}"`, 400);
  }
  let stId = miRow.stationId ? int(miRow.stationId) : null, stName = 'Unassigned';
  if (stId) { const st = dbc.prepare('SELECT name FROM stations WHERE id=?'); st.execute([stId]); const sr = st.fetch(); stName = sr ? sr.name : 'Unassigned'; }
  return Object.assign({}, i, {
    menuItemId: mid, qty, name, basePrice: price, modifiers: safeMods,
    lineTotal: round2((price + modTotal) * qty), stationId: stId, stationName: stName,
    status: 'pending', inventoryDeducted: false,
  });
}

// Write a change-audit row for a successful mutating request. Called by the
// host (server.js) after handle() resolves, so it sees the final status code.
// Sensitive fields are redacted; audit never throws into the request path.
function auditLog(ctx, statusCode) {
  try {
    const u = ctx._user; if (!u) return;
    const m = ctx.method;
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return;
    if (statusCode >= 400) return;
    const path = ctx.uri || '';
    if (/^\/notifications(\/|$)/.test(path)) return;   // too noisy, not a change
    const body = ctx.body || {};
    const redacted = {};
    for (const k of Object.keys(body)) {
      if (/pin|password|token|secret|auth|logo|image|bg|data/i.test(k)) { redacted[k] = '***'; continue; }
      let v = body[k];
      if (typeof v === 'string') v = v.length > 80 ? v.slice(0, 80) + '…' : v;
      else if (Array.isArray(v)) v = `[${v.length} item(s)]`;
      else if (v && typeof v === 'object') v = '{…}';
      redacted[k] = v;
    }
    let summary = ''; try { summary = JSON.stringify(redacted); } catch (_) {}
    if (summary.length > 500) summary = summary.slice(0, 500) + '…';
    db.prepare('INSERT INTO audit_log (branchId,userId,userName,role,method,path,summary,statusCode,ip) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([ctx._bid || null, int(u.id), u.name || '', u.role || '', m, path, summary, int(statusCode), String(ctx.remoteAddr || '').slice(0, 64)]);
  } catch (e) { /* audit is best-effort */ }
}

// ── Gift card money trail ───────────────────────────────────────────────
// Every change to a card's balance goes through these two helpers so a row in
// gift_card_ledger is written in the same step, with the balance after it.
// Callers run them inside a transaction with the order update.
function giftDebit(dbc, card, amount, info) {
  const amt = round2(amount);
  // Conditional update: two tills redeeming at once cannot overdraw the card.
  dbc.prepare("UPDATE gift_cards SET balance = round(balance - ?, 2) WHERE id=? AND status='active' AND balance >= ? - 0.001").execute([amt, int(card.id), amt]);
  if (!dbc._changes) err('Gift card balance changed - check the card and try again', 409);
  return giftLedgerRow(dbc, card, info.type || 'redeem', -amt, info);
}
function giftCredit(dbc, card, amount, info) {
  const amt = round2(amount);
  dbc.prepare('UPDATE gift_cards SET balance = round(balance + ?, 2) WHERE id=?').execute([amt, int(card.id)]);
  return giftLedgerRow(dbc, card, info.type || 'refund', amt, info);
}
function giftLedgerRow(dbc, card, type, amount, info) {
  const b = dbc.prepare('SELECT balance FROM gift_cards WHERE id=?'); b.execute([int(card.id)]);
  const after = round2(flt((b.fetch() || {}).balance));
  dbc.prepare('INSERT INTO gift_card_ledger (branchId,cardId,code,orderId,orderNum,type,amount,balanceAfter,byStaffName,note) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .execute([int(card.branchId), int(card.id), card.code, info.orderId || null, truncate(info.orderNum || '', 40), type, round2(amount), after, truncate(info.by || '', 120), truncate(info.note || '', 300)]);
  return after;
}
/** Net amount each gift card still has on an order (payments minus refunds). */
function giftNetByCode(payments) {
  const net = {};
  for (const p of payments || []) {
    if (p.method !== 'giftcard' || !p.code) continue;
    net[p.code] = round2((net[p.code] || 0) + flt(p.amount));
  }
  return net;
}

// Undo loyalty for an order that is voided / fully refunded: points the
// customer spent on it go back, points it earned are taken off. Each change is
// a loyalty_ledger row. Runs once per order (ledger rows of type 'reverse' /
// 'return' mark it as done).
function loyaltyUndo(dbc, o, oid, by, why) {
  const done = dbc.prepare("SELECT COUNT(*) n FROM loyalty_ledger WHERE orderId=? AND type IN ('reverse','return')"); done.execute([oid]);
  if (int((done.fetch() || {}).n)) return;
  const rows = dbc.prepare('SELECT * FROM loyalty_ledger WHERE orderId=?'); rows.execute([oid]);
  const byCust = {};
  for (const r of rows.fetchAll()) {
    const k = int(r.customerId); byCust[k] = byCust[k] || { earn: 0, redeem: 0, phone: r.phone, branchId: r.branchId };
    if (r.type === 'earn') byCust[k].earn += flt(r.points);
    if (r.type === 'redeem') byCust[k].redeem += -flt(r.points);
  }
  const label = o.displayNum || ('#' + oid);
  for (const [cid, v] of Object.entries(byCust)) {
    if (v.redeem > 0) {
      dbc.prepare('UPDATE customers SET loyaltyPoints = COALESCE(loyaltyPoints,0) + ? WHERE id=?').execute([v.redeem, int(cid)]);
      dbc.prepare('INSERT INTO loyalty_ledger (branchId,customerId,phone,orderId,type,points,note,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
        .execute([v.branchId, int(cid), v.phone, oid, 'return', v.redeem, `Points given back - ${label} ${why}`, by || '']);
    }
    if (v.earn > 0) {
      // never take a customer below zero
      const c = dbc.prepare('SELECT loyaltyPoints FROM customers WHERE id=?'); c.execute([int(cid)]);
      const take = Math.min(v.earn, Math.max(0, flt((c.fetch() || {}).loyaltyPoints)));
      dbc.prepare('UPDATE customers SET loyaltyPoints = COALESCE(loyaltyPoints,0) - ? WHERE id=?').execute([take, int(cid)]);
      dbc.prepare('INSERT INTO loyalty_ledger (branchId,customerId,phone,orderId,type,points,note,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
        .execute([v.branchId, int(cid), v.phone, oid, 'reverse', -take, `Points earned on ${label} taken back - ${why}`, by || '']);
    }
  }
}

// Plain-words description of every ACTIVE promotion at a branch (staff list,
// customer QR menu). availableToday follows the promotion's days, exactly like
// the discount engine (computeBestPromotion).
function describePromotions(dbc, branchId) {
  const s = getSettings();
  if (!(Array.isArray(s.enabledAddons) && s.enabledAddons.includes('promotions'))) return [];
  const st = dbc.prepare('SELECT * FROM promotions WHERE branchId=? AND active=1 ORDER BY priority DESC, id DESC'); st.execute([branchId]);
  const today = new Date().getDay();
  const cur = s.currencySymbol || 'Rs. ';
  const names = {};
  const itemOf = (id) => {
    if (!(id in names)) { const q = dbc.prepare('SELECT name, soldOut FROM menu_items WHERE id=? AND branchId=?'); q.execute([id, branchId]); const r = q.fetch(); names[id] = r ? { name: r.name, soldOut: !!int(r.soldOut) } : null; }
    return names[id];
  };
  const out = [];
  for (const p of st.fetchAll()) {
    const conds = (jsonDecode(p.conditions, []) || []).map((c) => ({ menuItemId: int(c.menuItemId), qty: Math.max(1, int(c.qty) || 1) }))
      .filter((c) => itemOf(c.menuItemId)).map((c) => Object.assign(c, { name: itemOf(c.menuItemId).name }));
    if (!conds.length) continue;
    const days = (jsonDecode(p.days, []) || []).map((d) => int(d)).filter((d) => d >= 0 && d <= 6);
    const value = flt(p.rewardValue);
    const headline = p.rewardKind === 'amount' ? `${cur}${numberFormat(value, value % 1 ? 2 : 0)} off` : `${value % 1 ? value : Math.round(value)}% off`;
    const list = conds.map((c) => `${c.qty > 1 || p.type !== 'daily' ? c.qty + ' × ' : ''}${c.name}`);
    const detail = p.type === 'daily'
      ? `On ${list.join(', ')}`
      : `When you order ${list.join(' + ')}` + (p.scope === 'order' && p.rewardKind === 'percent' ? ' - off the whole order' : '');
    out.push({
      id: int(p.id), name: p.name, headline, detail, note: p.customerNote || '', type: p.type,
      items: conds, days: days.length === 7 ? [] : days, availableToday: !days.length || days.includes(today),
      showToCustomers: !!int(p.showToCustomers),
    });
  }
  out.sort((a, b) => Number(b.availableToday) - Number(a.availableToday));   // today's first
  return out;
}

// Assign a sequential fiscal invoice number to a paid order, once, when fiscal
// mode is on. Returns nothing; safe to call on every full-payment path.
function assignFiscalIfDue(dbc, oid) {
  try {
    const s = getSettings();
    if (!s.fiscalEnabled) return;
    const o = dbc.prepare('SELECT fiscalNumber, paymentStatus FROM orders WHERE id=?'); o.execute([oid]);
    const row = o.fetch();
    if (!row || row.fiscalNumber || row.paymentStatus !== 'paid') return;
    const seqSt = dbc.prepare('SELECT fiscalSeq FROM settings WHERE id=1'); seqSt.execute([]);
    const next = int((seqSt.fetch() || {}).fiscalSeq || 0) + 1;
    dbc.prepare('UPDATE settings SET fiscalSeq=? WHERE id=1').execute([next]);
    getSettings(true);
    const num = (s.fiscalPrefix || 'INV-') + String(next).padStart(6, '0');
    dbc.prepare('UPDATE orders SET fiscalNumber=? WHERE id=?').execute([num, oid]);
  } catch (e) { /* fiscal numbering must not block payment */ }
}

// A random, unguessable token for a table's QR link (ambiguous chars dropped).
function genTableToken() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 16; i++) t += A[Math.floor(Math.random() * A.length)];
  return t;
}

// Evaluate active promotions for a branch against a cart and return the single
// best one as { promotionId, name, amount }, or null. Promotions never stack —
// the highest-value applicable promo wins (keeps discounts predictable).
function computeBestPromotion(dbc, branchId, items, settings) {
  if (!branchId || !Array.isArray(items) || !items.length) return null;
  let rows;
  try {
    const st = dbc.prepare('SELECT * FROM promotions WHERE branchId=? AND active=1');
    st.execute([branchId]); rows = st.fetchAll();
  } catch (e) { return null; }
  if (!rows || !rows.length) return null;

  // Aggregate cart quantities and line totals per menu item.
  const qtyById = {}, totalById = {};
  for (const it of items) {
    const mid = int(it.menuItemId);
    qtyById[mid] = (qtyById[mid] || 0) + int(it.qty);
    totalById[mid] = round2((totalById[mid] || 0) + flt(it.lineTotal || 0));
  }
  const subtotal = round2(arrSum(arrColumn(items, 'lineTotal')));
  const today = new Date().getDay();

  let best = null;
  for (const p of rows) {
    const days = jsonDecode(p.days, []) || [];
    if (days.length && !days.includes(today)) continue;   // not scheduled today
    const conds = jsonDecode(p.conditions, []) || [];
    if (!conds.length) continue;

    let qualifies = true, qualifyingTotal = 0;
    if (p.type === 'daily') {
      // Percent off the listed items present in the cart (any of them).
      let any = false;
      for (const c of conds) {
        const mid = int(c.menuItemId);
        if (qtyById[mid]) { any = true; qualifyingTotal += totalById[mid] || 0; }
      }
      qualifies = any;
    } else {
      // buy_n / bundle: every condition's quantity must be met.
      for (const c of conds) {
        const mid = int(c.menuItemId), need = int(c.qty) || 1;
        if ((qtyById[mid] || 0) < need) { qualifies = false; break; }
        qualifyingTotal += totalById[mid] || 0;
      }
    }
    if (!qualifies) continue;

    const kind = p.rewardKind || 'percent';
    const value = flt(p.rewardValue || 0);
    let amount = 0;
    if (kind === 'amount') amount = value;
    else { // percent
      const base = (p.scope === 'order') ? subtotal : qualifyingTotal;
      amount = round2(base * value / 100);
    }
    amount = round2(Math.min(amount, subtotal));
    if (amount > 0 && (!best || amount > best.amount)) {
      best = { promotionId: int(p.id), name: p.name, amount };
    }
  }
  return best;
}

function handle(ctx) {
  const method = ctx.method;
  const uri = ctx.uri;
  const query = ctx.query || {};
  const body = ctx.body || {};
  const params = {};

  // ═══════════════════════════════════════════════════════════
  // PUBLIC ROUTES (no auth required)
  // ═══════════════════════════════════════════════════════════

  if (method === 'GET' && uri === '/public/has-admin') {
    const count = int(db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin'").fetch().c);
    jsonOut({ hasAdmin: count > 0 });
  }

  if (method === 'POST' && uri === '/public/create-admin') {
    const count = int(db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin'").fetch().c);
    if (count > 0) jsonOut({ error: 'Admin already exists.' }, 403);
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    if (!name) jsonOut({ error: 'Name is required.' }, 400);
    if (!username) jsonOut({ error: 'Username is required.' }, 400);
    if (username.length < 3) jsonOut({ error: 'Username must be at least 3 characters.' }, 400);
    if (password.length < 6) jsonOut({ error: 'Password must be at least 6 characters.' }, 400);
    const takenSt = db.prepare('SELECT COUNT(*) AS c FROM users WHERE username=?');
    takenSt.execute([username]);
    if (int(takenSt.fetch().c) > 0) jsonOut({ error: 'Username already taken.' }, 400);
    const ph = passwordHash(password);
    db.prepare(
      `INSERT INTO users (branchId, name, username, passwordHash, mustChangePassword, role, payRate, payType, authMethod)
       VALUES (NULL, ?, ?, ?, 0, 'admin', 0.00, 'hourly', 'password')`
    ).execute([name, username, ph]);
    jsonOut({ ok: true });
  }

  if (method === 'GET' && uri === '/public/settings') {
    let s;
    try { s = getSettings(); } catch (e) {
      jsonOut({
        businessName: 'Restaurant POS', logoUrl: '', businessTagline: '',
        businessPhone: '', businessAddress: '', businessEmail: '',
        theme: 'light', allowUserThemeOverride: true,
        lightThemeId: '', darkThemeId: '', activeThemeId: '',
        accentColor: '', accentDark: '', accentSoft: '', font: '',
        currencySymbol: '$', serviceChargeRate: 0, vatRate: 0, cardFeePercent: 0,
        receiptFooterText: '', receiptShowVatBreakdown: false,
        loginLayout: 'classic', loginBgUrl: '', loginPanelImageUrl: '', autoStockClose: true, enabledAddons: [],
        loyaltyEarnPoints: 1, loyaltyEarnPer: 100, loyaltyRedeemValue: 1, loyaltyMinRedeem: 0,
        taxRegNo: '', fiscalEnabled: false, fiscalPrefix: 'INV-',
        printAgentUrl: '', printAgentEnabled: false, printPaperWidth: 48, kitchenPrinterName: '', paymentPrinterName: '', qrPrinterName: '',
        publicBaseUrl: '', qrOrderAutoKitchen: true, defaultOrderType: 'dine-in', loginThemeId: '',
      });
    }
    jsonOut({
      businessName: s.businessName, logoUrl: s.logoUrl, businessTagline: s.businessTagline,
      businessPhone: s.businessPhone, businessAddress: s.businessAddress, businessEmail: s.businessEmail,
      theme: s.theme, allowUserThemeOverride: s.allowUserThemeOverride,
      lightThemeId: s.lightThemeId, darkThemeId: s.darkThemeId, activeThemeId: s.activeThemeId,
      accentColor: s.accentColor, accentDark: s.accentDark, accentSoft: s.accentSoft, font: s.font,
      currencySymbol: s.currencySymbol, serviceChargeRate: s.serviceChargeRate, vatRate: s.vatRate,
      cardFeePercent: s.cardFeePercent || 0, receiptFooterText: s.receiptFooterText,
      receiptShowVatBreakdown: s.receiptShowVatBreakdown, loginLayout: s.loginLayout, loginBgUrl: s.loginBgUrl,
      loginPanelImageUrl: s.loginPanelImageUrl || '',
      autoStockClose: s.autoStockClose !== false,
      enabledAddons: s.enabledAddons || [],
      loyaltyEarnPoints: s.loyaltyEarnPoints, loyaltyEarnPer: s.loyaltyEarnPer,
      loyaltyRedeemValue: s.loyaltyRedeemValue, loyaltyMinRedeem: s.loyaltyMinRedeem,
      taxRegNo: s.taxRegNo || '', fiscalEnabled: !!s.fiscalEnabled, fiscalPrefix: s.fiscalPrefix || 'INV-',
      printAgentUrl: s.printAgentUrl || '', printAgentEnabled: !!s.printAgentEnabled, printPaperWidth: s.printPaperWidth || 48,
      kitchenPrinterName: s.kitchenPrinterName || '', paymentPrinterName: s.paymentPrinterName || '', qrPrinterName: s.qrPrinterName || '',
      publicBaseUrl: s.publicBaseUrl || '', qrOrderAutoKitchen: s.qrOrderAutoKitchen !== false,
      defaultOrderType: s.defaultOrderType || 'dine-in',
      loginThemeId: s.loginThemeId || '',
      homeBanners: s.homeBanners || [],
      accentColor: s.accentColor || '',
    });
  }

  // ── Offers on the customer QR menu ─────────────────────────────────────
  // Only promotions the restaurant switched to "Show to customers" (and that
  // are active) are listed. Identify the branch by table token or branchId.
  const publicBranch = () => {
    if (query.token || body.token) {
      const tok = String(query.token || body.token || '').slice(0, 64);
      const t = db.prepare('SELECT branchId FROM tables_list WHERE qrToken=?'); t.execute([tok]);
      const row = t.fetch(); if (!row) err('This QR code is not recognised.', 404);
      return int(row.branchId);
    }
    const b = int(query.branchId || body.branchId); if (!b) err('branchId required', 400);
    return b;
  };
  if (method === 'GET' && uri === '/public/promotions') {
    const pb = publicBranch();
    // Only offers the restaurant chose to show, and only on the days they run.
    const list = describePromotions(db, pb).filter((p) => p.showToCustomers && p.availableToday)
      .map(({ id, name, headline, detail, note, type, items, days, availableToday }) => ({ id, name, headline, detail, note, type, items, days, availableToday }));
    jsonOut({ promotions: list });
  }
  // What a customer's cart would save - the same calculation the real order uses.
  if (method === 'POST' && uri === '/public/promo-preview') {
    const pb = publicBranch();
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 60);
    if (!items.length) jsonOut({ promo: null });
    let lines;
    try { lines = items.map((i) => priceAndValidateLine(db, pb, { menuItemId: int(i.menuItemId), qty: Math.min(99, Math.max(1, int(i.qty) || 1)) })); }
    catch (e) { jsonOut({ promo: null }); }
    const promo = computeBestPromotion(db, pb, lines, getSettings());
    jsonOut({ promo: promo ? { name: promo.name, amount: promo.amount } : null });
  }

  if (method === 'GET' && uri === '/public/menu') {
    const mbid = int(query.branchId);
    if (!mbid) err('branchId required', 400);
    const bChk = db.prepare("SELECT id FROM branches WHERE id=? AND status='active'");
    bChk.execute([mbid]);
    if (!bChk.fetch()) err('Invalid branch', 400);
    const st = db.prepare('SELECT * FROM menu_items WHERE branchId=? ORDER BY category, name');
    st.execute([mbid]);
    const items = st.fetchAll().map((r) => {
      const m = menuRow(r);
      // Photos are stored as data: URLs. Send a small link instead of the whole
      // picture so the menu loads fast on mobile data; the phone then fetches
      // each photo once (/api/public/menu-image/<id>, cached by the browser).
      const img = String(m.imageUrl || '');
      let imageUrl = '';
      if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(img)) {
        const v = require('crypto').createHash('sha1').update(img).digest('hex').slice(0, 10);
        imageUrl = `/api/public/menu-image/${m.id}?v=${v}`;
      } else if (/^https:\/\//i.test(img)) {
        imageUrl = img;
      }
      return {
        id: m.id, name: m.name, price: m.price, category: m.category,
        imageUrl, soldOut: !!m.soldOut, tags: String(m.tags || ''), modifiers: m.modifiers || [],
      };
    });
    const cSt = db.prepare('SELECT name FROM categories WHERE branchId=? ORDER BY sortOrder, name');
    cSt.execute([mbid]);
    const cats = cSt.fetchAll().map((r) => r.name);
    const s = getSettings();
    jsonOut({
      items, categories: cats, currency: s.currencySymbol || 'Rs. ',
      rates: { serviceCharge: flt(s.serviceChargeRate || 0), vat: flt(s.vatRate || 0) },
    });
  }

  if (method === 'GET' && uri === '/public/branches') {
    let rows = db.query(
      `SELECT b.id, b.name FROM branches b
        WHERE b.status='active' AND EXISTS (SELECT 1 FROM menu_items m WHERE m.branchId = b.id)
        ORDER BY b.id`
    ).fetchAll();
    if (!rows.length) rows = db.query("SELECT id, name FROM branches WHERE status='active' ORDER BY id").fetchAll();
    jsonOut(rows.map((r) => ({ id: int(r.id), name: r.name })));
  }

  // Public reservation request (no login). Lands as a 'booked' reservation
  // that a manager / super manager can confirm from the Reservations screen.
  if (method === 'POST' && uri === '/public/reservation') {
    const rbid = has(body.branchId) ? int(body.branchId)
      : int((db.query("SELECT id FROM branches WHERE status='active' ORDER BY id LIMIT 1").fetch() || {}).id);
    if (!rbid) err('No branch available', 400);
    const name = truncate(body.customerName || '', 200).trim();
    const phone = truncate(body.customerPhone || '', 50).trim();
    if (!name && !phone) err('A name or phone is required', 400);
    const date = truncate(body.reserveDate || '', 10).trim();
    const time = truncate(body.reserveTime || '', 5).trim();
    if (!date || !time) err('Date and time are required', 400);
    db.prepare('INSERT INTO reservations (branchId,customerName,customerPhone,partySize,reserveDate,reserveTime,tableId,tableName,status,note,createdByName) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .execute([rbid, name, phone, Math.max(1, int(body.partySize) || 1), date, time, null, '', 'booked', truncate(body.note || '', 500), 'Online']);
    const rid = db.lastInsertId();
    addNotification({ branchId: rbid, type: 'reservation', message: `New online booking: ${name || phone} · ${date} ${time} · party ${Math.max(1, int(body.partySize) || 1)}`, targetRole: 'manager' });
    jsonOut({ ok: true, id: rid }, 201);
  }

  // ── PUBLIC QR TABLE ORDERING (no login) ──────────────────
  // Resolve a table's QR token → the branch + table the guest scanned.
  if (method === 'GET' && uri === '/public/table') {
    const token = truncate(query.token || '', 40).trim();
    if (!token) err('token required', 400);
    const st = db.prepare('SELECT * FROM tables_list WHERE qrToken=?'); st.execute([token]);
    const t = st.fetch(); if (!t) err('This QR code is not recognised.', 404);
    const bSt = db.prepare('SELECT id,name,status FROM branches WHERE id=?'); bSt.execute([int(t.branchId)]);
    const b = bSt.fetch(); if (!b) err('Branch not found', 404);
    const s = getSettings();
    jsonOut({
      ok: true, branchId: int(t.branchId), branchName: b.name, branchActive: b.status === 'active',
      tableId: int(t.id), tableName: t.name, businessName: s.businessName || 'Restaurant',
    });
  }
  // Place an order for a scanned table. Creates a dine-in order tied to the
  // table; routed straight to the kitchen or to the staff accept-queue per the
  // qrOrderAutoKitchen setting. Prices/validates on the server.
  if (method === 'POST' && uri === '/public/table-order') {
    const token = truncate(body.token || '', 40).trim();
    if (!token) err('token required', 400);
    const tSt = db.prepare('SELECT * FROM tables_list WHERE qrToken=?'); tSt.execute([token]);
    const t = tSt.fetch(); if (!t) err('This QR code is not recognised.', 404);
    const tbid = int(t.branchId);
    const bSt = db.prepare('SELECT status FROM branches WHERE id=?'); bSt.execute([tbid]);
    const brow = bSt.fetch();
    if (!brow || brow.status !== 'active') err('Sorry — the restaurant is not taking orders right now.', 403);
    const items = body.items || [];
    if (!items.length) err('Your order is empty.', 400);
    const lineItems = items.map((i) => priceAndValidateLine(db, tbid, i));
    const s = getSettings();
    const promo = computeBestPromotion(db, tbid, lineItems, s);
    const totals = computeTotals(lineItems, null, promo ? promo.amount : 0, 'dine-in');
    // Table QR orders enter staff acceptance; each order still routes to kitchen separately.
    const autoKitchen = false;
    const status = 'new';
    const seqNum = nextOrderSeqNum(db, tbid);
    db.prepare(
      `INSERT INTO orders (branchId,orderType,tableId,tableName,staffId,staffName,customerName,customerPhone,customerAddress,note,items,subtotal,serviceCharge,vat,total,status,paymentStatus,priority,payments,amountPaid,inventoryDeducted,orderSeqNum,promo_data,source,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).execute([
      tbid, 'dine-in', int(t.id), t.name, null, 'QR · ' + t.name,
      truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50), '',
      truncate(body.note || '', 1000), jsonEncode(lineItems),
      totals.subtotal, totals.serviceCharge, totals.vat, totals.total,
      status, 'unpaid', 'normal', '[]', 0, 0, seqNum, promo ? jsonEncode(promo) : null, 'qr', nowStr(),
    ]);
    const oid = db.lastInsertId();
    db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([int(t.id)]);
    addNotification({
      branchId: tbid, type: 'qr-order',
      message: `${t.name}: new QR order ${s.currencySymbol || ''}${numberFormat(totals.total, 2)} — open Online Orders → Table Orders to accept and send to kitchen`,
      targetRole: 'all',      // cashiers and waiters must see new table orders too
    });
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    const o = orderRow(f.fetch());
    jsonOut({ ok: true, orderId: oid, displayNum: o.displayNum, total: o.total, status, autoKitchen }, 201);
  }

  // Order tracker for the customer's phone. The phone remembers the ids of the
  // orders it placed from this table; only those orders, for THIS table and
  // from the last 12 hours, are returned - a QR token can't read other
  // tables' orders, and the next guests at the table don't see old orders.
  if (method === 'GET' && uri === '/public/table-orders') {
    const token = truncate(query.token || '', 40).trim();
    if (!token) err('token required', 400);
    const tSt = db.prepare('SELECT id FROM tables_list WHERE qrToken=?'); tSt.execute([token]);
    const t = tSt.fetch(); if (!t) err('This QR code is not recognised.', 404);
    const ids = Array.from(new Set(String(query.ids || '').split(',')
      .map((x) => parseInt(x, 10)).filter((n) => n > 0))).slice(0, 20);
    if (!ids.length) jsonOut({ ok: true, orders: [] });
    const d = new Date(Date.now() - 12 * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    const since = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    const st = db.prepare(
      `SELECT * FROM orders WHERE tableId=? AND createdAt>=? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id DESC`
    );
    st.execute([int(t.id), since, ...ids]);
    const orders = st.fetchAll().map((r) => {
      const o = orderRow(r);
      // Per-dish kitchen progress only means something once staff accepted it.
      const started = o.status !== 'new' && o.status !== 'voided';
      return {
        id: o.id, displayNum: o.displayNum, status: o.status, paymentStatus: o.paymentStatus,
        total: o.total, createdAt: o.createdAt, readyAt: o.readyAt || null, dispatchedAt: o.dispatchedAt || null,
        items: (o.items || []).map((i) => ({
          name: String(i.name || ''), qty: int(i.qty) || 1,
          status: started && ['pending', 'preparing', 'ready'].includes(i.status) ? i.status : 'pending',
        })),
      };
    });
    jsonOut({ ok: true, orders });
  }

  // POST /api/auth/login (PIN-based)
  if (method === 'POST' && uri === '/auth/login') {
    checkRateLimit('login:' + (ctx.remoteAddr || 'unknown'));
    const pin = String(body.pin || '').trim();
    if (!pin) err('PIN required');
    const pinIndex = sha256hex(pin);
    const st = db.prepare(
      "SELECT * FROM users WHERE (authMethod IS NULL OR authMethod = '' OR authMethod = 'pin') AND pin_index = ?"
    );
    st.execute([pinIndex]);
    const candidates = st.fetchAll();
    let u = null;
    for (const c of candidates) {
      if (verifyPin(pin, c.pin)) {
        u = c;
        const needsUpgrade = String(c.pin).length < 20 || String(c.pin)[0] !== '$';
        const needsIndex = (c.pin_index || null) !== pinIndex;
        if (needsUpgrade || needsIndex) {
          const newHash = needsUpgrade ? hashPin(pin) : c.pin;
          db.prepare('UPDATE users SET pin=?, pin_index=? WHERE id=?').execute([newHash, pinIndex, int(c.id)]);
        }
        break;
      }
    }
    if (!u) err('Incorrect PIN', 401);
    if (int(u.isHeld || 0)) err('Account suspended. Contact your administrator.', 403);
    const user = userRow(u);
    const token = makeToken(user.id);
    let branch = null;
    if (user.branchId) {
      const bs = db.prepare('SELECT * FROM branches WHERE id=?'); bs.execute([user.branchId]);
      branch = bs.fetch() || null;
    }
    db.prepare('INSERT INTO login_logs (userId,userName,role,branchId,branchName,userAgent) VALUES (?,?,?,?,?,?)')
      .execute([user.id, user.name, user.role, user.branchId, (branch && branch.name) || '', truncate(ctx.userAgent || '', 500)]);
    jsonOut(Object.assign({}, user, { branch, token }));
  }

  if (method === 'POST' && uri === '/auth/verify-manager') {
    checkRateLimit('login:' + (ctx.remoteAddr || 'unknown'));
    const pin = String(body.pin || '').trim();
    // Manager approvals use the separate APPROVAL pin, never the login PIN.
    const u = findApproverByPin(db, pin);
    if (!u) jsonOut({ ok: false, error: 'Manager approval PIN required' }, 403);
    jsonOut({ ok: true, user: userRow(u) });
  }

  if (method === 'POST' && uri === '/auth/login-password') {
    checkRateLimit('login:' + (ctx.remoteAddr || 'unknown'));
    const username = truncate(String(body.username || '').trim(), 100);
    const password = body.password || '';
    if (!username || !password) err('Username and password required');
    const st = db.prepare("SELECT * FROM users WHERE username=? AND authMethod='password'");
    st.execute([username]);
    const u = st.fetch();
    const hash = (u && u.passwordHash) || '$scrypt$0$0';
    const verified = passwordVerify(password, hash);
    if (!u || !verified) err('Incorrect username or password', 401);
    if (int(u.isHeld || 0)) err('Account suspended. Contact your administrator.', 403);
    const user2 = userRow(u);
    const token = makeToken(user2.id);
    let branch = null;
    if (user2.branchId) {
      const bs = db.prepare('SELECT * FROM branches WHERE id=?'); bs.execute([user2.branchId]);
      branch = bs.fetch() || null;
    }
    db.prepare('INSERT INTO login_logs (userId,userName,role,branchId,branchName,userAgent) VALUES (?,?,?,?,?,?)')
      .execute([user2.id, user2.name, user2.role, user2.branchId || null, (branch && branch.name) || '', truncate(ctx.userAgent || '', 500)]);
    jsonOut(Object.assign({}, user2, { branch, token, mustChangePassword: !!(u.mustChangePassword || 0) }));
  }

  if (method === 'POST' && uri === '/auth/change-password') {
    const u = currentUser(ctx);
    if (!u) err('Not authenticated', 401);
    const uid = has(body.userId) ? int(body.userId) : u.id;      // your own account
    const newPassword = body.newPassword || '';
    if (uid !== u.id) err('Not authorized', 403);
    if (newPassword.length < 6) err('Password must be at least 6 characters');
    db.prepare('UPDATE users SET passwordHash=?, mustChangePassword=0 WHERE id=?').execute([passwordHash(newPassword), uid]);
    jsonOut({ ok: true });
  }

  if (method === 'GET' && routeMatch('/public/orders/:id', uri, params)) {
    const oid = int(params.id);
    const st = db.prepare('SELECT id,status,paymentStatus,tableName,items,total,createdAt,readyAt FROM orders WHERE id=?');
    st.execute([oid]);
    const r = st.fetch();
    if (!r) err('Order not found', 404);
    jsonOut({
      id: int(r.id), status: r.status, paymentStatus: r.paymentStatus, tableName: r.tableName,
      total: flt(r.total), items: jsonDecode(r.items, []), createdAt: r.createdAt, readyAt: r.readyAt,
    });
  }

  // POST /api/orders/online — public online order
  if (method === 'POST' && uri === '/orders/online') {
    const obid = int(body.branchId);
    if (!obid) err('branchId required');
    const branchCheck = db.prepare("SELECT id FROM branches WHERE id=? AND status='active'");
    branchCheck.execute([obid]);
    if (!branchCheck.fetch()) err('Invalid branch', 400);
    const items = body.items || [];
    if (!items.length) err('Items required');
    // Server-authoritative pricing + modifier validation (same as in-house).
    const lineItems = items.map((i) => priceAndValidateLine(db, obid, i));
    const promo = computeBestPromotion(db, int(obid), lineItems, getSettings());
    const totals = computeTotals(lineItems, null, promo ? promo.amount : 0, body.orderType || 'takeaway');
    db.prepare(
      `INSERT INTO orders (branchId,orderType,tableName,staffId,staffName,customerName,customerPhone,customerAddress,note,items,subtotal,serviceCharge,vat,total,status,paymentStatus,priority,payments,amountPaid,inventoryDeducted,promo_data,source,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).execute([
      obid, body.orderType || 'takeaway', body.tableName || 'Online', null, 'Online Order',
      truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50),
      truncate(body.customerAddress || '', 1000), truncate(body.note || '', 1000),
      jsonEncode(lineItems), totals.subtotal, totals.serviceCharge, totals.vat, totals.total,
      'new', 'unpaid', 'normal', '[]', 0, 0, promo ? jsonEncode(promo) : null, 'online', nowStr(),
    ]);
    const oid = db.lastInsertId();
    addNotification({
      branchId: obid, type: 'online-order',
      message: `New ${body.orderType} order #${oid} from ` + (body.customerName || 'customer'),
      targetRole: 'manager',
    });
    const fetchSt = db.prepare('SELECT * FROM orders WHERE id=?'); fetchSt.execute([oid]);
    jsonOut(orderRow(fetchSt.fetch()), 201);
  }

  // ═══════════════════════════════════════════════════════════
  // AUTHENTICATED ROUTES
  // ═══════════════════════════════════════════════════════════
  const user = requireUser(ctx);
  const bid = branchId(ctx, user);
  // Stash the resolved actor so the host can write a change-audit row after a
  // successful mutating request (see auditLog + server.js).
  ctx._user = user; ctx._bid = bid;

  // Enforce the role hierarchy for account-management actions: you may only act
  // on accounts strictly below your own rank (admin can act on anyone). This is
  // what stops a superManager from resetting/holding an ADMIN account.
  // ── Account permission rules (one place, used by every user route) ──
  //  * Admin manages everyone. Super manager manages managers and staff.
  //    Manager manages staff (finance/server/cashier/kitchen) of their OWN branch.
  //  * You can only give a role BELOW your own (admin may create admins).
  //  * Nobody can delete, suspend, change the role or login type of their own
  //    account, or change their own pay - someone above them does that.
  //  * The last active admin can never be deleted, suspended or demoted.
  const RANK = { admin: 4, superManager: 3, manager: 2, finance: 1, server: 1, cashier: 1, kitchen: 1 };
  const canAssignRole = (role) => user.role === 'admin' || (RANK[role] || 0) < (RANK[user.role] || 0);
  const activeAdmins = () => int(db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND COALESCE(isHeld,0)=0").fetch().c);
  const guardAccount = (row, action) => {
    const target = { id: int(row.id), role: row.role, branchId: row.branchId == null ? null : int(row.branchId) };
    const self = target.id === int(user.id);
    if (self) {
      if (['delete', 'hold', 'role', 'auth', 'pay'].includes(action)) {
        const what = { delete: 'delete', hold: 'suspend', role: 'change the role of', auth: 'change the sign-in type of', pay: 'change the pay of' }[action];
        err(`You can't ${what} your own account. Ask ${user.role === 'admin' ? 'another admin' : 'someone above you'}.`, 403);
      }
      return target;                                  // own name / PIN is fine
    }
    if (user.role !== 'admin' && !((RANK[user.role] || 0) > (RANK[target.role] || 0))) err('You do not have permission to change this account.', 403);
    if (user.role === 'manager' && target.branchId !== int(user.branchId)) err('That person belongs to another branch.', 403);
    if (target.role === 'admin' && ['delete', 'hold', 'role'].includes(action) && activeAdmins() <= 1 && !row.isHeld) {
      err('This is the only admin account. Create another admin first.', 400);
    }
    return target;
  };
  const requireManageTarget = (uid, action = 'edit') => {
    const t = db.prepare('SELECT id, role, authMethod, name, branchId, isHeld FROM users WHERE id=?'); t.execute([uid]);
    const row = t.fetch();
    if (!row) err('User not found', 404);
    guardAccount(row, action);
    return row;
  };

  // ── SETTINGS ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/settings') {
    requireRole(['admin'], user);
    jsonOut(getSettings());
  }
  if (method === 'PUT' && uri === '/settings') {
    requireRole(['admin'], user);
    const allowed = [
      'businessName', 'logoUrl', 'businessTagline', 'businessPhone', 'businessAddress', 'businessEmail',
      'theme', 'allowUserThemeOverride', 'lightThemeId', 'darkThemeId', 'activeThemeId', 'accentColor',
      'accentDark', 'accentSoft', 'font', 'currencySymbol', 'serviceChargeRate', 'vatRate', 'cardFeePercent', 'dateFormat',
      'lowStockDefaultThreshold', 'receiptFooterText', 'receiptShowVatBreakdown', 'notifyEmailEnabled',
      'notifySmsEnabled', 'loginLayout', 'loginBgUrl', 'loginPanelImageUrl', 'autoStockClose', 'defaultOrderType', 'loginThemeId',
      'homeBanners',
    ];
    // Normalise homeBanners: accept an array and serialise it to JSON for the DB.
    const settingsBody = Array.isArray(body.homeBanners)
      ? Object.assign({}, body, { homeBanners: JSON.stringify(body.homeBanners) })
      : body;
    const [sets, vals] = buildSet(settingsBody, allowed);
    if (sets) db.prepare(`UPDATE settings SET ${sets} WHERE id=1`).execute(vals);
    jsonOut(getSettings(true));
  }

  // ── BRANCHES ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/branches') {
    const rows = db.query('SELECT * FROM branches ORDER BY id').fetchAll();
    jsonOut(rows.map((r) => Object.assign({}, r, { id: int(r.id) })));
  }
  if (method === 'POST' && uri === '/branches') {
    requireRole(['superManager', 'admin'], user);
    const bName = truncate(String(body.name || '').trim() || 'New Branch', 200);
    // Optional: one sign-in account per chosen role for the new branch, each
    // with its own random 6-digit PIN (shown once to whoever creates the branch).
    const ROLE_TITLES = { manager: 'Manager', cashier: 'Cashier', kitchen: 'Kitchen', server: 'Server' };
    const roles = Array.from(new Set((Array.isArray(body.createUsers) ? body.createUsers : []).filter((r) => ROLE_TITLES[r])));
    const created = [];
    let id;
    db.beginTransaction();
    try {
      db.prepare('INSERT INTO branches (name,address,phone,imageUrl) VALUES (?,?,?,?)')
        .execute([bName, truncate(body.address || '', 500), truncate(body.phone || '', 50), truncate(body.imageUrl || '', 500000)]);
      id = db.lastInsertId();
      db.prepare('INSERT OR IGNORE INTO permissions (branchId) VALUES (?)').execute([id]);
      for (const role of roles) {
        let pin = null;
        for (let i = 0; i < 50 && !pin; i++) {
          const c = String(require('crypto').randomInt(100000, 1000000));
          const chk = db.prepare('SELECT id FROM users WHERE pin_index=? OR approvalPinIndex=?'); chk.execute([sha256hex(c), sha256hex(c)]);
          if (!chk.fetch()) pin = c;
        }
        if (!pin) err('Could not pick a free PIN - please try again.', 500);
        const uName = truncate(`${bName} ${ROLE_TITLES[role]}`, 200);
        db.prepare("INSERT INTO users (branchId,name,pin,pin_index,role,payRate,payType,authMethod) VALUES (?,?,?,?,?,0,'hourly','pin')")
          .execute([id, uName, hashPin(pin), sha256hex(pin), role]);
        created.push({ id: db.lastInsertId(), name: uName, role, pin });
      }
      db.commit();
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Could not create the branch: ' + e.message, 500); }
    const f = db.prepare('SELECT * FROM branches WHERE id=?'); f.execute([id]);
    jsonOut(Object.assign({}, f.fetch(), { id: int(id), createdUsers: created }));
  }
  if (routeMatch('/branches/:id', uri, params)) {
    const bId = int(params.id);
    if (method === 'PATCH' || method === 'PUT') {
      requireRole(['superManager', 'admin'], user);
      const [sets, vals] = buildSet(body, ['name', 'address', 'phone', 'status', 'imageUrl']);
      if (sets) db.prepare(`UPDATE branches SET ${sets} WHERE id=?`).execute([...vals, bId]);
      const f = db.prepare('SELECT * FROM branches WHERE id=?'); f.execute([bId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'admin'], user);
      db.prepare('DELETE FROM branches WHERE id=?').execute([bId]);
      jsonOut({ ok: true });
    }
  }

  // ── CATEGORIES ───────────────────────────────────────────
  if (method === 'GET' && uri === '/categories') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM categories WHERE branchId=? ORDER BY sortOrder, name');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), branchId: int(r.branchId), sortOrder: int(r.sortOrder) })));
  }
  if (method === 'POST' && uri === '/categories') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO categories (branchId,name,sortOrder) VALUES (?,?,?)')
      .execute([bid, truncate(body.name || 'Category', 100), int(body.sortOrder || 0)]);
    jsonOut({ id: db.lastInsertId(), branchId: bid, name: body.name, sortOrder: 0 });
  }
  if (routeMatch('/categories/:id', uri, params)) {
    const cId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      if (has(body.name)) db.prepare('UPDATE categories SET name=? WHERE id=?').execute([truncate(body.name, 100), cId]);
      const f = db.prepare('SELECT * FROM categories WHERE id=?'); f.execute([cId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM categories WHERE id=?').execute([cId]);
      jsonOut({ ok: true });
    }
  }

  // ── STATIONS ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/stations') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM stations WHERE branchId=? ORDER BY id');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), branchId: int(r.branchId) })));
  }
  if (method === 'POST' && uri === '/stations') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO stations (branchId,name,color) VALUES (?,?,?)')
      .execute([bid, truncate(body.name || 'Station', 100), truncate(body.color || '#8a5a34', 20)]);
    jsonOut({ id: db.lastInsertId(), branchId: bid, name: body.name, color: body.color || '#8a5a34' });
  }
  if (routeMatch('/stations/:id', uri, params)) {
    const sId = int(params.id);
    if (method === 'PUT' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const [sets, vals] = buildSet(body, ['name', 'color']);
      if (sets) db.prepare(`UPDATE stations SET ${sets} WHERE id=?`).execute([...vals, sId]);
      const f = db.prepare('SELECT * FROM stations WHERE id=?'); f.execute([sId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM stations WHERE id=?').execute([sId]);
      jsonOut({ ok: true });
    }
  }

  // ── MENU ITEMS ───────────────────────────────────────────
  if (method === 'GET' && uri === '/menu') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM menu_items WHERE branchId=? ORDER BY category, name');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => menuRow(r)));
  }
  if (method === 'POST' && uri === '/menu') {
    requireRole(['superManager', 'manager'], user);
    // Images may be data URLs (base64) — allow up to 3 MB.
    const imageUrl = truncate(body.imageUrl || '', 3_000_000);
    const modifiers = Array.isArray(body.modifiers) ? JSON.stringify(body.modifiers) : '[]';
    const recipe = Array.isArray(body.recipe) ? JSON.stringify(body.recipe) : '[]';
    db.prepare('INSERT INTO menu_items (branchId,name,price,category,plu,imageUrl,stationId,recipe,modifiers) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([
        bid, truncate(body.name || '', 300), flt(body.price || 0), truncate(body.category || '', 100),
        body.plu ? truncate(body.plu, 50) : null, imageUrl,
        body.stationId ? int(body.stationId) : null, recipe, modifiers,
      ]);
    const id = db.lastInsertId();
    const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([id]);
    jsonOut(menuRow(f.fetch()));
  }
  if (routeMatch('/menu/plu/:code', uri, params)) {
    const st = db.prepare('SELECT * FROM menu_items WHERE branchId=? AND plu=? LIMIT 1');
    st.execute([bid, truncate(params.code, 50)]);
    const r = st.fetch(); if (!r) err('Not found', 404);
    jsonOut(menuRow(r));
  }
  if (routeMatch('/menu/:id/stock-check', uri, params)) {
    const mId = int(params.id);
    const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
    const item = menuRow(f.fetch());
    if (!item) err('Not found', 404);
    const recipe = item.recipe || [];
    let maxPortions = null, limiting = null;
    for (const r of recipe) {
      const ingId = int(r.ingredientId);
      const need = flt(r.qty || 0);
      if (!ingId || need <= 0) continue;
      const st2 = db.prepare('SELECT * FROM ingredients WHERE id=?'); st2.execute([ingId]);
      const ing = ingredientRow(st2.fetch());
      if (!ing) continue;
      const possible = Math.floor(ing.qty / need);
      if (maxPortions === null || possible < maxPortions) { maxPortions = possible; limiting = ing.name; }
    }
    jsonOut({
      tracked: recipe.length > 0, maxPortions, limitingIngredient: limiting,
      price: flt(item.price), soldOut: !!item.soldOut,
    });
  }
  if (method === 'PATCH' && routeMatch('/menu/:id/sold-out', uri, params)) {
    requireRole(['superManager', 'manager', 'kitchen'], user);
    const mId = int(params.id);
    const flag = body.soldOut ? 1 : 0;
    db.prepare('UPDATE menu_items SET soldOut=? WHERE id=?').execute([flag, mId]);
    const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
    jsonOut(menuRow(f.fetch()));
  }
  if (routeMatch('/menu/:id/recipe', uri, params)) {
    const mId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      let recipe = has(body.recipe) ? body.recipe : body;
      if (!Array.isArray(recipe)) recipe = [];
      db.prepare('UPDATE menu_items SET recipe=? WHERE id=?').execute([jsonEncode(recipe), mId]);
      const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
      jsonOut(menuRow(f.fetch()));
    }
  }
  if (routeMatch('/menu/:id/modifiers', uri, params)) {
    const mId = int(params.id);
    if (method === 'POST') {
      requireRole(['superManager', 'manager'], user);
      const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
      const item = menuRow(f.fetch());
      const mods = item.modifiers;
      const cleanOpts = [];
      for (const o of (body.options || [])) {
        let mult = o.qtyMultiplier !== undefined ? flt(o.qtyMultiplier) : 1.0;
        if (mult < 0 || mult > 100) mult = 1.0;
        const extra = [];
        for (const r of (o.recipe || [])) {
          const iid = int(r.ingredientId); const qv = flt(r.qty || 0);
          if (iid > 0 && qv > 0) extra.push({ ingredientId: iid, qty: qv });
        }
        cleanOpts.push({ name: truncate(o.name || '', 100), priceDelta: flt(o.priceDelta || 0), qtyMultiplier: mult, recipe: extra });
      }
      const gmax = Math.max(1, int(body.max) || 1);
      const gmin = Math.min(gmax, Math.max(0, int(body.min) || 0));
      mods.push({
        id: require('crypto').randomBytes(8).toString('hex'),
        name: truncate(body.name || '', 100),
        required: !!body.required, min: gmin, max: gmax,
        options: cleanOpts,
      });
      db.prepare('UPDATE menu_items SET modifiers=? WHERE id=?').execute([jsonEncode(mods), mId]);
      const f2 = db.prepare('SELECT * FROM menu_items WHERE id=?'); f2.execute([mId]);
      jsonOut(menuRow(f2.fetch()));
    }
  }
  if (routeMatch('/menu/:id/modifiers/:gid', uri, params)) {
    const mId = int(params.id);
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      if (params.gid === 'all') {
        db.prepare("UPDATE menu_items SET modifiers='[]' WHERE id=?").execute([mId]);
      } else {
        const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
        const item = menuRow(f.fetch());
        const mods = item.modifiers.filter((g) => String(g.id || '') !== params.gid);
        db.prepare('UPDATE menu_items SET modifiers=? WHERE id=?').execute([jsonEncode(mods), mId]);
      }
      const f2 = db.prepare('SELECT * FROM menu_items WHERE id=?'); f2.execute([mId]);
      jsonOut(menuRow(f2.fetch()));
    }
  }
  if (routeMatch('/menu/:id', uri, params)) {
    const mId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      // Serialise modifiers + recipe to JSON for the DB (local copy — body is const).
      const menuBody = Object.assign({}, body);
      if (Array.isArray(menuBody.modifiers)) menuBody.modifiers = JSON.stringify(menuBody.modifiers);
      if (Array.isArray(menuBody.recipe)) menuBody.recipe = JSON.stringify(menuBody.recipe);
      const [sets, vals] = buildSet(menuBody, ['name', 'price', 'category', 'plu', 'imageUrl', 'stationId', 'soldOut', 'tags', 'modifiers', 'recipe']);
      if (sets) db.prepare(`UPDATE menu_items SET ${sets} WHERE id=?`).execute([...vals, mId]);
      const f = db.prepare('SELECT * FROM menu_items WHERE id=?'); f.execute([mId]);
      jsonOut(menuRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM menu_items WHERE id=?').execute([mId]);
      jsonOut({ ok: true });
    }
  }

  // ── TABLES ───────────────────────────────────────────────
  if (method === 'GET' && uri === '/tables') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM tables_list WHERE branchId=? ORDER BY id');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), branchId: int(r.branchId), seats: int(r.seats) })));
  }
  if (method === 'POST' && uri === '/tables') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO tables_list (branchId,name,seats,floor,qrToken) VALUES (?,?,?,?,?)')
      .execute([bid, truncate(body.name || 'Table', 100), int(body.seats || 4), truncate(body.floor || '', 50), genTableToken()]);
    const id = db.lastInsertId();
    const f = db.prepare('SELECT * FROM tables_list WHERE id=?'); f.execute([id]);
    jsonOut(Object.assign({}, f.fetch(), { id, seats: int(body.seats || 4) }));
  }
  // Reset the whole floor — mark every table open again. Handy at end of day or
  // after testing. Does not touch orders (they stay in History/Payment).
  if (method === 'POST' && uri === '/tables/reset-floor') {
    requireRole(['superManager', 'manager', 'admin'], user);
    db.prepare("UPDATE tables_list SET status='open' WHERE branchId=?").execute([bid]);
    jsonOut({ ok: true });
  }
  // Regenerate a table's QR token (invalidates the old printed QR).
  if (method === 'POST' && routeMatch('/tables/:id/qr-regenerate', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const tId = int(params.id);
    const chk = db.prepare('SELECT id FROM tables_list WHERE id=? AND branchId=?'); chk.execute([tId, bid]);
    if (!chk.fetch()) err('Table not found', 404);
    const tok = genTableToken();
    db.prepare('UPDATE tables_list SET qrToken=? WHERE id=?').execute([tok, tId]);
    jsonOut({ ok: true, qrToken: tok });
  }
  if (routeMatch('/tables/:id', uri, params)) {
    const tId = int(params.id);
    if (method === 'PATCH' || method === 'PUT') {
      requireRole(['superManager', 'manager', 'server', 'cashier'], user);
      const allowed = ['superManager', 'manager'].includes(user.role) ? ['name', 'seats', 'status', 'floor'] : ['status'];
      const [sets, vals] = buildSet(body, allowed);
      if (sets) db.prepare(`UPDATE tables_list SET ${sets} WHERE id=?`).execute([...vals, tId]);
      const f = db.prepare('SELECT * FROM tables_list WHERE id=?'); f.execute([tId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM tables_list WHERE id=?').execute([tId]);
      jsonOut({ ok: true });
    }
  }

  // ── ORDERS ───────────────────────────────────────────────
  // Persistent merged table bills. Kitchen tickets remain separate orders; a bill
  // groups their balances for one cashier-facing selection/payment/discount flow.
  function getTableBill(billId) {
    const st = db.prepare('SELECT * FROM table_bills WHERE id=?'); st.execute([billId]);
    const row = st.fetch();
    if (!row) return null;
    if (user.role !== 'superManager' && int(row.branchId) !== int(bid)) err('Bill belongs to another branch', 403);
    const ids = jsonDecode(row.orderIds, []) || [];
    const orders = ids.map((oid) => { const os = db.prepare('SELECT * FROM orders WHERE id=?'); os.execute([oid]); return orderRow(os.fetch()); }).filter(Boolean);
    const sum = (key) => round2(orders.reduce((a, o) => a + flt(o[key] || 0), 0));
    const subtotal = sum('subtotal'), serviceCharge = sum('serviceCharge'), vat = sum('vat'), total = sum('total'), tipAmount = sum('tipAmount');
    const grandTotal = round2(total + tipAmount);
    const orderLines = orders.flatMap((o) => (o.items || []).map((it) => Object.assign({}, it, { sourceOrderId: o.id, sourceOrderNum: o.displayNum })));
    return {
      id: int(row.id), billId: int(row.id), isMergedBill: true,
      branchId: int(row.branchId), tableId: int(row.tableId), tableName: row.tableName || '',
      orderType: int(row.tableId) ? 'dine-in' : ((orders[0] && orders[0].orderType) || 'takeaway'), displayNum: 'MB-' + String(row.id).padStart(4, '0'),
      staffName: row.createdBy || '', status: row.status === 'paid' ? 'paid' : 'merged',
      paymentStatus: row.status === 'paid' ? 'paid' : 'unpaid',
      orderIds: ids.map(int), memberOrders: orders.map((o) => ({ id: o.id, displayNum: o.displayNum, total: o.grandTotal, amountPaid: o.amountPaid })),
      items: orderLines, subtotal, serviceCharge, vat, total, tipAmount, grandTotal,
      amountPaid: flt(row.amountPaid), discount: jsonDecode(row.discount), payments: jsonDecode(row.payments, []) || [],
      createdAt: row.createdAt, paidAt: row.paidAt, snapshot: jsonDecode(row.snapshot, []) || [],
    };
  }

  if (method === 'GET' && uri === '/table-bills') {
    const status = String(query.status || 'open');
    const st = db.prepare('SELECT id FROM table_bills WHERE branchId=? AND status=? ORDER BY id DESC');
    st.execute([bid, status]);
    jsonOut(st.fetchAll().map((r) => getTableBill(int(r.id))).filter(Boolean));
  }

  if (method === 'POST' && uri === '/table-bills') {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const ids = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(int).filter((n) => n > 0))];
    if (ids.length < 2) err('Choose at least two tickets to merge');
    if (ids.length > 30) err('A merged bill can contain at most 30 tickets');
    const orders = [];
    for (const oid of ids) {
      const st = db.prepare('SELECT * FROM orders WHERE id=?'); st.execute([oid]);
      const raw = st.fetch(); if (!raw) err('Ticket #' + oid + ' was not found');
      if (user.role !== 'superManager' && int(raw.branchId) !== int(bid)) err('Ticket belongs to another branch', 403);
      const o = orderRow(raw);
      // anyType: merge any open bills (takeaway, delivery, another table) — e.g. a customer orders again after the first order went to the kitchen.
      if (!body.anyType && (o.orderType !== 'dine-in' || !o.tableId)) err('Only dine-in table tickets can be merged');
      if (o.status === 'voided' || o.paymentStatus === 'paid' || o.paymentStatus === 'refunded' || o.amountPaid > 0.01) err('Only unpaid tickets with no recorded payments can be merged');
      orders.push(o);
    }
    if (new Set(orders.map(o => String(o.branchId))).size !== 1) err('All tickets must belong to the same branch');
    const sameTable = orders.every(o => o.orderType === 'dine-in' && o.tableId) && new Set(orders.map(o => String(o.tableId))).size === 1;
    if (!body.anyType && !sameTable) err('All tickets must belong to the same table and branch');
    const billTableId = sameTable ? orders[0].tableId : 0;
    const billTableName = sameTable ? (orders[0].tableName || ('Table ' + orders[0].tableId)) : 'Combined bill';
    const existing = db.prepare("SELECT orderIds FROM table_bills WHERE branchId=? AND status='open'"); existing.execute([orders[0].branchId]);
    const alreadyGrouped = new Set(existing.fetchAll().flatMap(r => jsonDecode(r.orderIds, []) || []).map(int));
    if (ids.some((id) => alreadyGrouped.has(id))) err('One or more tickets already belong to an open merged bill');
    const snapshot = orders.map((o) => ({ id: o.id, discount: o.discount, serviceCharge: o.serviceCharge, vat: o.vat, total: o.total, promo: o.promo }));
    db.prepare('INSERT INTO table_bills (branchId,tableId,tableName,orderIds,snapshot,discount,status,payments,amountPaid,createdBy) VALUES (?,?,?,?,?,NULL,\'open\',\'[]\',0,?)')
      .execute([orders[0].branchId, billTableId, billTableName, jsonEncode(ids), jsonEncode(snapshot), user.name || '']);
    const billId = db.lastInsertId();
    addNotification({ branchId: orders[0].branchId, type: 'payment', message: `Merged bill MB-${String(billId).padStart(4, '0')} created for ${orders[0].tableName || 'table'} · ${ids.length} tickets`, targetRole: 'manager', relatedId: ids[0] });
    jsonOut(getTableBill(billId), 201);
  }

  if (routeMatch('/table-bills/:id', uri, params) && method === 'GET') {
    const bill = getTableBill(int(params.id)); if (!bill) err('Merged bill not found', 404); jsonOut(bill);
  }

  if (routeMatch('/table-bills/:id/discount', uri, params) && method === 'POST') {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const bill = getTableBill(int(params.id)); if (!bill) err('Merged bill not found', 404);
    if (bill.paymentStatus === 'paid' || bill.amountPaid > 0.01) err('Cannot change a discount after payment has started');
    const type = ['percent', 'fixed'].includes(body.type || '') ? body.type : 'percent';
    const value = flt(body.value || 0); if (value < 0) err('Discount cannot be negative');
    if (type === 'percent' && value > 100) err('Percent discount cannot exceed 100%');
    let approver = user.name || 'Staff';
    if (value > 0 && !['superManager', 'manager', 'admin'].includes(user.role)) {
      const perm = db.prepare('SELECT serverMaxDiscountPercent FROM permissions WHERE branchId=?'); perm.execute([bill.branchId]);
      const limit = flt((perm.fetch() || {}).serverMaxDiscountPercent || 0);
      if (!(type === 'percent' && value <= limit)) {
        const pin = String(body.pin || '').trim(); if (!pin) err(type === 'percent' ? `Discounts over ${limit}% need a manager approval PIN` : 'Fixed discounts need a manager approval PIN', 403);
        const mgr = findApproverByPin(db, pin); if (!mgr) err('Invalid approval PIN', 403); approver = mgr.name + ' (approved for ' + user.name + ')';
      }
    }
    const snapshot = bill.snapshot || [];
    const originals = bill.orderIds.map((oid) => { const st = db.prepare('SELECT * FROM orders WHERE id=?'); st.execute([oid]); return orderRow(st.fetch()); });
    let applied = 0;
    if (value > 0) {
      const preAvailable = originals.map((o) => {
        const base = snapshot.find((x) => int(x.id) === int(o.id)) || {};
        return Math.max(0, o.subtotal - flt(base.discount && base.discount.amount || 0) - flt(base.promo && base.promo.amount || 0));
      });
      const availableTotal = round2(preAvailable.reduce((a, x) => a + x, 0));
      applied = type === 'percent' ? round2(availableTotal * value / 100) : round2(value);
      if (applied > availableTotal + 0.001) err('Discount cannot exceed the remaining subtotal');
    }
    // Restore each ticket to its pre-merge pricing first, so editing a bill discount never stacks discounts.
    for (const o of originals) {
      const base = snapshot.find((x) => int(x.id) === int(o.id)) || {};
      const baseDiscount = base.discount || null;
      const promoAmount = base.promo && base.promo.amount ? flt(base.promo.amount) : 0;
      const totals = computeTotals(o.items, baseDiscount, promoAmount, o.orderType);
      db.prepare('UPDATE orders SET discount=?, serviceCharge=?, vat=?, total=? WHERE id=?')
        .execute([baseDiscount ? jsonEncode(baseDiscount) : null, totals.serviceCharge, totals.vat, totals.total, o.id]);
    }
    if (value > 0) {
      const refreshed = bill.orderIds.map((oid) => { const st = db.prepare('SELECT * FROM orders WHERE id=?'); st.execute([oid]); return orderRow(st.fetch()); });
      const available = refreshed.map((o) => Math.max(0, o.subtotal - flt(o.discount && o.discount.amount || 0) - flt(o.promo && o.promo.amount || 0)));
      const availableTotal = round2(available.reduce((a, x) => a + x, 0));
      let allocated = 0;
      refreshed.forEach((o, i) => {
        const part = i === refreshed.length - 1 ? round2(applied - allocated) : (availableTotal > 0 ? round2(applied * available[i] / availableTotal) : 0);
        allocated = round2(allocated + part);
        const base = snapshot.find((x) => int(x.id) === int(o.id)) || {};
        const baseDiscount = base.discount || null;
        const oldAmount = flt(baseDiscount && baseDiscount.amount || 0);
        const newAmount = round2(oldAmount + part);
        const discount = newAmount > 0 ? Object.assign({}, baseDiscount || {}, { type: 'fixed', value: newAmount, amount: newAmount, reason: [baseDiscount && baseDiscount.reason, body.reason || 'Merged bill discount'].filter(Boolean).join(' + '), approvedBy: approver, mergedBillDiscountAmount: part }) : null;
        const promoAmount = base.promo && base.promo.amount ? flt(base.promo.amount) : 0;
        const totals = computeTotals(o.items, discount, promoAmount, o.orderType);
        db.prepare('UPDATE orders SET discount=?, serviceCharge=?, vat=?, total=? WHERE id=?').execute([discount ? jsonEncode(discount) : null, totals.serviceCharge, totals.vat, totals.total, o.id]);
      });
    }
    const discountRecord = value > 0 ? { type, value, amount: applied, reason: truncate(body.reason || '', 500), approvedBy: approver } : null;
    db.prepare('UPDATE table_bills SET discount=? WHERE id=?').execute([discountRecord ? jsonEncode(discountRecord) : null, bill.id]);
    jsonOut(getTableBill(bill.id));
  }

  if (routeMatch('/table-bills/:id/pay', uri, params) && method === 'POST') {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const bill = getTableBill(int(params.id)); if (!bill) err('Merged bill not found', 404);
    if (bill.paymentStatus === 'paid') err('Merged bill is already paid');
    const method2 = body.method || ''; if (!['cash', 'card', 'online', 'wallet', 'giftcard'].includes(method2)) err('Invalid payment method');
    const totalDue = round2(bill.grandTotal - bill.amountPaid);
    const settings = getSettings(); const feePercent = method2 === 'card' ? flt(settings.cardFeePercent || 0) : 0;
    // Gift card on a merged bill: the amount is whatever the card can cover.
    let gCard = null, gCode = '';
    if (method2 === 'giftcard') {
      if (!(Array.isArray(settings.enabledAddons) && settings.enabledAddons.includes('giftcards'))) err('Gift cards are not enabled', 400);
      gCode = truncate(body.code || '', 40).trim().toUpperCase();
      const gSt = db.prepare('SELECT * FROM gift_cards WHERE branchId=? AND code=?'); gSt.execute([bill.branchId, gCode]);
      gCard = gSt.fetch(); if (!gCard) err('Gift card not found', 404);
      if (gCard.status !== 'active') err('This gift card is disabled', 400);
      if (flt(gCard.balance) <= 0) err('This gift card has no balance left', 400);
    }
    let amount = round2(flt(body.amount));
    if (gCard) amount = round2(Math.min(flt(gCard.balance), totalDue, amount > 0 ? amount : totalDue));
    if (amount <= 0 || amount > totalDue + 0.01) err('Invalid payment amount');
    const batchId = 'MBPAY-' + bill.id + '-' + Date.now().toString(36).toUpperCase();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (gCard) {
        const nums = bill.orderIds.map((oid) => { const q = db.prepare('SELECT * FROM orders WHERE id=?'); q.execute([oid]); const r = q.fetch(); return (r && orderRow(r).displayNum) || ('#' + oid); });
        giftDebit(db, gCard, amount, { orderId: bill.orderIds[0] || null, orderNum: nums.join(', '), by: user.name, note: 'Merged bill ' + bill.id + (bill.tableName ? ' - ' + bill.tableName : '') });
      }
      let remaining = amount;
      const memberOrders = bill.orderIds.map((oid) => { const st = db.prepare('SELECT * FROM orders WHERE id=?'); st.execute([oid]); return orderRow(st.fetch()); });
      for (const o of memberOrders) {
        if (remaining <= 0.001) break;
        const due = round2(Math.max(0, o.grandTotal - o.amountPaid)); if (due <= 0.001) continue;
        const allocation = round2(Math.min(due, remaining)); remaining = round2(remaining - allocation);
        const feeAmount = round2(allocation * feePercent); const netAmount = round2(allocation - feeAmount);
        const payments = (o.payments || []).slice(); payments.push(Object.assign({ method: method2, amount: allocation, feePercent, feeAmount, netAmount, paidAt: isoNow(), mergedBillId: bill.id, combinedBatchId: batchId }, gCode ? { code: gCode, byStaffName: user.name } : {}));
        const amountPaid = round2(arrSum(arrColumn(payments, 'amount'))); const fullyPaid = amountPaid >= o.grandTotal - 0.01;
        db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?').execute([jsonEncode(payments), amountPaid, fullyPaid ? 'paid' : 'unpaid', fullyPaid ? nowStr() : null, o.id]);
        if (fullyPaid) { try { awardLoyaltyPoints(db, o, o.id, settings, user.name); } catch (_) {} try { assignFiscalIfDue(db, o.id); } catch (_) {} }
      }
      const billPayments = (bill.payments || []).slice(); const feeAmount = round2(amount * feePercent);
      billPayments.push(Object.assign({ method: method2, amount, feePercent, feeAmount, netAmount: round2(amount - feeAmount), paidAt: isoNow(), batchId }, gCode ? { code: gCode } : {}));
      const amountPaid = round2(flt(bill.amountPaid) + amount); const fullyPaid = amountPaid >= bill.grandTotal - 0.01;
      db.prepare('UPDATE table_bills SET payments=?, amountPaid=?, status=?, paidAt=? WHERE id=?').execute([jsonEncode(billPayments), amountPaid, fullyPaid ? 'paid' : 'open', fullyPaid ? nowStr() : null, bill.id]);
      if (fullyPaid) {
        // Free every table that had a ticket on this bill (a combined bill can span tables / takeaway).
        const tableIds = new Set([int(bill.tableId)]);
        for (const oid of bill.orderIds) { const ts = db.prepare('SELECT tableId FROM orders WHERE id=?'); ts.execute([oid]); const tr = ts.fetch(); if (tr && int(tr.tableId)) tableIds.add(int(tr.tableId)); }
        for (const tid of tableIds) {
          if (!tid) continue;
          const rem = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE tableId=? AND branchId=? AND paymentStatus!='paid' AND status!='voided'"); rem.execute([tid, bill.branchId]);
          const remainingRows = rem.fetch(); if (!remainingRows || Number(remainingRows.n || 0) === 0) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([tid]);
        }
      }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} if (e instanceof Resp) throw e; throw e; }
    addNotification({ branchId: bill.branchId, type: 'payment', message: `Merged bill MB-${String(bill.id).padStart(4, '0')} payment · ${settings.currencySymbol || 'Rs. '}${numberFormat(amount, 2)} · ${method2}`, targetRole: 'manager', relatedId: bill.orderIds[0] || null });
    jsonOut(getTableBill(bill.id));
  }

  if (method === 'GET' && uri === '/orders') {
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const args = [];
    if (bid) { sql += ' AND branchId=?'; args.push(bid); }
    if (has(query.status)) {
      let statuses = String(query.status).split(',').map((s) => s.trim());
      const allowed = ['new', 'pending', 'preparing', 'ready', 'dispatched', 'voided'];
      statuses = statuses.filter((s) => allowed.includes(s));
      if (statuses.length) {
        sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
        args.push(...statuses);
      }
    }
    sql += ' ORDER BY id DESC';
    const st = db.prepare(sql); st.execute(args);
    jsonOut(st.fetchAll().map((r) => orderRow(r)));
  }

  // Everything the serving staff need on one screen.
  if (method === 'GET' && uri === '/orders/serve-board') {
    requireRole(['cashier', 'manager', 'superManager', 'admin'], user);
    const r = db.prepare(`SELECT * FROM orders WHERE branchId=? AND status='ready' ORDER BY COALESCE(readyAt, createdAt), id`);
    r.execute([bid]);
    const since = (() => { const d = new Date(Date.now() - 3 * 3600 * 1000); const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; })();
    const s = db.prepare(`SELECT * FROM orders WHERE branchId=? AND status='dispatched' AND dispatchedAt>=? ORDER BY dispatchedAt DESC LIMIT 40`);
    s.execute([bid, since]);
    const c = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE branchId=? AND status IN ('pending','preparing')`); c.execute([bid]);
    jsonOut({ ready: r.fetchAll().map(orderRow), served: s.fetchAll().map(orderRow), cooking: int(c.fetch().n), serverTime: nowStr() });
  }

  if (method === 'GET' && uri === '/orders/last-receipt') {
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' ORDER BY paidAt DESC LIMIT 1");
    st.execute([bid]);
    const r = st.fetch(); if (!r) err('No paid orders', 404);
    jsonOut(orderRow(r));
  }

  if (method === 'POST' && uri === '/orders') {
    const items = body.items || [];
    if (!items.length) err('Items required');
    // A branch in maintenance is paused — no new orders (in-house or online).
    if (bid) {
      const bSt = db.prepare('SELECT status FROM branches WHERE id=?'); bSt.execute([bid]);
      const brow = bSt.fetch();
      if (brow && brow.status !== 'active') {
        err('This branch is in maintenance mode — new orders are paused. A manager can re-activate it under Branches.', 403);
      }
    }
    // Price and validate every line against the SERVER's menu + modifier rules
    // (never trust client-sent prices, option deltas, or required/min-max).
    const lineItems = items.map((i) => priceAndValidateLine(db, int(bid), i));

    // ── Running tab: add to the table's existing open order ──────────────
    // For a dine-in table that already has an unpaid, non-voided order, append
    // the new items to that same bill (one tab per table) instead of opening a
    // separate order. New lines start 'pending' so the kitchen sees the round.
    const reqType = body.orderType || 'dine-in';
    if (reqType === 'dine-in' && body.tableId && body.addToExisting !== false) {
      const exSt = db.prepare("SELECT * FROM orders WHERE tableId=? AND branchId=? AND paymentStatus!='paid' AND (void_data IS NULL) ORDER BY id DESC LIMIT 1");
      exSt.execute([int(body.tableId), int(bid)]);
      const exRaw = exSt.fetch();
      if (exRaw) {
        const ex = orderRow(exRaw);
        const merged = ex.items.concat(lineItems);
        const promo2 = computeBestPromotion(db, int(bid), merged, getSettings());
        const totals2 = computeTotals(merged, ex.discount || null, promo2 ? promo2.amount : 0, ex.orderType);
        // status back to 'pending' so the new round shows in the kitchen; leave
        // per-line inventoryDeducted flags intact (earlier rounds stay deducted).
        db.prepare("UPDATE orders SET items=?, subtotal=?, serviceCharge=?, vat=?, total=?, status='pending', inventoryDeducted=0, promo_data=? WHERE id=?")
          .execute([jsonEncode(merged), totals2.subtotal, totals2.serviceCharge, totals2.vat, totals2.total, promo2 ? jsonEncode(promo2) : null, ex.id]);
        db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([int(body.tableId)]);
        addNotification({
          branchId: int(bid), type: 'order',
          message: `New items added to ${ex.tableName || 'table'} · order #${ex.id} (${lineItems.length} item line${lineItems.length === 1 ? '' : 's'})`,
          targetRole: 'all', relatedId: ex.id,
        });
        const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([ex.id]);
        jsonOut(orderRow(f.fetch()), 200);
      }
    }

    // Auto-apply the best active promotion (if any) for this branch.
    const promo = computeBestPromotion(db, int(bid), lineItems, getSettings());
    const totals = computeTotals(lineItems, null, promo ? promo.amount : 0, reqType);
    let tableId = body.tableId || null;
    let tableName = truncate(body.tableNameOverride || 'Walk-in', 100);
    if (tableId) {
      const tSt = db.prepare('SELECT * FROM tables_list WHERE id=?'); tSt.execute([int(tableId)]);
      const t = tSt.fetch();
      tableName = t ? t.name : tableName;
      db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([tableId]);
    }
    const seqNum = nextOrderSeqNum(db, int(bid));
    db.prepare(
      `INSERT INTO orders (branchId,orderType,tableId,tableName,staffId,staffName,customerName,customerPhone,customerAddress,note,items,subtotal,serviceCharge,vat,total,status,paymentStatus,priority,payments,amountPaid,inventoryDeducted,orderSeqNum,promo_data,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).execute([
      bid, body.orderType || 'dine-in', tableId || null, tableName, user.id, user.name,
      truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50),
      truncate(body.customerAddress || '', 1000), truncate(body.note || '', 1000),
      jsonEncode(lineItems), totals.subtotal, totals.serviceCharge, totals.vat, totals.total,
      'pending', 'unpaid', body.priority || 'normal', '[]', 0, 0, seqNum, promo ? jsonEncode(promo) : null, nowStr(),
    ]);
    const oid = db.lastInsertId();
    addNotification({
      branchId: int(bid), type: 'order',
      message: `New ${body.orderType || 'dine-in'} order #${oid}${tableName ? ' · ' + tableName : ''} · ${getSettings().currencySymbol || 'Rs. '}${numberFormat(totals.total, 2)}`,
      targetRole: 'all', relatedId: oid,
    });
    if (body.customerPhone) {
      db.prepare(
        `INSERT INTO customers (branchId,phone,name,address) VALUES (?,?,?,?)
         ON CONFLICT(branchId,phone) DO UPDATE SET name=excluded.name, address=excluded.address`
      ).execute([bid, truncate(body.customerPhone, 50), truncate(body.customerName || '', 200), truncate(body.customerAddress || '', 1000)]);
    }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()), 201);
  }

  if (routeMatch('/orders/:id', uri, params)) {
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const orderRaw = oSt.fetch();
    if (!orderRaw || (user.role !== 'superManager' && int(orderRaw.branchId) !== int(bid))) err('Order not found', 404);
    if (method === 'GET') jsonOut(orderRow(orderRaw));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/type', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const type = body.orderType || '';
    if (!['dine-in', 'takeaway', 'delivery'].includes(type)) err('Invalid order type');
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.paymentStatus === 'paid') err('Cannot change type on a paid order', 400);
    const cName = truncate(has(body.customerName) ? body.customerName : o.customerName, 200);
    const cPhone = truncate(has(body.customerPhone) ? body.customerPhone : o.customerPhone, 50);
    const cAddr = truncate(has(body.customerAddress) ? body.customerAddress : o.customerAddress, 500);
    if (type !== 'dine-in' && o.tableId) {
      db.prepare("UPDATE tables_list SET status='open' WHERE id=?").execute([o.tableId]);
      db.prepare('UPDATE orders SET orderType=?, tableId=NULL, tableName=?, customerName=?, customerPhone=?, customerAddress=? WHERE id=?')
        .execute([type, type === 'takeaway' ? 'Takeaway' : 'Delivery', cName, cPhone, cAddr, oid]);
    } else {
      db.prepare('UPDATE orders SET orderType=?, customerName=?, customerPhone=?, customerAddress=? WHERE id=?')
        .execute([type, cName, cPhone, cAddr, oid]);
    }
    const settings = getSettings();
    const reduction = Math.min(o.subtotal, ((o.discount && o.discount.amount) || 0) + ((o.promo && o.promo.amount) || 0));
    const taxable = Math.max(0, o.subtotal - reduction);
    const serviceCharge = type === 'dine-in' ? round2(taxable * settings.serviceChargeRate) : 0;
    const vat = round2((taxable + serviceCharge) * settings.vatRate);
    const total = round2(taxable + serviceCharge + vat);
    db.prepare('UPDATE orders SET serviceCharge=?, vat=?, total=? WHERE id=?').execute([serviceCharge, vat, total, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  // Atomic combined settlement for a selected subset of tickets belonging to one dine-in table.
  // Kitchen tickets remain independent, but the cashier settles the selected balances in one request.
  if (method === 'POST' && uri === '/orders/combined-pay') {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const ids = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : []).map(int).filter(n => n > 0))];
    const method2 = body.method || '';
    if (!ids.length) err('Select at least one ticket');
    if (!['cash', 'card', 'online', 'wallet'].includes(method2)) err('Invalid payment method');
    if (ids.length > 30) err('A combined settlement can include at most 30 tickets');
    const batchId = 'TB-' + Date.now().toString(36).toUpperCase();
    const settings = getSettings();
    const feePercent = method2 === 'card' ? flt(settings.cardFeePercent || 0) : 0;
    let totalSettled = 0;
    let branchForNotice = bid;
    let tableForNotice = '';
    const settledIds = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      const targets = [];
      for (const oid of ids) {
        const st = db.prepare('SELECT * FROM orders WHERE id=?'); st.execute([oid]);
        const raw = st.fetch();
        if (!raw) err('Ticket #' + oid + ' was not found');
        if (user.role !== 'superManager' && int(raw.branchId) !== int(bid)) err('Ticket #' + oid + ' belongs to another branch', 403);
        const o = orderRow(raw);
        if (o.orderType !== 'dine-in' || !o.tableId) err('Combined settlement only supports dine-in table tickets');
        if (o.status === 'voided' || o.paymentStatus === 'paid' || o.paymentStatus === 'refunded') err('Ticket ' + o.displayNum + ' is not payable');
        targets.push(o);
      }
      const tableIds = new Set(targets.map(o => String(o.tableId)));
      const branchIds = new Set(targets.map(o => String(o.branchId)));
      if (tableIds.size !== 1 || branchIds.size !== 1) err('All selected tickets must belong to the same table and branch');
      branchForNotice = targets[0].branchId;
      tableForNotice = targets[0].tableName || ('Table ' + targets[0].tableId);
      for (const o of targets) {
        const amount = round2(Math.max(0, o.grandTotal - o.amountPaid));
        if (amount <= 0.01) continue;
        const feeAmount = round2(amount * feePercent);
        const netAmount = round2(amount - feeAmount);
        const payments = Array.isArray(o.payments) ? o.payments.slice() : [];
        payments.push({ method: method2, amount, feePercent, feeAmount, netAmount, paidAt: isoNow(), combinedBatchId: batchId });
        const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
        const fullyPaid = amountPaid >= o.grandTotal - 0.01;
        db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
          .execute([jsonEncode(payments), amountPaid, fullyPaid ? 'paid' : 'unpaid', fullyPaid ? nowStr() : null, o.id]);
        totalSettled = round2(totalSettled + amount);
        settledIds.push(o.id);
        if (fullyPaid) {
          try { awardLoyaltyPoints(db, o, o.id, settings, user.name); } catch (_) {}
          try { assignFiscalIfDue(db, o.id); } catch (_) {}
        }
      }
      if (targets.every(o => ['ready', 'dispatched'].includes(o.status)) && targets[0].tableId) {
        const remaining = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE tableId=? AND branchId=? AND paymentStatus!='paid' AND status!='voided'");
        remaining.execute([targets[0].tableId, targets[0].branchId]);
        const rem = remaining.fetch();
        if (!rem || Number(rem.n || 0) === 0) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([targets[0].tableId]);
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw e;
    }
    addNotification({
      branchId: branchForNotice, type: 'payment',
      message: `Combined table settlement ${batchId} · ${tableForNotice} · ${settings.currencySymbol || 'Rs. '}${numberFormat(totalSettled, 2)} · ${settledIds.length} ticket${settledIds.length === 1 ? '' : 's'}`,
      targetRole: 'manager', relatedId: settledIds[0] || null,
    });
    const settledOrders = settledIds.map(oid => { const st = db.prepare('SELECT * FROM orders WHERE id=?'); st.execute([oid]); return orderRow(st.fetch()); });
    jsonOut({ ok: true, batchId, total: totalSettled, method: method2, orderIds: settledIds, orders: settledOrders });
  }

  if (method === 'POST' && routeMatch('/orders/:id/pay', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    const method2 = body.method || '';
    if (!['cash', 'card', 'online', 'wallet'].includes(method2)) err('Invalid payment method');
    let amount = has(body.amount) ? flt(body.amount) : (o.grandTotal - o.amountPaid);
    amount = round2(amount);
    const s = getSettings();
    const feePercent = method2 === 'card' ? flt(s.cardFeePercent || 0) : 0.0;
    const feeAmount = round2(amount * feePercent);
    const netAmount = round2(amount - feeAmount);
    const payments = o.payments;
    payments.push({ method: method2, amount, feePercent, feeAmount, netAmount, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const fullyPaid = amountPaid >= o.grandTotal - 0.01;
    const paidAt = fullyPaid ? nowStr() : null;
    const payStatus = fullyPaid ? 'paid' : 'unpaid';
    db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
      .execute([jsonEncode(payments), amountPaid, payStatus, paidAt, oid]);
    if (fullyPaid && o.tableId && ['ready', 'dispatched'].includes(o.status)) {
      db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
    }
    // Loyalty: award points once, when the bill is first settled in full and a
    // customer is attached. Must never block the payment itself.
    try {
      const ls = getSettings();
      if (fullyPaid && Array.isArray(ls.enabledAddons) && ls.enabledAddons.includes('loyalty') && o.customerPhone) {
        awardLoyaltyPoints(db, o, oid, ls, user.name);
      }
    } catch (e) { /* loyalty is best-effort */ }
    if (fullyPaid) assignFiscalIfDue(db, oid);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  // POST /api/orders/:id/refund — reverse part or all of a payment.
  // Managers/superManagers refund directly; anyone else needs a manager
  // APPROVAL pin (not the login PIN).
  if (method === 'POST' && routeMatch('/orders/:id/refund', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server', 'finance'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.amountPaid <= 0) err('This order has no payment to refund.', 400);
    const reason = truncate(body.reason || '', 500);
    if (!reason) err('A reason is required for a refund.', 400);

    let approver = user.name;
    if (!['superManager', 'manager', 'admin'].includes(user.role)) {
      const pin = String(body.pin || '').trim();
      if (!pin) err('A manager approval PIN is required to refund.', 403);
      const mgr = findApproverByPin(db, pin);
      if (!mgr) err('Invalid approval PIN.', 403);
      approver = mgr.name + ' (approved for ' + user.name + ')';
    }

    let amount = has(body.amount) ? flt(body.amount) : o.amountPaid;
    amount = round2(amount);
    if (amount <= 0) err('Refund amount must be greater than zero.', 400);
    if (amount > o.amountPaid + 0.01) err(`Refund cannot exceed the amount paid (${o.amountPaid.toFixed(2)}).`, 400);
    const method2 = ['cash', 'card', 'online', 'giftcard'].includes(body.method) ? body.method : 'cash';

    // Refund back onto a gift card: only up to what that card paid on this order.
    let gCard = null;
    if (method2 === 'giftcard') {
      const net = giftNetByCode(o.payments);
      const codes = Object.keys(net).filter((c) => net[c] > 0.001);
      const code = truncate(body.code || (codes.length === 1 ? codes[0] : ''), 40).trim().toUpperCase();
      if (!code) err(codes.length ? 'Choose which gift card to refund to' : 'This order was not paid with a gift card', 400);
      if (!(net[code] > 0.001)) err('That gift card did not pay for this order', 400);
      if (amount > net[code] + 0.01) err(`Only ${net[code].toFixed(2)} was paid with gift card ${code}.`, 400);
      const gSt = db.prepare('SELECT * FROM gift_cards WHERE code=? AND branchId=?'); gSt.execute([code, o.branchId]);
      gCard = gSt.fetch(); if (!gCard) err('Gift card not found', 404);
    }

    const payments = o.payments;
    payments.push(Object.assign({ method: method2, type: 'refund', amount: -amount, reason, byStaffName: user.name, approvedBy: approver, paidAt: isoNow() }, gCard ? { code: gCard.code } : {}));
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const payStatus = amountPaid <= 0.01 ? 'refunded' : (amountPaid >= o.grandTotal - 0.01 ? 'paid' : 'unpaid');
    const paidAt = payStatus === 'paid' ? (o.paidAt || nowStr()) : null;
    db.beginTransaction();
    try {
      if (gCard) giftCredit(db, gCard, amount, { type: 'refund', orderId: oid, orderNum: o.displayNum, by: approver, note: reason });
      if (payStatus === 'refunded') { try { loyaltyUndo(db, o, oid, approver, 'fully refunded'); } catch (_) { /* best-effort */ } }
      db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
        .execute([jsonEncode(payments), amountPaid, payStatus, paidAt, oid]);
      db.commit();
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Refund failed: ' + e.message, 500); }
    const s = getSettings();
    addNotification({
      branchId: o.branchId, type: 'refund',
      message: `Refund ${s.currencySymbol}${numberFormat(amount, 2)} on ${o.displayNum} by ${approver} — ${reason}`,
      targetRole: 'manager', relatedId: oid,
    });
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/accept', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.status !== 'new') {
      if (['pending', 'preparing', 'ready', 'served', 'completed'].includes(o.status)) jsonOut(o);
      err('Only new orders can be accepted', 400);
    }
    db.prepare("UPDATE orders SET status='pending', staffId=?, staffName=? WHERE id=?").execute([user.id, user.name, oid]);
    try {
      db.prepare('INSERT INTO notifications (branchId,type,message,targetRole,readBy) VALUES (?,?,?,?,?)')
        .execute([o.branchId, 'online-order-accepted', 'Online order #' + oid + ' sent to kitchen by ' + user.name, 'kitchen', '[]']);
    } catch (e) { /* best-effort */ }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/reject', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.status !== 'new') err('Only pending online orders can be rejected', 400);
    const voidData = { reason: truncate(body.reason || 'Rejected by staff', 500), byStaffName: user.name, at: isoNow() };
    db.prepare("UPDATE orders SET status='voided', void_data=? WHERE id=?").execute([jsonEncode(voidData), oid]);
    jsonOut({ ok: true });
  }

  // ═══════════════════════════════════════════════════════════
  // KITCHEN -> CASHIER HAND-OFF
  //   Chef:    Start cooking (pending -> preparing), then Ready (existing)
  //   Cashier: Served (ready -> dispatched) = order complete; records who.
  // The conditional UPDATE means a double tap (or two tills) can't serve twice.
  // ═══════════════════════════════════════════════════════════
  const KITCHEN_ROLES = ['kitchen', 'manager', 'superManager', 'admin'];
  const SERVE_ROLES = ['cashier', 'manager', 'superManager', 'admin'];
  const isBoss = ['manager', 'superManager', 'admin'].includes(user.role);
  const loadOrder = (oid) => {
    const s = db.prepare('SELECT * FROM orders WHERE id=?'); s.execute([oid]);
    const o = orderRow(s.fetch());
    if (!o || (bid && o.branchId !== bid && user.role !== 'superManager' && user.role !== 'admin')) err('Order not found', 404);
    return o;
  };

  if (method === 'POST' && routeMatch('/orders/:id/start', uri, params)) {
    requireRole(KITCHEN_ROLES, user);
    const o = loadOrder(int(params.id));
    if (!['pending', 'preparing'].includes(o.status)) err(o.status === 'new' ? 'The cashier has not accepted this order yet.' : 'This order is no longer in the kitchen.', 409);
    const stationId = body.stationId ? int(body.stationId) : null;    // only this station's dishes
    const items = o.items.map((it) => (it.status || 'pending') === 'pending' && (!stationId || int(it.stationId) === stationId)
      ? Object.assign({}, it, { status: 'preparing', startedAt: isoNow() }) : it);
    db.prepare("UPDATE orders SET items=?, status='preparing', startedAt=COALESCE(startedAt, ?) WHERE id=?")
      .execute([jsonEncode(items), nowStr(), o.id]);
    jsonOut(loadOrder(o.id));
  }

  if (method === 'POST' && routeMatch('/orders/:id/serve', uri, params)) {
    requireRole(SERVE_ROLES, user);
    const oid = int(params.id);
    loadOrder(oid);
    db.prepare(`UPDATE orders SET status='dispatched', dispatchedAt=?, servedById=?, servedByName=? WHERE id=? AND status='ready'`)
      .execute([nowStr(), user.id, user.name, oid]);
    if (!db._changes) {
      const o = loadOrder(oid);
      if (o.status === 'dispatched') err(`Already marked served by ${o.servedByName || 'someone else'}.`, 409);
      if (o.status === 'voided') err('This order was cancelled.', 409);
      err('The kitchen has not marked this order ready yet.', 409);
    }
    const o = loadOrder(oid);
    if (o.paymentStatus === 'paid' && o.tableId) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
    jsonOut(o);
  }

  // Undo a mis-tap: back to "ready" within 10 minutes (whoever marked it, or a manager).
  if (method === 'POST' && routeMatch('/orders/:id/unserve', uri, params)) {
    requireRole(SERVE_ROLES, user);
    const o = loadOrder(int(params.id));
    if (o.status !== 'dispatched') err('This order is not marked served.', 409);
    if (o.servedById !== user.id && !isBoss) err('Only the person who marked it served (or a manager) can undo this.', 403);
    const t = Date.parse(String(o.dispatchedAt || '').replace(' ', 'T'));
    if (!isBoss && (!t || Date.now() - t > 10 * 60 * 1000)) err('Too late to undo - ask a manager.', 409);
    db.prepare("UPDATE orders SET status='ready', dispatchedAt=NULL, servedById=NULL, servedByName='' WHERE id=?").execute([o.id]);
    jsonOut(loadOrder(o.id));
  }

  // Tell the cashiers that food is waiting at the pass.
  const notifyReady = (o) => {
    try {
      addNotification({ branchId: o.branchId, type: 'order-ready', relatedId: o.id, targetRole: 'cashier',
        message: `Ready to serve: ${o.tableName || ucfirst(o.orderType || 'order')} · ${o.displayNum} - open Serve`, });
    } catch (_) { /* best-effort */ }
  };

  if (method === 'PATCH' && routeMatch('/orders/:id/status', uri, params)) {
    const oid = int(params.id);
    const status = body.status || '';
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (status === 'ready' && o.status !== 'ready') notifyReady(o);
    const allItemsDeducted = o.items.length > 0 && o.items.every((l) => l.inventoryDeducted || false);
    if (status === 'ready' && !allItemsDeducted) {
      db.beginTransaction();
      try {
        // Only deduct lines that haven't already been deducted (a running tab
        // may have had earlier rounds deducted already) — avoids double counts.
        for (const line of o.items) if (!(line.inventoryDeducted || false)) deductInventoryLine(db, line);
        const now = isoNow();
        const items = o.items.map((i) => Object.assign({}, i, { status: 'ready', inventoryDeducted: true, readyAt: i.readyAt || now }));
        db.prepare('UPDATE orders SET status=?, inventoryDeducted=1, readyAt=?, items=? WHERE id=?')
          .execute(['ready', nowStr(), jsonEncode(items), oid]);
        if (o.paymentStatus === 'paid' && o.tableId) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
        db.commit();
        for (const line of o.items) checkLowStock(db, int(line.menuItemId), int(o.branchId));
      } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Deduction failed: ' + e.message, 500); }
    } else {
      db.prepare('UPDATE orders SET status=? WHERE id=?').execute([status, oid]);
      if (status === 'dispatched') db.prepare('UPDATE orders SET dispatchedAt=? WHERE id=?').execute([nowStr(), oid]);
    }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/items/:idx/status', uri, params)) {
    const oid = int(params.id);
    const idx = int(params.idx);
    const status = body.status || '';
    if (!['pending', 'preparing', 'ready'].includes(status)) err('Invalid status');
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    const items = o.items; if (!items[idx]) err('Item not found', 404);
    db.beginTransaction();
    try {
      const line = items[idx];
      line.status = status;
      if (status === 'ready' && !(line.inventoryDeducted || false)) {
        deductInventoryLine(db, line);
        line.inventoryDeducted = true;
        line.readyAt = isoNow();
      }
      const statuses = arrColumn(items, 'status');
      let newStatus = o.status;
      if (new Set(statuses).size === 1 && statuses[0] === 'ready') {
        newStatus = 'ready';
        if (o.paymentStatus === 'paid' && o.tableId) db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
      } else if (statuses.includes('preparing') || statuses.includes('ready')) {
        newStatus = 'preparing';
      } else { newStatus = 'pending'; }
      const allReady = newStatus === 'ready';
      db.prepare('UPDATE orders SET items=?, status=?, inventoryDeducted=?, readyAt=CASE WHEN ?=1 THEN COALESCE(readyAt, ?) ELSE readyAt END, startedAt=CASE WHEN ?=1 THEN COALESCE(startedAt, ?) ELSE startedAt END WHERE id=?')
        .execute([jsonEncode(items), newStatus, allReady ? 1 : (o.inventoryDeducted ? 1 : 0), allReady ? 1 : 0, nowStr(), newStatus !== 'pending' ? 1 : 0, nowStr(), oid]);
      db.commit();
      if (allReady && o.status !== 'ready') notifyReady(o);
      if (status === 'ready') checkLowStock(db, int(items[idx].menuItemId), int(o.branchId));
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Failed: ' + e.message, 500); }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/priority', uri, params)) {
    const oid = int(params.id);
    const p = (body.priority || '') === 'high' ? 'high' : 'normal';
    db.prepare('UPDATE orders SET priority=? WHERE id=?').execute([p, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/kitchen-tag', uri, params)) {
    const oid = int(params.id);
    const tag = { type: truncate(body.type || '', 100), note: truncate(body.note || '', 500), setBy: user.name, setAt: isoNow() };
    db.prepare('UPDATE orders SET kitchenTag=? WHERE id=?').execute([jsonEncode(tag), oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    const o = orderRow(f.fetch());
    if (o.staffId) {
      addNotification({
        branchId: o.branchId, type: 'kitchen-delay',
        message: `Kitchen flagged Order #${o.id} (${o.tableName}): ${tag.type}` + (tag.note ? ` — ${tag.note}` : ''),
        targetUserId: o.staffId, relatedId: o.id,
      });
    }
    jsonOut(o);
  }

  if (method === 'DELETE' && routeMatch('/orders/:id/kitchen-tag', uri, params)) {
    const oid = int(params.id);
    db.prepare('UPDATE orders SET kitchenTag=NULL WHERE id=?').execute([oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/discount', uri, params)) {
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.amountPaid > 0) err('Cannot discount an order that already has payments', 400);
    const type = ['percent', 'fixed'].includes(body.type || '') ? body.type : 'percent';
    const value = flt(body.value || 0);
    if (value < 0) err('Discount value cannot be negative', 400);
    const promoAmt = o.promo && o.promo.amount ? o.promo.amount : 0;
    if (value === 0) {
      const totals = computeTotals(o.items, null, promoAmt, o.orderType);
      db.prepare('UPDATE orders SET discount=NULL, serviceCharge=?, vat=?, total=? WHERE id=?')
        .execute([totals.serviceCharge, totals.vat, totals.total, oid]);
      const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
      jsonOut(orderRow(f.fetch()));
    }
    if (type === 'percent' && value > 100) err('Percent discount cannot exceed 100%', 400);
    let approver = user.name;
    if (!['superManager', 'manager', 'admin'].includes(user.role)) {
      const permSt = db.prepare('SELECT serverMaxDiscountPercent FROM permissions WHERE branchId=?');
      permSt.execute([o.branchId]);
      const limit = flt(permSt.fetchColumn() || 0);
      const withinLimit = (type === 'percent' && value <= limit);
      if (!withinLimit) {
        const pin = String(body.pin || '').trim();
        if (pin === '') err(type === 'percent' ? `Discounts over ${limit}% need a manager approval PIN` : 'Fixed-amount discounts need a manager approval PIN', 403);
        const mgr = findApproverByPin(db, pin);
        if (!mgr) err('Invalid approval PIN', 403);
        approver = mgr.name + ' (approved for ' + user.name + ')';
      }
    }
    const discountAmount = type === 'percent' ? round2(o.subtotal * value / 100) : value;
    if (discountAmount > o.subtotal) err('Discount cannot exceed the subtotal', 400);
    const discount = { type, value, amount: discountAmount, reason: truncate(body.reason || '', 500), approvedBy: approver };
    const totals = computeTotals(o.items, discount, promoAmt, o.orderType);
    db.prepare('UPDATE orders SET discount=?, serviceCharge=?, vat=?, total=? WHERE id=?')
      .execute([jsonEncode(discount), totals.serviceCharge, totals.vat, totals.total, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/void', uri, params)) {
    requireRole(['superManager', 'manager', 'cashier', 'server', 'kitchen'], user);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (['server', 'cashier'].includes(user.role)) {
      const pSt = db.prepare('SELECT allowServerVoid, allowCashierVoid FROM permissions WHERE branchId=?');
      pSt.execute([o.branchId]);
      const perm = pSt.fetch() || { allowServerVoid: 0, allowCashierVoid: 0 };
      const field = user.role === 'server' ? 'allowServerVoid' : 'allowCashierVoid';
      if (!perm[field]) err(ucfirst(user.role) + 's are not allowed to void orders at this branch. Ask a manager.', 403);
    }
    if (o.status === 'voided') err('This order is already voided', 400);
    const voidData = { reason: truncate(body.reason || '', 500), byStaffName: user.name, at: isoNow() };
    // Gift card money on a voided order goes back onto the card, with a record.
    const giftBack = Object.entries(giftNetByCode(o.payments)).filter(([, v]) => v > 0.001);
    const payments = o.payments.slice();
    for (const [code, amt] of giftBack) payments.push({ method: 'giftcard', type: 'refund', code, amount: -amt, reason: 'Order voided: ' + voidData.reason, byStaffName: user.name, paidAt: isoNow() });
    db.beginTransaction();
    try {
      if (o.inventoryDeducted) restoreInventory(db, o.items);
      for (const [code, amt] of giftBack) {
        const gSt = db.prepare('SELECT * FROM gift_cards WHERE code=? AND branchId=?'); gSt.execute([code, o.branchId]);
        const card = gSt.fetch();
        if (card) giftCredit(db, card, amt, { type: 'void-return', orderId: oid, orderNum: o.displayNum, by: user.name, note: voidData.reason || 'Order voided' });
      }
      try { loyaltyUndo(db, o, oid, user.name, 'order voided'); } catch (_) { /* loyalty is best-effort */ }
      if (giftBack.length) {
        const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
        db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=? WHERE id=?')
          .execute([jsonEncode(payments), amountPaid, amountPaid <= 0.01 ? 'refunded' : o.paymentStatus, oid]);
      }
      db.prepare("UPDATE orders SET status='voided', inventoryDeducted=0, void_data=? WHERE id=?").execute([jsonEncode(voidData), oid]);
      if (o.tableId) db.prepare("UPDATE tables_list SET status='open' WHERE id=?").execute([o.tableId]);
      db.commit();
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Void failed: ' + e.message, 500); }
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'PATCH' && routeMatch('/orders/:id/table', uri, params)) {
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (o.tableId) db.prepare("UPDATE tables_list SET status='open' WHERE id=?").execute([o.tableId]);
    const newTid = body.tableId ? int(body.tableId) : null;
    const newTname = truncate(body.tableName || '', 100);
    if (newTid) db.prepare("UPDATE tables_list SET status='ordered' WHERE id=?").execute([newTid]);
    db.prepare('UPDATE orders SET tableId=?, tableName=? WHERE id=?').execute([newTid, newTname, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut(orderRow(f.fetch()));
  }

  if (method === 'POST' && routeMatch('/orders/:id/tip', uri, params)) {
    const oid = int(params.id);
    const tip = round2(flt(body.amount || 0));
    if (tip < 0) err('Tip cannot be negative');
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Order not found', 404);
    db.prepare('UPDATE orders SET tipAmount=? WHERE id=?').execute([tip, oid]);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    const updated = orderRow(f.fetch());
    if (o.staffId) {
      const s = getSettings();
      addNotification({
        branchId: o.branchId, type: 'tip-added',
        message: `Tip of ${s.currencySymbol}${numberFormat(tip, 2)} added to ${orderNum(oid)} · New total: ${s.currencySymbol}${numberFormat(updated.grandTotal, 2)}`,
        targetUserId: int(o.staffId), relatedId: oid,
      });
    }
    jsonOut(updated);
  }

  // ── HELD ORDERS ──────────────────────────────────────────
  if (method === 'GET' && uri === '/held-orders') {
    const st = db.prepare('SELECT * FROM held_orders WHERE branchId=? ORDER BY heldAt DESC');
    st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), items: jsonDecode(r.items, []) })));
  }
  if (method === 'POST' && uri === '/held-orders') {
    db.prepare(
      'INSERT INTO held_orders (branchId,label,staffName,orderType,tableId,tableName,customerName,customerPhone,customerAddress,items,note,priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).execute([
      bid, truncate(body.label || '', 200), user.name, body.orderType || 'dine-in', body.tableId || null,
      truncate(body.tableName || '', 100), truncate(body.customerName || '', 200), truncate(body.customerPhone || '', 50),
      truncate(body.customerAddress || '', 1000), jsonEncode(body.items || []), truncate(body.note || '', 1000), body.priority || 'normal',
    ]);
    const id = db.lastInsertId();
    const f = db.prepare('SELECT * FROM held_orders WHERE id=?'); f.execute([id]);
    jsonOut(Object.assign({}, f.fetch(), { id, items: body.items || [] }));
  }
  if (routeMatch('/held-orders/:id', uri, params)) {
    const hId = int(params.id);
    if (method === 'GET') {
      const f = db.prepare('SELECT * FROM held_orders WHERE id=?'); f.execute([hId]);
      const r = f.fetch(); if (!r) err('Not found', 404);
      jsonOut(Object.assign({}, r, { items: jsonDecode(r.items, []) }));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM held_orders WHERE id=?').execute([hId]);
      jsonOut({ ok: true });
    }
  }

  // ── CUSTOMERS ────────────────────────────────────────────
  if (method === 'GET' && uri === '/customers/lookup') {
    const phone = truncate(query.phone || '', 50);
    if (!phone) err('phone required');
    const st = db.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?'); st.execute([bid, phone]);
    const c = st.fetch();
    const os = db.prepare('SELECT * FROM orders WHERE branchId=? AND customerPhone=? ORDER BY createdAt DESC LIMIT 5');
    os.execute([bid, phone]);
    jsonOut({ customer: c || null, orders: os.fetchAll().map((r) => orderRow(r)) });
  }
  // GET /api/customers?search= — directory (phone = primary key, per branch)
  if (method === 'GET' && uri === '/customers') {
    if (!bid) jsonOut([]);
    const search = truncate(query.search || '', 100).trim();
    let st;
    if (search) {
      st = db.prepare('SELECT * FROM customers WHERE branchId=? AND (phone LIKE ? OR name LIKE ?) ORDER BY name LIMIT 100');
      st.execute([bid, '%' + search + '%', '%' + search + '%']);
    } else {
      st = db.prepare('SELECT * FROM customers WHERE branchId=? ORDER BY createdAt DESC LIMIT 200');
      st.execute([bid]);
    }
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0) })));
  }
  if (method === 'POST' && uri === '/customers') {
    const phone = truncate(body.phone || '', 50).trim();
    if (!phone) err('Phone number is required (it is the customer key).', 400);
    const name = truncate(body.name || '', 200);
    const address = truncate(body.address || '', 1000);
    db.prepare(
      `INSERT INTO customers (branchId,phone,name,address) VALUES (?,?,?,?)
       ON CONFLICT(branchId,phone) DO UPDATE SET name=excluded.name, address=excluded.address`
    ).execute([bid, phone, name, address]);
    const f = db.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?'); f.execute([bid, phone]);
    const r = f.fetch();
    jsonOut(Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0) }), 201);
  }
  if (routeMatch('/customers/:id', uri, params)) {
    const cId = int(params.id);
    if (method === 'GET') {
      const f = db.prepare('SELECT * FROM customers WHERE id=? AND branchId=?'); f.execute([cId, bid]);
      const r = f.fetch(); if (!r) err('Customer not found', 404);
      const os = db.prepare('SELECT * FROM orders WHERE branchId=? AND customerPhone=? ORDER BY createdAt DESC LIMIT 20');
      os.execute([bid, r.phone]);
      jsonOut(Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0), orders: os.fetchAll().map((o) => orderRow(o)) }));
    }
    if (method === 'PUT' || method === 'PATCH') {
      const [sets, vals] = buildSet(body, ['name', 'address', 'phone']);
      if (sets) db.prepare(`UPDATE customers SET ${sets} WHERE id=? AND branchId=?`).execute([...vals, cId, bid]);
      const f = db.prepare('SELECT * FROM customers WHERE id=?'); f.execute([cId]);
      const r = f.fetch(); if (!r) err('Customer not found', 404);
      jsonOut(Object.assign({}, r, { id: int(r.id), loyaltyPoints: flt(r.loyaltyPoints || 0) }));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager', 'admin'], user);
      db.prepare('DELETE FROM customers WHERE id=? AND branchId=?').execute([cId, bid]);
      jsonOut({ ok: true });
    }
  }

  // ── ADD-ON FRAMEWORK (admin enables feature modules) ─────
  if (method === 'POST' && uri === '/admin/addons') {
    requireRole(['admin'], user);
    const VALID = ['loyalty', 'giftcards', 'promotions', 'reservations'];
    const addon = String(body.addon || '');
    if (!VALID.includes(addon)) err('Unknown add-on', 400);
    const s = getSettings();
    let list = Array.isArray(s.enabledAddons) ? s.enabledAddons.slice() : [];
    if (body.enabled) { if (!list.includes(addon)) list.push(addon); }
    else list = list.filter((a) => a !== addon);
    db.prepare('UPDATE settings SET enabledAddons=? WHERE id=1').execute([jsonEncode(list)]);
    getSettings(true);
    jsonOut({ ok: true, enabledAddons: list });
  }

  // ── LOYALTY ADD-ON ───────────────────────────────────────
  // Redeem a customer's points against the balance due. Recorded as a
  // "loyalty" tender so it reduces the balance and shows on the receipt.
  if (method === 'POST' && routeMatch('/orders/:id/loyalty-redeem', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const s = getSettings();
    if (!(Array.isArray(s.enabledAddons) && s.enabledAddons.includes('loyalty'))) err('Loyalty is not enabled', 400);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    if (!o.customerPhone) err('Attach a customer to the order before redeeming points.', 400);
    const cSt = db.prepare('SELECT * FROM customers WHERE branchId=? AND phone=?'); cSt.execute([o.branchId, o.customerPhone]);
    const cust = cSt.fetch(); if (!cust) err('Customer not found', 404);
    const balanceDue = round2(o.grandTotal - o.amountPaid);
    if (balanceDue <= 0) err('This order is already settled.', 400);
    const available = flt(cust.loyaltyPoints || 0);
    let points = Math.floor(flt(body.points || 0));
    if (points <= 0) err('Enter the number of points to redeem.', 400);
    if (points > available) err(`Customer only has ${Math.floor(available)} points.`, 400);
    const minR = flt(s.loyaltyMinRedeem || 0);
    if (minR > 0 && points < minR) err(`At least ${minR} points are needed to redeem.`, 400);
    const redeemValue = flt(s.loyaltyRedeemValue) || 1;
    // Never redeem more than needed to clear the balance.
    const maxPoints = Math.ceil(balanceDue / redeemValue);
    if (points > maxPoints) points = maxPoints;
    let value = round2(points * redeemValue);
    if (value > balanceDue) value = balanceDue;
    if (o.status === 'voided') err('This order was voided', 400);
    const payments = o.payments;
    payments.push({ method: 'loyalty', type: 'redeem', amount: value, points, byStaffName: user.name, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const fullyPaid = amountPaid >= o.grandTotal - 0.01;
    const payStatus = fullyPaid ? 'paid' : 'unpaid';
    const paidAt = fullyPaid ? nowStr() : null;
    db.beginTransaction();
    try {
      // conditional: two tills cannot spend the same points twice
      db.prepare('UPDATE customers SET loyaltyPoints = COALESCE(loyaltyPoints,0) - ? WHERE id=? AND COALESCE(loyaltyPoints,0) >= ?').execute([points, int(cust.id), points]);
      if (!db._changes) err('The customer\'s points changed - check and try again', 409);
      db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
        .execute([jsonEncode(payments), amountPaid, payStatus, paidAt, oid]);
      db.prepare('INSERT INTO loyalty_ledger (branchId,customerId,phone,orderId,type,points,note,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
        .execute([o.branchId, int(cust.id), o.customerPhone, oid, 'redeem', -points, 'Redeemed on ' + (o.displayNum || ('#' + oid)), user.name]);
      db.commit();
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Could not redeem points: ' + e.message, 500); }
    if (fullyPaid) assignFiscalIfDue(db, oid);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut({ order: orderRow(f.fetch()), redeemedPoints: points, redeemedValue: value, remainingPoints: round2(available - points) });
  }

  // Loyalty report: top customers by balance + points issued/redeemed + recent activity.
  if (method === 'GET' && uri === '/loyalty/report') {
    const s = getSettings();
    const settings = {
      loyaltyEarnPoints: s.loyaltyEarnPoints, loyaltyEarnPer: s.loyaltyEarnPer,
      loyaltyRedeemValue: s.loyaltyRedeemValue, loyaltyMinRedeem: s.loyaltyMinRedeem,
    };
    if (!bid) jsonOut({ top: [], issued: 0, redeemed: 0, recent: [], settings });
    const topSt = db.prepare('SELECT id,name,phone,loyaltyPoints FROM customers WHERE branchId=? AND COALESCE(loyaltyPoints,0)>0 ORDER BY loyaltyPoints DESC LIMIT 25');
    topSt.execute([bid]);
    const iSt = db.prepare("SELECT COALESCE(SUM(points),0) as p FROM loyalty_ledger WHERE branchId=? AND type='earn'"); iSt.execute([bid]);
    const rSt = db.prepare("SELECT COALESCE(SUM(points),0) as p FROM loyalty_ledger WHERE branchId=? AND type='redeem'"); rSt.execute([bid]);
    const recSt = db.prepare('SELECT * FROM loyalty_ledger WHERE branchId=? ORDER BY id DESC LIMIT 40'); recSt.execute([bid]);
    jsonOut({
      top: topSt.fetchAll().map((r) => ({ id: int(r.id), name: r.name, phone: r.phone, loyaltyPoints: round2(flt(r.loyaltyPoints || 0)) })),
      issued: round2(flt(iSt.fetch().p)),
      redeemed: Math.abs(round2(flt(rSt.fetch().p))),
      recent: recSt.fetchAll().map((r) => ({ id: int(r.id), phone: r.phone, type: r.type, points: round2(flt(r.points)), note: r.note, byStaffName: r.byStaffName, createdAt: r.createdAt })),
      settings,
    });
  }

  // Update loyalty earn/redeem rates (managers and up).
  if (method === 'PUT' && uri === '/loyalty/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const fields = ['loyaltyEarnPoints', 'loyaltyEarnPer', 'loyaltyRedeemValue', 'loyaltyMinRedeem'];
    const sets = [], vals = [];
    for (const fld of fields) if (has(body[fld])) { sets.push(`${fld}=?`); vals.push(flt(body[fld])); }
    if (!sets.length) err('No settings to update', 400);
    db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals);
    getSettings(true);
    const s = getSettings();
    jsonOut({ ok: true, settings: { loyaltyEarnPoints: s.loyaltyEarnPoints, loyaltyEarnPer: s.loyaltyEarnPer, loyaltyRedeemValue: s.loyaltyRedeemValue, loyaltyMinRedeem: s.loyaltyMinRedeem } });
  }

  // ── PROMOTIONS ADD-ON ────────────────────────────────────
  const promoRow = (r) => ({
    id: int(r.id), branchId: int(r.branchId), name: r.name, type: r.type,
    conditions: jsonDecode(r.conditions, []) || [], rewardKind: r.rewardKind,
    rewardValue: flt(r.rewardValue), scope: r.scope, days: jsonDecode(r.days, []) || [],
    active: !!r.active, priority: int(r.priority), createdAt: r.createdAt,
    showToCustomers: !!int(r.showToCustomers), customerNote: r.customerNote || '',
  });
  if (method === 'GET' && uri === '/promotions') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM promotions WHERE branchId=? ORDER BY active DESC, priority DESC, id DESC');
    st.execute([bid]);
    jsonOut(st.fetchAll().map(promoRow));
  }
  if (method === 'POST' && uri === '/promotions') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const name = truncate(body.name || '', 120).trim();
    if (!name) err('A promotion name is required', 400);
    const type = ['buy_n', 'bundle', 'daily'].includes(body.type) ? body.type : 'buy_n';
    const conditions = Array.isArray(body.conditions) ? body.conditions.map((c) => ({ menuItemId: int(c.menuItemId), qty: Math.max(1, int(c.qty) || 1) })).filter((c) => c.menuItemId) : [];
    if (!conditions.length) err('Add at least one item to the promotion', 400);
    const rewardKind = body.rewardKind === 'amount' ? 'amount' : 'percent';
    const rewardValue = flt(body.rewardValue || 0);
    if (rewardValue <= 0) err('Reward value must be greater than zero', 400);
    if (rewardKind === 'percent' && rewardValue > 100) err('Percent reward cannot exceed 100%', 400);
    const scope = body.scope === 'order' ? 'order' : 'items';
    const days = Array.isArray(body.days) ? body.days.map((d) => int(d)).filter((d) => d >= 0 && d <= 6) : [];
    db.prepare('INSERT INTO promotions (branchId,name,type,conditions,rewardKind,rewardValue,scope,days,active,priority,showToCustomers,customerNote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .execute([bid, name, type, jsonEncode(conditions), rewardKind, rewardValue, scope, jsonEncode(days), body.active === false ? 0 : 1, int(body.priority) || 0,
        body.showToCustomers ? 1 : 0, truncate(String(body.customerNote || ''), 200).trim()]);
    const f = db.prepare('SELECT * FROM promotions WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(promoRow(f.fetch()), 201);
  }
  // Every active promotion with today's flag - for all staff (servers too),
  // shown on the home page, dashboard and Order Entry.
  if (method === 'GET' && uri === '/promotions/today') {
    if (!bid) jsonOut({ promotions: [] });
    jsonOut({ promotions: describePromotions(db, int(bid)) });
  }
  // Preview the best promotion for a tentative cart (used live in Order Entry).
  // Must be declared BEFORE /promotions/:id or ":id" would swallow "preview".
  if (method === 'POST' && uri === '/promotions/preview') {
    const items = (body.items || []).map((i) => ({ menuItemId: int(i.menuItemId), qty: int(i.qty), lineTotal: flt(i.lineTotal || 0) }));
    jsonOut({ promo: computeBestPromotion(db, int(bid), items, getSettings()) });
  }
  // Promotions usage report: count + total discount per promotion.
  if (method === 'GET' && uri === '/promotions/report') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut({ promos: [], totalDiscount: 0, totalOrders: 0 });
    const oSt = db.prepare(`SELECT promo_data FROM orders WHERE branchId=? AND promo_data IS NOT NULL`);
    oSt.execute([bid]);
    const byPromo = {}; let totalDiscount = 0, totalOrders = 0;
    for (const row of oSt.fetchAll()) {
      const pr = jsonDecode(row.promo_data, null); if (!pr || !pr.amount) continue;
      const k = pr.promotionId || pr.name;
      if (!byPromo[k]) byPromo[k] = { promotionId: pr.promotionId || null, name: pr.name, count: 0, discount: 0 };
      byPromo[k].count++; byPromo[k].discount = round2(byPromo[k].discount + flt(pr.amount));
      totalDiscount = round2(totalDiscount + flt(pr.amount)); totalOrders++;
    }
    jsonOut({ promos: Object.values(byPromo).sort((a, b) => b.discount - a.discount), totalDiscount, totalOrders });
  }
  if (routeMatch('/promotions/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const pid = int(params.id);
    const chk = db.prepare('SELECT * FROM promotions WHERE id=? AND branchId=?'); chk.execute([pid, bid]);
    if (!chk.fetch()) err('Promotion not found', 404);
    if (method === 'PUT' || method === 'PATCH') {
      const sets = [], vals = [];
      if (has(body.name)) { sets.push('name=?'); vals.push(truncate(body.name, 120)); }
      if (has(body.type) && ['buy_n', 'bundle', 'daily'].includes(body.type)) { sets.push('type=?'); vals.push(body.type); }
      if (has(body.conditions)) { sets.push('conditions=?'); vals.push(jsonEncode((body.conditions || []).map((c) => ({ menuItemId: int(c.menuItemId), qty: Math.max(1, int(c.qty) || 1) })).filter((c) => c.menuItemId))); }
      if (has(body.rewardKind)) { sets.push('rewardKind=?'); vals.push(body.rewardKind === 'amount' ? 'amount' : 'percent'); }
      if (has(body.rewardValue)) { sets.push('rewardValue=?'); vals.push(flt(body.rewardValue)); }
      if (has(body.scope)) { sets.push('scope=?'); vals.push(body.scope === 'order' ? 'order' : 'items'); }
      if (has(body.days)) { sets.push('days=?'); vals.push(jsonEncode((body.days || []).map((d) => int(d)).filter((d) => d >= 0 && d <= 6))); }
      if (has(body.active)) { sets.push('active=?'); vals.push(body.active ? 1 : 0); }
      if (has(body.priority)) { sets.push('priority=?'); vals.push(int(body.priority)); }
      if (has(body.showToCustomers)) { sets.push('showToCustomers=?'); vals.push(body.showToCustomers ? 1 : 0); }
      if (has(body.customerNote)) { sets.push('customerNote=?'); vals.push(truncate(String(body.customerNote || ''), 200).trim()); }
      if (sets.length) db.prepare(`UPDATE promotions SET ${sets.join(',')} WHERE id=? AND branchId=?`).execute([...vals, pid, bid]);
      const f = db.prepare('SELECT * FROM promotions WHERE id=?'); f.execute([pid]);
      jsonOut(promoRow(f.fetch()));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM promotions WHERE id=? AND branchId=?').execute([pid, bid]);
      jsonOut({ ok: true });
    }
  }

  // ── GIFT CARDS ADD-ON ────────────────────────────────────
  const giftLedgerOut = (r) => ({
    id: int(r.id), cardId: int(r.cardId), code: r.code, orderId: r.orderId ? int(r.orderId) : null, orderNum: r.orderNum || '',
    type: r.type, amount: round2(flt(r.amount)), balanceAfter: r.balanceAfter === null || r.balanceAfter === undefined ? null : round2(flt(r.balanceAfter)),
    byStaffName: r.byStaffName || '', note: r.note || '', createdAt: r.createdAt,
  });
  const giftRow = (r) => ({
    id: int(r.id), code: r.code, initialBalance: flt(r.initialBalance), balance: flt(r.balance),
    status: r.status, recipientName: r.recipientName, note: r.note, issuedByName: r.issuedByName, createdAt: r.createdAt,
  });
  if (method === 'GET' && uri === '/giftcards') {
    requireRole(['superManager', 'manager', 'admin', 'cashier'], user);
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM gift_cards WHERE branchId=? ORDER BY id DESC LIMIT 300'); st.execute([bid]);
    jsonOut(st.fetchAll().map(giftRow));
  }
  if (method === 'POST' && uri === '/giftcards') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const amount = round2(flt(body.amount || 0));
    if (amount <= 0) err('Enter a gift-card amount', 400);
    // Generate a unique, scanner-friendly code (no ambiguous characters).
    const ALPHA = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';
    let code = '';
    for (let tries = 0; tries < 20; tries++) {
      let c = 'GC';
      for (let i = 0; i < 10; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
      const ex = db.prepare('SELECT id FROM gift_cards WHERE branchId=? AND code=?'); ex.execute([bid, c]);
      if (!ex.fetch()) { code = c; break; }
    }
    if (!code) err('Could not allocate a code, try again', 500);
    db.prepare('INSERT INTO gift_cards (branchId,code,initialBalance,balance,status,recipientName,note,issuedByName) VALUES (?,?,?,?,?,?,?,?)')
      .execute([bid, code, amount, amount, 'active', truncate(body.recipientName || '', 200), truncate(body.note || '', 500), user.name]);
    const gid = db.lastInsertId();
    db.prepare('INSERT INTO gift_card_ledger (branchId,cardId,code,type,amount,balanceAfter,byStaffName,note) VALUES (?,?,?,?,?,?,?,?)')
      .execute([bid, gid, code, 'issue', amount, amount, user.name, truncate(body.recipientName ? 'For ' + body.recipientName : '', 200)]);
    const f = db.prepare('SELECT * FROM gift_cards WHERE id=?'); f.execute([gid]);
    jsonOut(giftRow(f.fetch()), 201);
  }
  if (method === 'GET' && uri === '/giftcards/lookup') {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const code = truncate(query.code || '', 40).trim().toUpperCase();
    if (!code) err('code required', 400);
    const st = db.prepare('SELECT * FROM gift_cards WHERE branchId=? AND code=?'); st.execute([bid, code]);
    const g = st.fetch(); if (!g) err('Gift card not found', 404);
    jsonOut(giftRow(g));
  }
  if (method === 'GET' && uri === '/giftcards/report') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut({ issued: 0, redeemed: 0, outstanding: 0, count: 0 });
    const a = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(initialBalance),0) i, COALESCE(SUM(balance),0) b FROM gift_cards WHERE branchId=? AND status='active'"); a.execute([bid]);
    const row = a.fetch();
    const rd = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM gift_card_ledger WHERE branchId=? AND type='redeem'"); rd.execute([bid]);
    jsonOut({ count: int(row.c), issued: round2(flt(row.i)), outstanding: round2(flt(row.b)), redeemed: Math.abs(round2(flt(rd.fetch().s))) });
  }
  // Full history of one card: issue, every deduction, refunds, disable/enable.
  if (method === 'GET' && routeMatch('/giftcards/:id/ledger', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'finance', 'cashier'], user);
    const gid = int(params.id);
    const cSt = db.prepare('SELECT * FROM gift_cards WHERE id=?'); cSt.execute([gid]);
    const card = cSt.fetch(); if (!card) err('Gift card not found', 404);
    if (user.role !== 'superManager' && user.role !== 'admin' && int(card.branchId) !== int(bid)) err('Gift card belongs to another branch', 403);
    const st = db.prepare('SELECT * FROM gift_card_ledger WHERE cardId=? ORDER BY id ASC'); st.execute([gid]);
    jsonOut({ card: giftRow(card), entries: st.fetchAll().map(giftLedgerOut) });
  }
  // Every gift card movement at this branch (newest first), for the activity list / export.
  if (method === 'GET' && uri === '/giftcards/ledger') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut([]);
    const where = ['branchId=?']; const args = [bid];
    if (query.from) { where.push('date(createdAt) >= date(?)'); args.push(String(query.from).slice(0, 10)); }
    if (query.to) { where.push('date(createdAt) <= date(?)'); args.push(String(query.to).slice(0, 10)); }
    const limit = Math.min(2000, Math.max(1, int(query.limit) || 500));
    const st = db.prepare('SELECT * FROM gift_card_ledger WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT ' + limit); st.execute(args);
    jsonOut(st.fetchAll().map(giftLedgerOut));
  }
  if (routeMatch('/giftcards/:id/toggle', uri, params) && method === 'POST') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const gid = int(params.id);
    const st = db.prepare('SELECT * FROM gift_cards WHERE id=? AND branchId=?'); st.execute([gid, bid]);
    const g = st.fetch(); if (!g) err('Gift card not found', 404);
    const next = g.status === 'active' ? 'disabled' : 'active';
    db.prepare('UPDATE gift_cards SET status=? WHERE id=?').execute([next, gid]);
    giftLedgerRow(db, g, next === 'disabled' ? 'disable' : 'enable', 0, { by: user.name, note: truncate(body.reason || '', 200) });
    const f = db.prepare('SELECT * FROM gift_cards WHERE id=?'); f.execute([gid]);
    jsonOut(giftRow(f.fetch()));
  }
  // Redeem a gift card against an order's balance (recorded as a tender).
  if (method === 'POST' && routeMatch('/orders/:id/giftcard-pay', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const s = getSettings();
    if (!(Array.isArray(s.enabledAddons) && s.enabledAddons.includes('giftcards'))) err('Gift cards are not enabled', 400);
    const oid = int(params.id);
    const oSt = db.prepare('SELECT * FROM orders WHERE id=?'); oSt.execute([oid]);
    const o = orderRow(oSt.fetch()); if (!o) err('Not found', 404);
    const code = truncate(body.code || '', 40).trim().toUpperCase();
    const gSt = db.prepare('SELECT * FROM gift_cards WHERE branchId=? AND code=?'); gSt.execute([bid, code]);
    const g = gSt.fetch(); if (!g) err('Gift card not found', 404);
    if (g.status !== 'active') err('This gift card is disabled', 400);
    const cardBal = flt(g.balance);
    if (cardBal <= 0) err('This gift card has no balance left', 400);
    const balanceDue = round2(o.grandTotal - o.amountPaid);
    if (balanceDue <= 0) err('This order is already settled', 400);
    let amount = has(body.amount) ? round2(flt(body.amount)) : Math.min(cardBal, balanceDue);
    amount = round2(Math.min(amount, cardBal, balanceDue));
    if (amount <= 0) err('Enter an amount to redeem', 400);
    if (o.status === 'voided') err('This order was voided', 400);
    const payments = o.payments;
    payments.push({ method: 'giftcard', code, amount, byStaffName: user.name, paidAt: isoNow() });
    const amountPaid = round2(arrSum(arrColumn(payments, 'amount')));
    const fullyPaid = amountPaid >= o.grandTotal - 0.01;
    // Card deduction, its ledger row and the order payment are one step:
    // either all are saved or none.
    db.beginTransaction();
    try {
      giftDebit(db, g, amount, { orderId: oid, orderNum: o.displayNum, by: user.name });
      db.prepare('UPDATE orders SET payments=?, amountPaid=?, paymentStatus=?, paidAt=? WHERE id=?')
        .execute([jsonEncode(payments), amountPaid, fullyPaid ? 'paid' : 'unpaid', fullyPaid ? nowStr() : null, oid]);
      db.commit();
    } catch (e) { db.rollBack(); if (e instanceof Resp) throw e; err('Gift card payment failed: ' + e.message, 500); }
    if (fullyPaid && o.tableId && ['ready', 'dispatched'].includes(o.status)) {
      db.prepare("UPDATE tables_list SET status='dirty' WHERE id=?").execute([o.tableId]);
    }
    try { if (fullyPaid && s.enabledAddons.includes('loyalty') && o.customerPhone) awardLoyaltyPoints(db, o, oid, s, user.name); } catch (_) {}
    if (fullyPaid) assignFiscalIfDue(db, oid);
    const f = db.prepare('SELECT * FROM orders WHERE id=?'); f.execute([oid]);
    jsonOut({ order: orderRow(f.fetch()), redeemed: amount, remainingCardBalance: round2(cardBal - amount) });
  }

  // ── RESERVATIONS ADD-ON ──────────────────────────────────
  const RESV_STATUS = ['booked', 'seated', 'completed', 'cancelled', 'no_show'];
  const resvRow = (r) => ({
    id: int(r.id), customerName: r.customerName, customerPhone: r.customerPhone,
    partySize: int(r.partySize), reserveDate: r.reserveDate, reserveTime: r.reserveTime,
    tableId: r.tableId ? int(r.tableId) : null, tableName: r.tableName, status: r.status,
    note: r.note, createdByName: r.createdByName, createdAt: r.createdAt,
  });
  if (method === 'GET' && uri === '/reservations') {
    requireRole(['superManager', 'manager', 'admin', 'server', 'cashier'], user);
    if (!bid) jsonOut([]);
    const date = truncate(query.date || '', 10).trim();
    let st;
    if (date) { st = db.prepare('SELECT * FROM reservations WHERE branchId=? AND reserveDate=? ORDER BY reserveTime, id'); st.execute([bid, date]); }
    else { st = db.prepare('SELECT * FROM reservations WHERE branchId=? ORDER BY reserveDate DESC, reserveTime LIMIT 200'); st.execute([bid]); }
    jsonOut(st.fetchAll().map(resvRow));
  }
  if (method === 'POST' && uri === '/reservations') {
    requireRole(['superManager', 'manager', 'admin', 'server', 'cashier'], user);
    const name = truncate(body.customerName || '', 200).trim();
    const phone = truncate(body.customerPhone || '', 50).trim();
    if (!name && !phone) err('A name or phone is required', 400);
    const date = truncate(body.reserveDate || '', 10).trim();
    const time = truncate(body.reserveTime || '', 5).trim();
    if (!date || !time) err('Date and time are required', 400);
    let tableId = body.tableId ? int(body.tableId) : null, tableName = '';
    if (tableId) { const t = db.prepare('SELECT name FROM tables_list WHERE id=? AND branchId=?'); t.execute([tableId, bid]); const tr = t.fetch(); tableName = tr ? tr.name : ''; if (!tr) tableId = null; }
    db.prepare('INSERT INTO reservations (branchId,customerName,customerPhone,partySize,reserveDate,reserveTime,tableId,tableName,status,note,createdByName) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .execute([bid, name, phone, Math.max(1, int(body.partySize) || 1), date, time, tableId, tableName, 'booked', truncate(body.note || '', 500), user.name]);
    const f = db.prepare('SELECT * FROM reservations WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(resvRow(f.fetch()), 201);
  }
  if (routeMatch('/reservations/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin', 'server', 'cashier'], user);
    const rid = int(params.id);
    const chk = db.prepare('SELECT * FROM reservations WHERE id=? AND branchId=?'); chk.execute([rid, bid]);
    if (!chk.fetch()) err('Reservation not found', 404);
    if (method === 'PUT' || method === 'PATCH') {
      const sets = [], vals = [];
      if (has(body.status) && RESV_STATUS.includes(body.status)) { sets.push('status=?'); vals.push(body.status); }
      if (has(body.customerName)) { sets.push('customerName=?'); vals.push(truncate(body.customerName, 200)); }
      if (has(body.customerPhone)) { sets.push('customerPhone=?'); vals.push(truncate(body.customerPhone, 50)); }
      if (has(body.partySize)) { sets.push('partySize=?'); vals.push(Math.max(1, int(body.partySize) || 1)); }
      if (has(body.reserveDate)) { sets.push('reserveDate=?'); vals.push(truncate(body.reserveDate, 10)); }
      if (has(body.reserveTime)) { sets.push('reserveTime=?'); vals.push(truncate(body.reserveTime, 5)); }
      if (has(body.note)) { sets.push('note=?'); vals.push(truncate(body.note, 500)); }
      if (has(body.tableId)) {
        let tid = body.tableId ? int(body.tableId) : null, tname = '';
        if (tid) { const t = db.prepare('SELECT name FROM tables_list WHERE id=? AND branchId=?'); t.execute([tid, bid]); const tr = t.fetch(); tname = tr ? tr.name : ''; if (!tr) tid = null; }
        sets.push('tableId=?'); vals.push(tid); sets.push('tableName=?'); vals.push(tname);
      }
      if (sets.length) db.prepare(`UPDATE reservations SET ${sets.join(',')} WHERE id=? AND branchId=?`).execute([...vals, rid, bid]);
      const f = db.prepare('SELECT * FROM reservations WHERE id=?'); f.execute([rid]);
      jsonOut(resvRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager', 'admin'], user);
      db.prepare('DELETE FROM reservations WHERE id=? AND branchId=?').execute([rid, bid]);
      jsonOut({ ok: true });
    }
  }

  // ── CHANGE-AUDIT LOG ─────────────────────────────────────
  if (method === 'GET' && uri === '/audit-log') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const limit = Math.min(500, Math.max(1, int(query.limit) || 200));
    let st;
    if (user.role === 'superManager' || user.role === 'admin') {
      st = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'); st.execute([limit]);
    } else {
      st = db.prepare('SELECT * FROM audit_log WHERE branchId=? ORDER BY id DESC LIMIT ?'); st.execute([bid, limit]);
    }
    jsonOut(st.fetchAll().map((r) => ({
      id: int(r.id), branchId: r.branchId ? int(r.branchId) : null, userName: r.userName, role: r.role,
      method: r.method, path: r.path, summary: r.summary, statusCode: int(r.statusCode), ip: r.ip, createdAt: r.createdAt,
    })));
  }

  // ── FISCAL / TAX AUTHORITY ───────────────────────────────
  if (method === 'PUT' && uri === '/fiscal/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const sets = [], vals = [];
    if (has(body.taxRegNo)) { sets.push('taxRegNo=?'); vals.push(truncate(body.taxRegNo, 60)); }
    if (has(body.fiscalEnabled)) { sets.push('fiscalEnabled=?'); vals.push(body.fiscalEnabled ? 1 : 0); }
    if (has(body.fiscalPrefix)) { sets.push('fiscalPrefix=?'); vals.push(truncate(body.fiscalPrefix, 12)); }
    if (sets.length) { db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals); getSettings(true); }
    const s = getSettings();
    jsonOut({ ok: true, taxRegNo: s.taxRegNo, fiscalEnabled: s.fiscalEnabled, fiscalPrefix: s.fiscalPrefix });
  }
  // Fiscal journal export — paid orders with their tax breakdown, ready to file.
  if (method === 'GET' && uri === '/fiscal/export') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut({ rows: [], csv: '' });
    const from = truncate(query.from || '2000-01-01', 10);
    const to = truncate(query.to || todayStr(), 10);
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)>=? AND date(paidAt)<=? ORDER BY paidAt");
    st.execute([bid, from, to]);
    const s = getSettings();
    const rows = st.fetchAll().map((r) => {
      const o = orderRow(r);
      const net = round2(o.subtotal - ((o.discount && o.discount.amount) || 0) - ((o.promo && o.promo.amount) || 0) + o.serviceCharge);
      const methods = (o.payments || []).filter((p) => (p.amount || 0) > 0).map((p) => p.method).join('|');
      return { fiscalNumber: o.fiscalNumber || '', orderNumber: o.displayNum, dateTime: o.paidAt || o.createdAt, net: round2(net), vat: round2(o.vat), gross: round2(o.grandTotal), methods };
    });
    const esc = (v) => { const sv = String(v == null ? '' : v); return /[",\n]/.test(sv) ? '"' + sv.replace(/"/g, '""') + '"' : sv; };
    const header = ['Fiscal No', 'Order', 'Date/Time', 'Net', 'VAT', 'Gross', 'Payment'];
    const csv = [`# TRN: ${s.taxRegNo || 'n/a'}  Period: ${from}..${to}`, header.join(',')]
      .concat(rows.map((r) => [r.fiscalNumber, r.orderNumber, r.dateTime, r.net, r.vat, r.gross, r.methods].map(esc).join(','))).join('\n');
    jsonOut({ rows, csv, taxRegNo: s.taxRegNo || '', count: rows.length, totalVat: round2(arrSum(rows.map((r) => r.vat))), totalGross: round2(arrSum(rows.map((r) => r.gross))) });
  }

  // ── PRINT AGENT SETTINGS ─────────────────────────────────
  if (method === 'PUT' && uri === '/print/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const sets = [], vals = [];
    if (has(body.printAgentUrl)) { sets.push('printAgentUrl=?'); vals.push(truncate(body.printAgentUrl, 300)); }
    if (has(body.printAgentEnabled)) { sets.push('printAgentEnabled=?'); vals.push(body.printAgentEnabled ? 1 : 0); }
    if (has(body.printPaperWidth)) { sets.push('printPaperWidth=?'); vals.push(Math.max(24, Math.min(64, int(body.printPaperWidth) || 48))); }
    if (has(body.kitchenPrinterName)) { sets.push('kitchenPrinterName=?'); vals.push(truncate(body.kitchenPrinterName, 250)); }
    if (has(body.paymentPrinterName)) { sets.push('paymentPrinterName=?'); vals.push(truncate(body.paymentPrinterName, 250)); }
    if (has(body.qrPrinterName)) { sets.push('qrPrinterName=?'); vals.push(truncate(body.qrPrinterName, 250)); }
    if (has(body.dailyReportEnabled)) { sets.push('dailyReportEnabled=?'); vals.push(body.dailyReportEnabled ? 1 : 0); }
    if (has(body.dailyReportTime)) {
      const t = String(body.dailyReportTime || '').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) err('Daily report time must be HH:MM (24-hour), e.g. 23:30', 400);
      sets.push('dailyReportTime=?'); vals.push(t);
      // A time that has already passed today starts from tomorrow (no surprise print right now).
      const now = new Date(); const [hh, mm] = t.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm) { sets.push('lastDailyReportDate=?'); vals.push(todayStr()); }
    }
    if (sets.length) { db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals); getSettings(true); }
    const s = getSettings();
    jsonOut({ ok: true, printAgentUrl: s.printAgentUrl, printAgentEnabled: s.printAgentEnabled, printPaperWidth: s.printPaperWidth, kitchenPrinterName: s.kitchenPrinterName || '', paymentPrinterName: s.paymentPrinterName || '', qrPrinterName: s.qrPrinterName || '', dailyReportEnabled: s.dailyReportEnabled, dailyReportTime: s.dailyReportTime });
  }

  // ── DAILY CARD & CASH BILLS ──────────────────────────────
  if (method === 'GET' && uri === '/reports/daily-bills') {
    requireRole(['admin', 'superManager', 'manager', 'cashier', 'finance'], user);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : todayStr();
    const DB = require('./daily-bills'); const st = getSettings();
    const rep = DB.collect(d, user.role === 'superManager' || user.role === 'admin' ? null : bid);
    // Ready-made slips so the screen prints exactly what the 11:30 PM auto-print prints.
    jsonOut(Object.assign(rep, { cardText: DB.slipText(rep, 'card', st, st.printPaperWidth), cashText: DB.slipText(rep, 'cash', st, st.printPaperWidth) }));
  }
  // ── QR ORDERING SETTINGS ─────────────────────────────────
  if (method === 'PUT' && uri === '/qr/settings') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const sets = [], vals = [];
    if (has(body.publicBaseUrl)) { sets.push('publicBaseUrl=?'); vals.push(truncate(String(body.publicBaseUrl).replace(/\/+$/, ''), 300)); }
    if (has(body.qrOrderAutoKitchen)) { sets.push('qrOrderAutoKitchen=?'); vals.push(body.qrOrderAutoKitchen ? 1 : 0); }
    if (has(body.wifiSsid)) { sets.push('wifiSsid=?'); vals.push(truncate(String(body.wifiSsid), 64)); }
    if (has(body.wifiPassword)) { sets.push('wifiPassword=?'); vals.push(truncate(String(body.wifiPassword), 64)); }
    if (sets.length) { db.prepare(`UPDATE settings SET ${sets.join(',')} WHERE id=1`).execute(vals); getSettings(true); }
    const s = getSettings();
    jsonOut({ ok: true, publicBaseUrl: s.publicBaseUrl, qrOrderAutoKitchen: s.qrOrderAutoKitchen, wifiSsid: s.wifiSsid || '', wifiPassword: s.wifiPassword || '' });
  }

  // Staff-only: what the table QR codes should point to, this computer's
  // current network address(es), and whether they still match.
  if (method === 'GET' && uri === '/qr/info') {
    requireRole(['superManager', 'manager', 'admin', 'cashier', 'server'], user);
    const s = getSettings();
    const lan = lanAddresses();
    const port = 3000;
    const lanUrls = lan.map((ip) => `http://${ip}:${port}`);
    jsonOut({
      publicBaseUrl: s.publicBaseUrl || '',
      wifiSsid: s.wifiSsid || '', wifiPassword: s.wifiPassword || '',
      lanUrls, suggestedUrl: lanUrls[0] || '',
      ipMismatch: qrIpMismatch(s.publicBaseUrl, lan),
    });
  }

  // ── NOTIFICATIONS ────────────────────────────────────────
  // Which notifications a user sees. The list, the bell's unread count and
  // "mark all read" all use this ONE rule so the numbers always agree.
  // Owners/admins also see everything sent to managers.
  function visibleNotifRows(limit) {
    const uid = user.id, role = user.role;
    const lim = limit ? ` ORDER BY createdAt DESC, id DESC LIMIT ${int(limit)}` : '';
    if (role === 'superManager') return db.query('SELECT * FROM notifications' + lim).fetchAll();
    const roles = ['all', role];
    if (role === 'admin') roles.push('manager', 'superManager');
    const ph = roles.map(() => '?').join(',');
    const st = db.prepare(`SELECT * FROM notifications WHERE (targetUserId=? OR (targetUserId IS NULL AND (branchId=? OR branchId IS NULL) AND targetRole IN (${ph})))` + lim);
    st.execute([uid, bid, ...roles]);
    return st.fetchAll();
  }
  if (method === 'GET' && uri === '/notifications') {
    const uid = user.id;
    const rows = visibleNotifRows(100);
    let list = rows.map((r) => notifRow(r, uid));
    if ((query.unread || '') === 'true') list = list.filter((n) => !n.read);
    jsonOut(list);
  }
  if (method === 'GET' && uri === '/notifications/unread-count') {
    const uid = user.id;
    const rows = visibleNotifRows(100);
    const count = rows.filter((r) => !jsonDecode(r.readBy, []).includes(uid)).length;
    jsonOut({ count });
  }
  if (method === 'POST' && routeMatch('/notifications/:id/read', uri, params)) {
    const nId = int(params.id);
    const f = db.prepare('SELECT * FROM notifications WHERE id=?'); f.execute([nId]);
    const n = f.fetch();
    if (n) {
      const readBy = jsonDecode(n.readBy, []);
      if (!readBy.includes(user.id)) { readBy.push(user.id); db.prepare('UPDATE notifications SET readBy=? WHERE id=?').execute([jsonEncode(readBy), nId]); }
    }
    jsonOut({ ok: true });
  }
  if (method === 'POST' && uri === '/notifications/read-all') {
    const uid = user.id;
    const rows = visibleNotifRows(0);
    for (const r of rows) {
      const rb = jsonDecode(r.readBy, []);
      if (!rb.includes(uid)) { rb.push(uid); db.prepare('UPDATE notifications SET readBy=? WHERE id=?').execute([jsonEncode(rb), int(r.id)]); }
    }
    jsonOut({ ok: true });
  }

  // ── USERS ────────────────────────────────────────────────
  if (method === 'GET' && uri === '/users') {
    const cols = 'id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword';
    let rows;
    if (user.role === 'superManager' || user.role === 'admin') {
      const bFilter = has(query.branchId) ? int(query.branchId) : null;
      if (bFilter) {
        const st = db.prepare(`SELECT ${cols} FROM users WHERE branchId=? OR branchId IS NULL ORDER BY id`);
        st.execute([bFilter]); rows = st.fetchAll();
      } else {
        rows = db.query(`SELECT ${cols} FROM users ORDER BY id`).fetchAll();
      }
    } else {
      const st = db.prepare(`SELECT ${cols} FROM users WHERE branchId=? OR branchId IS NULL ORDER BY id`);
      st.execute([bid]); rows = st.fetchAll();
    }
    jsonOut(rows.map((r) => userRow(r)));
  }
  if (method === 'POST' && uri === '/users') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const role = body.role || 'server';
    if (!['admin', 'superManager', 'manager', 'finance', 'server', 'cashier', 'kitchen'].includes(role)) err('Invalid role', 400);
    if (!canAssignRole(role)) err('You can only create accounts with a role below your own.', 403);
    const authMethod = body.authMethod || 'pin';
    const pinRaw = String(body.pin ?? '0000');
    if (authMethod === 'pin') assertPinAvailable(db, pinRaw);
    let pin = authMethod === 'pin' ? hashPin(pinRaw) : '____';
    let ph = null, mustChange = 0, username = null;
    if (authMethod === 'password') {
      const tempPw = body.tempPassword || '';
      if (tempPw.length < 6) err('Temporary password must be at least 6 characters');
      username = truncate(String(body.username || '').trim(), 100);
      if (!username) err('Username required for password auth');
      ph = passwordHash(tempPw); mustChange = 1; pin = '____';
    }
    const pinIndex = authMethod === 'pin' ? sha256hex(pinRaw) : null;
    const branchScoped = !['admin', 'superManager'].includes(role);
    let newBranchId = body.branchId ?? null;
    if (newBranchId === '' || newBranchId === 0) newBranchId = null;
    if (newBranchId === null && branchScoped) newBranchId = bid;
    if (branchScoped) {
      if (!newBranchId) err('Pick a branch for this user — ' + role + ' accounts must belong to one branch.', 400);
      const bChk = db.prepare('SELECT COUNT(*) AS c FROM branches WHERE id=?'); bChk.execute([int(newBranchId)]);
      if (!int(bChk.fetch().c)) err('That branch does not exist', 400);
      newBranchId = int(newBranchId);
    } else { newBranchId = null; }
    try {
      db.prepare('INSERT INTO users (branchId,name,pin,pin_index,role,payRate,payType,authMethod,username,passwordHash,mustChangePassword) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .execute([newBranchId, truncate(body.name || '', 200), pin, pinIndex, role, flt(body.payRate || 0), body.payType || 'hourly', authMethod, username, ph, mustChange]);
    } catch (e) { if (e instanceof Resp) throw e; err('Database error creating user: ' + e.message, 500); }
    const id = db.lastInsertId();
    const f = db.prepare('SELECT id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword FROM users WHERE id=?');
    f.execute([id]);
    jsonOut(userRow(f.fetch()), 201);
  }
  if (routeMatch('/users/:id', uri, params)) {
    const uId = int(params.id);
    if (method === 'PUT' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const f = db.prepare('SELECT * FROM users WHERE id=?'); f.execute([uId]);
      const target = userRow(f.fetch());
      if (!target) err('User not found', 404);
      guardAccount(target, 'edit');
      const VALID_ROLES = ['admin', 'superManager', 'manager', 'finance', 'server', 'cashier', 'kitchen'];
      if (has(body.role) && body.role !== target.role) {
        if (!VALID_ROLES.includes(body.role)) err('Invalid role', 400);
        guardAccount(target, 'role');
        if (!canAssignRole(body.role)) err('You can only give a role below your own.', 403);
      }
      if ((has(body.payRate) && flt(body.payRate) !== flt(target.payRate)) || (has(body.payType) && body.payType !== target.payType)) guardAccount(target, 'pay');
      if (has(body.name) && !String(body.name).trim()) err('Name is required', 400);
      // Branch: super managers / admins can put staff (managers too) in any branch.
      const nextRole = has(body.role) ? body.role : target.role;
      const scoped = !['admin', 'superManager'].includes(nextRole);
      let branchChange;   // undefined = leave as is
      if (has(body.branchId) && int(body.branchId) !== int(target.branchId)) {
        if (!['superManager', 'admin'].includes(user.role)) err('Only a super manager or admin can move staff to another branch.', 403);
        if (scoped) {
          const bChk = db.prepare('SELECT COUNT(*) AS c FROM branches WHERE id=?'); bChk.execute([int(body.branchId)]);
          if (!int(bChk.fetch().c)) err('That branch does not exist', 400);
          branchChange = int(body.branchId);
        }
      }
      if (!scoped) branchChange = null;                                   // super managers / admins are not tied to a branch
      else if (branchChange === undefined && !target.branchId) {
        // e.g. a super manager turned into a manager: they must get a branch
        if (has(body.branchId) && int(body.branchId)) branchChange = int(body.branchId);
        else if (bid) branchChange = int(bid);                            // the branch being worked in
        else err('Pick a branch for this ' + nextRole + '.', 400);
      }
      const clean = {};
      if (has(body.name)) clean.name = truncate(String(body.name).trim(), 200);
      if (has(body.role)) clean.role = body.role;
      if (has(body.payRate)) clean.payRate = Math.max(0, flt(body.payRate));
      if (has(body.payType)) clean.payType = ['hourly', 'daily', 'salary'].includes(body.payType) ? body.payType : 'hourly';
      const [sets, vals] = buildSet(clean, ['name', 'role', 'payRate', 'payType']);
      if (sets) db.prepare(`UPDATE users SET ${sets} WHERE id=?`).execute([...vals, uId]);
      if (branchChange !== undefined && branchChange !== (target.branchId ? int(target.branchId) : null)) {
        db.prepare('UPDATE users SET branchId=? WHERE id=?').execute([branchChange, uId]);
      }
      const f2 = db.prepare('SELECT id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword FROM users WHERE id=?');
      f2.execute([uId]);
      jsonOut(userRow(f2.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const f = db.prepare('SELECT * FROM users WHERE id=?'); f.execute([uId]);
      const target = userRow(f.fetch());
      if (!target) err('User not found', 404);
      guardAccount(target, 'delete');
      db.prepare('DELETE FROM users WHERE id=?').execute([uId]);
      jsonOut({ ok: true });
    }
  }

  // ── MY PROFILE (self-service, every role) ────────────────
  const meCols = 'id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword,approvalPinIndex';
  if (method === 'PUT' && uri === '/me') {
    const name = truncate(String(body.name || '').trim(), 200);
    if (!name) err('Name is required');
    db.prepare('UPDATE users SET name=? WHERE id=?').execute([name, user.id]);
    const f = db.prepare(`SELECT ${meCols} FROM users WHERE id=?`); f.execute([user.id]);
    jsonOut(userRow(f.fetch()));
  }
  if (method === 'POST' && uri === '/me/login-pin') {
    if ((user.authMethod || 'pin') !== 'pin') err('Your account uses password login — change your password instead.', 400);
    checkRateLimit('me-secret:' + user.id);
    const me = db.prepare('SELECT pin FROM users WHERE id=?'); me.execute([user.id]);
    if (!verifyPin(String(body.currentPin ?? '').trim(), (me.fetch() || {}).pin)) err('Your current PIN is not correct.', 400);
    const pinRaw = String(body.pin ?? '').trim();
    assertPinAvailable(db, pinRaw, user.id);
    db.prepare('UPDATE users SET pin=?, pin_index=? WHERE id=?').execute([hashPin(pinRaw), sha256hex(pinRaw), user.id]);
    jsonOut({ ok: true });
  }
  // Change my password (password accounts). An ADMIN who signs in with a PIN
  // can also switch to username + password here. Always needs the current
  // password / PIN, so an unattended logged-in till can't be used to take over.
  if (method === 'POST' && uri === '/me/password') {
    checkRateLimit('me-secret:' + user.id);
    const me = db.prepare('SELECT pin, passwordHash, authMethod, username FROM users WHERE id=?'); me.execute([user.id]);
    const row = me.fetch() || {};
    const usesPassword = (row.authMethod || 'pin') === 'password';
    const current = String(body.currentPassword ?? '');
    const next = String(body.newPassword ?? '');
    if (usesPassword) {
      if (!passwordVerify(current, row.passwordHash || '$scrypt$0$0')) err('Your current password is not correct.', 400);
    } else {
      if (user.role !== 'admin') err('Your account signs in with a PIN - change your PIN instead.', 400);
      if (!verifyPin(current.trim(), row.pin)) err('Your current PIN is not correct.', 400);
    }
    if (next.length < 8) err('The new password must be at least 8 characters.', 400);
    if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) err('Use both letters and numbers in the new password.', 400);
    if (usesPassword && passwordVerify(next, row.passwordHash || '$scrypt$0$0')) err('The new password must be different from the current one.', 400);
    if (!usesPassword) {
      const username = truncate(String(body.username || '').trim(), 100);
      if (username.length < 3) err('Choose a username (at least 3 characters).', 400);
      const t = db.prepare('SELECT id FROM users WHERE username=? AND id<>?'); t.execute([username, user.id]);
      if (t.fetch()) err('That username is already taken.', 400);
      db.prepare("UPDATE users SET authMethod='password', username=?, passwordHash=?, mustChangePassword=0, pin='____', pin_index=NULL WHERE id=?")
        .execute([username, passwordHash(next), user.id]);
      jsonOut({ ok: true, switched: true, username });
    }
    db.prepare('UPDATE users SET passwordHash=?, mustChangePassword=0 WHERE id=?').execute([passwordHash(next), user.id]);
    jsonOut({ ok: true });
  }

  // Admin: switch my own sign-in from username + password back to a PIN.
  // (PIN -> password is done through /me/password.) Needs the current password.
  if (method === 'POST' && uri === '/me/login-method') {
    requireRole(['admin'], user);
    checkRateLimit('me-secret:' + user.id);
    if (body.to !== 'pin') err('Unknown sign-in method', 400);
    const me = db.prepare('SELECT passwordHash, authMethod FROM users WHERE id=?'); me.execute([user.id]);
    const row = me.fetch() || {};
    if ((row.authMethod || 'pin') !== 'password') err('You already sign in with a PIN.', 400);
    if (!passwordVerify(String(body.currentPassword ?? ''), row.passwordHash || '$scrypt$0$0')) err('Your current password is not correct.', 400);
    const pinRaw = String(body.pin ?? '').trim();
    assertPinAvailable(db, pinRaw, user.id);
    db.prepare("UPDATE users SET authMethod='pin', pin=?, pin_index=?, username=NULL, passwordHash=NULL, mustChangePassword=0 WHERE id=?")
      .execute([hashPin(pinRaw), sha256hex(pinRaw), user.id]);
    jsonOut({ ok: true, switched: true });
  }

  if (method === 'POST' && uri === '/me/approval-pin') {
    requireRole(['manager', 'superManager', 'admin'], user);
    const pinRaw = String(body.approvalPin ?? '').trim();
    if (pinRaw === '') {
      db.prepare('UPDATE users SET approvalPin=NULL, approvalPinIndex=NULL WHERE id=?').execute([user.id]);
      jsonOut({ ok: true, hasApprovalPin: false });
    }
    // An approval PIN must differ from the user's own login PIN.
    const self = db.prepare('SELECT pin FROM users WHERE id=?'); self.execute([user.id]);
    const selfRow = self.fetch();
    if (selfRow && verifyPin(pinRaw, selfRow.pin)) err('Your approval PIN must be different from your login PIN.', 400);
    assertApprovalPinAvailable(db, pinRaw, user.id);
    db.prepare('UPDATE users SET approvalPin=?, approvalPinIndex=? WHERE id=?').execute([hashPin(pinRaw), sha256hex(pinRaw), user.id]);
    jsonOut({ ok: true, hasApprovalPin: true });
  }

  // ── ADMIN ────────────────────────────────────────────────
  if (method === 'GET' && uri === '/admin/users') {
    requireRole(['admin'], user);
    const rows = db.query('SELECT id,branchId,name,role,payRate,payType,authMethod,username,isHeld,mustChangePassword FROM users ORDER BY id').fetchAll();
    jsonOut(rows.map((r) => userRow(r)));
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/reset-pin', uri, params)) {
    requireRole(['admin', 'superManager', 'manager'], user);   // managers: only staff below them (requireManageTarget)
    const uid = int(params.id);
    const target = requireManageTarget(uid, 'reset');
    if ((target.authMethod || 'pin') === 'password') err('This user uses password login. Use Reset Password instead.', 400);
    const pinRaw = String(body.pin ?? '');
    assertPinAvailable(db, pinRaw, uid);
    db.prepare('UPDATE users SET pin=?, pin_index=? WHERE id=?').execute([hashPin(pinRaw), sha256hex(pinRaw), uid]);
    jsonOut({ ok: true, method: 'pin' });
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/reset-password', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    const uid = int(params.id);
    const target = requireManageTarget(uid, 'reset');
    const tempPassword = body.tempPassword || '';
    if (tempPassword.length < 6) err('Temporary password must be at least 6 characters');
    db.prepare('UPDATE users SET passwordHash=?, mustChangePassword=1 WHERE id=?').execute([passwordHash(tempPassword), uid]);
    jsonOut({ ok: true, method: 'password', name: target.name });
  }
  if (method === 'GET' && uri === '/admin/login-logs') {
    requireRole(['admin'], user);
    const limit = Math.min(int(query.limit || 100), 1000);
    const st = db.prepare('SELECT * FROM login_logs ORDER BY at DESC LIMIT ?'); st.execute([limit]);
    jsonOut(st.fetchAll());
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/hold', uri, params)) {
    requireRole(['admin', 'superManager', 'manager'], user);
    requireManageTarget(int(params.id), 'hold');
    db.prepare('UPDATE users SET isHeld=1 WHERE id=?').execute([int(params.id)]);
    jsonOut({ ok: true, held: true });
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/unhold', uri, params)) {
    requireRole(['admin', 'superManager', 'manager'], user);
    requireManageTarget(int(params.id), 'hold');
    db.prepare('UPDATE users SET isHeld=0 WHERE id=?').execute([int(params.id)]);
    jsonOut({ ok: true, held: false });
  }
  if (method === 'POST' && routeMatch('/admin/users/:id/set-auth', uri, params)) {
    requireRole(['admin', 'superManager'], user);
    const uid = int(params.id);
    requireManageTarget(uid, 'auth');
    const authMethod = body.authMethod || 'pin';
    if (authMethod === 'password') {
      const username = truncate(String(body.username || '').trim(), 100);
      const tempPass = body.tempPassword || '';
      if (!username) err('Username required for password auth');
      if (tempPass.length < 6) err('Temporary password must be at least 6 characters');
      const uq = db.prepare('SELECT id FROM users WHERE username=? AND id<>?'); uq.execute([username, uid]);
      if (uq.fetch()) err('That username is already taken.', 400);
      db.prepare("UPDATE users SET authMethod='password', username=?, passwordHash=?, mustChangePassword=1, pin='____', pin_index=NULL WHERE id=?")
        .execute([username, passwordHash(tempPass), uid]);
    } else {
      const pinRaw = String(body.pin ?? '').trim();
      assertPinAvailable(db, pinRaw, uid);   // 4-8 digits and not used by anyone else
      db.prepare("UPDATE users SET authMethod='pin', pin=?, pin_index=?, username=NULL, passwordHash=NULL, mustChangePassword=0 WHERE id=?")
        .execute([hashPin(pinRaw), sha256hex(pinRaw), uid]);
    }
    jsonOut({ ok: true });
  }

  // ── SHIFTS ───────────────────────────────────────────────
  if (method === 'GET' && routeMatch('/shifts/open/:userId', uri, params)) {
    const st = db.prepare('SELECT * FROM shifts WHERE userId=? AND clockOut IS NULL ORDER BY clockIn DESC LIMIT 1');
    st.execute([int(params.userId)]);
    const r = st.fetch();
    jsonOut(r ? shiftRow(r) : null);
  }
  if (method === 'POST' && uri === '/shifts/clockin') {
    const uid = int(body.userId ?? user.id);
    if (uid !== user.id && !['superManager', 'manager', 'admin'].includes(user.role)) err('Not authorized to clock in other users', 403);
    const f = db.prepare('SELECT * FROM users WHERE id=?'); f.execute([uid]);
    const u2 = userRow(f.fetch());
    if (!u2) err('User not found', 404);
    db.prepare('INSERT INTO shifts (branchId,userId,userName,clockIn) VALUES (?,?,?,?)').execute([u2.branchId || bid, uid, u2.name, nowStr()]);
    const f2 = db.prepare('SELECT * FROM shifts WHERE id=?'); f2.execute([db.lastInsertId()]);
    jsonOut(shiftRow(f2.fetch()), 201);
  }
  if (method === 'POST' && uri === '/shifts/clockout') {
    const uid = int(body.userId ?? user.id);
    if (uid !== user.id && !['superManager', 'manager', 'admin'].includes(user.role)) err('Not authorized to clock out other users', 403);
    const st = db.prepare('SELECT * FROM shifts WHERE userId=? AND clockOut IS NULL ORDER BY clockIn DESC LIMIT 1');
    st.execute([uid]);
    const s = st.fetch(); if (!s) err('No open shift', 404);
    db.prepare('UPDATE shifts SET clockOut=? WHERE id=?').execute([nowStr(), int(s.id)]);
    const f = db.prepare('SELECT * FROM shifts WHERE id=?'); f.execute([int(s.id)]);
    jsonOut(shiftRow(f.fetch()));
  }
  if (method === 'GET' && uri === '/shifts') {
    let st;
    if (has(query.userId)) {
      st = db.prepare('SELECT * FROM shifts WHERE userId=? ORDER BY clockIn DESC LIMIT 50'); st.execute([int(query.userId)]);
    } else {
      st = db.prepare('SELECT * FROM shifts WHERE branchId=? ORDER BY clockIn DESC'); st.execute([bid]);
    }
    jsonOut(st.fetchAll().map((r) => shiftRow(r)));
  }

  // ── KITCHEN TAG TEMPLATES ────────────────────────────────
  if (method === 'GET' && uri === '/kitchen-tag-templates') {
    jsonOut(['Running behind', 'Waiting on ingredient', 'Out of stock — substituting', 'Extra prep time needed', 'Equipment issue', 'Custom note']);
  }

  // ── MESSAGES ─────────────────────────────────────────────
  if (method === 'GET' && uri === '/messages/unread-count') {
    const uid = user.id;
    const st = db.prepare("SELECT * FROM messages WHERE parentId IS NULL AND (fromUserId=? OR toUserId=? OR (toRole=? AND branchId=?) OR (toRole='all' AND branchId=?))");
    st.execute([uid, uid, user.role, bid, bid]);
    let count = 0;
    for (const root of st.fetchAll()) {
      const rootId = int(root.id);
      // A thread is unread if someone ELSE wrote something you haven't read.
      const rs = db.prepare('SELECT readBy, fromUserId FROM messages WHERE id=? OR parentId=?'); rs.execute([rootId, rootId]);
      for (const m of rs.fetchAll()) { if (int(m.fromUserId) !== uid && !jsonDecode(m.readBy, []).includes(uid)) { count++; break; } }
    }
    jsonOut({ count });
  }
  if (method === 'GET' && uri === '/messages/threads') {
    const uid = user.id;
    const st = db.prepare("SELECT * FROM messages WHERE parentId IS NULL AND (fromUserId=? OR toUserId=? OR (toRole=? AND branchId=?) OR (toRole='all' AND branchId=?)) ORDER BY createdAt DESC");
    st.execute([uid, uid, user.role, bid, bid]);
    const threads = [];
    for (const root of st.fetchAll()) {
      const rootId = int(root.id);
      const replSt = db.prepare('SELECT * FROM messages WHERE parentId=? ORDER BY createdAt'); replSt.execute([rootId]);
      const replies = replSt.fetchAll();
      const all = [root, ...replies];
      const last = all[all.length - 1];
      let unread = false;
      for (const m of all) { if (!jsonDecode(m.readBy, []).includes(uid) && int(m.fromUserId) !== uid) { unread = true; break; } }
      const toLabel = root.toUserId ? root.toName : (root.toRole === 'all' ? 'Everyone' : `${root.toRole} (broadcast)`);
      threads.push({ threadId: rootId, to: toLabel, subject: String(root.body).substring(0, 60), lastMessage: last, messageCount: all.length, unread });
    }
    jsonOut(threads);
  }
  if (method === 'GET' && routeMatch('/messages/thread/:id', uri, params)) {
    const tid = int(params.id);
    const f = db.prepare('SELECT * FROM messages WHERE id=?'); f.execute([tid]);
    const root = f.fetch(); if (!root) err('Not found', 404);
    const replSt = db.prepare('SELECT * FROM messages WHERE parentId=? ORDER BY createdAt'); replSt.execute([tid]);
    const all = [root, ...replSt.fetchAll()];
    for (const m of all) {
      const rb = jsonDecode(m.readBy, []);
      if (!rb.includes(user.id)) { rb.push(user.id); db.prepare('UPDATE messages SET readBy=? WHERE id=?').execute([jsonEncode(rb), int(m.id)]); }
    }
    jsonOut(all);
  }
  if (method === 'POST' && uri === '/messages') {
    const parentId = body.parentId || null;
    if (!parentId) {
      requireRole(['manager', 'superManager'], user);
      const toUserId = body.toUserId || null;
      const toRole = body.toRole || null;
      let toName = '';
      if (toUserId) {
        const tuSt = db.prepare('SELECT * FROM users WHERE id=?'); tuSt.execute([int(toUserId)]);
        const tu = userRow(tuSt.fetch());
        toName = tu ? tu.name : '';
      }
      db.prepare('INSERT INTO messages (branchId,fromUserId,fromName,fromRole,toUserId,toName,toRole,body,readBy) VALUES (?,?,?,?,?,?,?,?,?)')
        .execute([bid, user.id, user.name, user.role, toUserId || null, toName, toRole || null, truncate(body.body || '', 5000), jsonEncode([user.id])]);
      const msgId = db.lastInsertId();
      if (toUserId) addNotification({ branchId: bid, type: 'message', message: `New message from ${user.name}`, targetUserId: int(toUserId), relatedId: msgId });
      else addNotification({ branchId: bid, type: 'message', message: `New message from ${user.name} (to ` + (toRole === 'all' ? 'everyone' : toRole) + ')', targetRole: toRole, relatedId: msgId });
      const f = db.prepare('SELECT * FROM messages WHERE id=?'); f.execute([msgId]);
      jsonOut(f.fetch(), 201);
    } else {
      const rootSt = db.prepare('SELECT * FROM messages WHERE id=?'); rootSt.execute([int(parentId)]);
      const root = rootSt.fetch(); if (!root) err('Thread not found', 404);
      const uid = user.id;
      const isParticipant = int(root.fromUserId) === uid || int(root.toUserId) === uid ||
        (root.toRole === user.role && int(root.branchId) === bid) || (root.toRole === 'all' && int(root.branchId) === bid);
      if (!isParticipant) err('Not a participant', 403);
      const toUid = uid === int(root.fromUserId) ? root.toUserId : root.fromUserId;
      const toName = uid === int(root.fromUserId) ? root.toName : root.fromName;
      db.prepare('INSERT INTO messages (branchId,parentId,fromUserId,fromName,fromRole,toUserId,toName,body,readBy) VALUES (?,?,?,?,?,?,?,?,?)')
        .execute([int(root.branchId), int(parentId), uid, user.name, user.role, toUid || null, toName || '', truncate(body.body || '', 5000), jsonEncode([uid])]);
      const msgId = db.lastInsertId();
      if (toUid) addNotification({ branchId: int(root.branchId), type: 'message', message: `${user.name} replied to a message`, targetUserId: int(toUid), relatedId: int(root.id) });
      const f = db.prepare('SELECT * FROM messages WHERE id=?'); f.execute([msgId]);
      jsonOut(f.fetch(), 201);
    }
  }

  // ── PAYROLL ──────────────────────────────────────────────
  if (method === 'GET' && uri === '/payroll/summary') {
    const bScope = user.role === 'superManager' ? null : bid;
    let sql = 'SELECT * FROM shifts WHERE clockOut IS NOT NULL';
    const args = [];
    if (bScope) { sql += ' AND branchId=?'; args.push(bScope); }
    if (has(query.from)) { sql += ' AND clockIn>=?'; args.push(query.from); }
    if (has(query.to)) { sql += ' AND clockIn<?'; args.push(query.to); }
    const st = db.prepare(sql); st.execute(args);
    const shifts = st.fetchAll();
    const byUser = {};
    for (const s of shifts) {
      const uid = int(s.userId);
      if (!byUser[uid]) byUser[uid] = { userId: uid, userName: s.userName, hours: 0 };
      byUser[uid].hours += (tsSeconds(s.clockOut) - tsSeconds(s.clockIn)) / 3600;
    }
    let users;
    if (bScope) { const uSt = db.prepare('SELECT * FROM users WHERE branchId=?'); uSt.execute([bScope]); users = uSt.fetchAll(); }
    else users = db.query('SELECT * FROM users').fetchAll();
    const rows = [];
    for (const uid in byUser) {
      const row = byUser[uid];
      const u = users.find((x) => int(x.id) === int(uid)) || null;
      const payRate = u ? flt(u.payRate) : 0;
      const payType = u ? (u.payType || 'hourly') : 'hourly';
      if (payType === 'daily') {
        const days = new Set(shifts.filter((s) => int(s.userId) === int(uid)).map((s) => todayStr(new Date(s.clockIn.replace(' ', 'T'))))).size;
        rows.push(Object.assign({}, row, { hours: round2(row.hours), days, payRate, payType: 'daily', amountDue: round2(days * payRate) }));
      } else {
        rows.push(Object.assign({}, row, { hours: round2(row.hours), payRate, payType: 'hourly', amountDue: round2(row.hours * payRate) }));
      }
    }
    jsonOut(rows);
  }

  // ── INGREDIENTS / INVENTORY ──────────────────────────────
  if (method === 'GET' && uri === '/ingredients') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => ingredientRow(r)));
  }
  if (method === 'POST' && uri === '/ingredients') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO ingredients (branchId,name,unit,qty,unitCost,lowStockThreshold) VALUES (?,?,?,?,?,?)')
      .execute([bid, truncate(body.name || '', 200), truncate(body.unit || 'pcs', 30), flt(body.qty || 0), flt(body.unitCost || 0), flt(body.lowStockThreshold || 0)]);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(ingredientRow(f.fetch()), 201);
  }
  if (routeMatch('/ingredients/:id/restock', uri, params)) {
    const iId = int(params.id);
    if (method === 'POST' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'finance'], user);
      const qty = flt(has(body.amount) ? body.amount : (body.qty || 0));
      if (qty <= 0) err('Amount must be greater than 0', 400);
      db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([qty, iId]);
      const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
      jsonOut(ingredientRow(f.fetch()));
    }
  }
  // ── WASTE / TRANSFER TRACKING ────────────────────────────
  // Record spoilage/loss: decrement stock (never below zero) and log it.
  if (method === 'POST' && uri === '/inventory/waste') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    const iId = int(body.ingredientId);
    const qty = round2(flt(body.qty || 0));
    if (qty <= 0) err('Quantity must be greater than 0', 400);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=? AND branchId=?'); f.execute([iId, bid]);
    const ing = f.fetch(); if (!ing) err('Ingredient not found', 404);
    db.prepare('UPDATE ingredients SET qty = MAX(0, qty - ?) WHERE id=?').execute([qty, iId]);
    db.prepare('INSERT INTO stock_movements (branchId,ingredientId,ingredientName,type,qty,unit,reason,byStaffName) VALUES (?,?,?,?,?,?,?,?)')
      .execute([bid, iId, ing.name, 'waste', qty, ing.unit || '', truncate(body.reason || '', 300), user.name]);
    const g = db.prepare('SELECT * FROM ingredients WHERE id=?'); g.execute([iId]);
    jsonOut(ingredientRow(g.fetch()));
  }
  // Transfer stock to another branch: decrement here, add there (matching by
  // name, creating the ingredient at the destination if needed). Two log rows.
  if (method === 'POST' && uri === '/inventory/transfer') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const iId = int(body.ingredientId);
    const qty = round2(flt(body.qty || 0));
    const toBranch = int(body.toBranchId);
    if (qty <= 0) err('Quantity must be greater than 0', 400);
    if (!toBranch || toBranch === bid) err('Choose a different destination branch', 400);
    const dchk = db.prepare('SELECT id,name FROM branches WHERE id=?'); dchk.execute([toBranch]);
    const dbr = dchk.fetch(); if (!dbr) err('Destination branch not found', 404);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=? AND branchId=?'); f.execute([iId, bid]);
    const ing = f.fetch(); if (!ing) err('Ingredient not found', 404);
    if (flt(ing.qty) < qty) err(`Only ${flt(ing.qty)} ${ing.unit || ''} in stock to transfer`, 400);
    db.prepare('UPDATE ingredients SET qty = MAX(0, qty - ?) WHERE id=?').execute([qty, iId]);
    // Find or create the matching ingredient at the destination.
    const dSt = db.prepare('SELECT * FROM ingredients WHERE branchId=? AND name=?'); dSt.execute([toBranch, ing.name]);
    let dIng = dSt.fetch();
    if (dIng) {
      db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([qty, int(dIng.id)]);
    } else {
      db.prepare('INSERT INTO ingredients (branchId,name,unit,qty,unitCost,lowStockThreshold) VALUES (?,?,?,?,?,?)')
        .execute([toBranch, ing.name, ing.unit || '', qty, flt(ing.unitCost || 0), flt(ing.lowStockThreshold || 0)]);
      dIng = { id: db.lastInsertId() };
    }
    const reason = truncate(body.reason || '', 300);
    db.prepare('INSERT INTO stock_movements (branchId,ingredientId,ingredientName,type,qty,unit,reason,counterpartyBranchId,byStaffName) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([bid, iId, ing.name, 'transfer_out', qty, ing.unit || '', reason, toBranch, user.name]);
    db.prepare('INSERT INTO stock_movements (branchId,ingredientId,ingredientName,type,qty,unit,reason,counterpartyBranchId,byStaffName) VALUES (?,?,?,?,?,?,?,?,?)')
      .execute([toBranch, int(dIng.id), ing.name, 'transfer_in', qty, ing.unit || '', reason, bid, user.name]);
    const g = db.prepare('SELECT * FROM ingredients WHERE id=?'); g.execute([iId]);
    jsonOut({ source: ingredientRow(g.fetch()), toBranch: dbr.name });
  }
  if (method === 'GET' && uri === '/inventory/movements') {
    requireRole(['superManager', 'manager', 'admin', 'finance'], user);
    if (!bid) jsonOut([]);
    const type = truncate(query.type || '', 20);
    let st;
    if (type) { st = db.prepare('SELECT * FROM stock_movements WHERE branchId=? AND type=? ORDER BY id DESC LIMIT 200'); st.execute([bid, type]); }
    else { st = db.prepare('SELECT * FROM stock_movements WHERE branchId=? ORDER BY id DESC LIMIT 200'); st.execute([bid]); }
    jsonOut(st.fetchAll().map((r) => ({
      id: int(r.id), ingredientId: int(r.ingredientId), ingredientName: r.ingredientName,
      type: r.type, qty: flt(r.qty), unit: r.unit, reason: r.reason,
      counterpartyBranchId: r.counterpartyBranchId ? int(r.counterpartyBranchId) : null,
      byStaffName: r.byStaffName, createdAt: r.createdAt,
    })));
  }
  if (routeMatch('/ingredients/:id', uri, params)) {
    const iId = int(params.id);
    if (method === 'PUT' || method === 'PATCH') {
      requireRole(['superManager', 'manager', 'admin'], user);
      const [sets, vals] = buildSet(body, ['name', 'unit', 'qty', 'unitCost', 'lowStockThreshold']);
      if (sets) db.prepare(`UPDATE ingredients SET ${sets} WHERE id=?`).execute([...vals, iId]);
      const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
      jsonOut(ingredientRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM ingredients WHERE id=?').execute([iId]);
      jsonOut({ ok: true });
    }
  }
  if (method === 'GET' && uri === '/inventory') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => ingredientRow(r)));
  }
  if (method === 'POST' && uri === '/inventory') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO ingredients (branchId,name,unit,qty,unitCost,lowStockThreshold,supplierId) VALUES (?,?,?,?,?,?,?)')
      .execute([bid, truncate(body.name || '', 200), truncate(body.unit || 'pcs', 30), flt(body.qty || 0), flt(body.unitCost || 0), flt(body.lowStockThreshold || 0), body.supplierId ? int(body.supplierId) : null]);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(ingredientRow(f.fetch()), 201);
  }
  if (routeMatch('/inventory/:id', uri, params)) {
    const iId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      const [sets, vals] = buildSet(body, ['name', 'unit', 'qty', 'unitCost', 'lowStockThreshold', 'supplierId']);
      if (sets) db.prepare(`UPDATE ingredients SET ${sets} WHERE id=?`).execute([...vals, iId]);
      const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
      jsonOut(ingredientRow(f.fetch()));
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM ingredients WHERE id=?').execute([iId]);
      jsonOut({ ok: true });
    }
  }
  if (method === 'POST' && routeMatch('/inventory/:id/adjust', uri, params)) {
    requireRole(['superManager', 'manager'], user);
    const iId = int(params.id);
    const delta = flt(body.delta || 0);
    db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([delta, iId]);
    const f = db.prepare('SELECT * FROM ingredients WHERE id=?'); f.execute([iId]);
    jsonOut(ingredientRow(f.fetch()));
  }

  // ── SUPPLIERS & PURCHASES ────────────────────────────────
  if (method === 'GET' && uri === '/suppliers') {
    const st = db.prepare('SELECT * FROM suppliers WHERE branchId=? ORDER BY name'); st.execute([bid]);
    jsonOut(st.fetchAll());
  }
  if (method === 'POST' && uri === '/suppliers') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO suppliers (branchId,name,contact,email,notes) VALUES (?,?,?,?,?)')
      .execute([bid, truncate(body.name || '', 200), truncate(body.contact || '', 200), truncate(body.email || '', 200), truncate(body.notes || '', 2000)]);
    const f = db.prepare('SELECT * FROM suppliers WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(f.fetch(), 201);
  }
  if (routeMatch('/suppliers/:id', uri, params)) {
    const sId = int(params.id);
    if (method === 'PUT') {
      requireRole(['superManager', 'manager'], user);
      const [sets, vals] = buildSet(body, ['name', 'contact', 'email', 'notes']);
      if (sets) db.prepare(`UPDATE suppliers SET ${sets} WHERE id=?`).execute([...vals, sId]);
      const f = db.prepare('SELECT * FROM suppliers WHERE id=?'); f.execute([sId]);
      jsonOut(f.fetch());
    }
    if (method === 'DELETE') {
      requireRole(['superManager', 'manager'], user);
      db.prepare('DELETE FROM suppliers WHERE id=?').execute([sId]);
      jsonOut({ ok: true });
    }
  }
  if (method === 'GET' && uri === '/purchases') {
    const st = db.prepare('SELECT * FROM purchases WHERE branchId=? ORDER BY createdAt DESC'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => {
      const items = jsonDecode(r.items || '[]', []);
      return Object.assign({}, r, {
        id: int(r.id), total: flt(r.total), items,
        ingredientName: (items[0] && items[0].name) ? items[0].name : '',
        qty: (items[0] && items[0].qty) ? flt(items[0].qty) : 0,
      });
    }));
  }

  // PUT /api/stock-auto-close — managers can toggle month-end auto close
  if (method === 'PUT' && uri === '/stock-auto-close') {
    requireRole(['superManager', 'manager', 'admin'], user);
    const on = body.autoStockClose ? 1 : 0;
    db.prepare('UPDATE settings SET autoStockClose=? WHERE id=1').execute([on]);
    getSettings(true);
    jsonOut({ ok: true, autoStockClose: !!on });
  }

  // ── STOCK PERIODS ────────────────────────────────────────
  if (method === 'GET' && uri === '/stock-periods') {
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM stock_periods WHERE branchId=? ORDER BY endDate DESC, id DESC'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, {
      id: int(r.id), branchId: int(r.branchId), lines: jsonDecode(r.lines, []),
      openingValue: flt(r.openingValue), purchaseValue: flt(r.purchaseValue),
      consumedValue: flt(r.consumedValue), closingValue: flt(r.closingValue),
    })));
  }
  if (method === 'GET' && uri === '/stock-periods/preview') {
    requireRole(['superManager', 'manager', 'finance', 'admin'], user);
    if (!bid) err('Pick a branch first', 400);
    const from = query.from || monthStart();
    const to = query.to || todayStr();
    const ings = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name'); ings.execute([bid]);
    const ingredients = ings.fetchAll().map((r) => ingredientRow(r));
    const openingMap = {};
    let prevRow = null;
    const prev = db.prepare('SELECT "lines" FROM stock_periods WHERE branchId=? AND endDate < ? ORDER BY endDate DESC, id DESC LIMIT 1');
    prev.execute([bid, from]); prevRow = prev.fetch();
    if (prevRow) for (const ln of jsonDecode(prevRow.lines, [])) openingMap[int(ln.ingredientId)] = flt(ln.closing || 0);
    const purchasedMap = {};
    const pSt = db.prepare('SELECT items FROM purchases WHERE branchId=? AND date(createdAt) BETWEEN ? AND ?');
    pSt.execute([bid, from, to]);
    for (const pr of pSt.fetchAll()) for (const it of jsonDecode(pr.items, [])) {
      const iid = int(it.ingredientId); if (!iid) continue;
      purchasedMap[iid] = (purchasedMap[iid] || 0) + flt(it.qty || 0);
    }
    const lines = ingredients.map((ing) => {
      const iid = ing.id;
      const opening = openingMap[iid] || 0.0;
      const purchased = purchasedMap[iid] || 0.0;
      const closing = ing.qty;
      const consumed = Math.max(0, opening + purchased - closing);
      return {
        ingredientId: iid, name: ing.name, unit: ing.unit, unitCost: ing.unitCost,
        opening: H.roundN(opening, 3), purchased: H.roundN(purchased, 3),
        consumed: H.roundN(consumed, 3), closing: H.roundN(closing, 3),
      };
    });
    jsonOut({ from, to, lines, hasPrevious: !!prevRow });
  }
  if (method === 'POST' && uri === '/stock-periods') {
    requireRole(['superManager', 'manager', 'admin'], user);
    if (!bid) err('Pick a branch first', 400);
    const label = truncate(body.label || '', 60);
    const from = body.from || monthStart();
    const to = body.to || todayStr();
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!label) err('Give the period a label (e.g. "July 2026")', 400);
    if (!lines.length) err('No stock lines to save', 400);
    let openingValue = 0, purchaseValue = 0, consumedValue = 0, closingValue = 0;
    const clean = [];
    for (const ln of lines) {
      const uc = flt(ln.unitCost || 0);
      const opening = flt(ln.opening || 0), purchased = flt(ln.purchased || 0), consumed = flt(ln.consumed || 0), closing = flt(ln.closing || 0);
      openingValue += opening * uc; purchaseValue += purchased * uc; consumedValue += consumed * uc; closingValue += closing * uc;
      clean.push({ ingredientId: int(ln.ingredientId), name: truncate(ln.name || '', 200), unit: truncate(ln.unit || '', 30), unitCost: uc, opening: H.roundN(opening, 3), purchased: H.roundN(purchased, 3), consumed: H.roundN(consumed, 3), closing: H.roundN(closing, 3) });
    }
    db.prepare(
      `INSERT INTO stock_periods (branchId,label,startDate,endDate,status,"lines",openingValue,purchaseValue,consumedValue,closingValue,closedByName,note)
       VALUES (?,?,?,?,'closed',?,?,?,?,?,?,?)`
    ).execute([bid, label, from, to, jsonEncode(clean), round2(openingValue), round2(purchaseValue), round2(consumedValue), round2(closingValue), user.name, truncate(body.note || '', 2000)]);
    const newId = db.lastInsertId();
    if (body.setStockToClosing) {
      for (const ln of clean) if (ln.ingredientId) db.prepare('UPDATE ingredients SET qty=? WHERE id=? AND branchId=?').execute([ln.closing, ln.ingredientId, bid]);
    }
    const f = db.prepare('SELECT * FROM stock_periods WHERE id=?'); f.execute([newId]);
    const row = f.fetch(); row.id = int(row.id); row.lines = jsonDecode(row.lines, []);
    jsonOut(row, 201);
  }
  if (method === 'PUT' && routeMatch('/stock-periods/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const pid = int(params.id);
    const chk = db.prepare('SELECT branchId FROM stock_periods WHERE id=?'); chk.execute([pid]);
    const row = chk.fetch();
    if (!row) err('Period not found', 404);
    if (user.role !== 'superManager' && int(row.branchId) !== int(bid)) err('Not your branch', 403);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) err('No stock lines', 400);
    let openingValue = 0, purchaseValue = 0, consumedValue = 0, closingValue = 0;
    const clean = [];
    for (const ln of lines) {
      const uc = flt(ln.unitCost || 0);
      const opening = flt(ln.opening || 0), purchased = flt(ln.purchased || 0), consumed = flt(ln.consumed || 0), closing = flt(ln.closing || 0);
      openingValue += opening * uc; purchaseValue += purchased * uc; consumedValue += consumed * uc; closingValue += closing * uc;
      clean.push({ ingredientId: int(ln.ingredientId), name: truncate(ln.name || '', 200), unit: truncate(ln.unit || '', 30), unitCost: uc, opening: H.roundN(opening, 3), purchased: H.roundN(purchased, 3), consumed: H.roundN(consumed, 3), closing: H.roundN(closing, 3) });
    }
    db.prepare('UPDATE stock_periods SET label=?, "lines"=?, openingValue=?, purchaseValue=?, consumedValue=?, closingValue=?, note=? WHERE id=?')
      .execute([truncate(body.label || '', 60), jsonEncode(clean), round2(openingValue), round2(purchaseValue), round2(consumedValue), round2(closingValue), truncate(body.note || '', 2000), pid]);
    const f = db.prepare('SELECT * FROM stock_periods WHERE id=?'); f.execute([pid]);
    const r = f.fetch(); r.id = int(r.id); r.lines = jsonDecode(r.lines, []);
    jsonOut(r);
  }
  if (method === 'DELETE' && routeMatch('/stock-periods/:id', uri, params)) {
    requireRole(['superManager', 'manager', 'admin'], user);
    const pid = int(params.id);
    db.prepare("DELETE FROM stock_periods WHERE id=? AND (branchId=? OR ?='superManager')").execute([pid, bid, user.role]);
    jsonOut({ ok: true });
  }
  if (method === 'POST' && uri === '/purchases') {
    requireRole(['superManager', 'manager', 'finance'], user);
    const ingredientId = body.ingredientId || null;
    const supplierId = body.supplierId || null;
    const qty = flt(body.qty || 0);
    const cost = flt(has(body.cost) ? body.cost : (body.total || 0));
    const note = truncate(body.note || '', 2000);
    let supplierName = '';
    if (supplierId) { const ss = db.prepare('SELECT name FROM suppliers WHERE id=?'); ss.execute([supplierId]); const sr = ss.fetch(); supplierName = sr ? sr.name : ''; }
    let items;
    if (ingredientId) {
      const is = db.prepare('SELECT name,unit FROM ingredients WHERE id=?'); is.execute([ingredientId]); const ir = is.fetch();
      items = [{ ingredientId: int(ingredientId), name: ir ? ir.name : '', qty, unit: ir ? ir.unit : '', cost }];
      db.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([qty, int(ingredientId)]);
    } else { items = body.items || []; }
    db.prepare('INSERT INTO purchases (branchId,supplierId,supplierName,items,total,note) VALUES (?,?,?,?,?,?)')
      .execute([bid, supplierId || null, supplierName, jsonEncode(items), cost, note]);
    const newId = db.lastInsertId();
    const f = db.prepare('SELECT * FROM purchases WHERE id=?'); f.execute([newId]);
    const row = f.fetch();
    const parsedItems = jsonDecode(row.items || '[]', []);
    row.ingredientName = (parsedItems[0] && parsedItems[0].name) ? parsedItems[0].name : '';
    row.supplierName = supplierName; row.qty = qty;
    jsonOut(row, 201);
  }

  // ── Z-REPORTS ────────────────────────────────────────────
  if (method === 'GET' && uri === '/zreports') {
    const st = db.prepare('SELECT * FROM z_reports WHERE branchId=? ORDER BY generatedAt DESC'); st.execute([bid]);
    jsonOut(st.fetchAll().map((r) => Object.assign({}, r, { grossSales: flt(r.grossSales), netSales: flt(r.netSales), paymentBreakdown: jsonDecode(r.paymentBreakdown) })));
  }
  if (method === 'POST' && uri === '/zreports') {
    requireRole(['superManager', 'manager'], user);
    let from = safeDate(body.fromDate || '');
    let to = safeDate(body.toDate || '');
    // A bare date means the whole day; the end is inclusive.
    if (from.length === 10) from += ' 00:00:00';
    if (to.length === 10) to += ' 23:59:59';
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND paidAt>=? AND paidAt<=?");
    st.execute([bid, from, to]);
    const orders = st.fetchAll().map((r) => orderRow(r));
    const vs = db.prepare('SELECT * FROM orders WHERE branchId=? AND void_data IS NOT NULL AND createdAt>=? AND createdAt<=?');
    vs.execute([bid, from, to]);
    const voided = vs.fetchAll().map((r) => orderRow(r));
    const gross = arrSum(arrColumn(orders, 'subtotal'));
    const disc = arrSum(orders.map((o) => (o.discount && o.discount.amount) || 0));
    const sc = arrSum(arrColumn(orders, 'serviceCharge'));
    const vat = arrSum(arrColumn(orders, 'vat'));
    const net = arrSum(arrColumn(orders, 'total'));
    const pb = { cash: 0, card: 0, online: 0, wallet: 0, giftcard: 0, loyalty: 0 };
    for (const o of orders) for (const p of o.payments) if (pb[p.method] !== undefined) pb[p.method] += flt(p.amount);
    for (const k of Object.keys(pb)) pb[k] = round2(pb[k]);
    const vt = arrSum(arrColumn(voided, 'total'));
    db.prepare('INSERT INTO z_reports (branchId,generatedBy,fromDate,toDate,orderCount,grossSales,totalDiscounts,totalServiceCharge,totalVat,netSales,paymentBreakdown,voidedCount,voidedTotal) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .execute([bid, user.name, from, to, orders.length, round2(gross), round2(disc), round2(sc), round2(vat), round2(net), jsonEncode(pb), voided.length, round2(vt)]);
    const f = db.prepare('SELECT * FROM z_reports WHERE id=?'); f.execute([db.lastInsertId()]);
    jsonOut(Object.assign({}, f.fetch(), { paymentBreakdown: pb }));
  }

  // ── PETTY CASH ───────────────────────────────────────────
  if (method === 'GET' && uri === '/petty-cash') {
    const st = db.prepare('SELECT * FROM petty_cash WHERE branchId=? ORDER BY createdAt DESC'); st.execute([bid]);
    const rows = st.fetchAll();
    let balance = 0;
    const entries = rows.map((r) => {
      const amt = flt(r.amount);
      balance += (r.type === 'in' ? amt : -amt);
      return {
        id: int(r.id), type: r.type, amount: amt,
        reason: r.description || '', description: r.description || '',
        recordedBy: r.staffName || '', staffName: r.staffName || '',
        createdAt: r.createdAt,
      };
    });
    jsonOut({ entries, balance: round2(balance) });
  }
  if (method === 'POST' && uri === '/petty-cash') {
    requireRole(['superManager', 'manager'], user);
    db.prepare('INSERT INTO petty_cash (branchId,type,amount,description,staffName) VALUES (?,?,?,?,?)')
      .execute([bid, body.type || 'out', flt(body.amount || 0), truncate(body.reason || body.description || '', 1000), user.name]);
    jsonOut({ ok: true }, 201);
  }

  // ── REPORTS / DASHBOARD ──────────────────────────────────
  if (method === 'GET' && uri === '/reports/summary') {
    const range = query.range || 'today';
    const now = todayStr();
    let from;
    switch (range) {
      case 'week': from = mondayThisWeek(); break;
      case 'all': from = '2000-01-01'; break;
      case 'month': from = monthStart(); break;
      default: from = now;
    }
    const st = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)>=?");
    st.execute([bid, from]);
    const orders = st.fetchAll().map((r) => orderRow(r));
    const revenue = round2(arrSum(orders.map((o) => o.grandTotal)));
    const count = orders.length;
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = dateAddDays(-i);
      const dayOrders = orders.filter((o) => o.paidAt && todayStr(new Date(String(o.paidAt).replace(' ', 'T'))) === d);
      trend.push(round2(arrSum(dayOrders.map((o) => o.grandTotal))));
    }
    const vs = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM orders WHERE branchId=? AND void_data IS NOT NULL AND date(createdAt)>=?');
    vs.execute([bid, from]);
    const v = vs.fetch();
    // Refunds in range. A refund is a negative payment and already removes the
    // sale from `revenue` (it nulls the order's paidAt), so we surface it as its
    // own figure rather than subtracting twice.
    const rfSt = db.prepare(`SELECT payments FROM orders WHERE branchId=? AND payments LIKE '%"type":"refund"%'`);
    rfSt.execute([bid]);
    let refunds = 0, refundCount = 0;
    for (const row of rfSt.fetchAll()) {
      for (const p of (jsonDecode(row.payments, []) || [])) {
        if (p.type !== 'refund') continue;
        const d = p.paidAt ? String(p.paidAt).slice(0, 10) : null;
        if (!d || d < from) continue;
        refunds += Math.abs(flt(p.amount || 0)); refundCount++;
      }
    }
    jsonOut({ revenue, orderCount: count, trend, voidedCount: int(v.c), voidedTotal: round2(flt(v.t)), refunds: round2(refunds), refundCount });
  }

  if (method === 'GET' && uri === '/dashboard/summary') {
    let bids = [];
    if (user.role === 'superManager') for (const b of db.query('SELECT id FROM branches').fetchAll()) bids.push(int(b.id));
    else bids = [bid];
    const now = todayStr();
    const summaries = [];
    let totalRevenue = 0, totalOrders = 0, totalKitchen = 0, totalRefunds = 0, totalRefundCount = 0;
    let totalOpenTables = 0, totalLowStock = 0;
    const methodKeys = ['cash', 'card', 'online', 'wallet', 'giftcard', 'loyalty'];
    const totalByMethod = {};
    for (const k of methodKeys) totalByMethod[k] = { gross: 0, fee: 0, net: 0 };
    for (const b of bids) {
      const bSt = db.prepare('SELECT * FROM branches WHERE id=?'); bSt.execute([b]);
      const binfo = bSt.fetch();
      const os = db.prepare("SELECT * FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)=?"); os.execute([b, now]);
      const orders = os.fetchAll().map((r) => orderRow(r));
      const rev = round2(arrSum(orders.map((o) => o.grandTotal)));
      const tblSt = db.prepare('SELECT * FROM tables_list WHERE branchId=?'); tblSt.execute([b]);
      const tables = tblSt.fetchAll();
      const activeTables = tables.filter((t) => t.status !== 'open').length;
      const kcSt = db.prepare("SELECT COUNT(*) as c FROM orders WHERE branchId=? AND status IN ('pending','preparing')"); kcSt.execute([b]);
      const kitchenCount = int(kcSt.fetch().c);
      const lsSt = db.prepare('SELECT COUNT(*) as c FROM ingredients WHERE branchId=? AND qty<=lowStockThreshold'); lsSt.execute([b]);
      const lowStock = int(lsSt.fetch().c);
      const bByMethod = {};
      for (const k of methodKeys) bByMethod[k] = { gross: 0, fee: 0, net: 0 };
      for (const o of orders) for (const p of o.payments) {
        const m = p.method || '';
        if (!bByMethod[m]) continue;
        const gross = flt(p.amount || 0); const fee = flt(p.feeAmount || 0);
        const net = has(p.netAmount) ? flt(p.netAmount) : gross - fee;
        bByMethod[m].gross += gross; bByMethod[m].fee += fee; bByMethod[m].net += net;
        totalByMethod[m].gross += gross; totalByMethod[m].fee += fee; totalByMethod[m].net += net;
      }
      for (const k in bByMethod) bByMethod[k] = { gross: round2(bByMethod[k].gross), fee: round2(bByMethod[k].fee), net: round2(bByMethod[k].net) };
      // Refunds issued today at this branch (refunded orders are excluded from
      // the paid-orders set above, so scan their payments directly).
      const rfSt = db.prepare(`SELECT payments FROM orders WHERE branchId=? AND payments LIKE '%"type":"refund"%'`); rfSt.execute([b]);
      let bRefunds = 0, bRefundCount = 0;
      for (const row of rfSt.fetchAll()) for (const p of (jsonDecode(row.payments, []) || [])) {
        if (p.type !== 'refund') continue;
        const d = p.paidAt ? String(p.paidAt).slice(0, 10) : null;
        if (d !== now) continue;
        bRefunds += Math.abs(flt(p.amount || 0)); bRefundCount++;
      }
      bRefunds = round2(bRefunds);
      totalRevenue += rev; totalOrders += orders.length; totalKitchen += kitchenCount;
      totalRefunds += bRefunds; totalRefundCount += bRefundCount;
      totalOpenTables += activeTables; totalLowStock += lowStock;
      summaries.push(Object.assign({}, binfo || {}, { branchId: b, branchName: (binfo && binfo.name) || ('Branch ' + b), revenueToday: rev, refundsToday: bRefunds, refundCount: bRefundCount, openTables: activeTables, inKitchen: kitchenCount, lowStockCount: lowStock, byMethod: bByMethod }));
    }
    for (const k in totalByMethod) totalByMethod[k] = { gross: round2(totalByMethod[k].gross), fee: round2(totalByMethod[k].fee), net: round2(totalByMethod[k].net) };
    jsonOut({
      branches: summaries,
      totals: {
        totalRevenue: round2(totalRevenue), totalOrders, totalBranches: bids.length, totalKitchen,
        totalRefunds: round2(totalRefunds), refundCount: totalRefundCount,
        totalOpenTables, totalLowStock,
        byMethod: totalByMethod,
        totalCardFees: round2(arrSum(Object.values(totalByMethod).map((v) => v.fee))),
        netRevenue: round2(arrSum(Object.values(totalByMethod).map((v) => v.net))),
      },
    });
  }

  // ── SETTINGS BACKUP & RESET ──────────────────────────────
  if (method === 'GET' && uri === '/settings/health') {
    requireRole(['admin', 'superManager', 'manager'], user);
    const checks = [];
    const dupCount = int(db.query(
      `SELECT COUNT(*) AS c FROM (
        SELECT pin_index FROM users
        WHERE pin_index IS NOT NULL AND pin_index <> ''
          AND (authMethod IS NULL OR authMethod = '' OR authMethod = 'pin')
        GROUP BY pin_index HAVING COUNT(*) > 1) d`
    ).fetch().c || 0);
    checks.push({ level: dupCount ? 'bad' : 'ok', msg: dupCount ? `${dupCount} duplicate PIN(s) — fix in Users` : 'No duplicate PINs' });
    const orphan = int(db.query("SELECT COUNT(*) AS c FROM users WHERE role NOT IN ('admin','superManager') AND (branchId IS NULL OR branchId = 0)").fetch().c || 0);
    checks.push({ level: orphan ? 'warn' : 'ok', msg: orphan ? `${orphan} staff with no branch assigned` : 'All staff have a branch' });
    const noStation = int(db.query('SELECT COUNT(*) AS c FROM menu_items WHERE stationId IS NULL OR stationId = 0').fetch().c || 0);
    checks.push({ level: noStation ? 'warn' : 'ok', msg: noStation ? `${noStation} menu item(s) with no station — won't route to a KOT printer` : 'All menu items have a station' });
    const noCost = int(db.query('SELECT COUNT(*) AS c FROM ingredients WHERE unitCost IS NULL OR unitCost <= 0').fetch().c || 0);
    checks.push({ level: noCost ? 'warn' : 'ok', msg: noCost ? `${noCost} ingredient(s) have no unit cost — stock value understated` : 'All ingredients have a unit cost' });
    const s = getSettings();
    {
      const lan = lanAddresses();
      if (!s.publicBaseUrl) checks.push({ level: 'warn', msg: 'Table QR address not set — Settings → Online ordering & QR → "Use this computer\'s address"' });
      else if (qrIpMismatch(s.publicBaseUrl, lan)) checks.push({ level: 'bad', msg: `Table QR codes point to ${s.publicBaseUrl} but this computer is now ${lan[0] || 'offline'} — QR ordering will not work. Reserve the IP in the router (see guide) or update the address.` });
      else if (/^https:\/\/[a-z]/i.test(s.publicBaseUrl)) checks.push({ level: 'ok', msg: `Table QR codes use the online address ${s.publicBaseUrl} (Wi-Fi and mobile data)` });
      else checks.push({ level: 'ok', msg: `Table QR codes point to this computer (${s.publicBaseUrl})` });
    }
    // Newest backup = the newest file in the backups folder (daily ones are automatic).
    let newest = 0;
    try {
      const { BACKUP_DIR } = require('./backup'); const fs = require('fs'), path = require('path');
      for (const f of fs.readdirSync(BACKUP_DIR)) if (/\.db$/.test(f)) newest = Math.max(newest, fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs);
    } catch (_) {}
    if (newest) {
      const days = Math.floor((Date.now() - newest) / 86400000);
      checks.push({ level: days > 2 ? 'warn' : 'ok', msg: days > 2 ? `Last backup was ${days} day(s) ago — press Back up now` : days === 0 ? 'Backed up today' : `Last backup ${days} day(s) ago` });
    } else {
      checks.push({ level: 'warn', msg: 'No backup yet — press Back up now' });
    }
    jsonOut({ checks });
  }
  if (method === 'GET' && uri === '/settings/export') {
    requireRole(['admin', 'superManager'], user);
    const tables = [
      'branches', 'users', 'settings', 'stations', 'categories', 'menu_items',
      'tables_list', 'ingredients', 'suppliers', 'purchases', 'stock_periods',
      'orders', 'held_orders', 'customers', 'shifts', 'z_reports', 'petty_cash',
      'permissions', 'order_sequences', 'messages', 'notifications',
    ];
    const dump = {};
    for (const t of tables) {
      try { dump[t] = db.query(`SELECT * FROM \`${t}\``).fetchAll(); }
      catch (e) { dump[t] = [{ _error: 'table not found or unreadable' }]; }
    }
    try { db.exec(`UPDATE settings SET lastBackupAt='${nowStr()}' WHERE id=1`); } catch (e) {}
    getSettings(true);
    jsonOut({ exportedAt: isoNow(), exportedBy: user.name, schemaVersion: 'pos-php-1', tables: dump });
  }
  // POST /api/settings/import — restore a downloaded JSON backup (destructive).
  if (method === 'POST' && uri === '/settings/import') {
    requireRole(['admin'], user);
    const tables = body && body.tables;
    if (!tables || typeof tables !== 'object') err('Invalid backup file — no "tables" section found.', 400);
    if (!body.confirm) err('Confirmation required to overwrite current data.', 400);
    const tableOrder = [
      'branches', 'users', 'settings', 'stations', 'categories', 'menu_items',
      'tables_list', 'ingredients', 'suppliers', 'purchases', 'stock_periods',
      'orders', 'held_orders', 'customers', 'shifts', 'z_reports', 'petty_cash',
      'permissions', 'order_sequences', 'messages', 'notifications',
    ];
    let restored = 0, rowsIn = 0;
    db.exec('PRAGMA foreign_keys=OFF');
    db.beginTransaction();
    try {
      for (const t of tableOrder) {
        const rows = tables[t];
        if (!Array.isArray(rows)) continue;
        db.exec(`DELETE FROM \`${t}\``);
        for (const row of rows) {
          if (!row || typeof row !== 'object' || row._error) continue;
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const sql = `INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
          const vals = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return null;
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (typeof v === 'object') return JSON.stringify(v);
            return v;
          });
          try { db.prepare(sql).execute(vals); rowsIn++; } catch (e) { /* skip incompatible row */ }
        }
        restored++;
      }
      db.commit();
    } catch (e) {
      db.rollBack();
      db.exec('PRAGMA foreign_keys=ON');
      if (e instanceof Resp) throw e;
      err('Restore failed: ' + e.message, 500);
    }
    db.exec('PRAGMA foreign_keys=ON');
    getSettings(true);
    jsonOut({ ok: true, tablesRestored: restored, rowsRestored: rowsIn });
  }

  if (method === 'POST' && uri === '/settings/backup') {
    requireRole(['admin', 'superManager'], user);
    // A real, consistent copy of the database (SQLite VACUUM INTO).
    let file = null;
    try { file = require('./backup').backupNow('manual-' + new Date().toISOString().slice(11, 19).replace(/:/g, '')); }
    catch (e) { err('Backup failed: ' + e.message, 500); }
    db.prepare('UPDATE settings SET lastBackupAt=? WHERE id=1').execute([nowStr()]);
    jsonOut({ ok: true, path: file, file: file ? require('path').basename(file) : null, settings: getSettings(true) });
  }

  // ── Restore a backup (admin only) ──
  // What's inside a backup, so the admin can pick the right one.
  if (method === 'GET' && uri === '/admin/backups/inspect') {
    requireRole(['admin'], user);
    const B = require('./backup');
    try { jsonOut({ name: String(query.name || ''), ...B.inspectBackup(B.backupPath(query.name)) }); }
    catch (e) { if (e instanceof Resp) throw e; err(e.message, 400); }
  }
  if (method === 'POST' && uri === '/admin/backups/restore') {
    requireRole(['admin'], user);
    if (!body.confirm) err('Confirmation required.', 400);
    const B = require('./backup');
    let r;
    try { r = B.scheduleRestore(String(body.name || '')); }
    catch (e) { if (e instanceof Resp) throw e; err(e.message, 400); }
    console.log(`[restore] ${user.name} asked to restore ${body.name}; restarting backend…`);
    // Respond first, then restart; the supervisor brings the backend back with the restored file.
    setTimeout(() => process.exit(0), 700);
    jsonOut({ ok: true, restarting: true, safety: r.safety });
  }
  // Upload a .db backup (from a USB stick / the mirror folder) into the backups list.
  if (method === 'POST' && uri === '/admin/backups/upload') {
    requireRole(['admin'], user);
    const b64 = String(body.dataBase64 || '').replace(/^data:[^,]*,/, '');
    if (!b64) err('No file received.', 400);
    let name;
    try { name = require('./backup').saveUploadedBackup(Buffer.from(b64, 'base64')); }
    catch (e) { if (e instanceof Resp) throw e; err(e.message, 400); }
    jsonOut({ ok: true, name });
  }


  // ── STORAGE: where the data and the backups are kept (admin only) ──
  if (method === 'GET' && uri === '/admin/storage') {
    requireRole(['admin'], user);
    const SC = require('./storage-config'), fs = require('fs');
    const { DB_FILE } = require('./db');
    const sz = (f) => { try { return fs.statSync(f).size; } catch (_) { return 0; } };
    const dd = SC.dataDir(), bd = SC.backupDir();
    const dc = SC.checkFolder(dd), bc = SC.checkFolder(bd);
    let count = 0; try { count = fs.readdirSync(bd).filter((f) => /\.db$/.test(f)).length; } catch (_) {}
    jsonOut({
      dataDir: dd, backupDir: bd, defaultDataDir: SC.defaultDataDir(), defaultBackupDir: SC.defaultBackupDir(),
      envLocked: SC.envLocked(), dbFile: DB_FILE, dbBytes: sz(DB_FILE) + sz(DB_FILE + '-wal'),
      dataBytes: SC.dirSize(dd), backupBytes: SC.dirSize(bd), backupCount: count,
      dataDrive: { root: dc.root, freeBytes: dc.freeBytes, totalBytes: dc.totalBytes, writable: dc.ok },
      backupDrive: { root: bc.root, freeBytes: bc.freeBytes, totalBytes: bc.totalBytes, writable: bc.ok },
      pendingMove: SC.pendingMove(), lastMove: SC.lastMoveResult(), backupTime: SC.backupTime(),
    });
  }
  // Daily automatic backup time (HH:MM, 24-hour).
  if (method === 'POST' && uri === '/admin/storage/backup-time') {
    requireRole(['admin'], user);
    const t = String(body.time || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) err('Backup time must be HH:MM (24-hour), e.g. 23:59', 400);
    require('./storage-config').setBackupTime(t);
    console.log(`[storage] ${user.name} set the daily backup time to ${t}`);
    jsonOut({ ok: true, backupTime: t });
  }
  // Is this folder usable, and is there enough room on its drive?
  if (method === 'POST' && uri === '/admin/storage/check') {
    requireRole(['admin'], user);
    const SC = require('./storage-config'), fs = require('fs'), path = require('path');
    const kind = body.kind === 'backup' ? 'backup' : 'data';
    const r = SC.checkFolder(body.path);
    const { DB_FILE } = require('./db');
    const sz = (f) => { try { return fs.statSync(f).size; } catch (_) { return 0; } };
    const dbBytes = sz(DB_FILE) + sz(DB_FILE + '-wal');
    const cur = kind === 'data' ? SC.dataDir() : SC.backupDir();
    r.requiredBytes = kind === 'data' ? Math.round(SC.dirSize(SC.dataDir()) * 1.5 + 200 * 1048576) : Math.round(SC.dirSize(SC.backupDir()) + dbBytes * 3 + 100 * 1048576);
    r.problem = '';
    if (!r.ok) r.problem = r.error;
    else if (path.resolve(r.path).toLowerCase() === path.resolve(cur).toLowerCase()) r.problem = 'That is the folder already in use.';
    else if (kind === 'data' && path.resolve(r.path).toLowerCase().startsWith(path.resolve(cur).toLowerCase() + path.sep)) r.problem = 'Choose a folder outside the current data folder.';
    else if (kind === 'data' && fs.existsSync(path.join(r.path, 'pos.db'))) r.problem = 'That folder already contains a pos.db. Choose an empty folder.';
    else if (r.freeBytes < r.requiredBytes) r.problem = 'Not enough free space on that drive.';
    r.usable = !r.problem;
    jsonOut(r);
  }
  // Change (or reset) the backup folder. Takes effect immediately, no restart.
  if (method === 'POST' && uri === '/admin/storage/backup-dir') {
    requireRole(['admin'], user);
    if (!body.confirm) err('Confirmation required.', 400);
    const SC = require('./storage-config'), B = require('./backup'), fs = require('fs'), path = require('path');
    const oldDir = SC.backupDir();
    const wanted = String(body.path || '').trim();
    let newDir = null;
    if (wanted) {
      const r = SC.checkFolder(wanted);
      if (!r.ok) err(r.error, 400);
      newDir = r.path;
      if (path.resolve(newDir).toLowerCase() === path.resolve(oldDir).toLowerCase()) err('That is the folder already in use.', 400);
      const need = SC.dirSize(oldDir) + 100 * 1048576;
      if (r.freeBytes < need) err('Not enough free space on that drive for the existing backups.', 400);
    }
    const targetDir = newDir || SC.defaultBackupDir();
    let copied = 0;
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      for (const f of (fs.existsSync(oldDir) ? fs.readdirSync(oldDir) : [])) {
        if (!/^[A-Za-z0-9._-]+\.db$/.test(f)) continue;
        const to = path.join(targetDir, f);
        if (!fs.existsSync(to)) { fs.copyFileSync(path.join(oldDir, f), to); copied++; }
      }
    } catch (e) { err('Could not copy the existing backups: ' + e.message, 500); }
    SC.setBackupDir(newDir);
    let file = null;
    try { file = B.backupNow('location-check'); }
    catch (e) { SC.setBackupDir(path.resolve(oldDir) === path.resolve(SC.defaultBackupDir()) ? null : oldDir); err('A test backup to the new folder failed, so nothing was changed: ' + e.message, 500); }
    db.prepare('UPDATE settings SET lastBackupAt=? WHERE id=1').execute([nowStr()]);
    console.log(`[storage] ${user.name} changed the backup folder: ${oldDir} -> ${targetDir}`);
    jsonOut({ ok: true, backupDir: SC.backupDir(), copied, testBackup: file ? path.basename(file) : null });
  }
  // Move the whole data folder. Done at the next start-up, old copy is kept.
  if (method === 'POST' && uri === '/admin/storage/data-dir') {
    requireRole(['admin'], user);
    if (!body.confirm) err('Confirmation required.', 400);
    const SC = require('./storage-config'), B = require('./backup'), fs = require('fs'), path = require('path');
    if (SC.envLocked()) err('The data folder is fixed by the POS_DATA_DIR setting on this computer and cannot be changed here.', 400);
    const r = SC.checkFolder(body.path);
    if (!r.ok) err(r.error, 400);
    const cur = SC.dataDir();
    if (path.resolve(r.path).toLowerCase() === path.resolve(cur).toLowerCase()) err('That is the folder already in use.', 400);
    if (path.resolve(r.path).toLowerCase().startsWith(path.resolve(cur).toLowerCase() + path.sep)) err('Choose a folder outside the current data folder.', 400);
    if (fs.existsSync(path.join(r.path, 'pos.db'))) err('That folder already contains a pos.db. Choose an empty folder.', 400);
    const need = Math.round(SC.dirSize(cur) * 1.5 + 200 * 1048576);
    if (r.freeBytes < need) err('Not enough free space on that drive.', 400);
    try { fs.mkdirSync(r.path, { recursive: true }); } catch (e) { err('Could not create that folder: ' + e.message, 400); }
    let safety = null;
    try { safety = B.backupNow('before-move-' + new Date().toISOString().slice(11, 19).replace(/:/g, '')); }
    catch (e) { err('Could not take the safety backup, so nothing was changed: ' + e.message, 500); }
    SC.requestDataMove(r.path);
    console.log(`[storage] ${user.name} asked to move the data folder to ${r.path}; restarting backend…`);
    setTimeout(() => process.exit(0), 700);
    jsonOut({ ok: true, restarting: true, safety: safety ? path.basename(safety) : null });
  }
  if (method === 'POST' && uri === '/admin/storage/cancel-move') {
    requireRole(['admin'], user);
    require('./storage-config').cancelDataMove();
    jsonOut({ ok: true });
  }

  // System status for the Admin page (cards, not raw data).
  if (method === 'GET' && uri === '/admin/system-info') {
    requireRole(['admin', 'superManager'], user);
    const fs = require('fs'), path = require('path');
    const { DB_FILE } = require('./db');
    const { BACKUP_DIR } = require('./backup');
    const size = (f) => { try { return fs.statSync(f).size; } catch (_) { return 0; } };
    let backups = [];
    try {
      backups = fs.readdirSync(BACKUP_DIR).filter((f) => /\.db$/.test(f))
        .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, at: st.mtime.toISOString() }; })
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
    } catch (_) {}
    const cnt = (sql, args = []) => { try { const st = db.prepare(sql); st.execute(args); return int(st.fetchColumn()) || 0; } catch (_) { return 0; } };
    const today = nowStr().slice(0, 10);
    jsonOut({
      dbSize: size(DB_FILE) + size(DB_FILE + '-wal'),
      dbFile: DB_FILE,
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      backups,
      lastBackupAt: getSettings().lastBackupAt || (backups[0] ? backups[0].at : null),
      counts: {
        users: cnt('SELECT COUNT(*) FROM users'),
        menuItems: cnt('SELECT COUNT(*) FROM menu_items'),
        ordersToday: cnt('SELECT COUNT(*) FROM orders WHERE substr(createdAt,1,10)=?', [today]),
        ordersTotal: cnt('SELECT COUNT(*) FROM orders'),
        openOrders: cnt("SELECT COUNT(*) FROM orders WHERE paymentStatus!='paid' AND status!='voided'"),
        tables: cnt('SELECT COUNT(*) FROM tables_list'),
      },
    });
  }
  if (method === 'POST' && uri === '/settings/reset-test-data') {
    requireRole(['admin'], user);
    db.exec('DELETE FROM orders');
    db.exec("UPDATE tables_list SET status='open'");
    db.exec('DELETE FROM shifts');
    db.exec('DELETE FROM notifications');
    db.exec('DELETE FROM held_orders');
    jsonOut({ ok: true });
  }

  // ── ORDER SEQUENCE ───────────────────────────────────────
  if (method === 'GET' && uri === '/order-sequence') {
    requireRole(['superManager', 'manager'], user);
    if (!bid) jsonOut([]);
    const st = db.prepare('SELECT * FROM order_sequences WHERE branchId=?'); st.execute([bid]);
    let seq = st.fetch();
    if (!seq) {
      db.prepare('INSERT INTO order_sequences (branchId, currentNum) VALUES (?,0)').execute([bid]);
      seq = { branchId: bid, currentNum: 0, lastResetAt: null, lastResetNum: 0 };
    }
    jsonOut(seq);
  }
  if (method === 'POST' && uri === '/order-sequence/reset') {
    requireRole(['superManager', 'manager'], user);
    if (!bid) err('Branch required');
    const st = db.prepare('SELECT currentNum FROM order_sequences WHERE branchId=?'); st.execute([bid]);
    const seq = st.fetch();
    const lastNum = seq ? int(seq.currentNum) : 0;
    db.prepare(
      `INSERT INTO order_sequences (branchId,currentNum,lastResetAt,lastResetNum) VALUES (?,0,?,?)
       ON CONFLICT(branchId) DO UPDATE SET currentNum=0, lastResetAt=excluded.lastResetAt, lastResetNum=excluded.lastResetNum`
    ).execute([bid, nowStr(), lastNum]);
    jsonOut({ ok: true, resetFrom: lastNum, at: isoNow() });
  }

  // ── ANALYTICS ────────────────────────────────────────────
  if (method === 'GET' && uri === '/analytics/items') {
    const from = query.from || dateAddDays(-30);
    const to = query.to || dateAddDays(1);
    const stationId = has(query.stationId) ? int(query.stationId) : null;
    const bFilter = user.role === 'superManager' ? (has(query.branchId) ? int(query.branchId) : null) : bid;
    const timeFrom = query.timeFrom || null;
    const timeTo = query.timeTo || null;
    let sql = "SELECT * FROM orders WHERE paymentStatus='paid' AND date(paidAt) BETWEEN ? AND ?";
    const args = [from, to];
    if (bFilter) { sql += ' AND branchId=?'; args.push(bFilter); }
    if (timeFrom) { sql += ' AND time(createdAt) >= ?'; args.push(timeFrom); }
    if (timeTo) { sql += ' AND time(createdAt) <= ?'; args.push(timeTo); }
    const st = db.prepare(sql); st.execute(args);
    const orders = st.fetchAll();
    const itemStats = {};
    for (const o of orders) {
      for (const item of jsonDecode(o.items, [])) {
        if (stationId && int(item.stationId || 0) !== stationId) continue;
        const key = item.menuItemId || 0;
        if (!itemStats[key]) itemStats[key] = { menuItemId: key, name: item.name, stationId: item.stationId || null, stationName: item.stationName || '', totalQty: 0, totalRevenue: 0, prepTimes: [] };
        itemStats[key].totalQty += int(item.qty);
        itemStats[key].totalRevenue += flt(item.lineTotal || 0);
        if (item.readyAt && o.createdAt) {
          const prepSecs = tsSeconds(item.readyAt) - tsSeconds(o.createdAt);
          if (prepSecs > 0 && prepSecs < 7200) itemStats[key].prepTimes.push(prepSecs);
        }
      }
    }
    const result = Object.values(itemStats).map((s) => {
      const avg = s.prepTimes.length ? Math.round(arrSum(s.prepTimes) / s.prepTimes.length / 60 * 10) / 10 : null;
      delete s.prepTimes;
      s.avgPrepMinutes = avg; s.totalRevenue = round2(s.totalRevenue);
      return s;
    });
    result.sort((a, b) => b.totalQty - a.totalQty);
    jsonOut({ items: result, from, to, totalOrders: orders.length });
  }

  // ── ADVANCED REPORTS ─────────────────────────────────────
  if (method === 'GET' && uri === '/reports/advanced') {
    const from = query.from || dateAddDays(-30);
    const to = query.to || dateAddDays(1);
    const bFilter = user.role === 'superManager' ? (has(query.branchId) ? int(query.branchId) : null) : bid;
    let sql = "SELECT * FROM orders WHERE date(paidAt) BETWEEN ? AND ? AND paymentStatus='paid'";
    const args = [from, to];
    if (bFilter) { sql += ' AND branchId=?'; args.push(bFilter); }
    const st = db.prepare(sql); st.execute(args);
    const orders = st.fetchAll().map((r) => orderRow(r));
    const totalRevenue = round2(arrSum(orders.map((o) => o.grandTotal)));
    const totalOrders = orders.length;
    const totalTips = round2(arrSum(arrColumn(orders, 'tipAmount')));
    const totalDiscount = round2(arrSum(orders.map((o) => (o.discount && o.discount.amount) || 0)));
    const methodKeys = ['cash', 'card', 'online', 'wallet', 'giftcard', 'loyalty'];
    const byMethod = {}; methodKeys.forEach((k) => byMethod[k] = 0);
    const methodStats = {};
    for (const k of methodKeys) methodStats[k] = { method: k, gross: 0, fee: 0, net: 0, count: 0 };
    for (const o of orders) for (const p of o.payments) {
      const m = p.method || '';
      if (!methodStats[m]) continue;
      const gross = flt(p.amount || 0); const fee = flt(p.feeAmount || 0);
      const net = has(p.netAmount) ? flt(p.netAmount) : gross - fee;
      byMethod[m] += gross; methodStats[m].gross += gross; methodStats[m].fee += fee; methodStats[m].net += net; methodStats[m].count++;
    }
    for (const k in methodStats) { methodStats[k].gross = round2(methodStats[k].gross); methodStats[k].fee = round2(methodStats[k].fee); methodStats[k].net = round2(methodStats[k].net); }
    for (const k in byMethod) byMethod[k] = round2(byMethod[k]);
    const totalFees = round2(arrSum(Object.values(methodStats).map((v) => v.fee)));
    const totalNet = round2(arrSum(Object.values(methodStats).map((v) => v.net)));
    let itemBreakdown = {};
    for (const o of orders) for (const item of o.items) {
      const k = item.menuItemId || 0;
      if (!itemBreakdown[k]) itemBreakdown[k] = { name: item.name, qty: 0, revenue: 0 };
      itemBreakdown[k].qty += int(item.qty); itemBreakdown[k].revenue += flt(item.lineTotal || 0);
    }
    itemBreakdown = Object.values(itemBreakdown).sort((a, b) => b.qty - a.qty);
    const grossSales = round2(arrSum(orders.map((o) => o.subtotal || 0)));
    const netSales = round2(totalNet);
    const avgOrder = totalOrders > 0 ? round2(totalRevenue / totalOrders) : 0;
    // Sales split by order type, derived from paid orders in the selected period.
    const orderTypeMap = {};
    for (const o of orders) {
      const type = String(o.orderType || 'unknown').toLowerCase();
      if (!orderTypeMap[type]) orderTypeMap[type] = { orderType: type, orders: 0, revenue: 0 };
      orderTypeMap[type].orders++; orderTypeMap[type].revenue += flt(o.grandTotal || 0);
    }
    const salesByOrderType = Object.values(orderTypeMap).map((x) => ({ ...x, revenue: round2(x.revenue) })).sort((a, b) => b.revenue - a.revenue);
    const salesByEmployeeMap = {};
    for (const o of orders) {
      const key = String(o.staffId || 'unassigned');
      if (!salesByEmployeeMap[key]) salesByEmployeeMap[key] = { staffId: o.staffId || null, staffName: o.staffName || 'Unassigned', orders: 0, revenue: 0 };
      salesByEmployeeMap[key].orders++; salesByEmployeeMap[key].revenue += flt(o.grandTotal || 0);
    }
    const salesByEmployee = Object.values(salesByEmployeeMap).map((x) => ({ ...x, revenue: round2(x.revenue) })).sort((a, b) => b.revenue - a.revenue);
    const catMap = {}; const mIds = {};
    for (const o of orders) for (const it of o.items) if (it.menuItemId) mIds[int(it.menuItemId)] = true;
    if (Object.keys(mIds).length) {
      const idList = Object.keys(mIds);
      const cst = db.prepare(`SELECT id, category FROM menu_items WHERE id IN (${idList.map(() => '?').join(',')})`);
      cst.execute(idList.map((x) => int(x)));
      for (const r of cst.fetchAll()) catMap[int(r.id)] = r.category || 'Uncategorised';
    }
    let categoryStats = {};
    for (const o of orders) for (const it of o.items) {
      const cat = catMap[int(it.menuItemId || 0)] || 'Uncategorised';
      if (!categoryStats[cat]) categoryStats[cat] = { category: cat, qty: 0, revenue: 0 };
      categoryStats[cat].qty += int(it.qty); categoryStats[cat].revenue += flt(it.lineTotal || 0);
    }
    for (const k in categoryStats) categoryStats[k].revenue = round2(categoryStats[k].revenue);
    categoryStats = Object.values(categoryStats).sort((a, b) => b.revenue - a.revenue);
    const hourly = [];
    for (let h = 0; h < 24; h++) hourly[h] = { hour: h, orders: 0, revenue: 0 };
    for (const o of orders) {
      const d = new Date(String(o.paidAt || o.createdAt || Date.now()).replace(' ', 'T'));
      const h = d.getHours();
      hourly[h].orders++; hourly[h].revenue += o.grandTotal;
    }
    for (let h = 0; h < 24; h++) hourly[h].revenue = round2(hourly[h].revenue);
    let peakHour = null;
    for (const v of hourly) if (peakHour === null || v.orders > peakHour.orders) peakHour = v;
    const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dow = [];
    for (let d = 0; d < 7; d++) dow[d] = { day: dowNames[d], dayIndex: d, orders: 0, revenue: 0 };
    for (const o of orders) {
      const dt = new Date(String(o.paidAt || o.createdAt || Date.now()).replace(' ', 'T'));
      const d = dt.getDay();
      dow[d].orders++; dow[d].revenue += o.grandTotal;
    }
    for (let d = 0; d < 7; d++) dow[d].revenue = round2(dow[d].revenue);
    let weekdayRev = 0, weekendRev = 0;
    for (let d = 0; d < 7; d++) { if ([1, 2, 3, 4].includes(d)) weekdayRev += dow[d].revenue; else weekendRev += dow[d].revenue; }
    const soldIds = {};
    for (const o of orders) for (const it of o.items) if (it.menuItemId) soldIds[int(it.menuItemId)] = true;
    let menuSql = 'SELECT id, name, category, price FROM menu_items';
    const menuArgs = [];
    if (bFilter) { menuSql += ' WHERE branchId=?'; menuArgs.push(bFilter); }
    const allMenuSt = db.prepare(menuSql); allMenuSt.execute(menuArgs);
    const deadStock = [];
    for (const mi of allMenuSt.fetchAll()) if (!soldIds[int(mi.id)]) deadStock.push({ name: mi.name, category: mi.category || 'Uncategorised', price: flt(mi.price) });
    let modStats = {};
    for (const o of orders) for (const it of o.items) for (const m of (it.modifiers || [])) {
      const name = m.option || m.name || '';
      if (name === '') continue;
      if (!modStats[name]) modStats[name] = { name, count: 0 };
      modStats[name].count += int(it.qty);
    }
    modStats = Object.values(modStats).sort((a, b) => b.count - a.count);
    let purchaseCost = 0;
    const pcSt = db.prepare('SELECT items FROM purchases WHERE ' + (bFilter ? 'branchId=? AND ' : '') + 'date(createdAt) BETWEEN ? AND ?');
    pcSt.execute(bFilter ? [bFilter, from, to] : [from, to]);
    for (const pr of pcSt.fetchAll()) for (const it of jsonDecode(pr.items, [])) purchaseCost += flt(it.cost || 0);
    let consumedCost = 0;
    const spSt = db.prepare('SELECT consumedValue FROM stock_periods WHERE ' + (bFilter ? 'branchId=? AND ' : '') + 'startDate <= ? AND endDate >= ?');
    spSt.execute(bFilter ? [bFilter, to, from] : [to, from]);
    for (const sp of spSt.fetchAll()) consumedCost += flt(sp.consumedValue);
    let voidSql = 'SELECT * FROM orders WHERE date(createdAt) BETWEEN ? AND ? AND void_data IS NOT NULL';
    const vargs = [from, to];
    if (bFilter) { voidSql += ' AND branchId=?'; vargs.push(bFilter); }
    const vst = db.prepare(voidSql); vst.execute(vargs);
    const voided = vst.fetchAll().map((r) => orderRow(r));
    const staffTips = {};
    for (const o of orders) if ((o.tipAmount || 0) > 0) {
      const k = o.staffId || 0;
      if (!staffTips[k]) staffTips[k] = { staffName: o.staffName, totalTips: 0, orderCount: 0 };
      staffTips[k].totalTips += o.tipAmount; staffTips[k].orderCount++;
    }
    let sequences;
    if (bFilter) { const seqSt = db.prepare('SELECT * FROM order_sequences WHERE branchId=?'); seqSt.execute([bFilter]); sequences = seqSt.fetchAll(); }
    else sequences = db.query('SELECT * FROM order_sequences').fetchAll();
    jsonOut({
      period: { from, to },
      summary: {
        totalRevenue, totalOrders, totalTips, totalDiscounts: totalDiscount,
        byPaymentMethod: byMethod, totalCardFees: totalFees, netRevenue: totalNet,
        grossSales, netSales, avgOrderValue: avgOrder,
      },
      paymentMethods: Object.values(methodStats),
      itemBreakdown, categoryStats, hourly, peakHour, dayOfWeek: dow,
      salesByOrderType, salesByEmployee,
      weekdayVsWeekend: { weekday: round2(weekdayRev), weekend: round2(weekendRev) },
      deadStock, modifierStats: modStats,
      inventoryCost: { purchases: round2(purchaseCost), consumed: round2(consumedCost) },
      voids: voided.map((o) => ({ orderId: o.id, tableName: o.tableName, staffName: o.staffName, staffId: o.staffId, amount: o.total, reason: (o.void && o.void.reason) || '', at: (o.void && o.void.at) || '' })),
      staffTips: Object.values(staffTips),
      orders: orders.filter((o) => (o.tipAmount || 0) > 0).map((o) => ({ id: o.id, tableName: o.tableName, staffId: o.staffId, staffName: o.staffName, tipAmount: o.tipAmount, grandTotal: o.grandTotal })),
      orderSequences: sequences,
    });
  }

  // ── DASHBOARD DETAILS ────────────────────────────────────
  if (method === 'GET' && uri === '/dashboard/details') {
    let bids = [];
    if (user.role === 'superManager') for (const b of db.query('SELECT id FROM branches').fetchAll()) bids.push(int(b.id));
    else bids = [bid];
    // Branch id -> name, so every row can carry a human label for superManager.
    const bNameMap = {};
    for (const row of db.query('SELECT id,name FROM branches').fetchAll()) bNameMap[int(row.id)] = row.name;
    const weekday = (ds) => { try { return new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }); } catch (e) { return ds.slice(5); } };
    const revenueTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = dateAddDays(-i);
      let total = 0;
      for (const b of bids) {
        const st = db.prepare("SELECT COALESCE(SUM(total),0) as t FROM orders WHERE branchId=? AND paymentStatus='paid' AND date(paidAt)=?");
        st.execute([b, d]); total += flt(st.fetch().t);
      }
      revenueTrend.push({ date: d, label: weekday(d), revenue: round2(total) });
    }
    let shiftRoster = [];
    for (const b of bids) {
      const st = db.prepare('SELECT s.*, u.name as userName, u.role FROM shifts s LEFT JOIN users u ON u.id=s.userId WHERE s.branchId=? AND s.clockOut IS NULL ORDER BY s.clockIn');
      st.execute([b]); shiftRoster = shiftRoster.concat(st.fetchAll());
    }
    shiftRoster = shiftRoster.map((r) => {
      const started = Date.parse(String(r.clockIn).replace(' ', 'T'));
      const minutesOn = isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 60000));
      return Object.assign({}, r, { id: int(r.id), userId: int(r.userId), minutesOn, branchName: bNameMap[int(r.branchId)] || '' });
    });
    const stationPerformance = [];
    const today = todayStr();
    for (const b of bids) {
      const staSt = db.prepare('SELECT * FROM stations WHERE branchId=?'); staSt.execute([b]);
      for (const s of staSt.fetchAll()) {
        let count = 0;
        const ordSt = db.prepare('SELECT items FROM orders WHERE branchId=? AND date(createdAt)=?'); ordSt.execute([b, today]);
        for (const o of ordSt.fetchAll()) for (const item of jsonDecode(o.items, [])) if (int(item.stationId || 0) === int(s.id)) count++;
        stationPerformance.push({ stationId: int(s.id), stationName: s.name, color: s.color, branchName: bNameMap[b] || '', itemsToday: count });
      }
    }
    const auditTrail = [];
    for (const b of bids) {
      const aSt = db.prepare('SELECT * FROM orders WHERE branchId=? AND (void_data IS NOT NULL OR discount IS NOT NULL) AND date(createdAt)=? ORDER BY createdAt DESC LIMIT 20');
      aSt.execute([b, today]);
      for (const o of aSt.fetchAll()) {
        const ord = orderRow(o);
        const branchName = bNameMap[b] || '';
        if (ord.void) auditTrail.push({ type: 'void', orderId: ord.id, tableName: ord.tableName, staffName: ord.staffName, branchName, detail: (ord.void && ord.void.reason) || '', at: (ord.void && ord.void.at) || ord.createdAt, amount: ord.total });
        if (ord.discount) auditTrail.push({ type: 'discount', orderId: ord.id, tableName: ord.tableName, staffName: ord.staffName, branchName, detail: `${ord.discount.type} ${ord.discount.value}` + (ord.discount.type === 'percent' ? '%' : ''), at: ord.createdAt, amount: ord.discount.amount });
      }
    }
    jsonOut({ revenueTrend, shiftRoster, stationPerformance, auditTrail });
  }

  // ── PERMISSIONS ──────────────────────────────────────────
  if (method === 'GET' && uri === '/permissions') {
    const st = db.prepare('SELECT * FROM permissions WHERE branchId=?'); st.execute([bid]);
    const row = st.fetch();
    if (!row) jsonOut({ branchId: bid, serverMaxDiscountPercent: 10.0, allowServerVoid: false, allowCashierVoid: false });
    jsonOut({
      branchId: int(row.branchId), serverMaxDiscountPercent: flt(row.serverMaxDiscountPercent),
      allowServerVoid: !!row.allowServerVoid, allowCashierVoid: !!row.allowCashierVoid,
    });
  }
  if (method === 'PUT' && uri === '/permissions') {
    requireRole(['superManager', 'manager'], user);
    if (!bid) err('Pick a branch before changing permissions', 400);
    const pct = has(body.serverMaxDiscountPercent) ? flt(body.serverMaxDiscountPercent) : null;
    if (pct !== null && (pct < 0 || pct > 100)) err('Discount limit must be between 0 and 100', 400);
    db.prepare('INSERT OR IGNORE INTO permissions (branchId) VALUES (?)').execute([bid]);
    db.prepare('UPDATE permissions SET serverMaxDiscountPercent = ?, allowServerVoid = ?, allowCashierVoid = ? WHERE branchId = ?')
      .execute([pct !== null ? pct : 10, body.allowServerVoid ? 1 : 0, body.allowCashierVoid ? 1 : 0, bid]);
    const f = db.prepare('SELECT * FROM permissions WHERE branchId=?'); f.execute([bid]);
    const row = f.fetch();
    jsonOut({
      branchId: int(row.branchId), serverMaxDiscountPercent: flt(row.serverMaxDiscountPercent),
      allowServerVoid: !!row.allowServerVoid, allowCashierVoid: !!row.allowCashierVoid,
    });
  }

  // ── CATCH-ALL ────────────────────────────────────────────
  err(`Route not found: ${method} ${uri}`, 404);
}

module.exports = { handle, auditLog };
