// ============================================================
// src/helpers.js — port of api/helpers.php + config/db.php helpers
// ============================================================
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

// ── Response control flow ────────────────────────────────────
// PHP's jsonOut()/err() call exit(); here we throw a Resp that the
// router catches and turns into an HTTP response.
class Resp {
  constructor(data, code = 200) { this.data = data; this.code = code; }
}
function jsonOut(data, code = 200) { throw new Resp(data, code); }
function err(msg, code = 400) { throw new Resp({ error: msg }, code); }

// ── Config: rate limiting ────────────────────────────────────
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW = 60; // seconds

// ── Token secret (unique per install, persisted) ─────────────
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');
let TOKEN_SECRET;
try {
  TOKEN_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  if (!TOKEN_SECRET) throw new Error('empty');
} catch (e) {
  TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, TOKEN_SECRET, { mode: 0o600 }); } catch (_) {}
}

// ── Hashing (scrypt; keeps the PHP verifyPin plain-text fallback) ──
function sha256hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function scryptHash(s) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(s), salt, 32);
  return `$scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}
function scryptVerify(s, hash) {
  try {
    const parts = String(hash).split('$'); // ['', 'scrypt', salt, hash]
    if (parts.length !== 4 || parts[1] !== 'scrypt') return false;
    const dk = crypto.scryptSync(String(s), Buffer.from(parts[2], 'hex'), 32);
    const target = Buffer.from(parts[3], 'hex');
    return dk.length === target.length && crypto.timingSafeEqual(dk, target);
  } catch (e) { return false; }
}
function hashPin(pin) { return scryptHash(String(pin)); }
function verifyPin(pin, hash) {
  if (hash == null) return false;
  hash = String(hash);
  if (hash.length < 20 || hash[0] !== '$') return hash === String(pin); // legacy plain-text
  return scryptVerify(pin, hash);
}
const passwordHash = (pw) => scryptHash(String(pw));
const passwordVerify = (pw, hash) => scryptVerify(pw, hash);

// ── Date/number helpers (replace PHP date()/number_format()) ──
const pad2 = (n) => String(n).padStart(2, '0');
function fmtLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
const nowStr = () => fmtLocal(new Date());                     // date('Y-m-d H:i:s') / NOW()
const isoNow = () => new Date().toISOString();                 // date('c')
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function dateAddDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return todayStr(d); }
function monthStart() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`; }
function mondayThisWeek() { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return todayStr(d); }
function tsSeconds(v) { const t = Date.parse(v); return isNaN(t) ? 0 : Math.floor(t / 1000); } // strtotime()
function numberFormat(n, dec = 2) {
  const parts = Number(n).toFixed(dec).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
const ucfirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function roundN(n, d) { const f = Math.pow(10, d); return Math.round((Number(n) + Number.EPSILON) * f) / f; }

// ── Small PHP-array helpers ──────────────────────────────────
const arrColumn = (arr, key) => arr.map((r) => r[key]);
const arrSum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

// ── URL routing helpers ──────────────────────────────────────
function routeMatch(pattern, uri, params) {
  const names = [];
  const regexStr = '^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$';
  const m = new RegExp(regexStr).exec(uri);
  if (!m) return false;
  names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
  return true;
}

// ── Safe dynamic UPDATE builder ──────────────────────────────
function buildSet(body, allowed) {
  const set = new Set(allowed);
  const keys = Object.keys(body || {}).filter((k) => set.has(k));
  if (!keys.length) return [null, []];
  const sets = keys.map((k) => `\`${k}\`=?`).join(', ');
  const vals = keys.map((k) => body[k]);
  return [sets, vals];
}

// ── PIN validation / manager lookup ──────────────────────────
function assertPinAvailable(dbc, pinRaw, excludeUserId = null) {
  pinRaw = String(pinRaw || '').trim();
  if (!/^\d{4,8}$/.test(pinRaw)) err('PIN must be 4 to 8 digits', 400);
  const pinIndex = sha256hex(pinRaw);
  let sql = 'SELECT id, name FROM users WHERE pin_index = ?';
  const args = [pinIndex];
  if (excludeUserId !== null) { sql += ' AND id <> ?'; args.push(excludeUserId); }
  const st = dbc.prepare(sql); st.execute(args);
  const clash = st.fetch();
  if (clash) err('That PIN is already used by ' + clash.name + '. Every user needs a unique PIN.', 400);
}

function findManagerByPin(dbc, pin) {
  pin = String(pin || '').trim();
  if (pin === '') return null;
  const pinIndex = sha256hex(pin);
  const st = dbc.prepare(
    `SELECT * FROM users
      WHERE (authMethod IS NULL OR authMethod = '' OR authMethod = 'pin')
        AND role IN ('manager','superManager')
        AND isHeld = 0
        AND pin_index = ?`
  );
  st.execute([pinIndex]);
  for (const c of st.fetchAll()) { if (verifyPin(pin, c.pin)) return c; }
  return null;
}

// ── Token auth ───────────────────────────────────────────────
// Approval PIN — a separate secret from the login PIN, used to authorise
// discounts, voids and refunds. Only managers/superManagers/admins carry one.
function findApproverByPin(dbc, pin) {
  pin = String(pin || '').trim();
  if (pin === '') return null;
  const idx = sha256hex(pin);
  const st = dbc.prepare(
    "SELECT * FROM users WHERE role IN ('manager','superManager','admin') AND isHeld = 0 AND approvalPinIndex = ?"
  );
  st.execute([idx]);
  for (const c of st.fetchAll()) { if (verifyPin(pin, c.approvalPin)) return c; }
  return null;
}
function assertApprovalPinAvailable(dbc, pinRaw, excludeUserId = null) {
  pinRaw = String(pinRaw || '').trim();
  if (!/^\d{4,8}$/.test(pinRaw)) err('Approval PIN must be 4 to 8 digits', 400);
  const idx = sha256hex(pinRaw);
  let sql = 'SELECT id, name FROM users WHERE approvalPinIndex = ?';
  const args = [idx];
  if (excludeUserId !== null) { sql += ' AND id <> ?'; args.push(excludeUserId); }
  const st = dbc.prepare(sql); st.execute(args);
  const clash = st.fetch();
  if (clash) err('That approval PIN is already used by ' + clash.name + '. Pick a different one.', 400);
}

// Role hierarchy: an actor may only manage accounts strictly below their rank
// (admin > superManager > manager > staff). Admin can manage anyone.
const ROLE_RANK = { admin: 4, superManager: 3, manager: 2, finance: 1, server: 1, cashier: 1, kitchen: 1 };
const roleRank = (r) => ROLE_RANK[r] || 0;
function canManage(actor, target) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return true;               // self
  if (actor.role === 'admin') return true;               // admin manages all
  return roleRank(actor.role) > roleRank(target.role);   // strictly higher only
}

