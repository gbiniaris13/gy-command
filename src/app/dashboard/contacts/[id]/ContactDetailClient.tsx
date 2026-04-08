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
  website_lead: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  website_inquiry: { bg: "bg-emerald-500/20", text: "text-emerald-400" },
  outreach_bot: { bg: "bg-blue-500/20", text: "text-blue-400" },
  manual: { bg: "bg-purple-500/20", text: "text-purple-400" },
  referral: { bg: "bg-amber-500/20", text: "text-amber-400" },
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
  if (!seconds) return "—";
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
    <div className="p-8">
      {/* Back link */}
      <Link
        href="/dashboard/contacts"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ivory/40 transition-colors hover:text-gold"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Contacts
      </Link>

      <div className="flex gap-8">
        {/* ─── Left Column ──────────────────────────────────────────────── */}
        <div className="w-1/3 shrink-0 space-y-5">
          {/* Profile card */}
          <div className="rounded-xl border border-white/5 bg-navy-light p-6">
            <div className="mb-4">
              <h1 className="font-[family-name:var(--font-montserrat)] text-xl font-bold text-ivory">
                {getFlagFromCountry(contact.country)} {fullName}
              </h1>
              {contact.company && (
                <p className="mt-1 text-sm text-ivory/50">{contact.company}</p>
              )}
              {contact.city && contact.country && (
                <p className="mt-0.5 text-xs text-ivory/30">
                  {contact.city}, {contact.country}
                </p>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-3">
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-2.5 text-sm text-ivory/60 transition-colors hover:text-gold"
                >
                  <span className="text-base">{"\u{1F4E7}"}</span>
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-2.5 text-sm text-ivory/60 transition-colors hover:text-gold"
                >
                  <span className="text-base">{"\u{1F4DE}"}</span>
                  {contact.phone}
                </a>
              )}
              {contact.linkedin_url && (
                <a
                  href={contact.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-sm text-ivory/60 transition-colors hover:text-gold"
                >
                  <span className="text-base">{"\u{1F517}"}</span>
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
              <label className="mb-1.5 block text-xs font-medium text-ivory/40 uppercase tracking-wider">
                Pipeline Stage
              </label>
              <select
                value={currentStageId}
                onChange={(e) => handleStageChange(e.target.value)}
                disabled={stageLoading}
                className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory focus:border-gold/30 focus:outline-none disabled:opacity-50"
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
              <label className="mb-1.5 block text-xs font-medium text-ivory/40 uppercase tracking-wider">
                Charter End Date
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={charterEndDate}
                  onChange={(e) => handleCharterDateChange(e.target.value)}
                  className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory focus:border-gold/30 focus:outline-none [color-scheme:dark]"
                />
                {charterSaving && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gold">
                    Saving...
                  </span>
                )}
              </div>
              {charterEndDate && (
                <p className="mt-1 text-[10px] text-ivory/30">
                  Post-charter step: {contact.post_charter_step}/3
                </p>
              )}
            </div>
          </div>

          {/* Tags */}
          <div className="rounded-xl border border-white/5 bg-navy-light p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider text-ivory/40 uppercase">
                Tags
              </h3>
              <button
                onClick={() => setShowTagPicker(!showTagPicker)}
                className="rounded p-1 text-ivory/30 transition-colors hover:bg-white/5 hover:text-gold"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 && (
                <p className="text-xs text-ivory/25">No tags assigned</p>
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
              <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-white/5 bg-navy-lighter p-2">
                {allTags
                  .filter((t) => !tags.some((ct) => ct.id === t.id))
                  .map((tag) => (
                    <button
                      key={tag.id}
                      className="block w-full rounded px-2 py-1.5 text-left text-xs text-ivory/60 transition-colors hover:bg-white/5 hover:text-ivory"
                    >
                      {tag.name}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Yachts Viewed */}
          <div className="rounded-xl border border-white/5 bg-navy-light p-5">
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-ivory/40 uppercase">
              Yachts Viewed
            </h3>
            {yachtsViewed.length === 0 ? (
              <p className="text-xs text-ivory/25">No yachts viewed yet</p>
            ) : (
              <div className="space-y-2">
                {yachtsViewed.map((y, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-navy-lighter px-3 py-2"
                  >
                    <span className="text-sm text-ivory/70">
                      {"\u{1F6A2}"} {y.name}
                    </span>
                    {y.viewed_at && (
                      <span className="text-[10px] text-ivory/30">
                        {formatDate(y.viewed_at)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Time on site */}
          <div className="rounded-xl border border-white/5 bg-navy-light p-5">
            <h3 className="mb-1 text-xs font-semibold tracking-wider text-ivory/40 uppercase">
              Time on Site
            </h3>
            <p className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-gold">
              {formatDuration(contact.time_on_site)}
            </p>
          </div>
        </div>

        {/* ─── Right Column ─────────────────────────────────────────────── */}
        <div className="flex-1 space-y-5">
          {/* Quick Actions */}
          <div className="flex gap-3">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-2 rounded-lg border border-white/5 bg-navy-light px-4 py-2.5 text-sm text-ivory/70 transition-colors hover:border-gold/20 hover:text-gold"
              >
                {"\u{1F4E7}"} Send Email
              </a>
            )}
            {contact.phone && (
              <a
                href={`https://wa.me/${contact.phone?.replace(/[^0-9]/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-white/5 bg-navy-light px-4 py-2.5 text-sm text-ivory/70 transition-colors hover:border-emerald-500/20 hover:text-emerald-400"
              >
                {"\u{1F4AC}"} Send WhatsApp
              </a>
            )}
            <button className="inline-flex items-center gap-2 rounded-lg border border-white/5 bg-navy-light px-4 py-2.5 text-sm text-ivory/70 transition-colors hover:border-purple-500/20 hover:text-purple-400">
              {"\u{1F4C5}"} Book Meeting
            </button>
          </div>

          {/* Quick Notes */}
          <div className="rounded-xl border border-white/5 bg-navy-light p-5">
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-ivory/40 uppercase">
              Quick Notes
            </h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/25 focus:border-gold/30 focus:outline-none resize-none"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleAddNote}
                disabled={savingNote || !noteText.trim()}
                className="rounded-lg bg-gold px-4 py-2 font-[family-name:var(--font-montserrat)] text-xs font-semibold text-navy transition-colors hover:bg-gold/90 disabled:opacity-50"
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
                    className="rounded-lg bg-navy-lighter px-3 py-2.5"
                  >
                    <p className="text-sm text-ivory/70 whitespace-pre-wrap">
                      {n.content}
                    </p>
                    <p className="mt-1 text-[10px] text-ivory/30">
                      {formatDate(n.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="rounded-xl border border-white/5 bg-navy-light p-5">
            <h3 className="mb-4 text-xs font-semibold tracking-wider text-ivory/40 uppercase">
              Activity Timeline
            </h3>
            {activities.length === 0 ? (
              <p className="py-8 text-center text-sm text-ivory/25">
                No activities yet
              </p>
            ) : (
              <div className="relative space-y-0">
                {/* Timeline line */}
                <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/5" />

                {activities.map((activity, i) => {
                  const icon = ACTIVITY_ICONS[activity.type] ?? "\u{2022}";
                  return (
                    <div
                      key={activity.id}
                      className={`relative flex gap-4 py-3 ${
                        i === 0 ? "" : ""
                      }`}
                    >
                      {/* Icon circle */}
                      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-lighter text-sm">
                        {icon}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-sm text-ivory/70">
                          {activity.description ?? activity.type.replace(/_/g, " ")}
                        </p>
                        <p className="mt-0.5 text-[10px] text-ivory/30">
                          {timeAgo(activity.created_at)}
                        </p>
                      </div>

                      {/* Type badge */}
                      <span className="shrink-0 self-start rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-ivory/30">
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
