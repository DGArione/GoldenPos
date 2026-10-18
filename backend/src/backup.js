// ============================================================
// src/backup.js — automatic database backups
// ------------------------------------------------------------
// • Takes a consistent snapshot of pos.db with SQLite's VACUUM INTO
//   (safe while the POS is running — no need to stop service).
// • Runs once at start-up if today's backup is missing, then checks hourly,
//   and also after the configured hour (default 23:30, after closing).
// • Keeps the newest 30 daily backups in backend/data/backups/.
// • Optional second copy: set POS_BACKUP_DIR (e.g. D:\GoldenPOS-Backups or
//   a USB / OneDrive folder) to mirror each backup off the system drive.
//
//   node backend/src/backup.js --now     → take a backup immediately
// ============================================================
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const SC = require('./storage-config');
const DATA_DIR = SC.dataDir();
const DB_FILE = process.env.POS_DB_FILE || path.join(DATA_DIR, 'pos.db');
// The backup folder can be changed in Settings > Storage without a restart,
// so it is looked up each time instead of being fixed at start-up.
const backupDir = () => SC.backupDir();
const MIRROR_DIR = (process.env.POS_BACKUP_DIR || '').trim();
const KEEP = parseInt(process.env.POS_BACKUP_KEEP || '30', 10);
// Daily backup time comes from Settings > Storage & backups (default 23:59).
const eveningTime = () => SC.backupTime().split(':').map(Number);

const pad2 = (n) => String(n).padStart(2, '0');
const today = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function prune(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => /^pos-\d{4}-\d{2}-\d{2}.*\.db$/.test(f)).sort();
    while (files.length > KEEP) fs.rmSync(path.join(dir, files.shift()), { force: true });
  } catch (_) {}
}

function backupNow(tag = '') {
  if (!fs.existsSync(DB_FILE)) return null;
  const BACKUP_DIR = backupDir();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `pos-${today()}${tag ? '-' + tag : ''}.db`;
  const target = path.join(BACKUP_DIR, name);
  const tmp = target + '.tmp';
  fs.rmSync(tmp, { force: true });
  const conn = new DatabaseSync(DB_FILE);
  try {
    conn.exec('PRAGMA busy_timeout = 10000;');
    conn.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally { conn.close(); }
  fs.renameSync(tmp, target);   // atomic replace of today's file
  prune(BACKUP_DIR);
  if (MIRROR_DIR) {
    try { fs.mkdirSync(MIRROR_DIR, { recursive: true }); fs.copyFileSync(target, path.join(MIRROR_DIR, name)); prune(MIRROR_DIR); }
    catch (e) { console.warn('[backup] mirror copy failed:', e.message); }
  }
  console.log(`[backup] ✓ ${target}`);
  return target;
}

let lastEvening = '';
function tick() {
  try {
    const now = new Date();
    const file = path.join(backupDir(), `pos-${today(now)}.db`);
    const EVENING = eveningTime();
    const afterEvening = now.getHours() > EVENING[0] || (now.getHours() === EVENING[0] && now.getMinutes() >= (EVENING[1] || 0));
    if (!fs.existsSync(file)) backupNow();
    else if (afterEvening && lastEvening !== today(now)) { backupNow(); lastEvening = today(now); console.log(`[backup] end-of-day backup done (${SC.backupTime()})`); }
  } catch (e) { console.warn('[backup] failed:', e.message); }
}

function start() {
  setTimeout(tick, 20000);                 // shortly after boot
  setInterval(tick, 30 * 1000).unref?.();   // every 30 s so a time like 23:59 is never missed
  console.log(`[backup] daily backup at ${SC.backupTime()} → ${backupDir()}${MIRROR_DIR ? ' (+ mirror ' + MIRROR_DIR + ')' : ''}`);
}

// ── Restore ────────────────────────────────────────────────
// A restore never touches the live database while it is open. The API checks
// the file, saves a safety copy of the current data, writes a "restore
// pending" note and restarts the backend; db.js swaps the file in on boot
// (applyPendingRestore) before opening it.
const PENDING = path.join(DATA_DIR, 'restore-pending.json');
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}\.db$/;

