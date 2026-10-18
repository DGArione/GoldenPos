// ============================================================
// src/storage-config.js — where the POS keeps its data and backups
// ------------------------------------------------------------
// The choice is stored in backend/storage-config.json (NOT inside the
// database, because the location has to be known before the database opens).
//   { "dataDir": "D:\\POS-Data", "backupDir": "E:\\POS-Backups" }
// Empty / missing = the original defaults (backend/data and backend/data/backups).
//
// Moving the data folder is done safely at the next start-up (before the
// database opens): the database is copied with VACUUM INTO, verified, and the
// OLD folder is left untouched as a fallback.
// An environment variable POS_DATA_DIR still wins (and locks the setting).
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');                       // backend/
const CFG_FILE = process.env.POS_STORAGE_CONFIG || path.join(ROOT, 'storage-config.json');
const RESULT_FILE = path.join(ROOT, 'storage-move-result.json');
const DEFAULT_DATA = path.join(ROOT, 'data');

function readCfg() {
  try { const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); return j && typeof j === 'object' ? j : {}; }
  catch (_) { return {}; }
}
function writeCfg(cfg) {
  const tmp = CFG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CFG_FILE);
}

const envLocked = () => !!(process.env.POS_DATA_DIR || '').trim();
function dataDir() {
  const env = (process.env.POS_DATA_DIR || '').trim();
  if (env) return path.resolve(env);
  const c = readCfg();
  return path.resolve((c.dataDir && String(c.dataDir).trim()) || DEFAULT_DATA);
}
function backupDir() {
  const c = readCfg();
  return path.resolve((c.backupDir && String(c.backupDir).trim()) || path.join(dataDir(), 'backups'));
}
const defaultDataDir = () => DEFAULT_DATA;
const defaultBackupDir = () => path.join(dataDir(), 'backups');
function pendingMove() { const c = readCfg(); return c.pendingDataDir || null; }
function lastMoveResult() { try { return JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8')); } catch (_) { return null; } }

// ── Folder checks ────────────────────────────────────────────
function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      try { total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } catch (_) {}
    }
  } catch (_) {}
  return total;
}
function nearestExisting(p) {
  let cur = p;
  for (let i = 0; i < 64; i++) {
    if (fs.existsSync(cur)) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
  return null;
}
/** Is this folder usable, and how much room is on its drive? Creates nothing. */
function checkFolder(input) {
  const raw = String(input || '').trim().replace(/^"+|"+$/g, '');
  const out = { ok: false, path: raw, error: '', exists: false, freeBytes: 0, totalBytes: 0, root: '' };
  if (!raw) { out.error = 'Enter a folder path.'; return out; }
  if (!path.isAbsolute(raw)) { out.error = 'Use a full path, for example D:\\GoldenPOS-Data'; return out; }
  const p = path.resolve(raw);
  out.path = p; out.root = path.parse(p).root;
  const anchor = nearestExisting(p);
  if (!anchor || !fs.existsSync(out.root)) { out.error = `The drive ${out.root || ''} was not found on this computer.`; return out; }
  out.exists = fs.existsSync(p);
  if (out.exists && !fs.statSync(p).isDirectory()) { out.error = 'That path is a file, not a folder.'; return out; }
  try {
    const st = fs.statfsSync(anchor);
    out.freeBytes = Number(st.bavail) * Number(st.bsize);
    out.totalBytes = Number(st.blocks) * Number(st.bsize);
  } catch (e) { out.error = 'Could not read the free space of that drive: ' + e.message; return out; }
  // Writable? Try a tiny temp file in the folder (or in the nearest existing parent).
  const probe = path.join(out.exists ? p : anchor, '.pos-write-test-' + process.pid + '.tmp');
  try { fs.writeFileSync(probe, 'ok'); fs.rmSync(probe, { force: true }); }
  catch (e) { out.error = 'Golden POS cannot write to that folder (' + (e.code || e.message) + ').'; return out; }
  out.ok = true;
  return out;
}

// ── Pending data-folder move (runs before the database opens) ─
function recordResult(r) { try { fs.writeFileSync(RESULT_FILE, JSON.stringify({ at: new Date().toISOString(), ...r }, null, 2)); } catch (_) {} }

function applyPendingMove() {
  const cfg = readCfg();
  const target = cfg.pendingDataDir;
  if (!target) return;
  const from = (process.env.POS_DATA_DIR || '').trim() || (cfg.dataDir && String(cfg.dataDir).trim()) || DEFAULT_DATA;
  const fail = (msg) => {
    console.error('[storage] data move cancelled - ' + msg + '. Still using ' + from);
    delete cfg.pendingDataDir; writeCfg(cfg);
    recordResult({ ok: false, from, to: target, error: msg });
  };
  const tmpDb = path.join(target, 'pos.db.moving');
  try {
    const src = path.join(from, 'pos.db');
    if (!fs.existsSync(src)) return fail('no database found in the current folder');
    fs.mkdirSync(target, { recursive: true });
    if (fs.existsSync(path.join(target, 'pos.db'))) return fail('the new folder already contains a pos.db - choose an empty folder');
    const { DatabaseSync } = require('node:sqlite');
    fs.rmSync(tmpDb, { force: true });
    const conn = new DatabaseSync(src);
    let srcOrders = 0;
    try {
      conn.exec('PRAGMA busy_timeout = 10000;');
      srcOrders = Number(Object.values(conn.prepare('SELECT COUNT(*) FROM orders').get())[0]) || 0;
      conn.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
    } finally { conn.close(); }
    // Verify the copy before using it.
    const chk = new DatabaseSync(tmpDb, { readOnly: true });
    try {
      const ok = chk.prepare('PRAGMA quick_check').get();
      if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('the copied database failed its integrity check');
      const n = Number(Object.values(chk.prepare('SELECT COUNT(*) FROM orders').get())[0]) || 0;
      if (n !== srcOrders) throw new Error(`order count differs after copy (${srcOrders} vs ${n})`);
    } finally { chk.close(); }
    fs.renameSync(tmpDb, path.join(target, 'pos.db'));
    // Everything else that lives next to the database.
    for (const f of ['secret.txt', 'staff-access.json', 'staff-access.key', 'cloudflare-access.json']) {
      const a = path.join(from, f); if (fs.existsSync(a)) fs.copyFileSync(a, path.join(target, f));
    }
    const logs = path.join(from, 'print-log');
    if (fs.existsSync(logs)) fs.cpSync(logs, path.join(target, 'print-log'), { recursive: true });
    // Backups stored in the default place travel with the data.
    if (!cfg.backupDir) {
      const b = path.join(from, 'backups');
      if (fs.existsSync(b)) fs.cpSync(b, path.join(target, 'backups'), { recursive: true });
    }
    cfg.dataDir = target; delete cfg.pendingDataDir; writeCfg(cfg);
    recordResult({ ok: true, from, to: target, orders: srcOrders });
    console.log(`[storage] ✓ data moved to ${target} (old copy kept in ${from})`);
  } catch (e) {
    try { fs.rmSync(tmpDb, { force: true }); } catch (_) {}
    fail(e.message);
  }
}

function setBackupDir(dir) { const c = readCfg(); if (dir) c.backupDir = dir; else delete c.backupDir; writeCfg(c); }
function requestDataMove(dir) { const c = readCfg(); c.pendingDataDir = dir; writeCfg(c); }
function cancelDataMove() { const c = readCfg(); delete c.pendingDataDir; writeCfg(c); }

module.exports = {
  CFG_FILE, dataDir, backupDir, defaultDataDir, defaultBackupDir, envLocked, pendingMove, lastMoveResult,
  checkFolder, dirSize, applyPendingMove, setBackupDir, requestDataMove, cancelDataMove,
};
