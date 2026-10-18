#!/usr/bin/env node
/*
 * Golden POS launcher + supervisor (v19)
 *
 *   npm start            → production mode (fast). Builds the UI once if needed.
 *   npm run start:dev    → development mode (hot reload, slow first load)
 *
 * Starts and WATCHES three services; any that crashes is restarted
 * automatically with back-off:
 *   • backend  – Express + SQLite API          :3001
 *   • agent    – thermal printer / drawer agent :9110 (127.0.0.1 only)
 *   • web      – Next.js Golden POS UI          :3000 (LAN)
 *
 * Logs: logs/<service>-YYYY-MM-DD.log, one file per day, kept for 7 days.
 *       (Bill / kitchen-ticket records in backend/data/print-log and the
 *        daily database backups are NOT touched by this.)
 * Designed to be run at Windows boot by deploy/windows/install.ps1.
 */
"use strict";

const { spawn, spawnSync, execSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = __dirname;
const WEB = path.join(ROOT, "web");
const BACKEND = path.join(ROOT, "backend");
const LOGS = path.join(ROOT, "logs");
fs.mkdirSync(LOGS, { recursive: true });

const DEV = process.argv.includes("--dev") || process.env.POS_MODE === "dev";
const PORT_BACKEND = Number(process.env.BACKEND_PORT) || 3001;
const PORT_WEB = Number(process.env.PORT) || 3000;
const PORT_AGENT = Number(process.env.PRINT_AGENT_PORT) || 9110;
const PORT_GATEWAY = Number(process.env.GATEWAY_PORT) || 3100;
const PORT_LOCK = Number(process.env.POS_LOCK_PORT) || 3099;   // "a launcher is running" marker (127.0.0.1 only)
const EXIT_ALREADY_RUNNING = 3;
const NODE = process.execPath;
const NEXT_BIN = path.join(WEB, "node_modules", "next", "dist", "bin", "next");
const sep = "─".repeat(60);

let stopping = false;

// ── logging: one file per service per day, 7 days kept ──────────
const LOG_KEEP_DAYS = 7;
const LOG_MAX_BYTES = 20 * 1024 * 1024;           // safety cap per file per day
const SERVICE_NAMES = ["launcher", "backend", "agent", "web", "gateway"];
const dayStamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Running as the Windows service: output already goes to the per-service
// files, so don't copy everything a second time into service.log.
const INTERACTIVE = !!process.stdout.isTTY;

function logStream(name) {
  let day = "", part = 0, stream = null, written = 0;
  const open = () => {
    const file = path.join(LOGS, `${name}-${day}${part ? "-" + part : ""}.log`);
    try { written = fs.statSync(file).size; } catch { written = 0; }
    stream = fs.createWriteStream(file, { flags: "a" });
    stream.on("error", () => {});
  };
  return {
    write(d) {
      const today = dayStamp();
      if (today !== day) { if (stream) stream.end(); day = today; part = 0; open(); }
      else if (written > LOG_MAX_BYTES) { stream.end(); part++; open(); }
      stream.write(d);
      written += Buffer.byteLength(d);
    },
  };
}

// Delete log files older than 7 days, and the old single-file logs from
// earlier versions. Runs at start and every hour.
function cleanLogs() {
  const cutoff = dayStamp(new Date(Date.now() - (LOG_KEEP_DAYS - 1) * 86400000));
  let removed = 0;
  let files = [];
  try { files = fs.readdirSync(LOGS); } catch { return; }
  for (const f of files) {
    const p = path.join(LOGS, f);
    const dated = /^(.+)-(\d{4}-\d{2}-\d{2})(?:-\d+)?\.log$/.exec(f);
    let drop = false;
    if (dated) drop = dated[2] < cutoff;
    else if (SERVICE_NAMES.some((n) => f === `${n}.log` || f === `${n}.log.1`)) drop = true;   // old style
    else if (/\.log(\.\d+)?$/i.test(f)) {
      // open-pos.log, first-setup.log, service.log ...: drop when untouched for 7 days
      try { drop = Date.now() - fs.statSync(p).mtimeMs > LOG_KEEP_DAYS * 86400000; } catch {}
    }
    if (drop) { try { fs.unlinkSync(p); removed++; } catch { /* still open - next time */ } }
  }
  // service.log is held open by Windows while the POS runs; shrink it instead when big.
  const svc = path.join(LOGS, "service.log");
  try { if (fs.statSync(svc).size > 5 * 1024 * 1024) fs.truncateSync(svc, 0); } catch {}
  return removed;
}

const launcherLog = logStream("launcher");
function say(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  if (INTERACTIVE) console.log(msg);
  launcherLog.write(line + "\n");
}

// ── Guard against a corrupt native SWC binary (Windows low-disk installs) ──
function ensureUsableSwc() {
  const nextScope = path.join(WEB, "node_modules", "@next");
  const hasWasm = fs.existsSync(path.join(nextScope, "swc-wasm-nodejs"));
  let nativeDir = null;
  try {
    for (const name of fs.readdirSync(nextScope)) {
      if (name.startsWith("swc-") && name !== "swc-wasm-nodejs") { nativeDir = path.join(nextScope, name); break; }
    }
  } catch { return; }
  if (!nativeDir) return;
  try { require(nativeDir); return; } catch {}
  if (!hasWasm) { say("⚠ Native SWC binary looks corrupt and the WASM fallback isn't installed. Run 'npm install' in web/."); return; }
  try { fs.rmSync(nativeDir, { recursive: true, force: true }); say("⚠ Removed a corrupt native SWC binary — using the WASM fallback."); } catch {}
}

// ── Free a stuck port from a previous run ───────────────────────
function freePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => {
        say(`⚠ Port ${port} is in use — freeing it…`);
        try {
          if (process.platform === "win32") {
            const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
            const pids = new Set();
            out.split(/\r?\n/).forEach((line) => {
              const m = line.trim().match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
              if (m && Number(m[1]) === port && Number(m[2]) !== process.pid) pids.add(m[2]);
            });
            pids.forEach((pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch {} });
          } else {
            execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore", shell: "/bin/bash" });
          }
        } catch {}
        setTimeout(resolve, 800);
      })
      .once("listening", () => tester.close(resolve))
      .listen(port, "0.0.0.0");
  });
}

