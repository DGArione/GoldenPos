"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Plus, Send, Users as UsersIcon, Megaphone } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, PageLoader, EmptyState, Screen, useToast, Modal } from "@/components/ui";

interface Thread {
  id: number;
  fromName: string;
  fromRole: string;
  toName?: string;
  toRole?: string;
  body: string;
  createdAt: string;
  unread: boolean;
  replyCount?: number;
}
interface Message {
  id: number;
  parentId: number | null;
  fromUserId: number;
  fromName: string;
  fromRole: string;
  body: string;
  createdAt: string;
}

export default function MessagesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Thread | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<Thread[]>("/messages/threads").then((d) => setThreads(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i); }, [load]);

  const canCompose = user?.role === "manager" || user?.role === "superManager";

  return (
    <div className="flex flex-col gap-3">
      <Screen>
        <PageHeader title="Messages" subtitle="Internal notes between staff" icon={MessageSquare}>
          {canCompose && (
            <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
              <Plus size={14} /> New message
            </button>
          )}
        </PageHeader>

        {loading ? <PageLoader /> : !threads.length ? (
          <EmptyState title="No messages yet" hint="Managers can start a new thread above." icon={<MessageSquare size={30} />} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t)}
                className="flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors"
                style={{ background: t.unread ? "var(--olive-wash)" : "var(--panel-2)" }}
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                  style={{ background: t.toRole === "all" ? "var(--warn)" : "var(--olive)" }}
                >
                  {t.toRole === "all" ? <Megaphone size={16} /> : t.fromName.charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[13.5px] text-ink">{t.fromName}</span>
                    <span className="text-[11px] text-muted">→</span>
                    <span className="text-[12px] text-muted">
                      {t.toName || (t.toRole === "all" ? "Everyone" : t.toRole)}
                    </span>
                    {t.unread && <span className="pill pill-info">new</span>}
                  </div>
                  <div className="text-[12.5px] text-ink/80 truncate mt-0.5">{t.body}</div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {(t.createdAt || "").replace("T", " ").slice(0, 16)}
                    {!!t.replyCount && ` · ${t.replyCount} replies`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Screen>

      {open && (
        <ComposeModal
          onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); load(); toast.push("ok", "Sent"); }}
        />
      )}

      {active && (
        <ThreadView
          thread={active}
          onClose={() => { setActive(null); load(); }}
        />
      )}
    </div>
  );
}

function ComposeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [toRole, setToRole] = useState("all");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const roles = [
    { k: "all",           label: "Everyone", icon: Megaphone },
    { k: "manager",       label: "Managers", icon: UsersIcon },
    { k: "server",        label: "Servers", icon: UsersIcon },
    { k: "cashier",       label: "Cashiers", icon: UsersIcon },
    { k: "kitchen",       label: "Kitchen", icon: UsersIcon },
  ];

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try { await apiPost("/messages", { toRole, body }); onDone(); }
    catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); setBusy(false); }
  }

  return (
    <Modal open title="New message" onClose={onClose} width={480}>
      <div className="space-y-3">
        <div>
          <label className="lbl">Send to</label>
          <div className="grid grid-cols-5 gap-1.5">
            {roles.map(({ k, label, icon: Icon }) => (
              <button key={k} onClick={() => setToRole(k)}
                className="flex flex-col items-center gap-1 px-2 py-2 rounded-lg border transition-colors"
                style={toRole === k
                  ? { background: "var(--olive)", color: "var(--on-accent)", borderColor: "var(--olive)" }
                  : { background: "var(--panel)", borderColor: "var(--line)", color: "var(--ink)" }}>
                <Icon size={14} />
                <span className="text-[10.5px] font-semibold">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="lbl">Message</label>
          <textarea
            className="inp"
            rows={5}
            autoFocus
            placeholder="What do you want to tell them?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button onClick={send} disabled={busy || !body.trim()} className="btn btn-primary w-full">
          <Send size={14} /> {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </Modal>
  );
}

function ThreadView({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { user } = useAuth();

  const load = useCallback(() => {
    apiGet<Message[]>(`/messages/thread/${thread.id}`).then((d) => setMessages(Array.isArray(d) ? d : [])).catch(() => {});
  }, [thread.id]);
  useEffect(load, [load]);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await apiPost("/messages", { parentId: thread.id, body: reply });
      setReply("");
      load();
    } catch (e) { toast.push("bad", e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <Modal open title="Thread" onClose={onClose} width={540}>
      <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto mb-3">
        {messages.map((m) => {
          const mine = m.fromUserId === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] rounded-2xl px-4 py-2.5"
                style={{
                  background: mine ? "var(--olive)" : "var(--panel-2)",
                  color: mine ? "#fff" : "var(--ink)",
                }}
              >
                {!mine && (
                  <div className="text-[11px] font-semibold mb-1" style={{ color: "var(--olive-700)" }}>
                    {m.fromName}
                  </div>
                )}
                <div className="text-[13px] whitespace-pre-wrap">{m.body}</div>
                <div className="text-[10.5px] mt-1 opacity-70">
                  {(m.createdAt || "").replace("T", " ").slice(11, 16)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          className="inp"
          placeholder="Reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={busy || !reply.trim()} className="btn btn-primary">
          <Send size={14} />
        </button>
      </div>
    </Modal>
  );
}
