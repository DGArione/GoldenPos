"use client";
// Settings → Storage & backups: where the database and the backups are kept,
// with free-space checks. Admin only (the API refuses everyone else).
import { useEffect, useState } from "react";
import { HardDrive, Database, Archive, CheckCircle2, XCircle } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/components/ui";

interface Drive { root: string; freeBytes: number; totalBytes: number; writable: boolean }
interface StorageInfo {
  dataDir: string; backupDir: string; defaultDataDir: string; defaultBackupDir: string; envLocked: boolean;
  dbFile: string; dbBytes: number; dataBytes: number; backupBytes: number; backupCount: number;
  dataDrive: Drive; backupDrive: Drive; pendingMove: string | null;
  lastMove: { at: string; ok: boolean; from: string; to: string; error?: string } | null;
}
interface Check { ok: boolean; usable: boolean; path: string; problem: string; exists: boolean; freeBytes: number; totalBytes: number; root: string; requiredBytes: number }

export function fmtBytes(n: number): string {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return Math.round(n / 1048576) + " MB";
  return Math.max(0, Math.round(n / 1024)) + " KB";
}

function SpaceBar({ d }: { d: Drive }) {
  if (!d?.totalBytes) return null;
  const pct = Math.round(((d.totalBytes - d.freeBytes) / d.totalBytes) * 100);
  const low = d.freeBytes < 2 * 1073741824 || d.freeBytes / d.totalBytes < 0.1;
  return (
    <div className="mt-2">
      <div className="h-2 w-full max-w-sm overflow-hidden rounded" style={{ background: "var(--panel-2)" }}>
        <div className="h-full" style={{ width: `${pct}%`, background: low ? "var(--bad-ink, #b91c1c)" : "var(--accent)" }} />
      </div>
      <div className="mt-1 text-[12px]" style={{ color: low ? "var(--bad-ink, #b91c1c)" : "var(--muted)" }}>
        Drive {d.root} <b>{fmtBytes(d.freeBytes)}</b> free of {fmtBytes(d.totalBytes)}{low ? " — running low" : ""}
      </div>
    </div>
  );
}

function CheckResult({ c }: { c: Check | null }) {
  if (!c) return null;
  return (
    <div className="mt-2 text-[12px] leading-relaxed">
      {c.root && <div>Drive {c.root} <b>{fmtBytes(c.freeBytes)}</b> free of {fmtBytes(c.totalBytes)} · space needed about {fmtBytes(c.requiredBytes)}</div>}
      {c.usable
        ? <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--ok-ink, green)" }}><CheckCircle2 size={14} /> This folder can be used{c.exists ? "" : " (it will be created)"}.</div>
        : <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--bad-ink, #b91c1c)" }}><XCircle size={14} /> {c.problem}</div>}
    </div>
  );
}

