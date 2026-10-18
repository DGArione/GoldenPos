"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete, ArrowRight, KeyRound, Hash, Monitor, Wifi, Loader2 } from "lucide-react";
import { api, SessionUser } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Spinner } from "@/components/ui";
import { BrandMark } from "@/components/Logo";

const KEYS = ["1","2","3","4","5","6","7","8","9","clear","0","back"] as const;

// Where to go after signing in: back to the page they opened (only our own
// pages), else the normal home for their role.
function destinationFor(role: string, fallback: string) {
  let next = "";
  try { next = new URLSearchParams(window.location.search).get("next") || ""; } catch {}
  if (!/^\/[A-Za-z0-9/_-]*$/.test(next) || next.startsWith("//") || next.startsWith("/login")) next = "";
  return next || fallback;
}

export default function LoginPage() {
  const router = useRouter();
  const { login, user } = useAuth();
  const settings = useSettings();
  const [pin, setPin] = useState("");
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState<Date | null>(null);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [newAdmin, setNewAdmin] = useState({ name: "Administrator", username: "admin", password: "" });

  useEffect(() => { if (user) router.replace(destinationFor(user.role, "/")); }, [user, router]);

  // Show why the last session was ended (if the server said so).
  useEffect(() => {
    try {
      const why = sessionStorage.getItem("gb-logout-reason");
      if (why) { setError(why); sessionStorage.removeItem("gb-logout-reason"); }
    } catch {}
  }, []);

  // Detect first-install: no admin user yet.
  useEffect(() => {
    api<{ hasAdmin: boolean }>("/public/has-admin", { noAuthRedirect: true })
      .then((d) => setHasAdmin(!!d.hasAdmin))
      .catch(() => setHasAdmin(true));
  }, []);

  async function createAdmin() {
    if (newAdmin.password.length < 8) { setError("Admin password must be at least 8 characters"); return; }
    setBusy(true); setError("");
    try {
      await api("/public/create-admin", {
        method: "POST",
        json: {
          name: newAdmin.name,
          username: newAdmin.username,
          password: newAdmin.password,
        },
        noAuthRedirect: true,
      });
      setHasAdmin(true);
      setMode("password");
      setUsername(newAdmin.username);
      setPassword(newAdmin.password);
      // Try to sign in automatically.
      const u = await api<SessionUser>("/auth/login-password", {
        method: "POST",
        json: { username: newAdmin.username, password: newAdmin.password },
        noAuthRedirect: true,
      });
      login(u);
      router.replace("/settings");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create admin");
    } finally { setBusy(false); }
  }
  useEffect(() => { setClock(new Date()); const i = setInterval(() => setClock(new Date()), 15000); return () => clearInterval(i); }, []);

  const press = (d: string) => { setError(""); setPin((p) => (p.length >= 8 ? p : p + d)); };
  const back = () => setPin((p) => p.slice(0, -1));

  async function submitPin() {
    if (pin.length < 3) { setError("Enter your PIN"); return; }
    setBusy(true); setError("");
    try {
      const u = await api<SessionUser>("/auth/login", { method: "POST", json: { pin }, noAuthRedirect: true });
      login(u);
      router.replace(destinationFor(u.role, u.role === "superManager" ? "/branches" : "/"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setPin("");
    } finally { setBusy(false); }
  }

  async function submitPassword() {
    setBusy(true); setError("");
    try {
      const u = await api<SessionUser>("/auth/login-password", { method: "POST", json: { username, password }, noAuthRedirect: true });
      login(u);
      router.replace(destinationFor(u.role, u.role === "admin" ? "/settings" : "/"));
    } catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (mode !== "pin") return;
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submitPin();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pin]);

  const brandName = settings?.businessName || "Golden Beach";
  const tagline = settings?.businessTagline || "Fresh. Local. Golden.";
  const loginBg = (settings as unknown as { loginBgUrl?: string })?.loginBgUrl || "";
  const panelImg = (settings as unknown as { loginPanelImageUrl?: string })?.loginPanelImageUrl || "";

  // Rendered only in the browser (after mount) so the server-built page never disagrees with the real time.
  const timeStr = clock ? clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "\u00a0";
  const dateStr = clock ? clock.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : "\u00a0";

  return (
    <div
      className="relative isolate flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: loginBg ? "transparent" : "var(--paper)" }}
    >
      {/* ---- Full-screen background image + dark overlay ---- */}
      {loginBg && (
        <>
          <img
            src={loginBg}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 -z-10 w-full h-full object-cover"
          />
          <span aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: "rgba(20,20,20,0.55)" }} />
        </>
      )}

      {/* ---- Login card: 2 columns (brand sidebar + form) ---- */}
      <div
        className="grid w-full max-w-[780px] overflow-hidden rounded-2xl md:grid-cols-[300px_1fr]"
        style={{ background: "var(--panel)", boxShadow: "0 20px 50px -24px rgba(0,0,0,.35)" }}
      >
        {/* ---- Left: brand panel with optional inside picture ---- */}
        <aside
          className="relative flex flex-col overflow-hidden p-5 md:p-6 text-[color:var(--on-accent)] min-h-[150px] md:min-h-[320px]"
          style={{ background: "var(--olive)" }}
        >
          {panelImg ? (
            <>
              {/* Picture chosen in Settings, darkened top and bottom so the name, time and status stay readable */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={panelImg} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
              <span aria-hidden="true" className="absolute inset-0"
                style={{ background: "linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.15) 45%, rgba(0,0,0,.6) 100%)" }} />
            </>
          ) : (
            <>
              <span aria-hidden="true" className="absolute -right-16 -top-16 size-48 rounded-full" style={{ background: "rgba(255,255,255,.1)" }} />
              <span aria-hidden="true" className="absolute -bottom-20 -left-10 size-56 rounded-full" style={{ background: "rgba(255,255,255,.1)" }} />
            </>
          )}

          {/* brand */}
          <div className="relative flex items-center gap-2.5">
            <BrandMark size={64} onDark rounded="rounded-2xl" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[16px] font-semibold text-white">{brandName}</p>
              {tagline && <p className="truncate text-[12px] text-white/85">{tagline}</p>}
            </div>
          </div>

          {/* clock */}
          <div className="relative mt-8 hidden md:block">
            <div className="mono text-[36px] font-semibold leading-none text-white">{timeStr}</div>
            <div className="mt-1.5 text-[12.5px] opacity-90">{dateStr}</div>
          </div>

          {/* terminal info at bottom */}
          <dl className="relative mt-auto hidden md:block space-y-2 pt-6 text-[12px]">
            <div className="flex items-center gap-2">
              <Monitor size={14} className="opacity-80" />
              <dt className="opacity-80">Terminal</dt>
              <dd className="ml-auto font-semibold">Front counter</dd>
            </div>
            <div className="flex items-center gap-2">
              <Wifi size={14} className="opacity-80" />
              <dt className="opacity-80">Server</dt>
              <dd className="ml-auto font-semibold">Connected</dd>
            </div>
          </dl>
        </aside>

        {/* ---- Right: form ---- */}
        <main className="p-7">
          {hasAdmin === false ? (
            <>
              <h1 className="text-[22px] font-semibold text-ink">Set up administrator</h1>
              <p className="text-[13px] text-muted mt-1 mb-5">
                No administrator account exists yet. Pick a username and password now — you'll be able to add staff
                PINs, change this later and configure the restaurant from inside.
              </p>
              <div className="space-y-3">
                <div><label className="lbl">Name</label>
                  <input className="inp" value={newAdmin.name}
                    onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} /></div>
                <div><label className="lbl">Username</label>
                  <input className="inp" value={newAdmin.username} autoFocus
                    onChange={(e) => setNewAdmin({ ...newAdmin, username: e.target.value })} /></div>
                <div><label className="lbl">Password (8+ characters)</label>
                  <input type="password" className="inp" value={newAdmin.password}
                    onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} /></div>
                <button onClick={createAdmin} disabled={busy || newAdmin.password.length < 8}
                  className="btn btn-primary w-full btn-lg">
                  {busy ? "Creating…" : "Create admin & sign in"}
                </button>
                {error && (
                  <div className="text-sm text-center rounded-lg py-2 px-3" style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}>
                    {error}
                  </div>
                )}
              </div>
            </>
          ) : (
          <>
          <h1 className="text-[22px] font-semibold text-ink">Welcome back</h1>
          <p className="text-[13px] text-muted mt-1 mb-5">
            {mode === "pin"
              ? "Enter your staff PIN to clock in."
              : "Sign in with your username and password."}
          </p>

          {mode === "pin" ? (
            <>
              {/* PIN dots */}
              <div className="flex justify-center gap-2 mb-5 h-4">
                {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                  <span
                    key={i}
                    className="w-2.5 h-2.5 rounded-full transition-colors"
                    style={{ background: i < pin.length ? "var(--olive)" : "var(--line)" }}
                  />
                ))}
              </div>

              {/* Keypad 3x4 */}
              <div className="grid grid-cols-3 gap-1.5">
                {KEYS.map((k) => (
                  <button
                    key={k}
                    onClick={() => k === "back" ? back() : k === "clear" ? setPin("") : press(k)}
                    className="h-[54px] rounded-lg text-[18px] font-semibold transition active:scale-95"
                    style={{
                      background: k === "back" || k === "clear" ? "var(--panel)" : "var(--panel-2)",
                      color: k === "back" || k === "clear" ? "var(--muted)" : "var(--ink)",
                      border: "1px solid var(--line)",
                      fontSize: k === "back" || k === "clear" ? 13 : 18,
                    }}
                  >
                    {k === "back" ? <Delete size={18} className="mx-auto" /> : k === "clear" ? "CLR" : k}
                  </button>
                ))}
              </div>

              <button
                onClick={submitPin}
                disabled={busy || pin.length < 3}
                className="btn btn-primary w-full mt-3 h-12 text-[15px]"
              >
                {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <label className="lbl">Username</label>
                <input className="inp" value={username} autoFocus
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPassword()} />
              </div>
              <div>
                <label className="lbl">Password</label>
                <input className="inp" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPassword()} />
              </div>
              <button onClick={submitPassword} disabled={busy} className="btn btn-primary btn-lg mt-1">
                {busy ? <Spinner /> : "Sign in"}
              </button>
            </div>
          )}

          {error && (
            <div
              className="mt-3 text-sm text-center rounded-lg py-2 px-3"
              style={{ background: "var(--bad-wash)", color: "var(--bad-ink)" }}
            >
              {error}
            </div>
          )}

          <button
            onClick={() => { setMode((m) => (m === "pin" ? "password" : "pin")); setError(""); }}
            className="mt-5 w-full flex items-center justify-center gap-2 text-sm text-muted hover:text-ink transition"
          >
            <KeyRound size={15} />
            {mode === "pin" ? "Sign in with username & password" : "Use a staff PIN instead"}
          </button>
          </>
          )}
        </main>
      </div>

      {/* footer */}
      <p
        className={`mt-4 text-[12px] ${loginBg ? "text-white/90" : "text-muted"}`}
        style={loginBg ? { textShadow: "0 1px 2px rgba(0,0,0,0.5)" } : {}}
      >
        {brandName} POS v2.1 · developed by Rapid Solutions
      </p>
    </div>
  );
}
