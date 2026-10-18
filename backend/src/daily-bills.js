// ============================================================
// src/daily-bills.js — Daily CARD and CASH bill report
// ------------------------------------------------------------
// Two slips for one day: every card payment and every cash payment
// (order number, time, table, amount) with the total.
// • Printed automatically every day at the time set in Settings
//   (default 23:30) on the payment (bill) printer.
// • Printed on demand from Reports → "Daily card & cash bills".
// ============================================================
'use strict';

const { db } = require('./db');
const { jsonDecode } = require('./helpers');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Parse either an ISO time (payments) or a local "YYYY-MM-DD HH:MM:SS" (orders). */
function parseWhen(v) {
  if (!v) return null;
  const s = String(v);
  const d = /[TZ]/.test(s) ? new Date(s) : new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function settingsRow() {
  return db.query('SELECT * FROM settings WHERE id=1').fetch() || {};
}

/**
 * Collect the card and cash payments made on `date` (YYYY-MM-DD).
 * Split payments are listed under each method with their own amount;
 * refunds appear as negative lines.
 */
function collect(date, branchId) {
  const st = branchId
    ? db.prepare("SELECT * FROM orders WHERE branchId=? AND (date(paidAt)=? OR date(createdAt)=? OR date(createdAt)=date(?,'-1 day'))")
    : db.prepare("SELECT * FROM orders WHERE (date(paidAt)=? OR date(createdAt)=? OR date(createdAt)=date(?,'-1 day'))");
  st.execute(branchId ? [branchId, date, date, date] : [date, date, date]);
  const card = [], cash = [];
  for (const o of st.fetchAll()) {
    const payments = jsonDecode(o.payments, []) || [];
    const num = o.displayNum || ('#' + String(o.id).padStart(4, '0'));
    const table = o.orderType === 'dine-in' && o.tableName ? String(o.tableName) : '';
    for (const p of payments) {
      const method = String(p.method || '').toLowerCase();
      if (method !== 'cash' && method !== 'card') continue;
      const when = parseWhen(p.paidAt) || parseWhen(o.paidAt) || parseWhen(o.createdAt);
      if (!when || ymd(when) !== date) continue;
      const amount = Math.round(Number(p.amount || 0) * 100) / 100;
      if (!amount) continue;
      const line = { orderId: Number(o.id), orderNum: num, time: hm(when), table, amount, refund: amount < 0 || p.type === 'refund', at: when.getTime() };
      (method === 'card' ? card : cash).push(line);
    }
  }
  const sort = (a, b) => a.at - b.at;
  card.sort(sort); cash.sort(sort);
  const total = (l) => Math.round(l.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  return { date, card, cash, cardTotal: total(card), cashTotal: total(cash) };
}

function money(v, cur) {
  const n = Number(v) || 0;
  return (n < 0 ? '-' : '') + cur + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Plain-text slip for the thermal printer, `width` characters wide. */
function slipText(rep, kind, s, width) {
  const w = Math.max(32, Math.min(64, parseInt(width, 10) || 48));
  const cur = s.currencySymbol || 'Rs. ';
  const lines = kind === 'card' ? rep.card : rep.cash;
  const total = kind === 'card' ? rep.cardTotal : rep.cashTotal;
  const center = (t) => { t = String(t).slice(0, w); const p = Math.floor((w - t.length) / 2); return ' '.repeat(Math.max(0, p)) + t; };
  const row = (a, b) => { a = String(a); b = String(b); if (a.length + b.length + 1 > w) a = a.slice(0, w - b.length - 1); return a + ' '.repeat(Math.max(1, w - a.length - b.length)) + b; };
  // Columns: order no | time | table | amount (right)
  const amtW = Math.max(12, Math.floor(w * 0.3));
  const numW = Math.floor((w - amtW) * 0.38), timeW = 6, tblW = w - amtW - numW - timeW;
  const col = (n, t, tb, a) => (String(n).slice(0, numW - 1).padEnd(numW) + String(t).padEnd(timeW) + String(tb).slice(0, tblW - 1).padEnd(tblW)).slice(0, w - amtW) + String(a).padStart(amtW);
  const out = [];
  out.push(center((s.businessName || 'Restaurant').toUpperCase()));
  out.push(center(kind === 'card' ? 'DAILY CARD BILLS' : 'DAILY CASH BILLS'));
  out.push('='.repeat(w));
  out.push(row('Date: ' + rep.date, 'Printed: ' + hm(new Date())));
  out.push('-'.repeat(w));
  out.push(col('Order', 'Time', 'Table', 'Amount'));
  out.push('-'.repeat(w));
  if (!lines.length) out.push(center('No ' + kind + ' bills'));
  for (const l of lines) out.push(col(l.orderNum, l.time, l.table || '-', money(l.amount, cur) + (l.refund ? ' R' : '')));
  out.push('-'.repeat(w));
  out.push(row('Bills: ' + lines.length, 'TOTAL ' + money(total, cur)));
  out.push('='.repeat(w));
  out.push('');
  return out.join('\n');
}

/** Send both slips to the payment printer through the print agent. */
async function printDaily(date, branchId) {
  const s = settingsRow();
  const url = String(s.printAgentUrl || 'http://localhost:9110/print').trim().replace('://localhost', '://127.0.0.1');
  const printerName = String(s.paymentPrinterName || '').trim();
  if (!s.printAgentEnabled) return { ok: false, error: 'Direct thermal printing is turned off (Settings → Printer management).' };
  if (!printerName) return { ok: false, error: 'No payment printer selected (Settings → Printer management).' };
  const rep = collect(date, branchId);
  const width = s.printPaperWidth || 48;
  for (const kind of ['card', 'cash']) {
    const text = slipText(rep, kind, s, width);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'report', title: `Daily ${kind} bills ${date}`, text, printerName, copies: 1, width }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) { return { ok: false, error: 'Print agent not reachable: ' + e.message, report: rep }; }
    if (!res.ok) { const j = await res.json().catch(() => ({})); return { ok: false, error: j.error || ('Print agent returned ' + res.status), report: rep }; }
  }
  return { ok: true, report: rep };
}

// ── Automatic print at the configured time ────────────────────
let busy = false;
async function tick() {
  if (busy) return;
  try {
    const s = settingsRow();
    if (s.dailyReportEnabled === 0) return;
    const [h, m] = String(s.dailyReportTime || '23:30').split(':').map((x) => parseInt(x, 10));
    if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return;
    const now = new Date();
    const today = ymd(now);
    if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;   // not time yet
    if (s.lastDailyReportDate === today) return;                         // already printed today
    busy = true;
    db.prepare('UPDATE settings SET lastDailyReportDate=? WHERE id=1').execute([today]);  // mark first: never double-print
    const r = await printDaily(today, null);
    console.log(r.ok ? `[daily-bills] ✓ printed card & cash bills for ${today}` : `[daily-bills] could not print for ${today}: ${r.error}`);
  } catch (e) { console.warn('[daily-bills] error:', e.message); }
  finally { busy = false; }
}

function start() {
  // Baseline: if the POS starts after today's print time, don't print a late report on boot —
  // only print automatically when the configured time is reached while the POS is running.
  try {
    const s = settingsRow();
    const [h, m] = String(s.dailyReportTime || '23:30').split(':').map((x) => parseInt(x, 10));
    const now = new Date();
    if (!s.lastDailyReportDate && now.getHours() * 60 + now.getMinutes() >= h * 60 + m) {
      db.prepare('UPDATE settings SET lastDailyReportDate=? WHERE id=1').execute([ymd(now)]);
    }
  } catch (_) {}
  setInterval(tick, 30 * 1000).unref?.();
  setTimeout(tick, 15000);
}

module.exports = { collect, slipText, printDaily, start, tick };
