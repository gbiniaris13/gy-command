"use client";

import { useState } from "react";
import Link from "next/link";
import type { Contact, PipelineStage, Activity, Note, Tag, YachtViewed } from "@/lib/types";
import { getFlagFromCountry } from "@/lib/flags";

interface Props {
  contact: Contact;
  activities: Activity[];
  notes: Note[];
  stages: PipelineStage[];
  allTags: Tag[];
  contactTags: Tag[];
}

const ACTIVITY_ICONS: Record<string, string> = {
  email_sent: "\u{1F4E7}",
  email_received: "\u{1F4E8}",
  call: "\u{1F4DE}",
  meeting: "\u{1F91D}",
  note: "\u{1F4DD}",
  stage_change: "\u{1F4CA}",
  website_visit: "\u{1F310}",
  lead_captured: "\u{1F3AF}",
  proposal_sent: "\u{1F4C4}",
  tag_added: "\u{1F3F7}",
  tag_removed: "\u{274C}",
};

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  website_lead: { bg: "bg-emerald/20", text: "text-emerald" },
  website_inquiry: { bg: "bg-emerald/20", text: "text-emerald" },
  outreach_bot: { bg: "bg-electric-cyan/20", text: "text-electric-cyan" },
  manual: { bg: "bg-neon-purple/20", text: "text-neon-purple" },
  referral: { bg: "bg-amber/20", text: "text-amber" },
  partner: { bg: "bg-pink-500/20", text: "text-pink-400" },
};

function sourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatDate(dateStr);
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "\u2014";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function ContactDetailClient({
  contact,
  activities: initialActivities,
  notes: initialNotes,
  stages,
  allTags,
  contactTags: initialTags,
}: Props) {
  const [currentStageId, setCurrentStageId] = useState(
    contact.pipeline_stage_id ?? ""
  );
  const [activities, setActivities] = useState(initialActivities);
  const [notes, setNotes] = useState(initialNotes);
  const [tags] = useState(initialTags);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [stageLoading, setStageLoading] = useState(false);
  const [charterEndDate, setCharterEndDate] = useState(
    contact.charter_end_date ?? ""
  );
  const [charterSaving, setCharterSaving] = useState(false);

  const fullName = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "Unknown";
  const currentStage = stages.find((s) => s.id === currentStageId);
  const srcColor = SOURCE_COLORS[contact.source ?? ""] ?? {
    bg: "bg-gray-500/20",
    text: "text-gray-400",
  };

  const yachtsViewed = (contact.yachts_viewed ?? []) as YachtViewed[];

  // ─── Stage change ───────────────────────────────────────────────────────

  async function handleStageChange(newStageId: string) {
    if (newStageId === currentStageId) return;
    setStageLoading(true);
    const oldStageId = currentStageId;
    setCurrentStageId(newStageId);

    try {
      const res = await fetch(`/api/crm/contacts/${contact.id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage_id: newStageId }),
      });
      if (res.ok) {
        const fromName = stages.find((s) => s.id === oldStageId)?.name ?? "Unknown";
        const toName = stages.find((s) => s.id === newStageId)?.name ?? "Unknown";
        setActivities((prev) => [
          {
            id: crypto.randomUUID(),
            contact_id: contact.id,
            type: "stage_change",
            description: `Stage changed from "${fromName}" to "${toName}"`,
            metadata: {},
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      } else {
        setCurrentStageId(oldStageId);
      }
    } catch {
      setCurrentStageId(oldStageId);
    } finally {
      setStageLoading(false);
    }
  }

  // ─── Add note ───────────────────────────────────────────────────────────

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/crm/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteText }),
      });
      if (res.ok) {
        const newNote = await res.json();
        setNotes((prev) => [newNote, ...prev]);
        setActivities((prev) => [
          {
            id: crypto.randomUUID(),
            contact_id: contact.id,
            type: "note",
            description: noteText.substring(0, 200),
            metadata: {},
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        setNoteText("");
      }
    } finally {
      setSavingNote(false);
    }
  }

  // ─── Charter end date ────────────────────────────────────────────────

  async function handleCharterDateChange(date: string) {
    setCharterEndDate(date);
    setCharterSaving(true);
    try {
      await fetch(`/api/crm/contacts/${contact.id}/charter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charter_end_date: date || null }),
      });
    } finally {
      setCharterSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Back link */}
      <Link
        href="/dashboard/contacts"
        className="mb-4 sm:mb-6 inline-flex items-center gap-1.5 text-sm text-muted-blue transition-colors hover:text-electric-cyan min-h-[44px]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Contacts
      </Link>

      <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
        {/* ─── Left Column ──────────────────────────────────────────────── */}
        <div className="w-full lg:w-1/3 shrink-0 space-y-5">
          {/* Profile card */}
          <div className="glass-card p-5 sm:p-6">
            <div className="mb-4">
              <h1 className="font-[family-name:var(--font-display)] text-lg sm:text-xl font-bold text-soft-white">
                {getFlagFromCountry(contact.country)} {fullName}
              </h1>
              {contact.company && (
                <p className="mt-1 text-sm text-muted-blue">{contact.company}</p>
              )}
              {contact.city && contact.country && (
                <p className="mt-0.5 text-xs text-muted-blue/60">
                  {contact.city}, {contact.country}
                </p>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-3">
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2.5 text-sm text-muted-blue transition-colors hover:text-electric-cyan min-h-[44px]"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  <span className="truncate">{contact.email}</span>
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2.5 text-sm text-muted-blue transition-colors hover:text-electric-cyan min-h-[44px]"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                  </svg>
                  <span>{contact.phone}</span>
                </a>
              )}
              {contact.linkedin_url && (
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-sm text-muted-blue transition-colors hover:text-electric-cyan min-h-[44px]"
                >
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-4.822a4.5 4.5 0 00-6.364-6.364L4.5 8.738a4.5 4.5 0 006.364 6.364l1.757-1.757" />
                  </svg>
                  LinkedIn
                </a>
              )}
            </div>

            {/* Source badge */}
            <div className="mt-4">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${srcColor.bg} ${srcColor.text}`}
              >
                {sourceLabel(contact.source)}
              </span>
            </div>

            {/* Pipeline stage dropdown */}
            <div className="mt-5">
              <label className="mb-1.5 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                Pipeline Stage
              </label>
              <select
                value={currentStageId}
                onChange={(e) => handleStageChange(e.target.value)}
                disabled={stageLoading}
                className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none disabled:opacity-50 min-h-[44px]"
                style={
                  currentStage
                    ? {
                        borderLeftColor: currentStage.color,
                        borderLeftWidth: "3px",
                      }
                    : {}
                }
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Charter End Date */}
            <div className="mt-5">
              <label className="mb-1.5 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                Charter End Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={charterEndDate}
                  onChange={(e) => handleCharterDateChange(e.target.value)}
                  className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none [color-scheme:dark] min-h-[44px]"
                />
                {charterSaving && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-electric-cyan">
                    Saving...
                  </span>
                )}
              </div>
              {charterEndDate && (
                <p className="mt-1 text-[10px] text-muted-blue/60">
                  Post-charter step: {contact.post_charter_step}/3
                </p>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="glass-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
                Tags
              </h3>
              <button
                onClick={() => setShowTagPicker(!showTagPicker)}
                className="rounded p-1 text-muted-blue transition-colors hover:bg-glass-light hover:text-electric-cyan min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 && (
                <p className="text-xs text-muted-blue/40">No tags assigned</p>
              )}
              {tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
            {showTagPicker && (
              <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-border-glow bg-glass-light p-2">
                {allTags
                  .filter((t) => !tags.some((ct) => ct.id === t.id))
                  .map((tag) => (
                    <button
                      key={tag.id}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs text-muted-blue transition-colors hover:bg-glass-dark hover:text-soft-white min-h-[44px]"
                    >
                      {tag.name}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Yachts Viewed */}
          <div className="glass-card p-5">
            <h3 className="mb-3 text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
              Yachts Viewed
            </h3>
            {yachtsViewed.length === 0 ? (
              <p className="text-xs text-muted-blue/40">No yachts viewed yet</p>
            ) : (
              <div className="space-y-2">
                {yachtsViewed.map((y, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-glass-light px-3 py-2"
                  >
                    <span className="text-sm text-soft-white/70">
                      {"\u{1F6A2}"} {y.name}
                    </span>
                    {y.viewed_at && (
                      <span className="text-[10px] text-muted-blue/50">
                        {formatDate(y.viewed_at)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Time on site */}
          <div className="glass-card p-5">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
              Time on Site
            </h3>
            <p className="font-[family-name:var(--font-mono)] text-2xl font-bold text-electric-cyan">
              {formatDuration(contact.time_on_site)}
            </p>
          </div>
        </div>

        {/* ─── Right Column ─────────────────────────────────────────────── */}
        <div className="flex-1 space-y-5">
          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-2 rounded-lg border border-border-glow bg-glass-dark px-4 py-2.5 text-sm text-muted-blue transition-all hover:border-electric-cyan/20 hover:text-electric-cyan min-h-[44px]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                Send Email
              </a>
            )}
            {contact.phone && (
              <a
                href={`https://wa.me/${contact.phone?.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border-glow bg-glass-dark px-4 py-2.5 text-sm text-muted-blue transition-all hover:border-emerald/20 hover:text-emerald min-h-[44px]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
                WhatsApp
              </a>
            )}
            <button className="inline-flex items-center gap-2 rounded-lg border border-border-glow bg-glass-dark px-4 py-2.5 text-sm text-muted-blue transition-all hover:border-neon-purple/20 hover:text-neon-purple min-h-[44px]">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              Book Meeting
            </button>
          </div>

          {/* Quick Notes */}
          <div className="glass-card p-5">
            <h3 className="mb-3 text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
              Quick Notes
            </h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none resize-none"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleAddNote}
                disabled={savingNote || !noteText.trim()}
                className="rounded-lg bg-electric-cyan px-4 py-2 font-[family-name:var(--font-display)] text-xs font-semibold text-deep-space transition-colors hover:bg-electric-cyan/90 disabled:opacity-50 min-h-[44px]"
              >
                {savingNote ? "Saving..." : "Save Note"}
              </button>
            </div>

            {/* Recent notes */}
            {notes.length > 0 && (
              <div className="mt-4 space-y-2">
                {notes.slice(0, 5).map((n) => (
                  <div
                    key={n.id}
                    className="rounded-lg bg-glass-light px-3 py-2.5"
                  >
                    <p className="text-sm text-soft-white/70 whitespace-pre-wrap">
                      {n.content}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-blue/50">
                      {formatDate(n.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="glass-card p-5">
            <h3 className="mb-4 text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
              Activity Timeline
            </h3>
            {activities.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-blue/40">
                No activities yet
              </p>
            ) : (
              <div className="relative space-y-0">
                {/* Timeline line */}
                <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border-glow" />

                {activities.map((activity) => {
                  const icon = ACTIVITY_ICONS[activity.type] ?? "\u{2022}";
                  return (
                    <div
                      key={activity.id}
                      className="relative flex gap-4 py-3"
                    >
                      {/* Icon circle */}
                      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-glass-light text-sm border border-border-glow">
                        {icon}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-sm text-soft-white/70">
                          {activity.description ?? activity.type.replace(/_/g, " ")}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-blue/50">
                          {timeAgo(activity.created_at)}
                        </p>
                      </div>

                      {/* Type badge */}
                      <span className="hidden sm:inline-flex shrink-0 self-start rounded-full bg-soft-white/5 px-2 py-0.5 text-[10px] text-muted-blue/50">
                        {activity.type.replace(/_/g, " ")}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
