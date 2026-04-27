"use client";

// CockpitClient — interactive surface for the new dashboard.
//
// Sections (top to bottom on mobile):
//   1. Greeting + date
//   2. TODAY'S 3 ACTIONS (priority-color-coded, [Send Draft] button)
//   3. PIPELINE PULSE (€ + counts strip)
//   4. OPPORTUNITIES (proactive intelligence)
//   5. BRAINSTORM (chat embedded with Gemini + full business context)
//
// Mobile-first: single column always, large tap targets, no sidebar.
// Desktop: same single column centered with max-w-2xl. Deliberately
// NOT widget-grid — the whole point is "one page, do these things".

import { useState } from "react";
import Link from "next/link";
import type { CockpitBriefing, CockpitAction, InboxThread } from "@/lib/cockpit-engine";

const INBOX_STAGE_STYLE: Record<
  string,
  { tag: string; label: string; ring: string }
> = {
  owed_reply: {
    tag: "bg-red-500/20 text-red-300 border-red-500/40",
    label: "OWED REPLY",
    ring: "border-red-500/40",
  },
  needs_followup: {
    tag: "bg-orange-500/20 text-orange-300 border-orange-500/40",
    label: "NEEDS FOLLOW-UP",
    ring: "border-orange-500/30",
  },
  cold: {
    tag: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    label: "COLD",
    ring: "border-white/15",
  },
  new_lead: {
    tag: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    label: "NEW LEAD",
    ring: "border-emerald-500/30",
  },
  active: {
    tag: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    label: "ACTIVE",
    ring: "border-white/15",
  },
  awaiting_reply: {
    tag: "bg-white/5 text-white/60 border-white/15",
    label: "AWAITING REPLY",
    ring: "border-white/10",
  },
};

