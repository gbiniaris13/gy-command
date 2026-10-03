// THE CHARTER TIMELINE (George, 2 October 2026): once a charter is won, the
// house moves on its own at four moments, each as a Gmail DRAFT in the
// client's thread that George reads and sends (house rule: nothing ever goes
// to a client without his hand).
//
//   T-45  the balance, the VAT and the APA fall due (MYBA terms)
//   T-7   the week-before note; George's calendar gets the embarkation and
//         a reminder to call the captain
//   T-1   "see you at the dock tomorrow"
//   T+3   thank you, the review, a photograph, the next summer
//
// Dates come from the Cabin when the booking has one (charter_period_from/to,
// port_embarkation), else from the request's own dates. White-label bookings
// are never touched. State lives in extraction.timeline, one entry per
// moment, so a re-run never drafts twice. A moment that is missed by more
// than seven days is marked "late" and skipped, never sent out of time.

import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting, calendarFetch } from "@/lib/google-api";
import { createHelmDraft } from "@/lib/helm/gmail-send";
import { logHelmMessage } from "@/lib/helm-admin";
import { helmSalutation } from "@/lib/helm/addressing";
import { readBooking } from "@/lib/helm/booking";
import { editionUrl } from "@/lib/helm/edition-link";

export type Moment = "T-45" | "T-7" | "T-1" | "T+3";
export const MOMENTS: Moment[] = ["T-45", "T-7", "T-1", "T+3"];
export const MOMENT_LABEL: Record<Moment, string> = {
  "T-45": "Balance, VAT and APA due",
  "T-7": "The week before",
  "T-1": "See you at the dock",
  "T+3": "Thank you and the review",
};

export type MomentState = {
  due: string;                 // YYYY-MM-DD
  drafted_at?: string;
  draft_id?: string | null;
  subject?: string;
  calendar?: { embarkation?: string | null; captain_call?: string | null; error?: string | null };
  skipped?: string;            // reason, e.g. "late", "no-email", "thanks-already-sent"
};
export type Timeline = Partial<Record<Moment, MomentState>>;

export type CharterRow = {
  id: string;
  client_name: string | null;
  client_title: string | null;
  client_surname: string | null;
  client_is_family: boolean | null;
  client_email: string | null;
  request_type: string | null;
  gmail_thread_id: string | null;
  dates_from: string | null;
  dates_to: string | null;
  extraction: Record<string, unknown> | null;
};

export type Charter = {
  id: string;
  client: string;               // "Hong" / "the Mead family"
  email: string | null;
  vessel: string;
  from: string;                 // YYYY-MM-DD
  to: string;
  port: string | null;
  berth: string | null;
  cabinId: string | null;
  threadId: string | null;
  timeline: Timeline;
  row: CharterRow;
};

