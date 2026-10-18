#!/usr/bin/env node
// ============================================================
// Golden POS thermal print agent (zero dependencies) — v19
// ------------------------------------------------------------
// Local service on the till that receives print jobs from the POS UI and
// sends ESC/POS bytes to the thermal printers. No browser print dialog,
// no "Save as" prompt — ever.
//
// What's new in v19
//   • One persistent PowerShell spooler worker (the C# RAW-printer class is
//     compiled ONCE at startup). Previously every ticket spawned PowerShell
//     and recompiled C#, costing ~1.5–3 s per print. Now ~50–150 ms.
//   • Per-printer job queue: KOTs and bills never race each other.
//   • Cash-drawer kick can be embedded in the receipt job ({openDrawer:true})
//     so the drawer opens the instant the bill starts printing — one spool
//     job, no second round-trip.
//   • Every bill / KOT is written to a daily log file automatically
//     (backend/data/print-log/YYYY-MM/YYYY-MM-DD-receipts.log), even when the
//     printer is offline, so no bill is ever lost.
//   • GET /health for the launcher/watchdog.
//   • CORS limited to the POS's own origins (override with CORS=*).
//
// Env: PORT (9110), PRINTER (stdout | /dev/usb/lp0 | tcp://ip:9100),
//      CORS (comma list or *), POS_DATA_DIR (default ../data)
// Job: { type, title, text, copies, printerName, barcodeData, openDrawer }
// ============================================================
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '9110', 10);
const PRINTER = process.env.PRINTER || 'stdout';
const IS_WINDOWS = process.platform === 'win32';
// The data folder can be changed in Settings > Storage, so it is looked up on use.
const dataDirNow = () => {
  try { return require('../src/storage-config').dataDir(); }
  catch (_) { return process.env.POS_DATA_DIR || path.join(__dirname, '..', 'data'); }
};
const logDirNow = () => path.join(dataDirNow(), 'print-log');

// Only the POS's own pages may print / kick the drawer (no random websites).
const CORS_RAW = (process.env.CORS || '').trim();
// The agent listens on 127.0.0.1 only; LAN tablets reach it through the
// till's web server (/print-agent/*), so their private-LAN origin is allowed.
const ORIGIN_OK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;
function allowOrigin(origin) {
  if (!origin) return null;
  if (CORS_RAW === '*') return '*';
  if (CORS_RAW && CORS_RAW.split(',').map(s => s.trim()).includes(origin)) return origin;
  return ORIGIN_OK.test(origin) ? origin : null;
}

// ESC/POS control codes
const ESC = '\x1B', GS = '\x1D';
const INIT = ESC + '@';
const CUT = GS + 'V' + '\x42' + '\x00';   // feed + partial cut
const FEED = '\n\n\n';
const DRAWER_KICK = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]); // ESC p 0 25 250 (pin 2)

// ── Automatic print log (bills are always recorded) ──────────
const pad2 = (n) => String(n).padStart(2, '0');
function logJob(job, printerName, status, error) {
  try {
    const d = new Date();
    const month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const day = `${month}-${pad2(d.getDate())}`;
    const kind = /kot|kitchen/i.test(job.type || '') ? 'kot' : (job.type === 'test' ? 'test' : (job.type === 'qr' ? 'qr' : 'receipts'));
    const dir = path.join(logDirNow(), month);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const head = `===== ${stamp} | ${job.type || 'job'} | ${job.title || ''} | → ${printerName || PRINTER} | ${status}${error ? ' (' + error + ')' : ''}${job.openDrawer ? ' | drawer' : ''}`;
    fs.appendFile(path.join(dir, `${day}-${kind}.log`), head + '\n' + String(job.text || '') + '\n\n', () => {});
  } catch (_) { /* logging must never break printing */ }
}

// ── PowerShell helpers ───────────────────────────────────────
function psEncoded(value) { return Buffer.from(String(value), 'utf16le').toString('base64'); }
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(script)], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `PowerShell exited ${code}`)));
  });
}

