"use client";
import { Database, Globe, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChatMsg, Source } from "@/types";

const SUGGESTIONS = [
  "How much did I spend today?",
  "How much did I spend on petrol this month?",
  "Which category has the highest expenses?",
  "Compare this month with last month",
  "What is today's NIFTY market situation?",
  "Compare my monthly expenses with current inflation",
  "Generate my monthly financial report",
];

export function SourceChips({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s) => (
        <span key={s.tool} title={s.type === "private" ? "Answered from your private records via internal API" : `Public data via MCP server: ${s.server}`}
          className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            s.type === "private" ? "bg-primary/15 text-primary" : "bg-success/15 text-success")}>
          {s.type === "private" ? <Database className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
          {s.type === "private" ? "Your data" : "Public (MCP)"} · {s.tool}
        </span>
      ))}
    </div>
  );
}

/** Minimal markdown: **bold**, bullets, and fenced blocks. Content is rendered as text (no HTML injection). */
function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : p));
        return <div key={i}>{/^\s*[*-]\s/.test(line) ? <span>• {parts.map((p) => (typeof p === "string" ? p.replace(/^\s*[*-]\s/, "") : p))}</span> : parts}</div>;
      })}
    </div>
  );
}

export function ChatPanel({ compact = false }: { compact?: boolean }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [sid, setSid] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<{ id: number; title: string }[]>([]);
  const end = useRef<HTMLDivElement>(null);

  const loadSessions = () => api.get<{ id: number; title: string }[]>("/chat/sessions").then(setSessions).catch(() => {});
  useEffect(() => { if (!compact) loadSessions(); }, [compact]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api.post<{ session_id: number; reply: string; sources: Source[] }>("/chat/message", { message: text, session_id: sid });
      setSid(r.session_id);
      setMsgs((m) => [...m, { role: "assistant", content: r.reply, sources: r.sources }]);
      if (!compact) loadSessions();
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `Sorry, something went wrong: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: number) {
    setSid(id);
    setMsgs(await api.get<ChatMsg[]>(`/chat/sessions/${id}/messages`));
  }

  return (
    <div className={cn("flex gap-4", compact ? "h-full flex-col" : "h-[calc(100vh-11rem)] min-h-[420px]")}>
      {!compact && (
        <aside className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto rounded-lg border bg-card p-2 md:flex">
          <Button variant="outline" size="sm" onClick={() => { setSid(null); setMsgs([]); }}>+ New chat</Button>
          {sessions.map((s) => (
            <div key={s.id} className={cn("group flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted", s.id === sid && "bg-muted")}>
              <button className="truncate text-left" onClick={() => open(s.id)}>{s.title}</button>
              <button aria-label="Delete chat" className="opacity-0 group-hover:opacity-100" onClick={async () => {
                await api.del(`/chat/sessions/${s.id}`); if (s.id === sid) { setSid(null); setMsgs([]); } loadSessions();
              }}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></button>
            </div>
          ))}
        </aside>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", !compact && "rounded-lg border bg-card")}>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!msgs.length && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Ask about your money (private records) or the world (public data). Each answer shows its source.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.slice(0, compact ? 4 : 7).map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{s}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[88%] rounded-2xl px-4 py-2.5", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                <Rich text={m.content} />
                {m.role === "assistant" && <SourceChips sources={m.sources} />}
              </div>
            </div>
          ))}
          {busy && <div className="text-sm text-muted-foreground" role="status">Thinking…</div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask RubiCore AI…" maxLength={2000} aria-label="Message" />
          <Button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </div>
  );
}
