// src/app/api/aftersales/route.ts
// 2026-11-25 — After sales. GET = the calendar. POST = one action by George.
// Nothing is ever sent without George pressing Send on that message, and in
// test mode (the default) Send goes to george@ only, marked [ΔΟΚΙΜΗ].

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { sendHelmEmail } from "@/lib/helm/gmail-send";
import { logHelmMessage } from "@/lib/helm-admin";
import { buildCalendar } from "@/lib/aftersales/plan";
import { generateTouch } from "@/lib/aftersales/generate";
import { checkAfterSales } from "@/lib/aftersales/validate";
import { greetingFor } from "@/lib/aftersales/templates";
import { readState, updateState, emailKey, TEST_INBOX } from "@/lib/aftersales/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  // Local read-only preview (same switch as the middleware's layout preview):
  // only on localhost with DEV_LAYOUT_PREVIEW=1, never true in production.
  const localPreview = new URL(req.url).hostname === "localhost" && process.env.DEV_LAYOUT_PREVIEW === "1";
  const denied = localPreview ? null : await requireUser(req);
  if (denied) return denied;
  const cal = await buildCalendar({ horizonDays: 75 });
  return NextResponse.json(cal);
}

type Body = {
  action: "generate" | "send" | "skip" | "unskip" | "problem" | "resolve" | "clear_problem" | "name" | "never" | "mode";
  id?: string;
  subject?: string;
  body?: string;
  reason?: string;
  charter_key?: string;
  note?: string;
  email?: string;
  first_name?: string;
  on?: boolean;
  mode?: "test" | "live";
};

export async function POST(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as Body;
  const now = new Date().toISOString();

  // Charter-level and person-level switches need no calendar lookup.
  if (b.action === "problem" || b.action === "resolve" || b.action === "clear_problem") {
    if (!b.charter_key) return NextResponse.json({ error: "charter_key missing" }, { status: 400 });
    await updateState((s) => {
      const cur = s.charters[b.charter_key!] ?? {};
      if (b.action === "problem") s.charters[b.charter_key!] = { problem: true, problem_note: (b.note ?? "").trim().slice(0, 300), problem_at: now };
      else if (b.action === "resolve") s.charters[b.charter_key!] = { ...cur, problem: true, problem_note: (b.note ?? cur.problem_note ?? "").trim().slice(0, 300), resolved_at: now };
      else delete s.charters[b.charter_key!];
    });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "name" || b.action === "never") {
    const e = emailKey(b.email ?? "");
    if (!e.includes("@")) return NextResponse.json({ error: "email missing" }, { status: 400 });
    await updateState((s) => {
      const cur = s.people[e] ?? {};
      if (b.action === "name") s.people[e] = { ...cur, first_name: (b.first_name ?? "").trim().slice(0, 40) || undefined };
      else s.people[e] = { ...cur, never: !!b.on, never_at: b.on ? now : undefined };
    });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "mode") {
    await updateState((s) => { s.mode = b.mode === "live" ? "live" : "test"; });
    return NextResponse.json({ ok: true });
  }

  // Message-level actions: find the message in today's calendar.
  if (!b.id) return NextResponse.json({ error: "id missing" }, { status: 400 });
  const state = await readState();
  const cal = await buildCalendar({ horizonDays: 75, state });
  const t = cal.touches.find((x) => x.id === b.id);
  if (!t) return NextResponse.json({ error: "Δεν βρέθηκε αυτό το μήνυμα (ίσως έληξε ή άλλαξε η ναύλωση)." }, { status: 404 });
  const c = [...cal.charters, ...cal.lost].find((x) => x.key === t.charter_key)!;

  if (b.action === "skip" || b.action === "unskip") {
    await updateState((s) => {
      if (b.action === "skip") s.touches[t.id] = { ...(s.touches[t.id] ?? {}), status: "skipped", at: now, skip_reason: (b.reason ?? "το παρέλειψες").slice(0, 120) };
      else delete s.touches[t.id];
    });
    return NextResponse.json({ ok: true });
  }

  if (["held", "skipped", "sent", "upcoming"].includes(t.status)) {
    return NextResponse.json({ error: `Αυτό το μήνυμα δεν είναι για σήμερα (${t.reason_el || t.status}).` }, { status: 409 });
  }

  if (b.action === "generate") {
    // Letters of the same kind, same charter, same year, already written for
    // the others: this one must read differently (26/11/2026).
    const siblings = Object.entries(state.touches)
      .map(([id, st]) => ({ id, st, parts: id.split("|") }))
      .filter((x) => x.parts[0] === t.kind && x.parts[1] === t.charter_key && x.parts[2] !== t.person.email && x.parts[3]?.slice(0, 4) === t.due.slice(0, 4) && x.st.body)
      .map((x) => ({ name: c.people.find((pp) => pp.email === x.parts[2])?.first_name ?? "another guest", body: x.st.body! }));
    const g = await generateTouch(t.kind, c, t.person, { siblings, due: t.due });
    await updateState((s) => {
      s.touches[t.id] = { ...(s.touches[t.id] ?? {}), status: "generated", at: now, subject: g.subject, body: g.body, generated_at: g.generated_at, warnings: g.warnings };
    });
    return NextResponse.json({ ok: true, generated: g });
  }

  if (b.action === "send") {
    if (t.status === "waiting") return NextResponse.json({ error: t.reason_el }, { status: 409 });
    const subject = (b.subject ?? state.touches[t.id]?.subject ?? "").trim();
    const body = (b.body ?? state.touches[t.id]?.body ?? "").trim();
    if (!subject || !body) return NextResponse.json({ error: "Πάτα πρώτα Generate." }, { status: 400 });
    const problems = checkAfterSales(t.kind, { subject, body }, { greeting: greetingFor(t.kind, t.person, c), fullName: t.person.full_name });
    const hard = problems.filter((p) => /long dash|Greek|review link|only the Google|Trustpilot|no links|no review ask|brackets/.test(p));
    if (hard.length) return NextResponse.json({ error: `Δεν στάλθηκε: ${hard.join("; ")}` }, { status: 422 });
    const live = state.mode === "live";
    const to = live ? t.person.email : TEST_INBOX;
    const sent = await sendHelmEmail({ to, subject: live ? subject : `[ΔΟΚΙΜΗ για ${t.person.email}] ${subject}`, body });
    await updateState((s) => {
      const cur = s.touches[t.id] ?? { status: "generated" as const, at: now };
      if (live) s.touches[t.id] = { status: "sent", at: now, subject, body, message_id: sent.messageId, sent_to: to };
      else s.touches[t.id] = { ...cur, subject, body, test_sent_at: now };
    });
    if (live && c.request_id && t.person.role !== "guest") {
      await logHelmMessage(c.request_id, { direction: "outbound", channel: "email", body: `[After sales: ${t.kind_el}] ${subject}\n\n${body}`, gmail_message_id: sent.messageId }).catch(() => {});
    }
    return NextResponse.json({ ok: true, sent_to: to, test: !live });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