const RAW_PRINTER_CS = `
using System;
using System.Runtime.InteropServices;
public class GoldenPosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO1 { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO1 di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  public static void Send(string name, byte[] bytes) {
    IntPtr h; if (!OpenPrinter(name, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try { var di = new DOCINFO1(); di.pDocName = "Golden POS"; di.pDataType = "RAW"; int job = StartDocPrinter(h, 1, di); if (job == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try { if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error()); IntPtr p = Marshal.AllocHGlobal(bytes.Length); try { Marshal.Copy(bytes,0,p,bytes.Length); int written; if (!WritePrinter(h,p,bytes.Length,out written) || written != bytes.Length) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error()); } finally { Marshal.FreeHGlobal(p); } if (!EndPagePrinter(h)) throw new Exception("EndPagePrinter failed: " + Marshal.GetLastWin32Error()); }
      finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}`;

// ── Persistent spooler worker ────────────────────────────────
// Protocol (one line each way):  node → "id|printerB64|dataB64"
//                                ps   → "OK|id"  or  "ERR|id|message"
const WORKER_SCRIPT = `$ErrorActionPreference='Stop'
$src=@'
${RAW_PRINTER_CS}
'@
Add-Type -TypeDefinition $src
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split('|')
  if ($parts.Length -lt 3) { continue }
  $id = $parts[0]
  try {
    $printer = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
    $data = [Convert]::FromBase64String($parts[2])
    [GoldenPosRawPrinter]::Send($printer, $data)
    [Console]::Out.WriteLine('OK|' + $id)
  } catch {
    $msg = ($_.Exception.Message -replace '[\\r\\n|]+', ' ')
    [Console]::Out.WriteLine('ERR|' + $id + '|' + $msg)
  }
  [Console]::Out.Flush()
}`;

let worker = null, workerReady = null, workerBuf = '', nextId = 1;
const pending = new Map();

function startWorker() {
  if (!IS_WINDOWS) return null;
  if (workerReady) return workerReady;
  workerReady = new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(WORKER_SCRIPT)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    worker = ps;
    const readyTimer = setTimeout(() => reject(new Error('Spooler worker did not start in time')), 30000);
    ps.stdout.on('data', (chunk) => {
      workerBuf += chunk.toString();
      let idx;
      while ((idx = workerBuf.indexOf('\n')) >= 0) {
        const line = workerBuf.slice(0, idx).trim();
        workerBuf = workerBuf.slice(idx + 1);
        if (!line) continue;
        if (line === 'READY') { clearTimeout(readyTimer); console.log('[agent] spooler worker ready'); resolve(ps); continue; }
        const [st, id, ...rest] = line.split('|');
        const p = pending.get(id);
        if (!p) continue;
        pending.delete(id); clearTimeout(p.timer);
        st === 'OK' ? p.resolve() : p.reject(new Error(rest.join('|') || 'Print failed'));
      }
    });
    ps.stderr.on('data', d => console.error('[agent] worker:', d.toString().trim()));
    const onDead = () => {
      clearTimeout(readyTimer);
      worker = null; workerReady = null; workerBuf = '';
      for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('Spooler worker restarted')); }
      pending.clear();
      reject(new Error('Spooler worker exited'));
    };
    ps.on('exit', onDead);
    ps.on('error', onDead);
  });
  workerReady.catch(() => { workerReady = null; });
  return workerReady;
}

async function rawViaWorker(printerName, bytes) {
  const ps = await startWorker();
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Printer did not respond (15 s)')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ps.stdin.write(`${id}|${Buffer.from(String(printerName), 'utf8').toString('base64')}|${Buffer.from(bytes).toString('base64')}\n`);
  });
}

// One-shot fallback (old behaviour) in case the worker can't start.
async function rawOneShot(printerName, bytes) {
  const printer64 = Buffer.from(String(printerName), 'utf8').toString('base64');
  const bytes64 = Buffer.from(bytes).toString('base64');
  await runPowerShell(`$ErrorActionPreference='Stop'
$printer=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${printer64}'))
$data=[Convert]::FromBase64String('${bytes64}')
$src=@'
${RAW_PRINTER_CS}
'@
Add-Type -TypeDefinition $src
[GoldenPosRawPrinter]::Send($printer, $data)`);
}

async function sendRawBytesToWindowsPrinter(printerName, bytes) {
  try { return await rawViaWorker(printerName, bytes); }
  catch (e) {
    if (/OpenPrinter|StartDoc|WritePrinter|StartPage|EndPage|did not respond/.test(e.message)) throw e; // real printer error
    console.warn('[agent] worker unavailable, using one-shot spool:', e.message);
    return rawOneShot(printerName, bytes);
  }
}

// ── Per-printer serial queue ────────────────────────────────
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
  return next;
}