function backupPath(name) {
  if (!SAFE_NAME.test(String(name || ''))) throw new Error('Invalid backup name');
  const BACKUP_DIR = backupDir();
  const p = path.join(BACKUP_DIR, name);
  if (path.dirname(p) !== BACKUP_DIR || !fs.existsSync(p)) throw new Error('Backup not found');
  return p;
}

/** Open a backup read-only and check it is a healthy Golden POS database. */
function inspectBackup(file) {
  let conn;
  try { conn = new DatabaseSync(file, { readOnly: true }); }
  catch (e) { throw new Error('This is not a Golden POS backup file.'); }
  try {
    const ok = conn.prepare('PRAGMA quick_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('This backup file is damaged.');
    const tables = new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    for (const t of ['users', 'menu_items', 'orders', 'settings', 'branches']) {
      if (!tables.has(t)) throw new Error('This is not a Golden POS backup file.');
    }
    const n = (sql) => { try { return Number(Object.values(conn.prepare(sql).get())[0]) || 0; } catch (_) { return 0; } };
    const last = conn.prepare('SELECT MAX(createdAt) AS m FROM orders').get();
    const admins = n("SELECT COUNT(*) FROM users WHERE role='admin'");
    if (!admins) throw new Error('This backup has no admin account, so nobody could manage the POS after restoring.');
    return {
      users: n('SELECT COUNT(*) FROM users'), menuItems: n('SELECT COUNT(*) FROM menu_items'),
      orders: n('SELECT COUNT(*) FROM orders'), lastOrderAt: (last && last.m) || null,
    };
  } catch (e) {
    throw /^This /.test(e.message) ? e : new Error('This is not a Golden POS backup file.');
  } finally { conn.close(); }
}

function scheduleRestore(name) {
  const file = backupPath(name);
  inspectBackup(file);
  const safety = backupNow('before-restore-' + new Date().toISOString().slice(11, 19).replace(/:/g, ''));
  fs.writeFileSync(PENDING, JSON.stringify({ file, requestedAt: new Date().toISOString(), safety }));
  return { safety: safety ? path.basename(safety) : null };
}

/** Called by db.js BEFORE the database is opened. */
function applyPendingRestore() {
  if (!fs.existsSync(PENDING)) return;
  let job = null;
  try { job = JSON.parse(fs.readFileSync(PENDING, 'utf8')); } catch (_) {}
  fs.rmSync(PENDING, { force: true });
  if (!job || !job.file || !fs.existsSync(job.file)) { console.warn('[restore] pending restore skipped - file missing'); return; }
  const tmp = DB_FILE + '.restoring';
  fs.copyFileSync(job.file, tmp);
  for (const f of [DB_FILE + '-wal', DB_FILE + '-shm', DB_FILE]) fs.rmSync(f, { force: true });
  fs.renameSync(tmp, DB_FILE);
  console.log(`[restore] ✓ database restored from ${path.basename(job.file)} (safety copy: ${job.safety ? path.basename(job.safety) : 'none'})`);
}

/** Save an uploaded .db (e.g. from a USB stick) into the backups folder. */
function saveUploadedBackup(buf) {
  const BACKUP_DIR = backupDir();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const name = `uploaded-${stamp}.db`;
  const target = path.join(BACKUP_DIR, name);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, buf);
  try { inspectBackup(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  fs.renameSync(tmp, target);
  return name;
}

module.exports = { start, backupNow, get BACKUP_DIR() { return backupDir(); }, backupPath, inspectBackup, scheduleRestore, applyPendingRestore, saveUploadedBackup };

if (require.main === module && process.argv.includes('--now')) {
  const f = backupNow('manual-' + Date.now());
  if (!f) { console.error('No database found at', DB_FILE); process.exit(1); }
}