function makeToken(userId) {
  const expiry = Math.floor(Date.now() / 1000) + 86400 * 30;
  const payload = Buffer.from(`${userId}.${expiry}`).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function parseToken(token) {
  token = String(token || '').trim();
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let decoded;
  try { decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch (e) { return null; }
  const bits = decoded.split('.');
  if (bits.length !== 2) return null;
  const [userId, expiry] = bits;
  if (Math.floor(Date.now() / 1000) > parseInt(expiry, 10)) return null;
  return { userId: parseInt(userId, 10) };
}

function tokenFrom(ctx) {
  if (ctx.query && ctx.query._auth) return ctx.query._auth;
  const h = ctx.headers || {};
  return h['x-auth-token'] || null;
}
function currentUser(ctx) {
  const token = tokenFrom(ctx);
  if (!token) return null;
  const data = parseToken(token);
  if (!data) return null;
  const st = db.prepare('SELECT * FROM users WHERE id=?');
  st.execute([data.userId]);
  const row = st.fetch();
  return row ? userRow(row) : null;
}
function requireUser(ctx) {
  const u = currentUser(ctx);
  if (!u) err('Not authenticated', 401);
  if (u.isHeld) err('Account suspended. Contact your administrator.', 403);
  return u;
}
function requireRole(roles, user) {
  if (!roles.includes(user.role)) err('Not authorized', 403);
}
function branchId(ctx, user) {
  // Super Manager may explicitly choose a branch. Regular staff must always
  // remain scoped to their assigned branch (ignore query-string overrides).
  // Admin and Super Manager demo accounts have no fixed branch on first run;
  // without a fallback, /menu and other branch-scoped routes returned [] .
  const requested = (ctx.query && ctx.query.branchId) || (ctx.body && ctx.body.branchId) || null;
  if (user.role === 'superManager' && requested && Number.isFinite(parseInt(requested, 10))) {
    return parseInt(requested, 10);
  }
  if (user.branchId && Number.isFinite(parseInt(user.branchId, 10))) return parseInt(user.branchId, 10);
  const first = db.prepare("SELECT id FROM branches WHERE status='active' ORDER BY id LIMIT 1");
  first.execute([]);
  const row = first.fetch();
  return row ? parseInt(row.id, 10) : null;
}

// ── Rate limiting ────────────────────────────────────────────
function checkRateLimit(key) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - RATE_LIMIT_WINDOW;
  const keyHash = crypto.createHash('md5').update(key).digest('hex');
  db.prepare('DELETE FROM login_rate_limits WHERE keyHash=? AND hitAt<?').execute([keyHash, windowStart]);
  db.prepare('INSERT INTO login_rate_limits (keyHash, hitAt) VALUES (?,?)').execute([keyHash, now]);
  const insertedId = db.lastInsertId();
  const st = db.prepare('SELECT COUNT(*) AS c FROM login_rate_limits WHERE keyHash=? AND hitAt>=?');
  st.execute([keyHash, windowStart]);
  const count = Number(st.fetch().c);
  if (count > RATE_LIMIT_MAX) {
    db.prepare('DELETE FROM login_rate_limits WHERE id=?').execute([insertedId]);
    err('Too many attempts. Please wait a minute and try again.', 429);
  }
}

// ── JSON helpers ─────────────────────────────────────────────
function jsonDecode(v, def = null) {
  if (v === null || v === undefined || v === '') return def;
  if (typeof v === 'object') return v;
  try { const d = JSON.parse(v); return d === null ? def : d; } catch (e) { return def; }
}
function jsonEncode(v) { return v !== null && v !== undefined ? JSON.stringify(v) : null; }

// ── Row parsers ──────────────────────────────────────────────
function userRow(r) {
  if (!r) return null;
  return Object.assign({}, r, {
    id: parseInt(r.id, 10),
    branchId: r.branchId ? parseInt(r.branchId, 10) : null,
    payRate: parseFloat(r.payRate || 0),
    payType: r.payType || 'hourly',
    authMethod: r.authMethod || 'pin',
    isHeld: !!(r.isHeld || 0),
    mustChangePassword: !!(r.mustChangePassword || 0),
    username: r.username || null,
    hasApprovalPin: !!r.approvalPinIndex,
    email: r.email || '',
    phoneAccess: !!(r.phoneAccess || 0),
    pin: null,
    passwordHash: null,
    approvalPin: null,
    approvalPinIndex: null,
  });
}
function orderRow(r) {
  if (!r) return null;
  const tip = parseFloat(r.tipAmount || 0);
  const total = parseFloat(r.total);
  const seqNum = r.orderSeqNum ? parseInt(r.orderSeqNum, 10) : parseInt(r.id, 10);
  return Object.assign({}, r, {
    id: parseInt(r.id, 10),
    orderSeqNum: seqNum,
    displayNum: '#' + String(seqNum).padStart(4, '0'),
    branchId: parseInt(r.branchId, 10),
    tableId: r.tableId ? parseInt(r.tableId, 10) : null,
    staffId: r.staffId ? parseInt(r.staffId, 10) : null,
    total,
    tipAmount: tip,
    grandTotal: round2(total + tip),
    subtotal: parseFloat(r.subtotal),
    serviceCharge: parseFloat(r.serviceCharge),
    vat: parseFloat(r.vat),
    amountPaid: parseFloat(r.amountPaid),
    inventoryDeducted: !!r.inventoryDeducted,
    items: jsonDecode(r.items, []),
    discount: jsonDecode(r.discount),
    promo: jsonDecode(r.promo_data),
    kitchenTag: jsonDecode(r.kitchenTag),
    payments: jsonDecode(r.payments, []),
    void: jsonDecode(r.void_data),
  });
}
function menuRow(r) {
  if (!r) return null;
  return Object.assign({}, r, {
    id: parseInt(r.id, 10),
    branchId: parseInt(r.branchId, 10),
    price: parseFloat(r.price),
    stationId: r.stationId ? parseInt(r.stationId, 10) : null,
    soldOut: !!r.soldOut,
    tags: r.tags || '',
    recipe: jsonDecode(r.recipe, []),
    modifiers: jsonDecode(r.modifiers, []),
  });
}
function ingredientRow(r) {
  if (!r) return null;
  return Object.assign({}, r, {
    id: parseInt(r.id, 10),
    branchId: parseInt(r.branchId, 10),
    qty: parseFloat(r.qty),
    unitCost: parseFloat(r.unitCost || 0),
    lowStockThreshold: parseFloat(r.lowStockThreshold),
    supplierId: r.supplierId ? parseInt(r.supplierId, 10) : null,
  });
}
function settingsRow(r) {
  if (!r) return null;
  return Object.assign({}, r, {
    serviceChargeRate: parseFloat(r.serviceChargeRate),
    vatRate: parseFloat(r.vatRate),
    cardFeePercent: parseFloat(r.cardFeePercent || 0),
    lowStockDefaultThreshold: parseInt(r.lowStockDefaultThreshold, 10),
    allowUserThemeOverride: !!r.allowUserThemeOverride,
    receiptShowVatBreakdown: !!r.receiptShowVatBreakdown,
    notifyEmailEnabled: !!r.notifyEmailEnabled,
    notifySmsEnabled: !!r.notifySmsEnabled,
    autoStockClose: r.autoStockClose === undefined ? true : !!r.autoStockClose,
    enabledAddons: jsonDecode(r.enabledAddons, []) || [],
    loyaltyEarnPoints: r.loyaltyEarnPoints == null ? 1 : parseFloat(r.loyaltyEarnPoints),
    loyaltyEarnPer: r.loyaltyEarnPer == null ? 100 : parseFloat(r.loyaltyEarnPer),
    loyaltyRedeemValue: r.loyaltyRedeemValue == null ? 1 : parseFloat(r.loyaltyRedeemValue),
    loyaltyMinRedeem: r.loyaltyMinRedeem == null ? 0 : parseFloat(r.loyaltyMinRedeem),
    taxRegNo: r.taxRegNo || '',
    fiscalEnabled: !!r.fiscalEnabled,
    fiscalPrefix: r.fiscalPrefix == null ? 'INV-' : r.fiscalPrefix,
    printAgentUrl: r.printAgentUrl || '',
    printAgentEnabled: !!r.printAgentEnabled,
    printPaperWidth: r.printPaperWidth == null ? 48 : parseInt(r.printPaperWidth, 10),
    kitchenPrinterName: r.kitchenPrinterName || '',
    paymentPrinterName: r.paymentPrinterName || '',
    qrPrinterName: r.qrPrinterName || '',
    dailyReportEnabled: r.dailyReportEnabled == null ? true : !!r.dailyReportEnabled,
    dailyReportTime: r.dailyReportTime || '23:30',
    publicBaseUrl: r.publicBaseUrl || '',
    qrOrderAutoKitchen: r.qrOrderAutoKitchen == null ? true : !!r.qrOrderAutoKitchen,
    defaultOrderType: r.defaultOrderType || 'dine-in',
    loginThemeId: r.loginThemeId || '',
    homeBanners: jsonDecode(r.homeBanners, []) || [],
  });
}
function notifRow(r, userId) {
  if (!r) return null;
  const readBy = jsonDecode(r.readBy, []);
  return Object.assign({}, r, {
    id: parseInt(r.id, 10),
    targetUserId: r.targetUserId ? parseInt(r.targetUserId, 10) : null,
    relatedId: r.relatedId ? parseInt(r.relatedId, 10) : null,
    readBy,
    read: userId !== null ? readBy.includes(userId) : false,
  });
}
function shiftRow(r) {
  if (!r) return null;
  return Object.assign({}, r, { id: parseInt(r.id, 10), userId: parseInt(r.userId, 10), branchId: parseInt(r.branchId, 10) });
}

// ── Settings (cached per process; bust after a PUT) ──────────
let _settingsCache = null;
function getSettings(bust = false) {
  if (bust) _settingsCache = null;
  if (_settingsCache !== null) return _settingsCache;
  let row = db.query('SELECT * FROM settings WHERE id=1').fetch();
  if (!row) {
    db.exec('INSERT INTO settings (id) VALUES (1)');
    row = db.query('SELECT * FROM settings WHERE id=1').fetch();
  }
  _settingsCache = settingsRow(row);
  return _settingsCache;
}

// ── Order totals ─────────────────────────────────────────────
function computeTotals(items, discount, promoAmount, orderType = 'dine-in') {
  const s = getSettings();
  const subtotal = arrSum(arrColumn(items, 'lineTotal'));
  const discountAmount = (discount && discount.amount) || 0;
  const promo = round2(promoAmount || 0);
  // Discount + promo together can't drop the taxable base below zero.
  const reduction = Math.min(subtotal, discountAmount + promo);
  const taxable = Math.max(0, subtotal - reduction);
  const serviceCharge = orderType === 'dine-in' ? round2(taxable * s.serviceChargeRate) : 0;
  const vat = round2((taxable + serviceCharge) * s.vatRate);
  const total = round2(subtotal - reduction + serviceCharge + vat);
  return { subtotal, serviceCharge, vat, total };
}

// ── Recipe / inventory deduction ─────────────────────────────
function computeLineDeductions(dbc, line) {
  const menuItemId = parseInt(line.menuItemId || 0, 10);
  const qty = parseFloat(line.qty || 0);
  if (!menuItemId || qty <= 0) return {};
  const st = dbc.prepare('SELECT recipe, modifiers FROM menu_items WHERE id=?');
  st.execute([menuItemId]);
  const row = st.fetch();
  if (!row) return {};
  const baseRecipe = jsonDecode(row.recipe, []) || [];
  const groups = jsonDecode(row.modifiers, []) || [];
  const defs = {};
  for (const g of groups) {
    const gName = String(g.name || '');
    for (const o of (g.options || [])) defs[gName + '|' + String(o.name || '')] = o;
  }
  let multiplier = 1.0;
  const extras = {};
  for (const sel of (line.modifiers || [])) {
    const key = String(sel.group || '') + '|' + String(sel.option || '');
    const def = defs[key];
    if (!def) continue;
    const m = def.qtyMultiplier !== undefined ? parseFloat(def.qtyMultiplier) : 1.0;
    if (m > 0) multiplier *= m;
    for (const r of (def.recipe || [])) {
      const iid = parseInt(r.ingredientId || 0, 10);
      if (!iid) continue;
      extras[iid] = (extras[iid] || 0) + parseFloat(r.qty || 0);
    }
  }
  const totals = {};
  for (const r of baseRecipe) {
    const iid = parseInt(r.ingredientId || 0, 10);
    if (!iid) continue;
    totals[iid] = (totals[iid] || 0) + parseFloat(r.qty || 0) * multiplier;
  }
  for (const iid in extras) totals[iid] = (totals[iid] || 0) + extras[iid];
  const out = {};
  for (const iid in totals) {
    const amount = roundN(totals[iid] * qty, 4);
    if (amount !== 0) out[iid] = amount;
  }
  return out;
}
function deductInventoryLine(dbc, line) {
  const d = computeLineDeductions(dbc, line);
  // Negative-stock prevention: never let a quantity fall below zero.
  for (const iid in d) dbc.prepare('UPDATE ingredients SET qty = MAX(0, qty - ?) WHERE id=?').execute([d[iid], parseInt(iid, 10)]);
}
function restoreInventory(dbc, items) {
  for (const line of items) {
    const d = computeLineDeductions(dbc, line);
    for (const iid in d) dbc.prepare('UPDATE ingredients SET qty = qty + ? WHERE id=?').execute([d[iid], parseInt(iid, 10)]);
  }
}
function checkLowStock(dbc, menuItemId, branchIdv) {
  const st = dbc.prepare('SELECT recipe FROM menu_items WHERE id=?');
  st.execute([menuItemId]);
  const row = st.fetch();
  if (!row) return;
  for (const r of jsonDecode(row.recipe, [])) {
    const ingId = parseInt(r.ingredientId, 10);
    const st2 = dbc.prepare('SELECT * FROM ingredients WHERE id=?');
    st2.execute([ingId]);
    const ing = st2.fetch();
    if (ing && parseFloat(ing.qty) <= parseFloat(ing.lowStockThreshold)) {
      dbc.prepare('INSERT INTO notifications (branchId,type,message,targetRole,readBy) VALUES (?,?,?,?,?)')
        .execute([branchIdv, 'low-stock', `Low stock: ${ing.name} (${ing.qty} ${ing.unit} left)`, 'manager', '[]']);
    }
  }
}

// ── Order sequence (single-threaded → race-safe) ─────────────
function nextOrderSeqNum(dbc, branchIdv) {
  dbc.prepare('INSERT OR IGNORE INTO order_sequences (branchId, currentNum) VALUES (?, 0)').execute([branchIdv]);
  dbc.prepare('UPDATE order_sequences SET currentNum = currentNum + 1 WHERE branchId = ?').execute([branchIdv]);
  const st = dbc.prepare('SELECT currentNum FROM order_sequences WHERE branchId=?');
  st.execute([branchIdv]);
  return Number(st.fetch().currentNum);
}

// ── Notifications ────────────────────────────────────────────
function orderNum(id) { return '#' + String(id).padStart(4, '0'); }
function addNotification(data) {
  db.prepare('INSERT INTO notifications (branchId,type,message,targetRole,targetUserId,relatedId,readBy) VALUES (?,?,?,?,?,?,?)')
    .execute([
      data.branchId ?? null, data.type || 'info', data.message,
      data.targetRole || 'all', data.targetUserId ?? null, data.relatedId ?? null, '[]',
    ]);
}

// ── Input helpers ────────────────────────────────────────────
function truncate(v, max) { return String(v ?? '').substring(0, max); }
function safeDate(v) {
  v = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v)) err(`Invalid date format: ${v}. Use YYYY-MM-DD.`, 400);
  return v;
}

module.exports = {
  Resp, jsonOut, err,
  sha256hex, hashPin, verifyPin, passwordHash, passwordVerify,
  nowStr, isoNow, todayStr, dateAddDays, monthStart, mondayThisWeek, tsSeconds,
  numberFormat, ucfirst, round2, roundN, arrColumn, arrSum,
  routeMatch, buildSet, assertPinAvailable, findManagerByPin,
  findApproverByPin, assertApprovalPinAvailable, canManage, roleRank,
  makeToken, parseToken, currentUser, requireUser, requireRole, branchId,
  checkRateLimit, jsonDecode, jsonEncode,
  userRow, orderRow, menuRow, ingredientRow, settingsRow, notifRow, shiftRow,
  getSettings, computeTotals, computeLineDeductions, deductInventoryLine,
  restoreInventory, checkLowStock, nextOrderSeqNum, orderNum, addNotification,
  truncate, safeDate,
};
