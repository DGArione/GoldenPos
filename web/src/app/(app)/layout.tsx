"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ToastProvider, PageLoader } from "@/components/ui";
import { Sidebar } from "@/components/Sidebar";
import { AppHeader } from "@/components/Topbar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Remember where they were going (e.g. /serve from the staff link).
    if (ready && !user) router.replace(pathname && pathname !== "/" ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
  }, [ready, user, router, pathname]);

  if (!ready || !user) {
    return <div className="min-h-screen"><PageLoader label="Starting Golden Beach POS" /></div>;
  }

  return (
    <ToastProvider>
      {/* Golden POS flex frame — floating sidebar + inline header + main */}
      <div className="flex h-dvh gap-3 overflow-hidden p-3" style={{ background: "var(--paper)" }}>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <AppHeader />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="gb-enter pb-2">{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
