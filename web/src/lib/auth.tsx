"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  SessionUser, getStoredUser, storeSession, clearSession,
  setUnauthorizedHandler, getActiveBranchId, setActiveBranchId,
  fetchBootId, getSessionBoot, setSessionBoot,
} from "./api";

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  branchId: number | null;
  login: (user: SessionUser) => void;
  logout: () => void;
  selectBranch: (id: number | null) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    const b = getActiveBranchId();
    setBranchId(b ? Number(b) : null);
    setReady(true);
    setUnauthorizedHandler(() => {
      setUser(null);
      router.push("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  // Lock the till when the POS server has restarted since this login
  // (power cut, Windows restart, service restart) — checked every 15 s.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const check = async () => {
      const now = await fetchBootId();
      if (!alive || !now) return;               // server unreachable: stay as-is
      const mine = getSessionBoot();
      if (!mine) { setSessionBoot(now); return; }
      if (mine !== now) { clearSession(); setUser(null); router.replace("/login"); }
    };
    check();
    const i = setInterval(check, 15000);
    return () => { alive = false; clearInterval(i); };
  }, [user, router]);

  const login = useCallback((u: SessionUser) => {
    storeSession(u);
    fetchBootId().then((b) => { if (b) setSessionBoot(b); });
    setUser(u);
    if (u.role !== "superManager" && u.branchId) {
      setActiveBranchId(u.branchId);
      setBranchId(u.branchId);
    }
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    router.push("/login");
  }, [router]);

  const selectBranch = useCallback((id: number | null) => {
    setActiveBranchId(id);
    setBranchId(id);
  }, []);

  return (
    <Ctx.Provider value={{ user, ready, branchId, login, logout, selectBranch }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export const isManager = (u: SessionUser | null) =>
  !!u && (u.role === "manager" || u.role === "superManager");
export const canViewFinance = (u: SessionUser | null) =>
  isManager(u) || (!!u && u.role === "finance");
