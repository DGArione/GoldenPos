// ============================================================
// server.js — Express host for the Restaurant POS
// ------------------------------------------------------------
// Serves the single-page front-end from public/ (with Apache-style clean
// URLs) and mounts the ported REST API under /api.
// ============================================================
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const api = require('./src/api');
const { Resp } = require('./src/helpers');
const { DB_FILE, raw } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.set('trust proxy', true);

// ── Security headers (from the original .htaccess) ───────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── JSON body parsing ────────────────────────────────────────
// Generous limit so a full backup file can be restored via /settings/import.
app.use(express.json({ limit: '50mb' }));

// ── API router ───────────────────────────────────────────────
// Handles every method under /api/*; the ctx mirrors the PHP superglobals.
// ── Staff screens are for this computer and the restaurant Wi-Fi only ──
// Anything arriving through Cloudflare (cf-ray / cf-connecting-ip headers) is
// refused. Customer QR ordering is not affected: it goes through the customer
// gateway, which never passes those headers on.
app.use('/api', (req, res, next) => {
  if (req.headers['cf-ray'] || req.headers['cf-connecting-ip']) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'The POS can only be used on the POS computer or the restaurant Wi-Fi.' });
  }
  next();
});

// A new id every time the server starts. The POS screen remembers it at
// login and locks itself (back to the PIN screen) when it changes.
const BOOT_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
app.get('/api/boot', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ bootId: BOOT_ID }); });

// Dish photo for the customer menu (public). Decodes the stored data: URL
// and serves it as a normal, cacheable image. SVG is never served (scripts).
app.get('/api/public/menu-image/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  let row = null;
  try { if (id > 0) row = raw.prepare('SELECT imageUrl FROM menu_items WHERE id=?').get(id); } catch (_) {}
  const m = row && /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(row.imageUrl || ''));
  if (!m) return res.status(404).end();
  const type = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  res.setHeader('Content-Type', 'image/' + type);
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  res.end(Buffer.from(m[2], 'base64'));
});

app.all('/api', apiHandler);
app.all('/api/*', apiHandler);

function apiHandler(req, res) {
  // Preflight (same-origin by default, but be permissive for split hosting)
  const origin = req.headers.origin || '';
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Derive the route path the way the PHP getUri() did: strip the /api prefix
  // (and an optional /index.php, since some front-end pages call the API as
  // "api/index.php/..." directly instead of through the shared api() helper).
  let uri = req.path.replace(/^\/api/, '');
  uri = uri.replace(/^\/index\.php/, '');
  uri = uri.replace(/\/+$/, '') || '/';

  const ctx = {
    method: req.method,
    uri,
    query: req.query || {},
    body: req.body || {},
    headers: req.headers || {},
    remoteAddr: req.ip || (req.socket && req.socket.remoteAddress) || 'unknown',
    userAgent: req.headers['user-agent'] || '',
  };

  try {
    api.handle(ctx);
    // handle() always terminates via a thrown Resp; reaching here is a bug.
    res.status(500).json({ error: 'Internal server error' });
  } catch (e) {
    if (e instanceof Resp) {
      res.status(e.code).json(e.data);
      // Record a change-audit row for successful mutating requests.
      try { if (e.code < 400) api.auditLog(ctx, e.code); } catch (_) {}
    } else {
      console.error('[api]', e && e.stack ? e.stack : e);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

// ── Static front-end ─────────────────────────────────────────
// Never expose the server-side files or the data directory.
app.use(express.static(PUBLIC_DIR, { extensions: [], index: 'index.html' }));

// ── QR table ordering: /t/<token> serves the guest ordering page ──
// table.js reads the token from its own URL path.
app.get(/^\/t\/[A-Za-z0-9]+$/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'table.html'));
});

// ── Clean URLs: /payment -> payment.html (Apache mod_rewrite parity) ──
app.get(/^\/([A-Za-z0-9_-]+)$/, (req, res, next) => {
  const name = req.params[0];
  const file = path.join(PUBLIC_DIR, name + '.html');
  if (fs.existsSync(file)) return res.sendFile(file);
  next();
});

// ── Health check (used by the kiosk launcher / watchdog) ─────
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

// ── Fallback ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('Not found');
});

// ── Background scheduler (auto month-end stock close) ────────
try { require('./src/scheduler').start(); } catch (e) { console.warn('[scheduler] not started:', e.message); }
// ── Daily card & cash bill report (auto-print at the time set in Settings) ──
try { require('./src/daily-bills').start(); } catch (e) { console.warn('[daily-bills] not started:', e.message); }
// ── Automatic daily database backups ─────────────────────────
try { require('./src/backup').start(); } catch (e) { console.warn('[backup] not started:', e.message); }

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Restaurant POS running → http://localhost:${PORT}`);
  console.log(`  Database file: ${DB_FILE}`);
  console.log('  Demo logins (PIN): Admin 9999 · Super Manager 1234 · Manager 1111 · Server 2222 · Cashier 3333 · Kitchen 4444\n');
});

// Flush the WAL into pos.db on a clean shutdown (Windows shutdown / restart).
function shutdown() {
  try { require('./src/db').raw.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
