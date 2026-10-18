#!/usr/bin/env node
// ============================================================
// Golden POS — customer-only public gateway (zero dependencies)
// ------------------------------------------------------------
// The ONLY thing published to the internet (through Cloudflare Tunnel or
// Tailscale Funnel) so customers on MOBILE DATA can scan the table QR,
// see the menu and order. Staff screens, logins, settings, reports and the
// printer are NEVER reachable through it.
//
//   internet ──tunnel──► 127.0.0.1:3100 (this) ──► 127.0.0.1:3000 (POS UI)
//
// Allowed:  GET  /t/<token>              table menu page
//           GET  /_next/static/*         page scripts/styles
//           GET  /favicon.ico
//           GET  /api/public/table       which table this QR is
//           GET  /api/public/menu        the menu
//           GET  /api/public/menu-image/<id>  dish photo
//           GET  /api/public/table-orders  progress of this phone's orders
//           GET  /api/public/promotions  offers the restaurant chose to show
//           POST /api/public/promo-preview  what the cart would save
//           POST /api/public/table-order place an order (staff must accept)
//           POST /api/public/reservation table booking
// Everything else → 404. Rate-limited per phone and per table.
// Env: GATEWAY_PORT (3100), POS_UI (http://127.0.0.1:3000)
// ============================================================
'use strict';

const http = require('http');

const PORT = parseInt(process.env.GATEWAY_PORT || '3100', 10);
const UPSTREAM = new URL(process.env.POS_UI || 'http://127.0.0.1:3000');
const MAX_BODY = 64 * 1024;

const RULES = [
  { method: 'GET',  re: /^\/t\/[A-Za-z0-9]{4,40}\/?$/ },
  // Next.js build files; route folders like [token] arrive as %5Btoken%5D. No '..' allowed.
  { method: 'GET',  re: /^\/_next\/static\/(?:[A-Za-z0-9_\-~]|%5[BbDd]|\.(?!\.))+(?:\/(?:[A-Za-z0-9_\-~]|%5[BbDd]|\.(?!\.))+)*$/ },
  { method: 'GET',  re: /^\/favicon\.ico$/ },
  { method: 'GET',  re: /^\/api\/public\/table$/ },
  { method: 'GET',  re: /^\/api\/public\/menu$/ },
  { method: 'GET',  re: /^\/api\/public\/menu-image\/\d{1,9}$/, image: true },
  { method: 'GET',  re: /^\/api\/public\/table-orders$/ },
  { method: 'GET',  re: /^\/api\/public\/promotions$/ },
  { method: 'POST', re: /^\/api\/public\/promo-preview$/ },
  { method: 'POST', re: /^\/api\/public\/table-order$/, order: true },
  { method: 'POST', re: /^\/api\/public\/reservation$/, order: true },
];

// ── simple sliding-window rate limits ──────────────────────
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  buckets.set(key, list);
  return list.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600000)) buckets.delete(k); }, 600000).unref();

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
}

const NOT_HERE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scan the QR on your table</title><style>body{font-family:system-ui,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#fff7ec;color:#222;text-align:center;padding:24px}
h1{font-size:22px;margin:0 0 8px}p{color:#666;margin:0}</style></head><body><div><h1>Please scan the QR code on your table</h1><p>That opens the menu for your table so you can order.</p></div></body></html>`;

function send(res, code, body, type = 'text/html; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const path = url.pathname;
  const ip = clientIp(req);

  if (path === '/gateway-health') return send(res, 200, '{"ok":true}', 'application/json');

  const rule = RULES.find((r) => r.method === req.method && r.re.test(path));
  if (!rule) {
    if (req.method === 'GET' && !path.startsWith('/api/')) return send(res, 404, NOT_HERE);
    return send(res, 404, '{"error":"Not available"}', 'application/json');
  }

  // Limits: 240 requests/min per phone; orders: 8 per 10 min per phone.
  // Dish photos have their own bucket so a big menu never hits the page limit.
  if (rule.image) { if (limited('img:' + ip, 600, 60000)) return send(res, 429, '', 'text/plain'); }
  else if (limited('all:' + ip, 240, 60000)) return send(res, 429, '{"error":"Too many requests — please wait a minute."}', 'application/json');
  if (rule.order && limited('order:' + ip, 8, 600000)) return send(res, 429, '{"error":"Too many orders from this phone. Please ask a waiter."}', 'application/json');

  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    // Per-table order limit (stops someone spamming one table's QR): 30 per hour.
    if (rule.order && path.endsWith('/table-order')) {
      try { const tok = JSON.parse(body.toString('utf8') || '{}').token || ''; if (tok && limited('table:' + tok, 30, 3600000)) return send(res, 429, '{"error":"This table has placed many orders. Please ask a waiter."}', 'application/json'); }
      catch (_) { return send(res, 400, '{"error":"Bad request"}', 'application/json'); }
    }
    const headers = {
      'accept': req.headers['accept'] || '*/*',
      'accept-encoding': req.headers['accept-encoding'] || '',
      'accept-language': req.headers['accept-language'] || '',
      'user-agent': req.headers['user-agent'] || '',
      'content-type': req.headers['content-type'] || '',
      'x-forwarded-for': ip,
      'host': UPSTREAM.host,
    };
    // Next.js page navigation headers (needed for the /t page to load)
    for (const h of ['rsc', 'next-router-state-tree', 'next-router-prefetch', 'next-url']) if (req.headers[h]) headers[h] = req.headers[h];
    if (body.length) headers['content-length'] = String(body.length);
    const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port || 80, method: req.method, path: path + url.search, headers, timeout: 20000 }, (ur) => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) {
        if (/^(set-cookie|x-powered-by|server)$/i.test(k)) continue;   // never leak cookies/server info
        out[k] = v;
      }
      // Menu / table answers must always be fresh (new dishes, sold-outs) - never cached by Cloudflare or the phone.
      if (path.startsWith('/api/public/') && !rule.image) out['cache-control'] = 'no-store';
      out['x-content-type-options'] = 'nosniff';
      out['referrer-policy'] = 'no-referrer';
      res.writeHead(ur.statusCode || 502, out);
      ur.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('timeout')));
    up.on('error', () => { if (!res.headersSent) send(res, 502, '{"error":"The restaurant system is starting — please try again in a minute."}', 'application/json'); });
    up.end(body);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`[gateway] port ${PORT} in use — another gateway is running. Exiting.`); process.exit(0); }
  console.error('[gateway] error:', e); process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => console.log(`[gateway] customer-only gateway on http://127.0.0.1:${PORT} → ${UPSTREAM.origin}`));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
