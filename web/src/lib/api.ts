// Thin client for the Golden Beach API (the Express + SQLite service).
// Mirrors the original auth contract: signed token sent as X-Auth-Token AND as
// a ?_auth= query param; superManager also passes the active branchId.

export type Role =
  | "admin" | "superManager" | "manager" | "finance"
  | "server" | "cashier" | "kitchen";

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  branchId: number | null;
  authMethod?: string;
  token: string;
  mustChangePassword?: boolean;
  branch?: { id: number; name: string } | null;
}

const TOKEN_KEY = "gb-token";
const USER_KEY = "gb-user";
const BRANCH_KEY = "gb-branch";

// The login lives only for this browser session (sessionStorage): closing the
// POS window, restarting the PC or restarting Chrome always returns to the PIN
// lock screen. A page refresh keeps you signed in.
const BOOT_KEY = "gb-boot";
function ss(): Storage | null { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } }
if (typeof window !== "undefined") {
  // Drop logins remembered permanently by older versions.
  try { localStorage.removeItem(USER_KEY); localStorage.removeItem(TOKEN_KEY); } catch {}
}

export function getToken(): string | null {
  return ss()?.getItem(TOKEN_KEY) ?? null;
}
export function getStoredUser(): SessionUser | null {
  try {
    const raw = ss()?.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}
export function storeSession(user: SessionUser) {
  ss()?.setItem(USER_KEY, JSON.stringify(user));
  if (user.token) ss()?.setItem(TOKEN_KEY, user.token);
}
export function clearSession() {
  ss()?.removeItem(USER_KEY);
  ss()?.removeItem(TOKEN_KEY);
  ss()?.removeItem(BOOT_KEY);
}
/** Server start id remembered at login; if the POS server restarts we lock. */
export function getSessionBoot(): string | null { return ss()?.getItem(BOOT_KEY) ?? null; }
export function setSessionBoot(id: string) { ss()?.setItem(BOOT_KEY, id); }
export async function fetchBootId(): Promise<string | null> {
  try {
    const r = await fetch("/api/boot", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d.bootId === "string" ? d.bootId : null;
  } catch { return null; }
}
export function getActiveBranchId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(BRANCH_KEY);
}
export function setActiveBranchId(id: number | string | null) {
  if (id == null) localStorage.removeItem(BRANCH_KEY);
  else localStorage.setItem(BRANCH_KEY, String(id));
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

interface ApiOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit;
  /** skip auto-logout on 401 (used by the login flow itself) */
  noAuthRedirect?: boolean;
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set("X-Auth-Token", token);

  let url = path.startsWith("/") ? path : `/${path}`;
  if (!url.startsWith("/api")) url = `/api${url}`;

  const qs: string[] = [];
  if (token) qs.push("_auth=" + encodeURIComponent(token));

  const user = getStoredUser();
  const branch = getActiveBranchId();
  if (user?.role === "superManager" && branch && !url.includes("branchId=")) {
    qs.push("branchId=" + encodeURIComponent(branch));
  }
  if (qs.length) url += (url.includes("?") ? "&" : "?") + qs.join("&");

  const init: RequestInit = { ...opts, headers };
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(opts.json);
  }

  const res = await fetch(url, init);

  if (res.status === 401 && !opts.noAuthRedirect) {
    const body = await res.clone().json().catch(() => null) as { error?: string; code?: string } | null;
    clearSession();
    // Tell the login screen WHY (e.g. phone access was turned off).
    if (body?.error && body.error !== "Not authenticated") { try { sessionStorage.setItem("gb-logout-reason", body.error); } catch {} }
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(401, body?.error || "Session expired");
  }

  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, String(msg), data);
  }
  return data as T;
}

export const apiGet = <T = unknown>(p: string) => api<T>(p);
export const apiPost = <T = unknown>(p: string, json?: unknown) => api<T>(p, { method: "POST", json });
export const apiPut = <T = unknown>(p: string, json?: unknown) => api<T>(p, { method: "PUT", json });
export const apiPatch = <T = unknown>(p: string, json?: unknown) => api<T>(p, { method: "PATCH", json });
export const apiDelete = <T = unknown>(p: string, json?: unknown) => api<T>(p, { method: "DELETE", json });