// ── Barcode-only slip (gift cards) ───────────────────────────
// Big, high-contrast CODE128 printed natively by the printer (sharpest
// possible bars), the code underneath in large text, then a cut.
function escposBarcodeOnly(code, title) {
  const clean = String(code || '').replace(/[^\x20-\x7e]/g, '').slice(0, 40);
  const modules = 11 * (clean.length + 3) + 2;
  const w = modules * 3 <= 560 ? 3 : 2;            // widest bars that fit 80 mm
  const parts = [Buffer.from(INIT + ESC + 'a' + '\x01', 'binary')];
  if (title) parts.push(Buffer.from(ESC + 'E' + '\x01' + String(title).slice(0, 32) + '\n' + ESC + 'E' + '\x00\n', 'utf8'));
  parts.push(Buffer.from(GS + 'h' + String.fromCharCode(162) + GS + 'w' + String.fromCharCode(w) + GS + 'H' + '\x00', 'binary'));
  parts.push(Buffer.from(GS + 'k' + '\x49' + String.fromCharCode(clean.length + 2) + '{B' + clean, 'binary'));
  parts.push(Buffer.from('\n' + ESC + '!' + '\x30' + clean + '\n' + ESC + '!' + '\x00' + FEED + CUT, 'binary'));
  return Buffer.concat(parts);
}

// ── Table QR card (raster image, works on any ESC/POS printer) ─
// The browser draws the QR code and sends it as a 1-bit bitmap, so the printer
// needs no QR firmware. job.raster = { width (dots, multiple of 8), height, dataBase64 }
function escposQrCard(job) {
  const r = job.raster || {};
  const width = parseInt(r.width, 10), height = parseInt(r.height, 10);
  const data = Buffer.from(String(r.dataBase64 || ''), 'base64');
  const bytesPerRow = width / 8;
  if (!(width > 0 && width <= 832 && width % 8 === 0) || !(height > 0 && height <= 2400) || data.length !== bytesPerRow * height) {
    throw new Error('Invalid QR image received');
  }
  const parts = [Buffer.from(INIT + ESC + 'a' + '\x01', 'binary')];
  const title = String(job.title || '').slice(0, 60);
  const sub = String(job.subtitle || '').slice(0, 80);
  if (title) parts.push(Buffer.from(ESC + 'E' + '\x01' + ESC + '!' + '\x30' + title + '\n' + ESC + '!' + '\x00' + ESC + 'E' + '\x00', 'utf8'));
  if (sub) parts.push(Buffer.from(sub + '\n\n', 'utf8'));
  // Send the bitmap in bands so printers with small buffers cope.
  const BAND = 128;
  for (let y = 0; y < height; y += BAND) {
    const h = Math.min(BAND, height - y);
    parts.push(Buffer.from([0x1D, 0x76, 0x30, 0x00, bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF]));
    parts.push(data.subarray(y * bytesPerRow, (y + h) * bytesPerRow));
  }
  const foot = String(job.footer || '').slice(0, 120);
  if (foot) parts.push(Buffer.from('\n' + foot + '\n', 'utf8'));
  parts.push(Buffer.from(FEED + CUT, 'binary'));
  return Buffer.concat(parts);
}

