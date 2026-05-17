"use client";

import { useEffect, useRef, useState } from "react";

type Msg = {
  id: string;
  body: string;
  sender_role: "charterer" | "admin";
  sender_email: string;
  created_at: string;
  pending?: boolean;
  failed?: boolean;
};

const POLL = 5000;

function fmt(iso: string) {
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return same
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function AdminChat({ cabinId }: { cabinId: string }) {
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const sinceRef = useRef<string | null>(null);

  async function pullInitial() {
    const r = await fetch(`/api/cabins/${cabinId}/chat`);
    const j = await r.json();
    const m: Msg[] = j.messages ?? [];
    setMessages(m);
    if (m.length) sinceRef.current = m[m.length - 1].created_at;
  }

  async function pullIncremental() {
    if (!sinceRef.current) return;
    try {
      const r = await fetch(`/api/cabins/${cabinId}/chat?since=${encodeURIComponent(sinceRef.current)}`);
      if (!r.ok) return;
      const j = await r.json();
      const newM: Msg[] = j.messages ?? [];
      if (newM.length) {
        setMessages((prev) => [...(prev ?? []), ...newM]);
        sinceRef.current = newM[newM.length - 1].created_at;
      }
    } catch {}
  }

  useEffect(() => {
    void pullInitial();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void pullIncremental();
    }, POLL);
    return () => clearInterval(id);
  }, [cabinId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages?.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const localId = "local-" + Date.now();
    setMessages((p) => [...(p ?? []), {
      id: localId, body, sender_role: "admin",
      sender_email: "you", created_at: new Date().toISOString(),
      pending: true,
    }]);
    setDraft("");
    try {
      const r = await fetch(`/api/cabins/${cabinId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (r.ok && j.message) {
        setMessages((p) => (p ?? []).map((m) => m.id === localId ? j.message : m));
        sinceRef.current = j.message.created_at;
      } else {
        setMessages((p) => (p ?? []).map((m) => m.id === localId ? { ...m, failed: true } : m));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={cardStyle}>
      <ul ref={listRef} style={listStyle} aria-live="polite">
        {messages === null && (
          <li style={emptyStyle}>Loading…</li>
        )}
        {messages?.length === 0 && (
          <li style={emptyStyle}><em>No messages yet.</em></li>
        )}
        {messages?.map((m, i) => {
          const isMe = m.sender_role === "admin";
          const prev = i > 0 ? messages[i - 1] : null;
          const grouped = prev && prev.sender_role === m.sender_role &&
            (new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60 * 1000;
          return (
            <li key={m.id || i} style={{
              ...msgRowStyle,
              alignItems: isMe ? "flex-end" : "flex-start",
              marginTop: grouped ? 2 : 10,
            }}>
              {!grouped && (
                <span style={whoStyle}>
                  {isMe ? "George (you)" : "Client"} <em style={{ fontStyle: "italic", color: "#9CA3AF", marginLeft: 4 }}>· {fmt(m.created_at)}</em>
                </span>
              )}
              <span style={{
                ...bubbleStyle,
                background: isMe ? "#0D1B2A" : "rgba(201,168,76,0.08)",
                color: isMe ? "#F8F5F0" : "#0D1B2A",
                border: isMe ? "1px solid #0D1B2A" : "1px solid rgba(201,168,76,0.35)",
                opacity: m.pending ? 0.6 : 1,
                borderColor: m.failed ? "#b14a3a" : undefined,
              }}>
                {m.body}
              </span>
            </li>
          );
        })}
      </ul>

      <form onSubmit={send} style={composeStyle}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e); }}
          placeholder="Your reply… ⌘+Enter to send"
          rows={2}
          maxLength={8000}
          style={textareaStyle}
        />
        <button type="submit" disabled={sending || !draft.trim()} style={btnStyle}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(13,27,42,0.08)",
  display: "flex",
  flexDirection: "column",
  minHeight: "60dvh",
};
const listStyle: React.CSSProperties = {
  flex: 1,
  listStyle: "none",
  padding: "18px 18px 8px",
  margin: 0,
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  minHeight: 320,
};
const emptyStyle: React.CSSProperties = {
  color: "rgba(13,27,42,0.4)",
  fontStyle: "italic",
  textAlign: "center",
  padding: "32px 8px",
};
const msgRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
};
const whoStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: "rgba(13,27,42,0.5)",
  marginBottom: 4,
};
const bubbleStyle: React.CSSProperties = {
  maxWidth: "78%",
  padding: "10px 14px",
  fontSize: 14.5,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};
const composeStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  padding: 12,
  borderTop: "1px solid rgba(13,27,42,0.08)",
  background: "rgba(13,27,42,0.02)",
};
const textareaStyle: React.CSSProperties = {
  flex: 1,
  border: "1px solid rgba(13,27,42,0.12)",
  padding: "10px 12px",
  fontSize: 14.5,
  lineHeight: 1.5,
  color: "#0D1B2A",
  outline: "none",
  resize: "none",
  minHeight: 44,
  maxHeight: 200,
  fontFamily: "inherit",
};
const btnStyle: React.CSSProperties = {
  background: "#0D1B2A",
  color: "#F8F5F0",
  border: "1px solid #C9A84C",
  padding: "0 18px",
  fontSize: 10.5,
  letterSpacing: 2.5,
  textTransform: "uppercase",
  cursor: "pointer",
};
