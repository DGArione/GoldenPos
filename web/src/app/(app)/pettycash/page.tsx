"use client";

import { useEffect, useState } from "react";
import { Coins, Plus, ArrowUpRight, ArrowDownLeft, Wallet } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { money, useSettings } from "@/lib/settings";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Entry {
  id: number;
  type: "in" | "out";
  amount: number;
  reason: string;
  staffName: string;
  createdAt: string;
}
interface PettyCashResp { entries: Entry[]; balance: number }

export default function PettyCashPage() {
  const toast = useToast();
  const settings = useSettings();
  const currency = settings?.currencySymbol || "Rs. ";
  const [data, setData] = useState<PettyCashResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<"in" | "out" | null>(null);

  const load = () => {
    setLoading(true);
    apiGet<PettyCashResp>("/petty-cash")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const inTotal  = (data?.entries || []).filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
  const outTotal = (data?.entries || []).filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Petty Cash" subtitle="Daily float — money in and out" icon={Coins}>
          <button onClick={() => setOpen("in")} className="btn btn-soft btn-sm">
            <ArrowDownLeft size={14} /> Cash in
          </button>
          <button onClick={() => setOpen("out")} className="btn btn-primary btn-sm">
            <ArrowUpRight size={14} /> Cash out
          </button>
        </PageHeader>

        <div className="grid grid-cols-3 gap-3">
          <Tile icon={<Wallet size={16} />}      label="Balance" value={money(data?.balance || 0, currency)} accent />
          <Tile icon={<ArrowDownLeft size={16} />} label="In total" value={money(inTotal, currency)} />
          <Tile icon={<ArrowUpRight size={16} />}  label="Out total" value={money(outTotal, currency)} />
        </div>
      </Screen>

      <Screen>
        <h2 className="text-[15px] font-semibold text-ink mb-4">Movements</h2>
        {loading ? (
          <PageLoader />
        ) : !data?.entries.length ? (
          <EmptyState title="No movements yet" hint="Log a cash in or cash out above." icon={<Coins size={30} />} />
        ) : (
          <div className="flex flex-col gap-1">
            {data.entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px]"
                style={{ background: "var(--panel-2)" }}
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: e.type === "in" ? "var(--ok-wash)" : "var(--bad-wash)",
                    color: e.type === "in" ? "var(--ok-ink)" : "var(--bad-ink)",
                  }}
                >
                  {e.type === "in" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-ink font-medium truncate">
                    {e.reason || <span className="text-muted italic">(no reason)</span>}
                  </div>
                  <div className="text-[11.5px] text-muted">
                    {e.staffName} · {new Date(e.createdAt.replace(" ", "T")).toLocaleString()}
                  </div>
                </div>
                <div
                  className="mono font-semibold"
                  style={{ color: e.type === "in" ? "var(--ok-ink)" : "var(--bad-ink)" }}
                >
                  {e.type === "in" ? "+" : "−"}{money(e.amount, currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Screen>

      {open && (
        <AddEntry
          type={open}
          currency={currency}
          onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); load(); toast.push("ok", "Logged"); }}
        />
      )}
    </div>
  );
}

function Tile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  const bg = accent ? "var(--olive)" : "var(--panel-2)";
  const fg = accent ? "var(--on-accent)" : "var(--ink)";
  const iconColor = accent ? "var(--on-accent)" : "var(--olive-text)";
  return (
    <div className="rounded-xl p-4" style={{ background: bg, border: accent ? "none" : "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: iconColor }}>
        {icon}
        <span className="text-[11px] uppercase tracking-wider font-semibold">{label}</span>
      </div>
      <div className="mono text-[20px] font-semibold leading-none" style={{ color: fg }}>{value}</div>
    </div>
  );
}

function AddEntry({
  type, currency, onClose, onDone,
}: {
  type: "in" | "out";
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = Number(amount);
    if (!n || n <= 0) { toast.push("bad", "Amount must be greater than 0"); return; }
    if (!reason.trim()) { toast.push("bad", "A short reason is required"); return; }
    setBusy(true);
    try {
      await apiPost("/petty-cash", { type, amount: n, reason });
      onDone();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  return (
    <Modal open title={type === "in" ? "Cash in" : "Cash out"} onClose={onClose} width={420}>
      <div className="space-y-3">
        <div>
          <label className="lbl">Amount ({currency.trim()})</label>
          <input
            className="inp mono text-right text-[18px]"
            inputMode="decimal"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <div>
          <label className="lbl">Reason</label>
          <input
            className="inp"
            placeholder={type === "in" ? "e.g. opening float, cash deposit" : "e.g. petrol, grocery, change"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>
        <button
          onClick={save}
          disabled={busy}
          className={type === "in" ? "btn btn-soft w-full btn-lg" : "btn btn-primary w-full btn-lg"}
        >
          {busy ? "Saving…" : type === "in" ? "Record cash in" : "Record cash out"}
        </button>
      </div>
    </Modal>
  );
}
