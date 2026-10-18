"use client";

import { useEffect, useState } from "react";
import { ScrollText, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api";
import { PageHeader, PageLoader, EmptyState } from "@/components/ui";

interface Log { id: number; userName: string; role: string; method: string; path: string; summary: string; statusCode: number; ip: string; createdAt: string; }

const METHOD_PILL: Record<string, string> = { POST: "pill-ok", PUT: "pill-clay", PATCH: "pill-clay", DELETE: "pill-bad", GET: "pill-olive" };

export default function AuditPage() {
  const [list, setList] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); apiGet<Log[]>("/audit-log").then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(load, []);

  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every change, who made it, and when.">
        <button onClick={load} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </PageHeader>

      {loading ? <PageLoader /> : !list.length ? <EmptyState title="Nothing logged yet" icon={<ScrollText size={30} />} /> : (
        <div className="gb-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-[11px] uppercase tracking-wide" style={{ background: "var(--panel-2)" }}>
                <th className="py-2.5 px-4">When</th><th>Who</th><th>Action</th><th>Detail</th><th>Status</th>
              </tr></thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id} className="border-t border-line-soft align-top">
                    <td className="py-2.5 px-4 text-muted text-[12px] whitespace-nowrap">{(l.createdAt || "").replace("T", " ").slice(0, 16)}</td>
                    <td className="whitespace-nowrap"><span className="font-medium">{l.userName}</span> <span className="text-muted text-[12px]">· {l.role}</span></td>
                    <td className="whitespace-nowrap"><span className={`pill ${METHOD_PILL[l.method] || "pill-olive"} mr-1.5`}>{l.method}</span><span className="mono text-[12px] text-muted">{l.path}</span></td>
                    <td className="text-[12px] text-muted max-w-xs truncate">{l.summary}</td>
                    <td className="mono text-[12px]" style={{ color: l.statusCode < 400 ? "var(--ok-ink)" : "var(--bad-ink)" }}>{l.statusCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
