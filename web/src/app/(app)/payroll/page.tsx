"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { apiGet } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState } from "@/components/ui";

interface Row { userId: number; userName: string; hours: number; days?: number; payRate: number; payType: string; amountDue: number; }

export default function PayrollPage() {
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { apiGet<Row[]>("/payroll/summary").then((d) => setRows(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false)); }, []);

  const total = rows.reduce((s, r) => s + (r.amountDue || 0), 0);

  return (
    <div>
      <PageHeader title="Payroll" subtitle="Hours and pay owed from recorded shifts." />
      {loading ? <PageLoader /> : !rows.length ? <EmptyState title="No payroll data" hint="Pay accrues as staff clock in and out." icon={<Wallet size={30} />} /> : (
        <>
          <div className="gb-card p-5 mb-4 inline-block">
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Total owed</div>
            <div className="font-head text-3xl mono text-olive-700">{money(total, currency)}</div>
          </div>
          <div className="gb-card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-[11px] uppercase tracking-wide" style={{ background: "var(--panel-2)" }}>
                <th className="py-2.5 px-4">Staff</th><th>Hours</th><th>Rate</th><th>Type</th><th className="text-right pr-4">Due</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-t border-line-soft">
                    <td className="py-2.5 px-4 font-medium">{r.userName}</td>
                    <td className="mono">{r.payType === "daily" ? `${r.days ?? 0} days` : `${r.hours.toFixed(2)}h`}</td>
                    <td className="mono">{money(r.payRate, currency)}</td>
                    <td className="capitalize text-muted">{r.payType}</td>
                    <td className="text-right pr-4 mono font-semibold text-clay">{money(r.amountDue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