// ── Production build (only when the UI source changed) ──────────
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch {} }
    }
  };
  walk(dir);
  return newest;
}
// If package.json lists a library that isn't installed yet (an update was
// copied over without running the installer), install it first.
function ensureDependencies(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const missing = Object.keys({ ...(pkg.dependencies || {}) }).filter((d) => !fs.existsSync(path.join(dir, "node_modules", d, "package.json")));
    if (!missing.length) return;
    say(`Installing missing parts (${missing.join(", ")}) — needs internet, one time…`);
    const npmCli = path.join(path.dirname(NODE), "node_modules", "npm", "bin", "npm-cli.js");
    const r = fs.existsSync(npmCli)
      ? spawnSync(NODE, [npmCli, "install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" })
      : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit", shell: true });
    say(r.status === 0 ? "✓ Parts installed" : "⚠ Could not install parts — check the internet connection");
  } catch (e) { say("⚠ Dependency check failed: " + e.message); }
}

function ensureProductionBuild() {
  ensureDependencies(WEB);
  ensureDependencies(BACKEND);
  const buildId = path.join(WEB, ".next", "BUILD_ID");
  let builtAt = 0;
  try { builtAt = fs.statSync(buildId).mtimeMs; } catch {}
  const srcAt = Math.max(
    newestMtime(path.join(WEB, "src")),
    ...["next.config.mjs", "tailwind.config.ts", "package.json", ".babelrc", "postcss.config.mjs"].map((f) => { try { return fs.statSync(path.join(WEB, f)).mtimeMs; } catch { return 0; } }),
  );
  if (builtAt && builtAt >= srcAt) return true;
  say(builtAt ? "UI source changed — rebuilding (one-time, ~1–3 min)…" : "No production build yet — building UI (one-time, ~1–3 min)…");
  const r = spawnSync(NODE, [NEXT_BIN, "build"], {
    cwd: WEB, stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048", NEXT_TELEMETRY_DISABLED: "1", BACKEND_URL: `http://localhost:${PORT_BACKEND}` },
  });
  if (r.status === 0) { say("✓ UI build complete"); return true; }
  if (builtAt) { say("⚠ Build failed — keeping the previous working build."); return true; }
  say("⚠ Build failed and no previous build exists — falling back to dev mode.");
  return false;
}

