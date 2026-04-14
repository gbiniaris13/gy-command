"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { Contact, PipelineStage, Activity, Note, Tag, YachtViewed, CharterReminder } from "@/lib/types";
import { CONTACT_TYPES, type ContactType } from "@/lib/types";
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
  const [contactType, setContactType] = useState(contact.contact_type ?? "OUTREACH_LEAD");
  const [contactTypeLoading, setContactTypeLoading] = useState(false);
  const [charterEndDate, setCharterEndDate] = useState(
    contact.charter_end_date ?? ""
  );
  const [charterSaving, setCharterSaving] = useState(false);

  // Charter management state
  const [charterVessel, setCharterVessel] = useState(contact.charter_vessel ?? "");
  const [charterStartDate, setCharterStartDate] = useState(contact.charter_start_date ?? "");
  const [charterGuests, setCharterGuests] = useState(contact.charter_guests?.toString() ?? "");
  const [charterEmbarkation, setCharterEmbarkation] = useState(contact.charter_embarkation ?? "");
  const [charterDisembarkation, setCharterDisembarkation] = useState(contact.charter_disembarkation ?? "");
  const [charterFee, setCharterFee] = useState(contact.charter_fee?.toString() ?? "");
  const [charterApa, setCharterApa] = useState(contact.charter_apa?.toString() ?? "");
  const [captainName, setCaptainName] = useState(contact.captain_name ?? "");
  const [captainPhone, setCaptainPhone] = useState(contact.captain_phone ?? "");
  const [charterNotes, setCharterNotes] = useState(contact.charter_notes ?? "");
  const [paymentStatus, setPaymentStatus] = useState(contact.payment_status ?? "pending");
  const [reminders, setReminders] = useState<CharterReminder[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const [activatingCharter, setActivatingCharter] = useState(false);
  const [charterFieldsSaving, setCharterFieldsSaving] = useState(false);

  // Voice notes state
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<unknown>(null);

  // Proposal modal state
  const [proposalHtml, setProposalHtml] = useState("");
  const [proposalLoading, setProposalLoading] = useState(false);
  const [showProposalModal, setShowProposalModal] = useState(false);

  // LinkedIn message copied state
  const [linkedinCopied, setLinkedinCopied] = useState(false);

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

  // ─── Contact type change ─────────────────────────────────────────────────

  async function handleContactTypeChange(newType: string) {
    if (newType === contactType) return;
    setContactTypeLoading(true);
    const oldType = contactType;
    setContactType(newType);

    try {
      const res = await fetch("/api/crm/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contact.id, contact_type: newType }),
      });
      if (!res.ok) setContactType(oldType);
    } catch {
      setContactType(oldType);
    } finally {
      setContactTypeLoading(false);
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

  // ─── Charter: check if stage is Closed Won ──────────────────────────────
  const isClosedWon = currentStage?.name === "Closed Won";

  // Load reminders when stage is Closed Won
  const fetchReminders = useCallback(async () => {
    setRemindersLoading(true);
    try {
      const res = await fetch(
        `/api/crm/charter/reminders?contactId=${contact.id}`
      );
      if (res.ok) {
        const data = await res.json();
        setReminders(data.reminders ?? []);
      }
    } finally {
      setRemindersLoading(false);
    }
  }, [contact.id]);

  useEffect(() => {
    if (isClosedWon) {
      fetchReminders();
    }
  }, [isClosedWon, fetchReminders]);

  // Save charter fields
  async function saveCharterFields() {
    setCharterFieldsSaving(true);
    try {
      await fetch(`/api/crm/contacts/${contact.id}/charter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          charter_vessel: charterVessel || null,
          charter_start_date: charterStartDate || null,
          charter_end_date: charterEndDate || null,
          charter_guests: charterGuests ? parseInt(charterGuests) : null,
          charter_embarkation: charterEmbarkation || null,
          charter_disembarkation: charterDisembarkation || null,
          charter_fee: charterFee ? parseFloat(charterFee) : null,
          charter_apa: charterApa ? parseFloat(charterApa) : null,
          captain_name: captainName || null,
          captain_phone: captainPhone || null,
          charter_notes: charterNotes || null,
          payment_status: paymentStatus,
        }),
      });
    } finally {
      setCharterFieldsSaving(false);
    }
  }

  // Activate charter (create reminders)
  async function activateCharter() {
    if (!charterStartDate) return;
    setActivatingCharter(true);
    try {
      const res = await fetch("/api/crm/charter/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: contact.id,
          charter_start_date: charterStartDate,
        }),
      });
      if (res.ok) {
        await fetchReminders();
      }
    } finally {
      setActivatingCharter(false);
    }
  }

  // Toggle reminder complete
  async function toggleReminder(id: string, completed: boolean) {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed } : r))
    );
    await fetch("/api/crm/charter/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, completed }),
    });
  }

  // Snooze reminder (7 days)
  async function snoozeReminder(id: string) {
    const snoozedUntil = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString().slice(0, 10);
    setReminders((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, snoozed_until: snoozedUntil } : r
      )
    );
    await fetch("/api/crm/charter/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, snoozed_until: snoozedUntil }),
    });
  }

  // ─── Voice Notes ──────────────────────────────────────────────────────────
  function startVoiceNote() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SR() as any;
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    setRecording(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript as string;
      setRecording(false);
      // Save as note
      fetch(`/api/crm/contacts/${contact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `\uD83C\uDFA4 Voice note: ${text}` }),
      }).then(async (res) => {
        if (res.ok) {
          const newNote = await res.json();
          setNotes((prev) => [newNote, ...prev]);
          setActivities((prev) => [
            {
              id: crypto.randomUUID(),
              contact_id: contact.id,
              type: "note",
              description: `Voice note: ${text.substring(0, 200)}`,
              metadata: {},
              created_at: new Date().toISOString(),
            },
            ...prev,
          ]);
        }
      });
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognition.start();
  }

  function stopVoiceNote() {
    if (recognitionRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recognitionRef.current as any).stop();
    }
    setRecording(false);
  }

  // ─── Proposal Generator ─────────────────────────────────────────────────
  async function generateProposal() {
    setProposalLoading(true);
    setShowProposalModal(true);
    try {
      const res = await fetch(`/api/crm/contacts/${contact.id}/proposal`);
      if (res.ok) {
        const data = await res.json();
        setProposalHtml(data.html);
      } else {
        setProposalHtml("<p>Failed to generate proposal. Please try again.</p>");
      }
    } catch {
      setProposalHtml("<p>Error generating proposal. Please try again.</p>");
    } finally {
      setProposalLoading(false);
    }
  }

  // ─── LinkedIn Message ───────────────────────────────────────────────────
  function copyLinkedInMessage() {
    const firstName = contact.first_name || "there";
    const company = contact.company || "your company";
    const message = `Hi ${firstName}, I came across ${company} and wanted to reach out about luxury yacht charter partnerships in Greece. Happy to share our Partnership Programme. Best, George`;
    navigator.clipboard.writeText(message).then(() => {
      setLinkedinCopied(true);
      setTimeout(() => setLinkedinCopied(false), 2000);
    });
  }

  async function logLinkedInActivity() {
    await fetch(`/api/crm/contacts/${contact.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "email_sent",
        description: `LinkedIn message sent to ${fullName}`,
      }),
    });
    setActivities((prev) => [
      {
        id: crypto.randomUUID(),
        contact_id: contact.id,
        type: "email_sent",
        description: `LinkedIn message sent to ${fullName}`,
        metadata: {},
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Proposal Modal */}
      {showProposalModal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border-glow px-5 py-3">
              <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-soft-white">
                Charter Proposal
              </h2>
              <button
                onClick={() => setShowProposalModal(false)}
                className="rounded p-1.5 text-muted-blue hover:text-soft-white hover:bg-glass-light transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {proposalLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-electric-cyan border-t-transparent" />
                  <span className="ml-3 text-sm text-muted-blue">Generating proposal...</span>
                </div>
              ) : (
                <div
                  className="prose prose-invert prose-sm max-w-none text-soft-white/80 [&_h1]:text-electric-cyan [&_h2]:text-electric-cyan/80 [&_h3]:text-soft-white [&_strong]:text-soft-white"
                  dangerouslySetInnerHTML={{ __html: proposalHtml }}
                />
              )}
            </div>
            {!proposalLoading && proposalHtml && (
              <div className="flex items-center gap-2 border-t border-border-glow px-5 py-3">
                <button
                  onClick={() => {
                    const textContent = proposalHtml.replace(/<[^>]*>/g, "");
                    navigator.clipboard.writeText(textContent);
                  }}
                  className="rounded-lg border border-border-glow bg-glass-dark px-4 py-2 text-xs font-semibold text-muted-blue hover:text-electric-cyan hover:border-electric-cyan/20 transition-all min-h-[44px]"
                >
                  Copy Text
                </button>
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}?subject=Luxury Yacht Charter Proposal&body=${encodeURIComponent(proposalHtml.replace(/<[^>]*>/g, ""))}`}
                    className="rounded-lg bg-electric-cyan px-4 py-2 font-[family-name:var(--font-display)] text-xs font-semibold text-deep-space hover:bg-electric-cyan/90 transition-colors min-h-[44px] inline-flex items-center"
                  >
                    Send via Email
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

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

            {/* Contact Type dropdown */}
            <div className="mt-5">
              <label className="mb-1.5 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                Contact Type
              </label>
              <select
                value={contactType}
                onChange={(e) => handleContactTypeChange(e.target.value)}
                disabled={contactTypeLoading}
                className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none disabled:opacity-50 min-h-[44px]"
                style={{
                  borderLeftColor: CONTACT_TYPES[contactType as ContactType]?.color ?? "#6b7280",
                  borderLeftWidth: "3px",
                }}
              >
                {Object.entries(CONTACT_TYPES).map(([key, val]) => (
                  <option key={key} value={key}>
                    {val.label}
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
            {/* LinkedIn buttons */}
            {contact.linkedin_url && (
              <a
                href={contact.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border-glow bg-glass-dark px-4 py-2.5 text-sm text-muted-blue transition-all hover:border-blue-400/20 hover:text-blue-400 min-h-[44px]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                Open LinkedIn
              </a>
            )}
            <button
              onClick={copyLinkedInMessage}
              className="inline-flex items-center gap-2 rounded-lg border border-border-glow bg-glass-dark px-4 py-2.5 text-sm text-muted-blue transition-all hover:border-blue-400/20 hover:text-blue-400 min-h-[44px]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
              </svg>
              {linkedinCopied ? "Copied!" : "Copy LinkedIn Message"}
            </button>
            <button
              onClick={logLinkedInActivity}
              className="inline-flex items-center gap-2 rounded-lg border border-border-glow bg-glass-dark px-4 py-2.5 text-sm text-muted-blue transition-all hover:border-emerald/20 hover:text-emerald min-h-[44px]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              LinkedIn Message Sent
            </button>
            {/* Generate Proposal — only for Closed Won */}
            {isClosedWon && (
              <button
                onClick={generateProposal}
                disabled={proposalLoading}
                className="inline-flex items-center gap-2 rounded-lg border border-amber/20 bg-amber/5 px-4 py-2.5 text-sm text-amber transition-all hover:bg-amber/10 hover:border-amber/30 disabled:opacity-50 min-h-[44px]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                {proposalLoading ? "Generating..." : "Generate Proposal"}
              </button>
            )}
          </div>

          {/* Quick Notes */}
          <div className="glass-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
                Quick Notes
              </h3>
              <button
                onClick={recording ? stopVoiceNote : startVoiceNote}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all min-h-[44px] ${
                  recording
                    ? "bg-hot-red/10 border border-hot-red/30 text-hot-red animate-hot-pulse"
                    : "border border-border-glow text-muted-blue hover:text-electric-cyan hover:border-electric-cyan/20"
                }`}
                title={recording ? "Stop recording" : "Start voice note"}
              >
                {recording ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-hot-red animate-pulse" />
                    Recording...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                    </svg>
                    Voice Note
                  </>
                )}
              </button>
            </div>
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

          {/* Charter Management — only when Closed Won */}
          {isClosedWon && (
            <div className="glass-card p-5">
              <h3 className="mb-4 text-[11px] font-semibold tracking-wider text-muted-blue uppercase">
                Charter Management
              </h3>

              {/* Charter Fields Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Vessel</label>
                  <input
                    type="text"
                    value={charterVessel}
                    onChange={(e) => setCharterVessel(e.target.value)}
                    placeholder="M/Y Vessel Name"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Guests</label>
                  <input
                    type="number"
                    value={charterGuests}
                    onChange={(e) => setCharterGuests(e.target.value)}
                    placeholder="Number of guests"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={charterStartDate}
                    onChange={(e) => setCharterStartDate(e.target.value)}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none [color-scheme:dark] min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">End Date</label>
                  <input
                    type="date"
                    value={charterEndDate}
                    onChange={(e) => setCharterEndDate(e.target.value)}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none [color-scheme:dark] min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Embarkation Port</label>
                  <input
                    type="text"
                    value={charterEmbarkation}
                    onChange={(e) => setCharterEmbarkation(e.target.value)}
                    placeholder="e.g. Athens Marina"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Disembarkation Port</label>
                  <input
                    type="text"
                    value={charterDisembarkation}
                    onChange={(e) => setCharterDisembarkation(e.target.value)}
                    placeholder="e.g. Mykonos"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Charter Fee (EUR)</label>
                  <input
                    type="number"
                    value={charterFee}
                    onChange={(e) => setCharterFee(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">APA (EUR)</label>
                  <input
                    type="number"
                    value={charterApa}
                    onChange={(e) => setCharterApa(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Captain Name</label>
                  <input
                    type="text"
                    value={captainName}
                    onChange={(e) => setCaptainName(e.target.value)}
                    placeholder="Captain name"
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-muted-blue/70 mb-1">Captain Phone</label>
                  <input
                    type="text"
                    value={captainPhone}
                    onChange={(e) => setCaptainPhone(e.target.value)}
                    placeholder="+30 ..."
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  />
                </div>
              </div>

              {/* Payment Status */}
              <div className="mb-4">
                <label className="block text-[10px] text-muted-blue/70 mb-1">Payment Status</label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                  className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                >
                  <option value="pending">Pending</option>
                  <option value="deposit_paid">Deposit Paid</option>
                  <option value="balance_paid">Balance Paid</option>
                  <option value="fully_paid">Fully Paid</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>

              {/* Charter Notes */}
              <div className="mb-4">
                <label className="block text-[10px] text-muted-blue/70 mb-1">Charter Notes</label>
                <textarea
                  value={charterNotes}
                  onChange={(e) => setCharterNotes(e.target.value)}
                  placeholder="Special requests, dietary needs, etc."
                  rows={2}
                  className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none resize-none"
                />
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 mb-5">
                <button
                  onClick={saveCharterFields}
                  disabled={charterFieldsSaving}
                  className="rounded-lg bg-electric-cyan px-4 py-2 font-[family-name:var(--font-display)] text-xs font-semibold text-deep-space transition-colors hover:bg-electric-cyan/90 disabled:opacity-50 min-h-[44px]"
                >
                  {charterFieldsSaving ? "Saving..." : "Save Charter Details"}
                </button>
                <button
                  onClick={activateCharter}
                  disabled={activatingCharter || !charterStartDate}
                  className="rounded-lg border border-neon-purple bg-neon-purple/10 px-4 py-2 font-[family-name:var(--font-display)] text-xs font-semibold text-neon-purple transition-colors hover:bg-neon-purple/20 disabled:opacity-50 min-h-[44px]"
                >
                  {activatingCharter ? "Activating..." : "Activate Charter"}
                </button>
              </div>

              {/* Reminder Timeline */}
              {reminders.length > 0 && (
                <div>
                  <h4 className="mb-3 text-[10px] font-semibold tracking-wider text-muted-blue uppercase">
                    Reminder Timeline
                  </h4>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {reminders.map((r) => {
                      const isPast =
                        new Date(r.reminder_date) <= new Date();
                      const isSnoozed =
                        r.snoozed_until &&
                        new Date(r.snoozed_until) > new Date();
                      return (
                        <div
                          key={r.id}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                            r.completed
                              ? "bg-emerald/5 border border-emerald/10"
                              : isPast && !isSnoozed
                              ? "bg-hot-red/5 border border-hot-red/10"
                              : "bg-glass-light border border-border-glow"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={r.completed}
                            onChange={() =>
                              toggleReminder(r.id, !r.completed)
                            }
                            className="h-4 w-4 rounded border-muted-blue accent-electric-cyan min-h-[44px] min-w-[44px] flex items-center justify-center"
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm ${
                                r.completed
                                  ? "text-muted-blue/50 line-through"
                                  : "text-soft-white/80"
                              }`}
                            >
                              {r.description}
                            </p>
                            <p className="text-[10px] text-muted-blue/50">
                              {r.reminder_date}
                              {isSnoozed && (
                                <span className="ml-2 text-amber">
                                  Snoozed to {r.snoozed_until}
                                </span>
                              )}
                            </p>
                          </div>
                          {!r.completed && (
                            <button
                              onClick={() => snoozeReminder(r.id)}
                              className="shrink-0 rounded px-2 py-1 text-[10px] text-muted-blue hover:text-amber hover:bg-amber/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                              title="Snooze 7 days"
                            >
                              Snooze
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {remindersLoading && (
                <p className="text-xs text-muted-blue/50 py-2">
                  Loading reminders...
                </p>
              )}
            </div>
          )}

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
