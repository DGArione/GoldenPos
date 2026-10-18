// ============================================================
// src/scheduler.js — background jobs
// ------------------------------------------------------------
// Auto month-end stock close: on the first check of a new calendar month,
// snapshot and close the PREVIOUS month's stock period for every branch
// (opening from the last close, purchases summed, closing = live stock) and
// carry the closing stock over as the new month's opening. Managers can still
// close manually at any time from Inventory → Stock Periods.
// ============================================================
'use strict';

const { db } = require('./db');
const { jsonDecode, jsonEncode, roundN, round2 } = require('./helpers');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

function prevMonthInfo(now) {
  const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastPrev = new Date(firstOfThis.getTime() - 86400000);           // last day of previous month
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return {
    key: monthKey(lastPrev),
    from: ymd(firstPrev),
    to: ymd(lastPrev),
    label: lastPrev.toLocaleString('en-US', { month: 'long' }) + ' ' + lastPrev.getFullYear(),
  };
}

function getSettingsRow() {
  let row = db.query('SELECT * FROM settings WHERE id=1').fetch();
  if (!row) { db.exec('INSERT INTO settings (id) VALUES (1)'); row = db.query('SELECT * FROM settings WHERE id=1').fetch(); }
  return row;
}

// Close one branch's period for [from,to] using live stock as the closing count.
function closeBranchMonth(branchId, from, to, label) {
  // Skip if a period already covers this month end for the branch.
  const dup = db.prepare('SELECT id FROM stock_periods WHERE branchId=? AND endDate>=? AND endDate<=?');
  dup.execute([branchId, from, to]);
  if (dup.fetch()) return false;

  const ingSt = db.prepare('SELECT * FROM ingredients WHERE branchId=? ORDER BY name');
  ingSt.execute([branchId]);
  const ingredients = ingSt.fetchAll();
  if (!ingredients.length) return false;

  // Opening = closing snapshot of the most recent closed period before `from`.
  const openingMap = {};
  const prev = db.prepare('SELECT "lines" FROM stock_periods WHERE branchId=? AND endDate < ? ORDER BY endDate DESC, id DESC LIMIT 1');
  prev.execute([branchId, from]);
  const prevRow = prev.fetch();
  if (prevRow) for (const ln of jsonDecode(prevRow.lines, [])) openingMap[parseInt(ln.ingredientId, 10)] = parseFloat(ln.closing || 0);

  // Purchases in range, summed per ingredient.
  const purchasedMap = {};
  const pSt = db.prepare('SELECT items FROM purchases WHERE branchId=? AND date(createdAt) BETWEEN ? AND ?');
  pSt.execute([branchId, from, to]);
  for (const pr of pSt.fetchAll()) for (const it of jsonDecode(pr.items, [])) {
    const iid = parseInt(it.ingredientId || 0, 10); if (!iid) continue;
    purchasedMap[iid] = (purchasedMap[iid] || 0) + parseFloat(it.qty || 0);
  }

  let openingValue = 0, purchaseValue = 0, consumedValue = 0, closingValue = 0;
  const lines = ingredients.map((ing) => {
    const iid = parseInt(ing.id, 10);
    const uc = parseFloat(ing.unitCost || 0);
    const opening = openingMap[iid] || 0;
    const purchased = purchasedMap[iid] || 0;
    const closing = parseFloat(ing.qty || 0);
    const consumed = Math.max(0, opening + purchased - closing);
    openingValue += opening * uc; purchaseValue += purchased * uc; consumedValue += consumed * uc; closingValue += closing * uc;
    return { ingredientId: iid, name: ing.name, unit: ing.unit, unitCost: uc,
      opening: roundN(opening, 3), purchased: roundN(purchased, 3), consumed: roundN(consumed, 3), closing: roundN(closing, 3) };
  });

  db.prepare(
    `INSERT INTO stock_periods (branchId,label,startDate,endDate,status,"lines",openingValue,purchaseValue,consumedValue,closingValue,closedByName,note)
     VALUES (?,?,?,?,'closed',?,?,?,?,?,?,?)`
  ).execute([branchId, label, from, to, jsonEncode(lines), round2(openingValue), round2(purchaseValue), round2(consumedValue), round2(closingValue),
    'System (month-end auto)', 'Automatically closed at month-end.']);
  // Carry over: closing already equals live stock, so this keeps continuity.
  return true;
}

function runAutoClose() {
  try {
    const s = getSettingsRow();
    const now = new Date();
    const prevM = prevMonthInfo(now);

    // First-ever run: set the baseline so we only act on FUTURE month rollovers.
    if (!s.lastAutoStockCloseMonth) {
      db.prepare('UPDATE settings SET lastAutoStockCloseMonth=? WHERE id=1').execute([prevM.key]);
      return;
    }
    if (s.autoStockClose === 0) return;              // disabled by admin
    if (s.lastAutoStockCloseMonth === prevM.key) return;  // already closed this month

    let closed = 0;
    for (const b of db.query('SELECT id FROM branches').fetchAll()) {
      try { if (closeBranchMonth(parseInt(b.id, 10), prevM.from, prevM.to, prevM.label)) closed++; }
      catch (e) { console.warn('[scheduler] close failed for branch', b.id, e.message); }
    }
    db.prepare('UPDATE settings SET lastAutoStockCloseMonth=? WHERE id=1').execute([prevM.key]);
    if (closed) console.log(`[scheduler] auto-closed ${prevM.label} stock period for ${closed} branch(es).`);
  } catch (e) {
    console.warn('[scheduler] runAutoClose error:', e.message);
  }
}

function start() {
  setTimeout(runAutoClose, 20000);                 // shortly after boot (baseline / catch-up)
  setInterval(runAutoClose, 30 * 60 * 1000);       // every 30 minutes
}

module.exports = { start, runAutoClose, prevMonthInfo, closeBranchMonth };
