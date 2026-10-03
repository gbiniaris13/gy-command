// The Week edition reaches the client by itself (George, 2 October 2026:
// "μόλις υπογράφει... θα το στέλνει μόνο του όταν είναι 100% το Cabin").
//
// Every morning this looks at the won, direct-client charters whose Cabin
// brief is complete, and for each one not yet dispatched it writes the
// client's email: the same private link they already have, which now opens
// "The <Surname> Week". By default the email lands in George's Gmail as a
// DRAFT and he presses Send (settings week_edition_mode = "draft"). Set
// settings week_edition_mode = "send" and it goes out on its own; George is
// emailed either way. One dispatch per charter, recorded in
// extraction.week_edition. White-label (agent) bookings are never touched.

import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch, getSetting, setSetting } from "@/lib/google-api";
import { editionUrl } from "@/lib/helm/edition-link";
import { sendHelmEmail, buildRawEmail, getGmailSignature } from "@/lib/helm/gmail-send";
import { helmSalutation } from "@/lib/helm/addressing";
import { logHelmMessage, saveExtraction } from "@/lib/helm-admin";
import { emailGeorgeReport } from "@/lib/email-tracking";

const BASE = "https://command.georgeyachts.com";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmtLong(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type WeekCandidate = {
  id: string;
  client: string;
  email: string;
  vessel: string;
  from: string | null;
  to: string | null;
  port: string | null;
  cabinComplete: boolean;
  already: string | null;
};

export async function findWeekCandidates(): Promise<WeekCandidate[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("helm_requests")
    .select("id, status, request_type, client_title, client_name, client_surname, client_email, client_is_family, extraction")
    .eq("status", "won")
    .eq("request_type", "direct_client")
    .order("created_at", { ascending: false })
    .limit(100);
  const out: WeekCandidate[] = [];
  for (const r of data ?? []) {
    const ex = (r.extraction && typeof r.extraction === "object" ? r.extraction : {}) as Record<string, unknown>;
    const booking = (ex.booking && typeof ex.booking === "object" ? ex.booking : {}) as { vessel?: unknown; cabin_id?: unknown; white_label?: unknown };
    const vessel = typeof booking.vessel === "string" ? booking.vessel.trim() : "";
    if (!vessel || booking.white_label === true || !r.client_email) continue;
    const we = (ex.week_edition && typeof ex.week_edition === "object" ? ex.week_edition : null) as { drafted_at?: string; sent_at?: string } | null;
    let cabinComplete = false, from: string | null = null, to: string | null = null, port: string | null = null;
    if (typeof booking.cabin_id === "string") {
      const { data: c } = await db
        .from("cabins")
        .select("brief_completion_percent, brief_submitted_at, charter_period_from, charter_period_to, port_embarkation")
        .eq("id", booking.cabin_id)
        .maybeSingle();
      cabinComplete = !!c && (Number(c.brief_completion_percent) >= 100 || !!c.brief_submitted_at);
      from = c?.charter_period_from ?? null; to = c?.charter_period_to ?? null; port = c?.port_embarkation ?? null;
    }
    out.push({
      id: r.id,
      client: [r.client_title, r.client_name, r.client_surname].filter(Boolean).join(" ").trim() || r.client_email,
      email: String(r.client_email).toLowerCase(),
      vessel, from, to, port, cabinComplete,
      already: we?.sent_at ?? we?.drafted_at ?? null,
    });
  }
  return out;
}

function letterFor(c: WeekCandidate, salutation: string, link: string): { subject: string; body: string } {
  const when = c.from && c.to ? `, ${fmtLong(c.from)} to ${fmtLong(c.to)}` : "";
  const subject = `Your week, as it stands: ${c.vessel}${when}`;
  const body = [
    salutation,
    "",
    `It is done. ${c.vessel} is yours${when}${c.port ? `, out of ${c.port}` : ""}, and your edition has turned a page with you. The same private link now opens your week as it stands: the yacht, her crew by role, the route we are planning with the captain, a taste of the galley, and the practical page for the days before you board.`,
    "",
    link,
    "",
    "Nothing there is final until the captain and I speak one week before you sail, with a reliable forecast in hand. The sea has the last word, and we plan around it rather than against it.",
    "",
    "I am a message away every day between now and your check-in, and every day you are on the water.",
    "",
    "Warm regards from Athens,",
  ].join("\n");
  return { subject, body };
}

export async function dispatchWeekEditions(opts: { dryRun?: boolean } = {}) {
  const mode = ((await getSetting("week_edition_mode")) || "draft").trim().toLowerCase();
  const candidates = await findWeekCandidates();
  const due = candidates.filter((c) => c.cabinComplete && !c.already);
  const done: { id: string; client: string; mode: string }[] = [];
  if (opts.dryRun) return { mode, candidates, due, done, dryRun: true };

  const db = createServiceClient();
  for (const c of due) {
    const { data: r } = await db.from("helm_requests").select("request_type, client_name, client_title, client_surname, client_is_family, extraction").eq("id", c.id).maybeSingle();
    if (!r) continue;
    const { salutation } = helmSalutation(r);
    const link = await editionUrl(c.id);
    const { subject, body } = letterFor(c, salutation, link);
    const ex = (r.extraction && typeof r.extraction === "object" ? r.extraction : {}) as Record<string, unknown>;
    const now = new Date().toISOString();
    try {
      if (mode === "send") {
        const sent = await sendHelmEmail({ to: c.email, subject, body });
        await logHelmMessage(c.id, { direction: "outbound", channel: "email", body: `[Week edition] ${subject}\n${link}`, gmail_message_id: sent.messageId });
        await saveExtraction(c.id, { ...ex, week_edition: { sent_at: now, mode: "send", link } });
        done.push({ id: c.id, client: c.client, mode: "sent" });
      } else {
        const signatureHtml = await getGmailSignature();
        const raw = buildRawEmail({ to: c.email, subject, body, signatureHtml });
        const res = await gmailFetch("/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { raw } }) });
        const j = res.ok ? await res.json() : null;
        await logHelmMessage(c.id, { direction: null, channel: "note", body: `[Week edition] Draft written in Gmail for ${c.client}: ${subject}` });
        await saveExtraction(c.id, { ...ex, week_edition: { drafted_at: now, mode: "draft", draft_id: j?.id ?? null, link } });
        done.push({ id: c.id, client: c.client, mode: res.ok ? "draft" : "draft-failed" });
      }
    } catch (e) {
      done.push({ id: c.id, client: c.client, mode: `error: ${(e as Error).message}` });
    }
  }
  try { await setSetting("week_edition_latest", JSON.stringify({ generated_at: new Date().toISOString(), mode, done })); } catch {}
  // 2026-10-03: with the morning brief on (default) the news rides in it.
  const briefOn = ((await getSetting("morning_brief_enabled")) ?? "1").trim() !== "0";
  if (done.length && !briefOn) {
    const lines = done.map((d) => `• ${d.client}: ${d.mode === "sent" ? "ΕΣΤΑΛΗ στον πελάτη" : d.mode === "draft" ? "πρόχειρο στο Gmail σου, πάτα Send" : d.mode}  →  ${BASE}/dashboard/helm/${d.id}`);
    await emailGeorgeReport(
      `Week edition ${mode === "send" ? "sent" : "ready"}: ${done.map((d) => d.client).join(", ")}`,
      [
        mode === "send"
          ? "Το Cabin συμπληρώθηκε και το Week edition έφυγε μόνο του στον πελάτη, με τον ίδιο σύνδεσμο της πρότασης."
          : "Το Cabin συμπληρώθηκε. Έγραψα το email στον πελάτη ως ΠΡΟΧΕΙΡΟ στο Gmail σου (Drafts), με τον ίδιο σύνδεσμο της πρότασης που τώρα ανοίγει το Week edition. Διάβασέ το και πάτα Send.",
        "",
        ...lines,
        "",
        `Λειτουργία: settings.week_edition_mode = "${mode}" (draft = εσύ πατάς Send, send = φεύγει μόνο του).`,
      ].join("\n"),
    );
  }
  return { mode, candidates, due, done, dryRun: false };
}