// ── ESC/POS ticket builder ──────────────────────────────────
function escposTicket(text, type = '', barcodeData = '', openDrawer = false, cols = 48) {
  const isKitchen = /kot|kitchen/i.test(String(type || ''));
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const chunks = [];
  const ctl = (value) => chunks.push(Buffer.from(value, 'binary'));
  const txt = (value) => chunks.push(Buffer.from(value, 'utf8'));
  // Full printable area for standard 80 mm / 203 dpi printer heads.
  ctl(INIT + GS + 'L' + '\x00' + '\x00' + GS + 'W' + '\x40' + '\x02' + ESC + 'a' + '\x01' + ESC + 'E' + '\x00' + ESC + '!' + '\x00');
  // Kick the drawer first so it opens while the bill is still printing.
  if (openDrawer && !isKitchen) chunks.push(DRAWER_KICK);
  // Word-wrap to the paper width instead of cutting text off.
  // Double-width text (order number) fits half as many characters.
  const COLS = Math.max(24, Math.min(64, parseInt(cols, 10) || 48));
  const wrap = (str, max, indent = '') => {
    const out = []; let cur = '';
    for (const word of String(str).split(/\s+/).filter(Boolean)) {
      if (!cur) { cur = word; continue; }
      if ((cur + ' ' + word).length <= max) cur += ' ' + word;
      else { out.push(cur); cur = indent + word; }
    }
    if (cur) out.push(cur);
    // Hard-split any single word longer than the line.
    return out.flatMap((l) => { const r = []; while (l.length > max) { r.push(l.slice(0, max)); l = indent + l.slice(max); } r.push(l); return r; });
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { ctl(ESC + 'E' + '\x00' + ESC + '!' + '\x00'); txt('\n'); continue; }
    const isItem = isKitchen && /^\s*\d+\s*x\s+/i.test(trimmed);
    const isKitchenHeading = isKitchen && /KITCHEN ORDER|^\*{3}.*\*{3}$/i.test(trimmed);
    // Order number = "#0012" / "ORDER NO" only — NOT item lines ("2x ...") or dates.
    const isOrderNo = isKitchen && !isItem && (/^#\s*[A-Z0-9-]+$/i.test(trimmed) || /ORDER\s*(NO|#)/i.test(trimmed));
    const isDetail = isKitchen && /^(\+|NOTE:|\*\*)/i.test(trimmed);   // modifiers / notes under an item
    if (isKitchenHeading || isOrderNo) {
      ctl(ESC + 'a' + '\x01' + ESC + 'E' + '\x01' + ESC + '!' + (isOrderNo ? '\x30' : '\x10'));
      for (const l of wrap(trimmed, isOrderNo ? Math.floor(COLS / 2) : COLS)) { txt(l); txt('\n'); }
      ctl(ESC + 'E' + '\x00' + ESC + '!' + '\x00');
    } else if (isItem) {
      // Item: bold, tall, left-aligned, full name wrapped under itself.
      ctl(ESC + 'a' + '\x00' + ESC + 'E' + '\x01' + ESC + '!' + '\x10');
      const m = trimmed.match(/^(\d+\s*x\s+)/i); const ind = ' '.repeat(Math.min(6, m ? m[1].length : 3));
      for (const l of wrap(trimmed, COLS, ind)) { txt(l); txt('\n'); }
      ctl(ESC + 'E' + '\x00' + ESC + '!' + '\x00');
    } else if (isDetail) {
      ctl(ESC + 'a' + '\x00' + ESC + 'E' + '\x00' + ESC + '!' + '\x00');
      for (const l of wrap('   ' + trimmed, COLS, '     ')) { txt(l); txt('\n'); }
    } else {
      // Rules and ordinary text: centred on bills; on kitchen tickets only short lines are centred.
      const isRule = /^[=\-_]{6,}$/.test(trimmed);
      ctl(ESC + 'a' + (isKitchen && !isRule && trimmed.length > COLS * 0.6 ? '\x00' : '\x01') + ESC + 'E' + '\x00' + ESC + '!' + '\x00');
      if (isRule) { txt(trimmed.slice(0, COLS)); txt('\n'); }
      else if (!isKitchen && line.length <= COLS) { txt(line.replace(/\s+$/, '')); txt('\n'); }   // bills keep their column layout
      else for (const l of wrap(trimmed, COLS)) { txt(l); txt('\n'); }
    }
  }
  if (barcodeData && !isKitchen) {
    const code = String(barcodeData).replace(/[^A-Za-z0-9\-.$/+% ]/g, '').slice(0, 40);
    if (code) {
      ctl(ESC + 'a' + '\x01' + ESC + 'E' + '\x00');
      ctl(GS + 'H' + '\x02' + GS + 'h' + '\x50' + GS + 'w' + '\x02' + GS + 'k' + '\x49' + String.fromCharCode(code.length + 2) + '{B' + code);
      txt('\n' + code + '\n');
    }
  }
  ctl(ESC + '!' + '\x00' + ESC + 'E' + '\x00' + ESC + 'a' + '\x01' + FEED + CUT);
  return Buffer.concat(chunks);
}

// Non-Windows targets (dev / network printers)
function sendToNonWindows(buf) {
  return new Promise((resolve, reject) => {
    if (PRINTER === 'stdout') {
      process.stdout.write('\n----- PRINT JOB -----\n' + buf.toString('utf8').replace(/[\x00-\x08\x1B\x1D]/g, '') + '\n---------------------\n');
      return resolve();
    }
    if (PRINTER.startsWith('tcp://')) {
      const m = PRINTER.slice(6).split(':');
      const sock = net.createConnection({ host: m[0], port: parseInt(m[1] || '9100', 10) }, () => sock.write(buf, () => sock.end()));
      sock.setTimeout(10000, () => sock.destroy(new Error('Network printer timeout')));
      sock.on('close', resolve);
      sock.on('error', reject);
      return;
    }
    fs.writeFile(PRINTER, buf, (err) => (err ? reject(err) : resolve()));
  });
}

function deliver(printerName, bytes) {
  const key = printerName || PRINTER;
  return enqueue(key, () => (IS_WINDOWS && printerName) ? sendRawBytesToWindowsPrinter(printerName, bytes) : sendToNonWindows(bytes));
}

// ── HTTP ─────────────────────────────────────────────────────
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2e6) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allowed = allowOrigin(origin);
  if (origin && !allowed) { res.writeHead(403); return res.end('origin not allowed'); }
  if (allowed) { res.setHeader('Access-Control-Allow-Origin', allowed); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Chrome Private Network Access preflight
  if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const route = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && route === '/health') {
    return json(res, 200, { ok: true, platform: process.platform, worker: !!worker, queued: pending.size });
  }
  if (req.method === 'GET' && route === '/printers') {
    if (!IS_WINDOWS) return json(res, 200, { printers: [], platform: process.platform, message: 'Windows printer discovery is available on the POS Windows computer.' });
    try {
      const out = await runPowerShell("$ErrorActionPreference='Stop'; Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress");
      const parsed = out ? JSON.parse(out) : [];
      return json(res, 200, { printers: (Array.isArray(parsed) ? parsed : [parsed]).filter(x => typeof x === 'string' && x.trim()), platform: process.platform });
    } catch (e) { return json(res, 500, { error: String(e.message || e), printers: [] }); }
  }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('Golden POS print agent OK'); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }

  let job;
  try { job = await readJson(req); } catch (e) { res.writeHead(400); return res.end(e.message); }

  // Explicit drawer kick (used when the receipt could not carry the kick).
  if (route === '/drawer') {
    const printerName = String(job.printerName || '').trim();
    if (IS_WINDOWS && !printerName) return json(res, 400, { ok: false, error: 'No payment printer selected; cash drawer not opened.' });
    try {
      if (!IS_WINDOWS && PRINTER === 'stdout') throw new Error('No physical printer configured in print agent');
      await deliver(printerName, DRAWER_KICK);
      console.log(`[drawer] kick → ${printerName || PRINTER}`);
      return json(res, 200, { ok: true, printerName });
    } catch (e) { console.error('[drawer] failed:', e.message); return json(res, 500, { ok: false, error: String(e.message || e) }); }
  }

  // Print job
  const copies = Math.max(1, Math.min(5, parseInt(job.copies, 10) || 1));
  const printerName = String(job.printerName || '').trim();
  const t0 = Date.now();
  try {
    for (let i = 0; i < copies; i++) {
      // Only the first copy opens the drawer.
      const bytes = job.type === 'qr'
        ? escposQrCard(job)
        : job.type === 'barcode'
        ? escposBarcodeOnly(job.barcodeData || job.text, job.title || '')
        : escposTicket(job.text, job.type || '', job.barcodeData || '', !!job.openDrawer && i === 0, job.width || 48);
      await deliver(printerName, bytes);
    }
    logJob(job, printerName, 'PRINTED');
    console.log(`[print] ${job.type || 'job'} "${job.title || ''}" ×${copies}${job.openDrawer ? ' +drawer' : ''} → ${printerName || PRINTER} (${Date.now() - t0} ms)`);
    return json(res, 200, { ok: true, type: job.type || 'print', copies, drawer: !!job.openDrawer });
  } catch (e) {
    logJob(job, printerName, 'FAILED', e.message);
    console.error('[print] failed:', e && e.message);
    return json(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`[agent] port ${PORT} already in use — another agent is running. Exiting.`); process.exit(0); }
  console.error('[agent] server error:', e); process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent] Golden POS print agent on http://localhost:${PORT}  (log: ${logDirNow()})`);
  if (IS_WINDOWS) startWorker().catch(e => console.warn('[agent] worker failed to start, will use one-shot printing:', e.message));
});

function stop() { try { worker && worker.stdin.end(); } catch {} process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