export default function StorageSettings() {
  const toast = useToast();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [err, setErr] = useState("");
  const [dataPath, setDataPath] = useState("");
  const [bkPath, setBkPath] = useState("");
  const [dataCheck, setDataCheck] = useState<Check | null>(null);
  const [bkCheck, setBkCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState("");

  async function load() {
    try { setInfo(await apiGet<StorageInfo>("/admin/storage")); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load storage details"); }
  }
  useEffect(() => { load(); }, []);

  async function check(kind: "data" | "backup") {
    const path = kind === "data" ? dataPath : bkPath;
    setBusy("check-" + kind);
    try {
      const r = await apiPost<Check>("/admin/storage/check", { path, kind });
      kind === "data" ? setDataCheck(r) : setBkCheck(r);
      return r;
    } catch (e) {
      const r = { usable: false, problem: e instanceof Error ? e.message : "Check failed" } as Check;
      kind === "data" ? setDataCheck(r) : setBkCheck(r);
      return r;
    } finally { setBusy(""); }
  }

  async function moveData() {
    const r = await check("data");
    if (!r.usable) return;
    if (!confirm(`Move ALL POS data to:\n${r.path}\n\nThe POS server restarts and everyone is signed out for about a minute. A safety backup is taken first and the old files are left where they are.\n\nDo this when the restaurant is closed. Continue?`)) return;
    setBusy("move");
    try {
      await apiPost("/admin/storage/data-dir", { path: dataPath, confirm: true });
      toast.push("ok", "Moving the data — the POS is restarting. Sign in again in about a minute.");
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Could not start the move"); setBusy(""); }
  }

  async function useBackup(reset = false) {
    if (!reset) { const r = await check("backup"); if (!r.usable) return; }
    else if (!confirm("Go back to the default backup folder (inside the data folder)?")) return;
    setBusy("backup");
    try {
      const r = await apiPost<{ backupDir: string; copied: number; testBackup: string }>("/admin/storage/backup-dir", { path: reset ? "" : bkPath, confirm: true });
      toast.push("ok", `Backups now saved in ${r.backupDir} (${r.copied} existing copied, test backup made)`);
      setBkPath(""); setBkCheck(null); load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Could not change the backup folder"); }
    finally { setBusy(""); }
  }

  async function cancelMove() { try { await apiPost("/admin/storage/cancel-move", {}); load(); } catch {} }

  return (
    <>
      <div className="eyebrow mb-1 flex items-center gap-2"><HardDrive size={14} /> Storage &amp; backups</div>
      <p className="text-[11.5px] text-muted mb-4">Where Golden POS keeps its data and its backups. Use a drive that is always connected to this computer — a USB stick that gets unplugged will stop the POS.</p>
      {err && <p className="text-[12px]" style={{ color: "var(--bad-ink, #b91c1c)" }}>{err}</p>}
      {!info && !err && <p className="text-[12px] text-muted">Loading…</p>}
      {info && (
        <div className="flex flex-col gap-5">
          {/* Data folder */}
          <div className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Database size={14} /> Data folder (database, bill logs)</div>
            <div className="mt-1 text-[12px] text-muted">Now: <code className="font-mono text-ink">{info.dataDir}</code></div>
            <div className="text-[12px] text-muted">Database {fmtBytes(info.dbBytes)} · whole folder {fmtBytes(info.dataBytes)}</div>
            <SpaceBar d={info.dataDrive} />
            {info.pendingMove && <div className="mt-2 text-[12px]" style={{ color: "var(--warn-ink)" }}>A move to <code>{info.pendingMove}</code> is waiting for the next restart. <button className="underline" onClick={cancelMove}>Cancel it</button></div>}
            {info.lastMove && (info.lastMove.ok
              ? <div className="mt-2 text-[12px] text-muted">Last move {new Date(info.lastMove.at).toLocaleString()}: done. The old copy is still in <code>{info.lastMove.from}</code> — delete it yourself once you are happy.</div>
              : <div className="mt-2 text-[12px]" style={{ color: "var(--bad-ink, #b91c1c)" }}>Last move attempt was cancelled ({info.lastMove.error}). Nothing was changed.</div>)}
            {info.envLocked ? (
              <div className="mt-2 text-[12px]" style={{ color: "var(--warn-ink)" }}>The data folder is fixed on this computer (POS_DATA_DIR) and can&apos;t be changed here.</div>
            ) : (
              <>
                <label className="lbl mt-3">Move the data to this folder</label>
                <input className="inp w-full font-mono" placeholder="D:\GoldenPOS-Data" value={dataPath} onChange={(e) => { setDataPath(e.target.value); setDataCheck(null); }} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn btn-ghost btn-sm" disabled={!dataPath || !!busy} onClick={() => check("data")}>{busy === "check-data" ? "Checking…" : "Check folder & free space"}</button>
                  <button className="btn btn-primary btn-sm" disabled={!dataCheck?.usable || !!busy} onClick={moveData}>{busy === "move" ? "Restarting…" : "Move data here…"}</button>
                </div>
                <CheckResult c={dataCheck} />
                <p className="mt-2 text-[11px] text-muted">The move runs at a restart: safety backup → copy → integrity check → switch. If anything fails it is cancelled and the POS keeps using the current folder.</p>
              </>
            )}
          </div>

          {/* Backup folder */}
          <div className="rounded-xl p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line-soft)" }}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><Archive size={14} /> Backup folder</div>
            <div className="mt-1 text-[12px] text-muted">Now: <code className="font-mono text-ink">{info.backupDir}</code></div>
            <div className="text-[12px] text-muted">{info.backupCount} backup file(s) · {fmtBytes(info.backupBytes)} · a backup is made automatically every day</div>
            <SpaceBar d={info.backupDrive} />
            <label className="lbl mt-3">Save backups in this folder</label>
            <input className="inp w-full font-mono" placeholder="E:\GoldenPOS-Backups" value={bkPath} onChange={(e) => { setBkPath(e.target.value); setBkCheck(null); }} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn btn-ghost btn-sm" disabled={!bkPath || !!busy} onClick={() => check("backup")}>{busy === "check-backup" ? "Checking…" : "Check folder & free space"}</button>
              <button className="btn btn-primary btn-sm" disabled={!bkCheck?.usable || !!busy} onClick={() => useBackup(false)}>{busy === "backup" ? "Saving…" : "Use this folder"}</button>
              {info.backupDir.toLowerCase() !== info.defaultBackupDir.toLowerCase() && <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => useBackup(true)}>Back to default</button>}
            </div>
            <CheckResult c={bkCheck} />
            <p className="mt-2 text-[11px] text-muted">Takes effect immediately, no restart. Existing backups are copied across (not deleted) and a test backup proves the folder works.</p>
          </div>
        </div>
      )}
    </>
  );
}