// ── Supervisor ──────────────────────────────────────────────────
const children = new Map();
function supervise(name, args, opts) {
  let delay = 1000;
  const out = logStream(name);
  const run = () => {
    if (stopping) return;
    const startedAt = Date.now();
    const child = spawn(NODE, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    children.set(name, child);
    const pipe = (stream, target) => stream.on("data", (d) => { if (INTERACTIVE) target.write(d); out.write(d); });
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on("error", (e) => say(`✖ ${name} failed to start: ${e.message}`));
    child.on("exit", (code, signal) => {
      children.delete(name);
      if (stopping) return;
      if (Date.now() - startedAt > 60000) delay = 1000;          // was healthy → reset back-off
      say(`⚠ ${name} exited (${signal || code}). Restarting in ${delay / 1000}s…`);
      setTimeout(run, delay);
      delay = Math.min(delay * 2, 30000);
    });
  };
  run();
}

// Is a healthy Golden POS already running? (Asked directly on 127.0.0.1 so
// proxies / IPv6 can't give a wrong answer.) If so, never start a second copy
// — the second copy would free the ports and kill the working one.
function httpOk(port, path) {
  return new Promise((resolve) => {
    const req = require("node:http").get({ host: "127.0.0.1", port, path, timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 400); });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

// Only ONE launcher may run. The boot task and the desktop icon can both try
// to start the POS (e.g. while the screens are being rebuilt); the second one
// finds this port taken and leaves quietly instead of fighting for the ports.
function holdSingleInstanceLock() {
  return new Promise((resolve) => {
    const srv = net.createServer((c) => c.end("golden-pos-launcher\n"));
    srv.once("error", () => resolve(false));
    srv.listen(PORT_LOCK, "127.0.0.1", () => { srv.unref(); resolve(true); });
  });
}

async function main() {
  if (!(await holdSingleInstanceLock())) {
    say("Another Golden POS launcher is already running — this copy is leaving it alone.");
    process.exit(EXIT_ALREADY_RUNNING);
  }
  if (!process.argv.includes("--force") && (await httpOk(PORT_BACKEND, "/healthz")) && (await httpOk(PORT_WEB, "/login"))) {
    say("Golden POS is already running — not starting a second copy.");
    process.exit(0);
  }
  const cleaned = cleanLogs();
  setInterval(cleanLogs, 3600 * 1000).unref();
  say(`\n🧡  Golden POS — launching (${DEV ? "development" : "production"} mode)\n${sep}`);
  if (cleaned) say(`   (removed ${cleaned} old log file${cleaned === 1 ? "" : "s"} - logs are kept ${LOG_KEEP_DAYS} days)`);
  say(`   • Golden POS UI → http://localhost:${PORT_WEB}   (LAN: http://<this-pc-ip>:${PORT_WEB})`);
  say(`   • Backend API   → http://localhost:${PORT_BACKEND}`);
  say(`   • Print agent   → http://localhost:${PORT_AGENT}`);
  say(`   • Customer gateway (online QR ordering) → http://127.0.0.1:${PORT_GATEWAY}\n${sep}`);

  await freePort(PORT_BACKEND);
  await freePort(PORT_WEB);
  await freePort(PORT_AGENT);
  await freePort(PORT_GATEWAY);
  ensureUsableSwc();

  if (!fs.existsSync(NEXT_BIN)) say("✖ web/node_modules missing — run 'npm install' in the project folder first.");
  const useDev = DEV || !ensureProductionBuild();

  supervise("backend", [path.join(BACKEND, "server.js")], {
    cwd: BACKEND,
    env: { ...process.env, PORT: String(PORT_BACKEND), NODE_OPTIONS: "" },
  });

  supervise("agent", [path.join(BACKEND, "print-agent", "agent.js")], {
    cwd: ROOT,
    // POS_DATA_DIR is no longer forced here: the agent reads the data folder chosen in Settings > Storage.
    env: { ...process.env, PORT: String(PORT_AGENT), NODE_OPTIONS: "" },
  });

  // Customer-only gateway (for online QR ordering over mobile data). Listens on
  // 127.0.0.1 only; a tunnel (Cloudflare / Tailscale) publishes it if set up.
  supervise("gateway", [path.join(BACKEND, "public-gateway", "gateway.js")], {
    cwd: ROOT,
    env: { ...process.env, GATEWAY_PORT: String(PORT_GATEWAY), POS_UI: `http://127.0.0.1:${PORT_WEB}`, NODE_OPTIONS: "" },
  });

  const webArgs = useDev
    ? [NEXT_BIN, "dev", "-p", String(PORT_WEB), "-H", "0.0.0.0"]
    : [NEXT_BIN, "start", "-p", String(PORT_WEB), "-H", "0.0.0.0"];
  setTimeout(() => supervise("web", webArgs, {
    cwd: WEB,
    env: {
      ...process.env,
      PORT: String(PORT_WEB),
      BACKEND_URL: `http://localhost:${PORT_BACKEND}`,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: useDev ? "development" : "production",
      NODE_OPTIONS: useDev ? "--max-old-space-size=2048" : "--max-old-space-size=768",
    },
  }), 1500);

  function shutdown() {
    if (stopping) return;
    stopping = true;
    say("🧡  Stopping Golden POS…");
    for (const [, c] of children) { try { c.kill(); } catch {} }
    setTimeout(() => process.exit(0), 1500);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
}

main();