const DAY = 86400000;
export function athensToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / DAY);
}
export function fmtLong(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function weekday(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

export function dueDates(from: string, to: string): Record<Moment, string> {
  return { "T-45": addDays(from, -45), "T-7": addDays(from, -7), "T-1": addDays(from, -1), "T+3": addDays(to, 3) };
}

/** Every won, direct, non-white-label charter with dates, newest first. */
export async function loadCharters(): Promise<Charter[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("helm_requests")
    .select("id, client_name, client_title, client_surname, client_is_family, client_email, request_type, gmail_thread_id, dates_from, dates_to, extraction")
    .eq("status", "won")
    .order("created_at", { ascending: false })
    .limit(200);
  const out: Charter[] = [];
  for (const r of (data ?? []) as CharterRow[]) {
    if (r.request_type && r.request_type !== "direct_client") continue;
    const b = readBooking(r.extraction);
    if (b.white_label) continue;
    let from = r.dates_from, to = r.dates_to, port: string | null = null, berth: string | null = null;
    if (b.cabin_id) {
      const { data: c } = await db.from("cabins").select("charter_period_from, charter_period_to, port_embarkation, berth_label").eq("id", b.cabin_id).maybeSingle();
      if (c?.charter_period_from) from = c.charter_period_from;
      if (c?.charter_period_to) to = c.charter_period_to;
      port = c?.port_embarkation ?? null;
      berth = c?.berth_label ?? null;
    }
    if (!from || !to || !b.vessel) continue;
    const tl = (r.extraction && typeof r.extraction === "object" && (r.extraction as { timeline?: Timeline }).timeline) || {};
    const surname = (r.client_surname || "").trim();
    const client = r.client_is_family && surname ? `the ${surname} family` : surname || (r.client_name || "").trim() || r.client_email || "the client";
    out.push({ id: r.id, client, email: r.client_email, vessel: b.vessel, from: String(from).slice(0, 10), to: String(to).slice(0, 10), port, berth, cabinId: b.cabin_id, threadId: r.gmail_thread_id, timeline: tl, row: r });
  }
  return out;
}

async function mergeTimeline(id: string, patch: Timeline): Promise<void> {
  const db = createServiceClient();
  const { data: r } = await db.from("helm_requests").select("extraction").eq("id", id).maybeSingle();
  const ex = (r?.extraction && typeof r.extraction === "object" ? r.extraction : {}) as Record<string, unknown>;
  const prev = (ex.timeline && typeof ex.timeline === "object" ? ex.timeline : {}) as Timeline;
  const next: Timeline = { ...prev };
  for (const k of Object.keys(patch) as Moment[]) next[k] = { ...(prev[k] ?? { due: patch[k]!.due }), ...patch[k] };
  await db.from("helm_requests").update({ extraction: { ...ex, timeline: next } }).eq("id", id);
}

// ─── the four letters, George's voice, facts only ───────────────────────────

function strip(name: string): string {
  return name.replace(/^(m\/?cat|s\/?cat|p\/?cat|m\/?y|s\/?y)\s+/i, "").trim();
}

export function letterFor(m: Moment, c: Charter, salutation: string, link: string | null): { subject: string; body: string } {
  const v = strip(c.vessel);
  const port = c.port ? c.port : "the marina";
  const sign = "";
  if (m === "T-45") {
    return {
      subject: `${v}, ${fmtLong(c.from)}: the balance, the VAT and the APA`,
      body: [
        salutation,
        "",
        `Forty five days before embarkation is the moment the MYBA agreement sets for the second half of the charter fee, together with the VAT and the Advance Provisioning Allowance. For ${v}, with embarkation on ${fmtLong(c.from)}, that date is ${fmtLong(addDays(c.from, -45))}.`,
        "",
        "I will send the exact figures and the stakeholder's bank details in a separate note today, so that everything you need sits in one place. Once the transfer is made, a copy of the remittance by reply is all I need; I confirm receipt the same day.",
        "",
        "If anything about the dates, the guest list or the itinerary has changed since we last spoke, tell me now and I will adjust before the paperwork settles.",
        sign,
      ].join("\n"),
    };
  }
  if (m === "T-7") {
    return {
      subject: `${v}: one week to go`,
      body: [
        salutation,
        "",
        `One week from today you step aboard ${v}${c.port ? ` in ${c.port}` : ""}. A few practical lines so the week opens without a single question.`,
        "",
        `Embarkation is on ${weekday(c.from)}, ${fmtLong(c.from)}. The captain will reach you directly in the coming days to agree the exact hour and the arrival arrangements, and I remain one message away at every step.`,
        "",
        "If you have not yet completed the preference brief, the next two days are the last comfortable moment for the chef to provision around your tastes. Allergies and special dates take priority over everything else.",
        link ? `\nYour private page keeps the week's details in one place: ${link}` : "",
        "",
        "Pack light, bring the people you love, and leave the rest to us.",
        sign,
      ].join("\n"),
    };
  }
  if (m === "T-1") {
    return {
      subject: `${v}: see you at the dock tomorrow`,
      body: [
        salutation,
        "",
        `Tomorrow is the day. ${v} is ready for you${c.port ? ` at ${port}` : ""}${c.berth ? `, berth ${c.berth}` : ""}, and the crew has your brief in hand.`,
        "",
        "Keep your passports within reach for the port formalities, and if your arrival time changes for any reason, one line to me or to the captain is enough. Everything else is taken care of.",
        "",
        "I wish you a week you will talk about for years.",
        sign,
      ].join("\n"),
    };
  }
  return {
    subject: `Thank you for sailing with us aboard ${v}`,
    body: [
      salutation,
      "",
      `Welcome home. I hope the week aboard ${v} was everything you had in mind, and more.`,
      "",
      "Two small favours, if the week earned them. First, a photograph or two you would be happy for me to keep: I collect them for the crew, who rarely get to see the week through your eyes. Second, a few honest words on Google; they are read by exactly the kind of families I hope to welcome next: https://g.page/r/CR_fG1ftsKWBEBM/review",
      "",
      "If a friend of yours is thinking about Greece, I would be honoured to be introduced. And when the time comes to think about next summer, the best weeks go first; I will keep an eye on the calendar for you.",
      "",
      "With warm regards from Athens, and my thanks,",
      sign,
    ].join("\n"),
  };
}

// ─── the calendar (George's own, write scope needed once) ───────────────────

async function calendarCreate(ev: Record<string, unknown>): Promise<{ id: string | null; error: string | null }> {
  try {
    const res = await calendarFetch("/calendars/primary/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ev) });
    if (res.status === 403 || res.status === 401) return { id: null, error: "CALENDAR_SCOPE_MISSING" };
    if (!res.ok) return { id: null, error: `calendar ${res.status}` };
    const j = await res.json();
    return { id: j.id ?? null, error: null };
  } catch (e) {
    return { id: null, error: (e as Error).message };
  }
}

async function calendarForWeek(c: Charter): Promise<MomentState["calendar"]> {
  const v = strip(c.vessel);
  const emb = await calendarCreate({
    summary: `Embarkation · ${c.client} · ${v}${c.port ? ` · ${c.port}` : ""}`,
    description: `Charter ${fmtLong(c.from)} to ${fmtLong(c.to)}. The Helm: https://command.georgeyachts.com/dashboard/helm/${c.id}`,
    start: { date: c.from },
    end: { date: addDays(c.from, 1) },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 12 * 60 }] },
  });
  if (emb.error === "CALENDAR_SCOPE_MISSING") return { embarkation: null, captain_call: null, error: emb.error };
  const callDay = addDays(c.from, -5);
  const call = await calendarCreate({
    summary: `Call the captain of ${v} about ${c.client}`,
    description: `Embarkation ${fmtLong(c.from)}${c.port ? ` in ${c.port}` : ""}. Agree the hour, the transfer and the brief. The Helm: https://command.georgeyachts.com/dashboard/helm/${c.id}`,
    start: { dateTime: `${callDay}T11:00:00`, timeZone: "Europe/Athens" },
    end: { dateTime: `${callDay}T11:30:00`, timeZone: "Europe/Athens" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  });
  return { embarkation: emb.id, captain_call: call.id, error: emb.error || call.error };
}

// ─── the daily run ───────────────────────────────────────────────────────────

export type RunResult = {
  today: string;
  drafted: { id: string; client: string; vessel: string; moment: Moment; subject: string; draft: boolean }[];
  skipped: { id: string; client: string; moment: Moment; reason: string }[];
  upcoming: { id: string; client: string; vessel: string; moment: Moment; due: string; days: number }[];
  calendar_missing: boolean;
};

// How many days late a moment may still be said naturally. "One week to go"
// three days before the week is still true; the day before is only the day
// before; the balance note and the thank-you keep a week.
const GRACE: Record<Moment, number> = { "T-45": 7, "T-7": 3, "T-1": 0, "T+3": 7 };

export async function runTimeline(opts: { dryRun?: boolean } = {}): Promise<RunResult> {
  const today = athensToday();
  const charters = await loadCharters();
  const result: RunResult = { today, drafted: [], skipped: [], upcoming: [], calendar_missing: false };

  for (const c of charters) {
    const due = dueDates(c.from, c.to);
    for (const m of MOMENTS) {
      const d = due[m];
      const st = c.timeline[m];
      const days = daysBetween(today, d);
      if (st?.drafted_at || st?.skipped) continue;
      if (days > 0) {
        if (days <= 10) result.upcoming.push({ id: c.id, client: c.client, vessel: c.vessel, moment: m, due: d, days });
        continue;
      }
      if (days < -GRACE[m]) {
        // Too late to say it naturally; note it, never send out of time.
        if (!opts.dryRun) await mergeTimeline(c.id, { [m]: { due: d, skipped: "late" } });
        result.skipped.push({ id: c.id, client: c.client, moment: m, reason: "late" });
        continue;
      }
      if (!c.email) {
        if (!opts.dryRun) await mergeTimeline(c.id, { [m]: { due: d, skipped: "no-email" } });
        result.skipped.push({ id: c.id, client: c.client, moment: m, reason: "no-email" });
        continue;
      }
      // The welcome-home engine (rebooking-ritual) also thanks a Cabin charter
      // 2 to 10 days after the week; one key shared with it means one thank-you.
      const thanksKey = c.cabinId ? `cabin_thanks_${c.cabinId}` : `charter_thanks_${c.id}`;
      if (m === "T+3" && (await getSetting(thanksKey))) {
        if (!opts.dryRun) await mergeTimeline(c.id, { [m]: { due: d, skipped: "thanks-already-sent" } });
        result.skipped.push({ id: c.id, client: c.client, moment: m, reason: "thanks-already-sent" });
        continue;
      }
      const { salutation } = helmSalutation(c.row);
      const link = m === "T-7" ? await editionUrl(c.id).catch(() => null) : null;
      const { subject, body } = letterFor(m, c, salutation, link);
      if (opts.dryRun) {
        result.drafted.push({ id: c.id, client: c.client, vessel: c.vessel, moment: m, subject, draft: false });
        continue;
      }
      let draftId: string | null = null;
      try {
        const r = await createHelmDraft({ to: c.email, subject, body, threadId: c.threadId ?? undefined });
        draftId = r.draftId;
      } catch (e) {
        result.skipped.push({ id: c.id, client: c.client, moment: m, reason: `draft-failed: ${(e as Error).message.slice(0, 80)}` });
        continue;
      }
      const state: MomentState = { due: d, drafted_at: new Date().toISOString(), draft_id: draftId, subject };
      if (m === "T-7") {
        state.calendar = await calendarForWeek(c);
        if (state.calendar?.error === "CALENDAR_SCOPE_MISSING") result.calendar_missing = true;
      }
      if (m === "T+3") await setSetting(thanksKey, new Date().toISOString());
      await mergeTimeline(c.id, { [m]: state });
      await logHelmMessage(c.id, { direction: null, channel: "note", body: `[Timeline ${m}] Draft written in Gmail: ${subject}` });
      result.drafted.push({ id: c.id, client: c.client, vessel: c.vessel, moment: m, subject, draft: true });
    }
  }
  if (!opts.dryRun) {
    try { await setSetting("charter_timeline_latest", JSON.stringify({ generated_at: new Date().toISOString(), ...result })); } catch {}
  }
  return result;
}
