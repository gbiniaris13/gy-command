"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

// ─── Swipeable Email Wrapper (mobile) ───────────────────────────────────────

function SwipeableEmail({
  children,
  onArchive,
  onDelete,
}: {
  children: React.ReactNode;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [swipeX, setSwipeX] = useState(0);
  const startX = useRef(0);
  const touching = useRef(false);

  return (
    <div className="relative overflow-hidden lg:contents">
      {/* Background — revealed on swipe */}
      <div className="absolute inset-0 flex lg:hidden pointer-events-none">
        <div className="w-1/2 bg-emerald-900/40 flex items-center pl-4">
          <span className="text-emerald-400 text-xs font-mono tracking-wider">ARCHIVE &rarr;</span>
        </div>
        <div className="w-1/2 bg-red-900/40 flex items-center justify-end pr-4">
          <span className="text-red-400 text-xs font-mono tracking-wider">&larr; DELETE</span>
        </div>
      </div>
      {/* Email card — slides */}
      <div
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: touching.current ? "none" : "transform 0.3s ease-out",
        }}
        onTouchStart={(e) => {
          startX.current = e.touches[0].clientX;
          touching.current = true;
        }}
        onTouchMove={(e) => {
          if (!touching.current) return;
          setSwipeX(e.touches[0].clientX - startX.current);
        }}
        onTouchEnd={() => {
          touching.current = false;
          if (swipeX > 100) {
            onArchive();
          } else if (swipeX < -100) {
            onDelete();
          }
          setSwipeX(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
  isStarred: boolean;
}

interface EmailDetail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  bodyType: "html" | "text";
  isStarred: boolean;
  attachments: { filename: string; mimeType: string; size: number }[];
}

interface Classification {
  classification: "HOT" | "WARM" | "COLD" | "NEUTRAL";
  reason: string;
  suggested_response: string;
}

interface MatchedContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
}

// ─── Templates ───────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    name: "Partnership PDF",
    subject: "George Yachts \u2014 Partnership Programme",
    body: "Thank you for your interest in George Yachts. I'd love to share our Partnership Programme with you.\n\nAttached you'll find our comprehensive brochure outlining our fleet, commission structure, and the benefits of working with us.\n\nI'm available for a call at your convenience to discuss further.\n\nBest regards,\nGeorge P. Biniaris\nGeorge Yachts",
  },
  {
    name: "Book a Call",
    subject: "",
    body: "I'd love to discuss this further over a quick call. You can book a time that works for you here, or just let me know your availability and I'll send over a calendar invite.\n\nLooking forward to connecting.\n\nBest,\nGeorge",
  },
  {
    name: "Gentle Follow-up",
    subject: "",
    body: "Hi {first_name},\n\nJust wanted to follow up on my previous message. I understand how busy things can get \u2014 no rush at all.\n\nIf you're still interested in exploring a partnership with George Yachts, I'd be happy to set up a brief call at your convenience.\n\nWarm regards,\nGeorge",
  },
  {
    name: "Last Chance",
    subject: "",
    body: "Hi {first_name},\n\nI don't want to crowd your inbox, so this will be my last follow-up. If the timing isn't right, I completely understand.\n\nShould things change in the future, my door is always open. Wishing you all the best.\n\nKind regards,\nGeorge P. Biniaris\nGeorge Yachts",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Tab = "inbox" | "starred" | "sent";

const TAB_QUERIES: Record<Tab, string> = {
  inbox: "in:inbox",
  starred: "is:starred",
  sent: "in:sent",
};

function extractName(header: string): string {
  const match = header.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const emailMatch = header.match(/^([^@]+)@/);
  return emailMatch ? emailMatch[1] : header;
}

function extractEmail(header: string): string {
  const match = header.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : header.toLowerCase().trim();
}

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7)
      return d.toLocaleDateString("en-US", { weekday: "short" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function classificationBadge(c: string) {
  switch (c) {
    case "HOT":
      return { emoji: "\uD83D\uDD34", bg: "bg-red-500/20", text: "text-red-400" };
    case "WARM":
      return { emoji: "\uD83D\uDFE1", bg: "bg-amber-500/20", text: "text-amber-400" };
    case "COLD":
      return { emoji: "\uD83D\uDD35", bg: "bg-blue-500/20", text: "text-blue-400" };
    default:
      return { emoji: "\u26AA", bg: "bg-gray-500/20", text: "text-gray-400" };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EmailClient() {
  const [tab, setTab] = useState<Tab>("inbox");
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [classifications, setClassifications] = useState<
    Record<string, Classification>
  >({});
  const [swipeToast, setSwipeToast] = useState<{ msg: string; undoFn: () => void } | null>(null);
  const [matchedContact, setMatchedContact] = useState<MatchedContact | null>(
    null
  );
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch messages ──
  const fetchMessages = useCallback(async () => {
    try {
      const q = TAB_QUERIES[tab];
      const res = await fetch(`/api/gmail/messages?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    setLoading(true);
    setSelectedId(null);
    setDetail(null);
    fetchMessages();
  }, [fetchMessages]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    intervalRef.current = setInterval(fetchMessages, 120_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMessages]);

  // ── Classify unclassified inbox messages ──
  useEffect(() => {
    if (tab !== "inbox") return;
    for (const msg of messages) {
      if (!classifications[msg.id]) {
        fetch("/api/gmail/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: msg.id,
            from: msg.from,
            subject: msg.subject,
            body: msg.snippet,
          }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) {
              setClassifications((prev) => ({
                ...prev,
                [msg.id]: data as Classification,
              }));
            }
          })
          .catch(() => {});
      }
    }
  }, [messages, tab, classifications]);

  // ── Fetch detail ──
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMatchedContact(null);
      return;
    }
    setDetailLoading(true);
    setReplyBody("");
    setSendSuccess(false);

    fetch(`/api/gmail/messages/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setDetail(data as EmailDetail);
          // Try to find matching contact
          const email = extractEmail(data.from);
          fetch(`/api/crm/contacts?email=${encodeURIComponent(email)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((contacts) => {
              if (contacts?.length) {
                setMatchedContact(contacts[0] as MatchedContact);
              } else {
                setMatchedContact(null);
              }
            })
            .catch(() => setMatchedContact(null));
        }
      })
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  // ── Toggle star ──
  const toggleStar = async (msgId: string, currentStarred: boolean) => {
    const newStarred = !currentStarred;

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isStarred: newStarred } : m))
    );

    await fetch("/api/gmail/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: msgId, starred: newStarred }),
    });
  };

  // ── Send reply ──
  const sendReply = async () => {
    if (!detail || !replyBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: extractEmail(detail.from),
          subject: `Re: ${detail.subject}`,
          body: replyBody,
          threadId: detail.threadId,
        }),
      });
      if (res.ok) {
        setSendSuccess(true);
        setReplyBody("");
      }
    } finally {
      setSending(false);
    }
  };

  // ── Apply template ──
  const applyTemplate = (tmpl: (typeof TEMPLATES)[number]) => {
    if (!detail) return;
    const fromName = extractName(detail.from);
    const firstName = fromName.split(/\s+/)[0] ?? fromName;
    setReplyBody(tmpl.body.replace(/\{first_name\}/g, firstName));
  };

  // ── Render ──
  return (
    <div className="flex h-full" style={{ touchAction: "pan-y" }}>
      {/* Left: email list — full width on mobile, 420px on desktop; hidden on mobile when reading */}
      <div
        className={`flex w-full lg:w-[420px] shrink-0 flex-col border-r border-navy-lighter ${
          selectedId ? "hidden lg:flex" : "flex"
        }`}
        style={{ touchAction: "pan-y" }}
      >
        {/* Tabs */}
        <div className="flex items-center border-b border-navy-lighter px-4">
          {(["inbox", "starred", "sent"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-4 py-3 font-[family-name:var(--font-montserrat)] text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "border-gold text-gold"
                  : "border-transparent text-ivory/50 hover:text-ivory"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ touchAction: "pan-y" }}
        >
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-ivory/40">
              No messages found
            </div>
          ) : (
            messages.map((msg) => {
              const name =
                tab === "sent"
                  ? extractName(msg.to)
                  : extractName(msg.from);
              const badge = classifications[msg.id]
                ? classificationBadge(classifications[msg.id].classification)
                : null;

              return (
                <SwipeableEmail
                  key={msg.id}
                  onArchive={() => {
                    const removed = msg;
                    setMessages((p) => p.filter((m) => m.id !== msg.id));
                    setSwipeToast({
                      msg: "Archived",
                      undoFn: () => setMessages((p) => [removed, ...p]),
                    });
                    setTimeout(() => setSwipeToast(null), 3000);
                  }}
                  onDelete={() => {
                    const removed = msg;
                    setMessages((p) => p.filter((m) => m.id !== msg.id));
                    setSwipeToast({
                      msg: "Deleted",
                      undoFn: () => setMessages((p) => [removed, ...p]),
                    });
                    setTimeout(() => setSwipeToast(null), 3000);
                  }}
                >
                <button
                  onClick={() => setSelectedId(msg.id)}
                  className={`flex w-full gap-3 border-b border-navy-lighter px-4 py-3 text-left transition-colors hover:bg-navy-lighter/50 ${
                    selectedId === msg.id ? "bg-navy-lighter" : "bg-navy-light"
                  }`}
                >
                  {/* Avatar */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold">
                    <span className="text-xs font-semibold">
                      {getInitials(name)}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ivory">
                        {name}
                      </span>
                      {badge && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.bg} ${badge.text}`}
                        >
                          {badge.emoji} {classifications[msg.id].classification}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-xs text-ivory/40">
                        {formatDate(msg.date)}
                      </span>
                    </div>
                    <p className="truncate text-sm font-semibold text-ivory/80">
                      {msg.subject || "(no subject)"}
                    </p>
                    <p className="truncate text-xs text-ivory/40">
                      {msg.snippet}
                    </p>
                  </div>

                  {/* Star */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(msg.id, msg.isStarred);
                    }}
                    className="shrink-0 self-start pt-1"
                    aria-label={msg.isStarred ? "Unstar" : "Star"}
                  >
                    <svg
                      className={`h-4 w-4 ${
                        msg.isStarred ? "fill-gold text-gold" : "text-ivory/20"
                      }`}
                      viewBox="0 0 24 24"
                      fill={msg.isStarred ? "currentColor" : "none"}
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                      />
                    </svg>
                  </button>
                </button>
                </SwipeableEmail>
              );
            })
          )}
        </div>
      </div>

      {/* Right: detail panel — hidden on mobile until a message is selected */}
      <div
        className={`flex flex-1 flex-col overflow-hidden ${
          selectedId ? "flex" : "hidden lg:flex"
        }`}
        style={{ touchAction: "pan-y" }}
      >
        {!selectedId ? (
          <div className="flex h-full items-center justify-center text-ivory/30">
            <div className="text-center">
              <svg
                className="mx-auto mb-3 h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                />
              </svg>
              <p className="text-sm">Select an email to read</p>
            </div>
          </div>
        ) : detailLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          </div>
        ) : detail ? (
          <>
            {/* Header */}
            <div className="border-b border-navy-lighter p-6">
              {/* Mobile-only back button */}
              <button
                onClick={() => setSelectedId(null)}
                className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-gold lg:hidden"
                aria-label="Back to inbox"
              >
                &larr; Back to inbox
              </button>
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
                    {detail.subject || "(no subject)"}
                  </h2>
                  <p className="mt-1 text-sm text-ivory/60">
                    From: {detail.from}
                  </p>
                  <p className="text-sm text-ivory/40">To: {detail.to}</p>
                </div>
                <span className="shrink-0 text-xs text-ivory/40">
                  {formatDate(detail.date)}
                </span>
              </div>

              {/* Classification badge */}
              {classifications[detail.id] && (
                <div className="mt-3 flex items-center gap-2">
                  {(() => {
                    const c = classifications[detail.id];
                    const badge = classificationBadge(c.classification);
                    return (
                      <>
                        <span
                          className={`rounded px-2 py-1 text-xs font-bold ${badge.bg} ${badge.text}`}
                        >
                          {badge.emoji} {c.classification}
                        </span>
                        <span className="text-xs text-ivory/40">
                          {c.reason}
                        </span>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Matched contact */}
              {matchedContact && (
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-navy-lighter/50 p-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gold/20 text-gold">
                    <span className="text-xs font-semibold">
                      {getInitials(
                        `${matchedContact.first_name ?? ""} ${matchedContact.last_name ?? ""}`.trim() || "?"
                      )}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ivory">
                      {matchedContact.first_name} {matchedContact.last_name}
                    </p>
                    {matchedContact.company && (
                      <p className="text-xs text-ivory/40">
                        {matchedContact.company}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/dashboard/contacts?id=${matchedContact.id}`}
                    className="rounded border border-gold/30 px-3 py-1 text-xs font-medium text-gold hover:bg-gold/10"
                  >
                    View in CRM
                  </Link>
                </div>
              )}

              {/* Attachments */}
              {detail.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.attachments.map((a, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded bg-navy-lighter px-2 py-1 text-xs text-ivory/60"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
                        />
                      </svg>
                      {a.filename}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Body */}
            <div
              className="flex-1 overflow-y-auto overscroll-contain p-6"
              style={{ touchAction: "pan-y" }}
            >
              {detail.bodyType === "html" ? (
                <div
                  className="prose prose-invert max-w-none text-sm text-ivory/80 [&_a]:text-gold [&_img]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: detail.body }}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-ivory/80">
                  {detail.body}
                </pre>
              )}
            </div>

            {/* Reply section */}
            <div className="border-t border-navy-lighter p-4">
              {/* Template buttons */}
              <div className="mb-3 flex flex-wrap gap-2">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.name}
                    onClick={() => applyTemplate(tmpl)}
                    className="rounded border border-gold/30 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold hover:text-navy"
                  >
                    {tmpl.name}
                  </button>
                ))}
              </div>

              {/* Suggested response from AI */}
              {classifications[detail.id]?.suggested_response && (
                <button
                  onClick={() =>
                    setReplyBody(classifications[detail.id].suggested_response)
                  }
                  className="mb-3 w-full rounded-lg bg-navy-lighter/50 p-3 text-left text-xs text-ivory/50 transition-colors hover:bg-navy-lighter"
                >
                  <span className="font-medium text-gold">
                    AI Suggestion:{" "}
                  </span>
                  {classifications[detail.id].suggested_response.slice(0, 120)}
                  ...
                </button>
              )}

              {sendSuccess && (
                <div className="mb-3 rounded-lg bg-green-500/10 px-4 py-2 text-sm text-green-400">
                  Reply sent successfully!
                </div>
              )}

              <div className="flex gap-2">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write your reply..."
                  rows={3}
                  className="flex-1 resize-none rounded-lg border border-navy-lighter bg-navy-light px-4 py-3 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold focus:outline-none"
                />
                <button
                  onClick={sendReply}
                  disabled={!replyBody.trim() || sending}
                  className="self-end rounded-lg bg-gold px-4 py-3 font-[family-name:var(--font-montserrat)] text-sm font-semibold text-navy transition-colors hover:bg-gold/90 disabled:opacity-40"
                >
                  {sending ? "..." : "Send"}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Undo toast for swipe actions */}
      {swipeToast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-electric-cyan/20 bg-deep-space/95 backdrop-blur-lg px-4 py-3 shadow-lg lg:hidden">
          <span className="text-sm text-soft-white">{swipeToast.msg}</span>
          <button
            onClick={() => {
              swipeToast.undoFn();
              setSwipeToast(null);
            }}
            className="font-mono text-xs font-bold text-electric-cyan tracking-wider"
          >
            UNDO
          </button>
        </div>
      )}
    </div>
  );
}