function gmailThreadHref(threadId: string | null): string | null {
  if (!threadId) return null;
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

function ThreadRow({ t }: { t: InboxThread }) {
  const style = INBOX_STAGE_STYLE[t.inbox_stage] ?? INBOX_STAGE_STYLE.awaiting_reply;
  const gmailHref = gmailThreadHref(t.thread_id);
  const gap = t.gap_days ?? 0;
  const directionLabel =
    t.last_direction === "inbound"
      ? "they sent"
      : t.last_direction === "outbound"
        ? "you sent"
        : "—";

  return (
    <div
      className={`rounded-lg border ${style.ring} bg-white/[0.02] p-4 hover:bg-white/[0.05] transition`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {t.starred && (
              <span
                className="text-[12px] leading-none"
                title="Starred in Gmail — top priority"
              >
                ⭐
              </span>
            )}
            <span
              className={`text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded border ${style.tag}`}
            >
              {style.label}
            </span>
            <span className="text-[10px] text-white/40">
              {gap}d · {directionLabel}
            </span>
            {t.charter_fee && t.charter_fee > 0 && (
              <span className="text-[10px] text-[#DAA520] font-mono">
                €{Math.round(t.charter_fee).toLocaleString()}
              </span>
            )}
          </div>
          <div className="font-serif text-white truncate">{t.contact_name}</div>
          {t.last_subject && (
            <div className="text-xs text-white/50 truncate mt-0.5">
              {t.last_subject}
            </div>
          )}
          {t.last_snippet && (
            <div className="text-xs text-white/40 mt-1 line-clamp-2">
              {t.last_snippet}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        {gmailHref && (
          <a
            href={gmailHref}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center bg-[#DAA520] text-black font-semibold uppercase tracking-widest text-[10px] py-2 rounded hover:bg-[#C9A24D]"
          >
            ✉️ Open in Gmail
          </a>
        )}
        <Link
          href={`/dashboard/contacts/${t.contact_id}`}
          className="flex-1 text-center border border-white/15 text-white/80 font-semibold uppercase tracking-widest text-[10px] py-2 rounded hover:bg-white/5"
        >
          Contact →
        </Link>
      </div>
    </div>
  );
}

function InboxBrain({
  threads,
  summary,
}: {
  threads: InboxThread[];
  summary: CockpitBriefing["inbox_summary"];
}) {
  const owed = threads.filter((t) => t.inbox_stage === "owed_reply");
  const followup = threads.filter((t) => t.inbox_stage === "needs_followup");
  const other = threads.filter(
    (t) => t.inbox_stage !== "owed_reply" && t.inbox_stage !== "needs_followup",
  );

  if (threads.length === 0) {
    return (
      <div className="border border-white/10 rounded-xl p-5 text-white/60 text-sm bg-white/[0.02]">
        Inbox Brain has no thread state yet.{" "}
        <a
          href="/api/admin/inbox-backfill?days=90"
          className="text-[#DAA520] underline"
        >
          Run backfill →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="border border-red-500/30 rounded-lg py-2">
          <div className="text-xl font-serif text-red-300">
            {summary.owed_reply}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/50 mt-0.5">
            Owed
          </div>
        </div>
        <div className="border border-orange-500/30 rounded-lg py-2">
          <div className="text-xl font-serif text-orange-300">
            {summary.needs_followup}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/50 mt-0.5">
            Follow-up
          </div>
        </div>
        <div className="border border-white/10 rounded-lg py-2">
          <div className="text-xl font-serif text-white">
            {summary.awaiting_reply}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-white/50 mt-0.5">
            Awaiting
          </div>
        </div>
      </div>

      {owed.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-red-300/80 mb-2">
            🔴 You owe them ({owed.length})
          </div>
          <div className="space-y-2">
            {owed.map((t) => (
              <ThreadRow key={t.contact_id} t={t} />
            ))}
          </div>
        </div>
      )}

      {followup.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-orange-300/80 mb-2">
            🟠 Needs follow-up ({followup.length})
          </div>
          <div className="space-y-2">
            {followup.map((t) => (
              <ThreadRow key={t.contact_id} t={t} />
            ))}
          </div>
        </div>
      )}

      {other.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-white/50 hover:text-white/80">
            Show {other.length} more (active, awaiting, cold) →
          </summary>
          <div className="mt-2 space-y-2">
            {other.map((t) => (
              <ThreadRow key={t.contact_id} t={t} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

const PRIORITY_COLORS: Record<string, { ring: string; tag: string; label: string }> = {
  critical: { ring: "ring-red-500/60", tag: "bg-red-500/20 text-red-300", label: "🔴 CRITICAL" },
  high:     { ring: "ring-orange-500/60", tag: "bg-orange-500/20 text-orange-300", label: "🟠 HIGH" },
  medium:   { ring: "ring-yellow-500/60", tag: "bg-yellow-500/20 text-yellow-300", label: "🟡 MEDIUM" },
  low:      { ring: "ring-white/20", tag: "bg-white/10 text-white/60", label: "⚪ LOW" },
};

function formatEur(n: number): string {
  if (!n) return "€0";
  return `€${Math.round(n).toLocaleString()}`;
}

function ActionCard({ action }: { action: CockpitAction }) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const colors = PRIORITY_COLORS[action.priority] || PRIORITY_COLORS.low;

  async function generateDraft() {
    setLoading(true);
    setCopied(false);
    try {
      const res = await fetch("/api/cockpit/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: action.contact_id,
          draft_kind: action.draft_kind,
        }),
      });
      const j = await res.json();
      if (j.subject || j.body) setDraft({ subject: j.subject ?? "", body: j.body ?? "" });
      else if (j.error) alert("Draft failed: " + j.error);
    } catch (e: any) {
      alert("Draft generation failed: " + (e?.message ?? "unknown"));
    }
    setLoading(false);
  }

  async function copyDraft() {
    if (!draft) return;
    const full = `Subject: ${draft.subject}\n\n${draft.body}`;
    await navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openMail() {
    if (!draft) return;
    const subject = encodeURIComponent(draft.subject);
    const body = encodeURIComponent(draft.body);
    const to = action.contact_email || "";
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }

  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] p-5 ring-1 ${colors.ring}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className={`text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded ${colors.tag}`}>
          {colors.label}
        </span>
        {action.expected_commission_eur > 0 && (
          <span className="text-[10px] text-[#DAA520] font-mono">
            commission: {formatEur(action.expected_commission_eur)}
          </span>
        )}
      </div>
      <h3 className="font-serif text-xl text-white leading-tight mb-2">{action.title}</h3>
      <p className="text-white/70 text-sm mb-3 leading-relaxed">{action.reason}</p>
      <div className="text-xs text-white/40 space-x-3 mb-4">
        {action.stage && <span>Stage: {action.stage}</span>}
        {action.vessel && <span>· {action.vessel}</span>}
        {action.charter_dates && <span>· {action.charter_dates}</span>}
      </div>

      {!draft && (
        <button
          onClick={generateDraft}
          disabled={loading}
          className="w-full bg-[#DAA520] text-black font-semibold uppercase tracking-widest text-xs py-3 rounded hover:bg-[#C9A24D] transition disabled:opacity-50"
        >
          {loading ? "Generating draft…" : "→ Generate follow-up draft"}
        </button>
      )}

      {draft && (
        <div className="mt-2 space-y-3">
          <div className="bg-black/40 rounded p-3 border border-white/10">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Subject</div>
            <div className="font-serif text-white text-sm mb-3">{draft.subject}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Body</div>
            <pre className="font-sans text-white/85 text-xs leading-relaxed whitespace-pre-wrap">
              {draft.body}
            </pre>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={openMail}
              className="bg-[#DAA520] text-black font-semibold uppercase tracking-widest text-xs py-2 rounded hover:bg-[#C9A24D]"
            >
              ✉️ Open in Mail
            </button>
            <button
              onClick={copyDraft}
              className="border border-white/20 text-white font-semibold uppercase tracking-widest text-xs py-2 rounded hover:bg-white/5"
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>
          <button
            onClick={generateDraft}
            disabled={loading}
            className="w-full text-[10px] uppercase tracking-widest text-white/40 hover:text-white/70 py-1"
          >
            ↻ Regenerate
          </button>
        </div>
      )}
    </div>
  );
}

function PipelinePulse({ p }: { p: CockpitBriefing["pulse"] }) {
  // Each stat is now a Link to a filtered contacts view. Tappable on
  // mobile, satisfying the natural "I tapped the number, show me what
  // it means" reflex (per George's 25/04 feedback).
  return (
    <div className="grid grid-cols-2 gap-3 text-center">
      <Link
        href="/dashboard/contacts?filter=active_deals"
        className="border border-white/10 rounded-lg p-4 hover:border-[#DAA520] transition"
      >
        <div className="text-2xl font-serif text-[#DAA520]">{formatEur(p.total_pipeline_value_eur)}</div>
        <div className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Pipeline value →</div>
      </Link>
      <Link
        href="/dashboard/revenue"
        className="border border-white/10 rounded-lg p-4 hover:border-[#DAA520] transition"
      >
        <div className="text-2xl font-serif text-[#DAA520]">{formatEur(p.total_commission_upside_eur)}</div>
        <div className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Commission upside →</div>
      </Link>
      <Link
        href="/dashboard/contacts?filter=active_deals"
        className="border border-white/10 rounded-lg p-3 hover:border-[#DAA520] transition"
      >
        <div className="text-lg font-serif text-white">{p.active_deals_count}</div>
        <div className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Active deals →</div>
      </Link>
      <Link
        href="/dashboard/contacts?stage=Hot"
        className="border border-white/10 rounded-lg p-3 hover:border-[#DAA520] transition"
      >
        <div className="text-lg font-serif text-white">{p.hot_leads_count}</div>
        <div className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Hot leads →</div>
      </Link>
      <Link
        href="/dashboard/contacts?stage=Warm&stale=7"
        className="border border-white/10 rounded-lg p-3 hover:border-[#DAA520] transition"
      >
        <div className="text-lg font-serif text-white">{p.stale_warm_leads_count}</div>
        <div className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Stale warm →</div>
      </Link>
      <Link
        href="/dashboard/revenue?filter=pending"
        className="border border-white/10 rounded-lg p-3 hover:border-[#DAA520] transition"
      >
        <div className="text-lg font-serif text-white">{p.pending_payments_count}</div>
        <div className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Pending payments →</div>
      </Link>
    </div>
  );
}

function Brainstorm({ initialPrompt }: { initialPrompt: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText) return;
    const newMessages = [...messages, { role: "user" as const, content: userText }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/cockpit/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const j = await res.json();
      if (j.content) {
        setMessages((prev) => [...prev, { role: "assistant", content: j.content }]);
      } else if (j.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "⚠️ " + j.error },
        ]);
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Network error: " + (e?.message ?? "unknown") },
      ]);
    }
    setLoading(false);
  }

  return (
    <div className="border border-white/10 rounded-xl bg-white/[0.02] p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-serif text-xl text-white">🧠 Brainstorm</h3>
        <span className="text-[10px] uppercase tracking-widest text-white/40">
          knows your live pipeline
        </span>
      </div>

      {messages.length === 0 && (
        <button
          onClick={() => send(initialPrompt)}
          className="w-full text-left text-sm text-white/60 hover:text-white/90 italic border border-white/10 rounded-lg p-3 mb-3 bg-white/[0.02]"
          disabled={loading}
        >
          💡 {initialPrompt}
        </button>
      )}

      {messages.length > 0 && (
        <div className="space-y-3 mb-3 max-h-[400px] overflow-y-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm leading-relaxed rounded-lg p-3 ${
                m.role === "user"
                  ? "bg-[#DAA520]/10 text-white border border-[#DAA520]/30"
                  : "bg-white/[0.04] text-white/85 border border-white/10"
              }`}
            >
              <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">
                {m.role === "user" ? "You" : "Advisor"}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="text-xs text-white/40 italic">Advisor is thinking…</div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your pipeline…"
          className="flex-1 bg-black border border-white/15 rounded px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#DAA520] focus:outline-none"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-[#DAA520] text-black font-semibold uppercase tracking-widest text-xs px-4 py-2 rounded hover:bg-[#C9A24D] disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

export default function CockpitClient({ briefing }: { briefing: CockpitBriefing }) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-2xl mx-auto px-5 py-10 space-y-8">
        {/* Header */}
        <header>
          <h1 className="font-serif text-4xl font-light leading-tight">
            {briefing.greeting}
          </h1>
          <p className="text-white/40 text-sm mt-1">{today} · Cockpit</p>
        </header>

        {/* INBOX BRAIN — Pillar 1. Gmail thread state, ranked by who
            George owes a reply / which threads need follow-up. This
            is the new primary surface; CRM-stage actions live below. */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xs uppercase tracking-[0.3em] text-[#DAA520]">
              📬 Inbox Brain
            </h2>
            <span className="text-[10px] text-white/40">
              ranked by Gmail thread state
            </span>
          </div>
          <InboxBrain
            threads={briefing.inbox_threads ?? []}
            summary={
              briefing.inbox_summary ?? {
                owed_reply: 0,
                needs_followup: 0,
                awaiting_reply: 0,
                active: 0,
                cold: 0,
                new_lead: 0,
              }
            }
          />
        </section>

        {/* TODAY'S ACTIONS — the heart */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.3em] text-[#DAA520] mb-4">
            📍 Σήμερα κάνε αυτά
          </h2>
          {briefing.actions.length === 0 ? (
            <div className="border border-white/10 rounded-xl p-6 text-white/60 text-sm">
              Καθαρή ατζέντα. Ώρα για outbound — travel-agent prospect list ή 1 PR pitch.
            </div>
          ) : (
            <div className="space-y-4">
              {briefing.actions.map((a) => (
                <ActionCard key={a.id} action={a} />
              ))}
            </div>
          )}
        </section>

        {/* PIPELINE PULSE */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.3em] text-[#DAA520] mb-4">
            💰 Pipeline Pulse
          </h2>
          <PipelinePulse p={briefing.pulse} />
        </section>

        {/* OPPORTUNITIES — each card has a primary action */}
        {briefing.opportunities.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.3em] text-[#DAA520] mb-4">
              💡 Opportunities Today
            </h2>
            <div className="space-y-3">
              {briefing.opportunities.map((o, i) => {
                // Decide each card's primary action based on opportunity kind
                let actionHref = "/dashboard/contacts";
                let actionLabel = "Δες λίστα →";
                if (o.kind === "stale_b2b_partner") {
                  actionHref = "/dashboard/contacts?stage=Warm&stale=7";
                  actionLabel = "Δες τους 22 stale partners →";
                } else if (o.kind === "calendar_today") {
                  actionHref = "/dashboard/calendar";
                  actionLabel = "Άνοιξε ημερολόγιο →";
                } else if (o.kind === "season_window") {
                  actionHref = "/dashboard/contacts?stage=Warm";
                  actionLabel = "Δες όλους τους warm →";
                } else if (o.kind === "press_mention") {
                  actionHref = "/dashboard/contacts?category=press";
                  actionLabel = "Press contacts →";
                } else if (o.kind === "ig_warm_signal") {
                  actionHref = "/dashboard/instagram";
                  actionLabel = "Άνοιξε Instagram →";
                }
                return (
                  <Link
                    href={actionHref}
                    key={i}
                    className="block border border-white/10 rounded-lg p-4 bg-white/[0.02] hover:border-[#DAA520] transition"
                  >
                    <div className="font-serif text-white mb-1">{o.title}</div>
                    <div className="text-sm text-white/60 leading-relaxed mb-3">{o.detail}</div>
                    <div className="text-xs text-[#DAA520] uppercase tracking-widest">
                      {actionLabel}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* DEVIL'S ADVOCATE — uninvited contrarian challenge */}
        {briefing.devils_advocate && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.3em] text-red-400/80 mb-4">
              🔪 Devil's Advocate
            </h2>
            <div className="border-l-2 border-red-400/60 bg-red-500/[0.04] rounded-r-lg p-5">
              <p className="font-serif text-lg text-white/90 leading-relaxed italic">
                "{briefing.devils_advocate}"
              </p>
              <p className="text-[10px] uppercase tracking-widest text-white/30 mt-3">
                Σου το λέω επειδή κανείς άλλος δεν σου το λέει.
              </p>
            </div>
          </section>
        )}

        {/* BRAINSTORM */}
        <section>
          <Brainstorm initialPrompt={briefing.brainstorm_prompt} />
        </section>

        {/* Footer / drill-down links */}
        <footer className="pt-8 border-t border-white/10 grid grid-cols-3 gap-3 text-[11px] uppercase tracking-widest text-white/40">
          <Link href="/dashboard/contacts" className="hover:text-[#DAA520]">Contacts</Link>
          <Link href="/dashboard/revenue" className="hover:text-[#DAA520]">Revenue</Link>
          <Link href="/dashboard/calendar" className="hover:text-[#DAA520]">Calendar</Link>
          <Link href="/dashboard/instagram" className="hover:text-[#DAA520]">Instagram</Link>
          <Link href="/dashboard/email" className="hover:text-[#DAA520]">Email</Link>
          <Link href="/dashboard/legacy" className="hover:text-[#DAA520]">Legacy</Link>
        </footer>

        <div className="text-center pt-4">
          <p className="text-[10px] text-white/30 italic">
            Built as a name-day gift, 25 April 2026 — close charters, make money. 🎁
          </p>
        </div>
      </div>
    </main>
  );
}
