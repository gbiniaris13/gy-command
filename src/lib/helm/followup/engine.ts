// src/lib/helm/followup/engine.ts
// 2026-11-16 — "Generate" for one request: read everything, compute the
// deterministic facts in code, let the model read and write, check it in code.
//
//   playbook  = .claude/skills/yacht-followup/SKILL.md, read from disk on every
//               call (cached until the file changes), so editing the playbook
//               changes behaviour with no code change.
//   model     = FOLLOWUP_AI_MODEL, else AI_MODEL (Gemini today). One setting.
//   sending   = never here. George presses Send in the Helm.

import fs from "node:fs";
import path from "node:path";
import { aiChat } from "@/lib/ai";
import { getSetting } from "@/lib/google-api";
import { parseLooseJson } from "@/lib/helm/json";
import { helmSalutation } from "@/lib/helm/addressing";
import { readPipeline, type FuStep } from "@/lib/helm/pipeline";
import { readFollowupSettings } from "./settings";
import { clientTimezone, leadFacts, nextSendSlot, localDate, addDays, usBlackout, type Channel, type SendSlot } from "./calendar";
import { readGmailByAddress, helmItems, timelineStats, trimForModel, type HelmMsg, type TimelineItem } from "./context";
import { checkDraft, scenarioHint, deDash, type CheckContext } from "./validate";

// ── Playbook from disk ─────────────────────────────────────────────────────
const PLAYBOOK_PATH = path.join(process.cwd(), ".claude", "skills", "yacht-followup", "SKILL.md");
let cache: { mtime: number; text: string } | null = null;
export function loadPlaybook(): string {
  const st = fs.statSync(PLAYBOOK_PATH);
  if (!cache || cache.mtime !== st.mtimeMs) cache = { mtime: st.mtimeMs, text: fs.readFileSync(PLAYBOOK_PATH, "utf8") };
  return cache.text;
}

// ── Types ──────────────────────────────────────────────────────────────────
export type HelmRow = {
  id: string;
  status: string;
  request_type: string | null;
  client_name: string | null;
  client_surname: string | null;
  client_title: string | null;
  client_email: string | null;
  client_whatsapp: string | null;
  client_is_family?: boolean | null;
  brief: string | null;
  occasion: string | null;
  party_size: number | null;
  budget: string | null;
  special_requests: string | null;
  dates_from: string | null;
  dates_to: string | null;
  area: string | null;
  email_subject: string | null;
  email_intro: string | null;
  gmail_thread_id: string | null;
  created_at: string;
  extraction: unknown;
};

type Draft = { touch_type?: string; channel?: string; subject?: string; body?: string; voice_note_script?: string; call_talking_points?: string[]; angle_el?: string };
type ModelOut = {
  snapshot_el?: string;
  temperature?: string;
  scenario?: string;
  we_owe_client?: string | null;
  next_touch?: Draft & { touch_number?: number; recipient_role?: string; rationale_el?: string };
  whatsapp_companion?: { body?: string } | string | null;
  alternatives?: Draft[];
  stage_change?: string | null;
  set_client_requested_followup_date?: string | null;
  requires_human?: boolean;
  requires_human_reason_el?: string;
  warnings_el?: string[];
};

export type FollowUpResult = {
  generated_at: string;
  model: string;
  snapshot_el: string;
  temperature: string;
  scenario: string;
  scenario_code: string;
  we_owe_client: string | null;
  next_touch: Draft & { touch_number: number; recipient_role: string; rationale_el: string; slot: SendSlot | null };
  // 16/11 George: the same idea on WhatsApp, written for WhatsApp. Empty when
  // WhatsApp is not allowed for this client. `hold` = the research limits say
  // send the email alone today (one unanswered WhatsApp per 72 h, three in a row).
  whatsapp_companion: { body: string; hold: boolean; hold_reason_el: string; slot: SendSlot | null; wa_link_digits: string } | null;
  alternatives: Draft[];
  forward_plan: { date: string; touch: string; anchor: string; kind: string }[];
  stage_change: string | null;
  set_client_requested_followup_date: string | null;
  requires_human: boolean;
  requires_human_reason_el: string;
  warnings_el: string[];
  checks: string[]; // problems still present after the retry (empty = clean)
  facts: {
    tz: string; tz_source: string; bucket: string; L_days: number | null; decision_deadline: string | null;
    consecutive_unanswered: number; last_inbound_at: string | null; last_outbound_at: string | null; ball: string;
    gmail_messages: number;
  };
  reply_thread: { thread_id: string; subject: string; rfc_message_id?: string } | null;
  new_addresses: string[];
  // 16/11: was the Mac's WhatsApp/iMessage read recently? If the client has a
  // phone and it was not, George must confirm he checked before Send.
  phone_channels: { synced_at: string | null; fresh: boolean; must_confirm: boolean; note_el: string };
};

// ── Helpers ────────────────────────────────────────────────────────────────
function yachtsForModel(extraction: unknown): { list: Record<string, unknown>[]; amounts: string[] } {
  const e = (extraction ?? {}) as { yachts?: unknown[] };
  const amounts: string[] = [];
  const v = (f: unknown) => (f && typeof f === "object" && "value" in (f as object) ? (f as { value: unknown }).value : f);
  const num = (x: unknown) => { const n = Number(v(x)); if (Number.isFinite(n) && n > 0) { amounts.push(String(Math.round(n))); return n; } return null; };
  const list = (Array.isArray(e.yachts) ? e.yachts : []).slice(0, 10).map((y0) => {
    const y = y0 as Record<string, unknown>;
    const p = (y.pricing ?? {}) as Record<string, unknown>;
    const c = (y.content ?? {}) as Record<string, unknown>;
    // Never the internal commission, never supplier/partner text.
    return {
      name: v(y.vessel_name), type: v(y.vessel_type), spec: v(y.spec_line),
      currency: v(p.currency), weekly_fee: num(p.charter_fee), list_price: num(p.list_price),
      discount_pct: v(p.discount_pct), apa_pct: v(p.apa_pct), vat_pct: v(p.vat_pct),
      all_in_total: num(p.all_inclusive_total), apa_amount: num(p.apa_amount), vat_amount: num(p.vat_amount),
      embarkation: v(y.embarkation),
      highlights: Array.isArray(c.highlights) ? (c.highlights as string[]).slice(0, 6) : [],
      tech_specs: Array.isArray(c.tech_specs) ? (c.tech_specs as unknown[]).slice(0, 16) : [],
      accommodation: Array.isArray(c.accommodation) ? (c.accommodation as unknown[]).slice(0, 8) : [],
      included: Array.isArray(c.included) ? (c.included as string[]).slice(0, 10) : [],
      crew_line: c.crew_line ?? null,
      water_toys: Array.isArray(c.water_toys) ? (c.water_toys as string[]).slice(0, 6) : [],
      testimonials: Array.isArray(c.testimonials) ? (c.testimonials as string[]).slice(0, 2) : [],
    };
  });
  return { list, amounts };
}

function voiceSamples(items: TimelineItem[], intro: string | null): string[] {
  const own = items.filter((i) => i.direction === "out" && i.channel === "email" && i.text.length > 80).slice(-4).map((i) => i.text);
  if (intro && own.length < 2) own.unshift(intro);
  return own.slice(-4);
}

function asChannel(c: string | undefined): Channel {
  return (["email", "whatsapp", "imessage", "call", "voice_note"].includes(c ?? "") ? c : "email") as Channel;
}

// ── The call ───────────────────────────────────────────────────────────────
export async function generateFollowUp(r: HelmRow, msgs: HelmMsg[], opts: { differentAngle?: string } = {}): Promise<FollowUpResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const pipeline = readPipeline(r.extraction);
  const settings = readFollowupSettings(r.extraction);
  const { tz, source: tzSource } = clientTimezone(settings.tz, r.client_whatsapp);
  const sentAt = pipeline.sent_at || r.created_at;
  const facts = leadFacts(sentAt, r.dates_from, tz);
  const today = localDate(now.getTime(), tz);
  const Lnow = r.dates_from ? Math.round((Date.parse(`${r.dates_from}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) : null;

  // 0) How fresh is the Mac → Helm copy of WhatsApp and iMessage/SMS?
  let syncedAt: string | null = null;
  try { syncedAt = (JSON.parse((await getSetting("conversation_sync_last")) || "{}") as { at?: string }).at ?? null; } catch { syncedAt = null; }
  const syncFresh = !!syncedAt && now.getTime() - Date.parse(syncedAt) < 3 * 3600000;

  // 1) Everything said, every channel.
  const addresses = [r.client_email ?? "", ...(settings.extra_emails ?? [])];
  const gm = await readGmailByAddress(addresses, r.created_at);
  const items = [...gm.items, ...helmItems(msgs)].sort((a, b) => a.ts.localeCompare(b.ts));
  const stats = timelineStats(items);
  const lastIn = [...items].reverse().find((i) => i.direction === "in");

  // 2) Deterministic facts.
  const isAgent = r.request_type === "travel_agent";
  const { salutation } = helmSalutation(r);
  const hasWaHistory = msgs.some((m) => m.channel === "whatsapp");
  const allowed: string[] = [];
  if (r.client_email) allowed.push("email");
  // WhatsApp only where the client already writes there or George ticked it
  // (research: ~32% of US adults use WhatsApp; never assume it). A phone
  // number alone allows a call.
  const waOk = !!r.client_whatsapp && (hasWaHistory || settings.whatsapp_ok === true);
  if (waOk) allowed.push("whatsapp", "voice_note");
  if (r.client_whatsapp) allowed.push("call");
  const doneSteps = (pipeline.fu ?? []).filter((s) => s.done_at);
  const pending = (pipeline.fu ?? []).filter((s) => !s.done_at);
  const lastTouch = [...doneSteps].reverse().find((s) => s.touch)?.touch;
  const usedSubjects = Array.from(new Set([
    ...doneSteps.map((s) => s.subject).filter(Boolean) as string[],
    ...items.filter((i) => i.direction === "out" && i.subject).map((i) => i.subject!.replace(/^(re|fwd?):\s*/i, "")),
  ])).slice(-12);
  const optionLive = settings.option_expires_at && settings.option_expires_at >= today ? settings.option_expires_at : null;
  const ebLive = settings.early_booking_deadline && settings.early_booking_deadline >= today ? settings.early_booking_deadline : null;
  const ddNear = facts.dd && facts.dd >= today && facts.dd <= addDays(today, 30) ? facts.dd : null;
  const urgency = optionLive
    ? { exists: true, source_field: "option_expires_at", date: optionLive }
    : ebLive
      ? { exists: true, source_field: "early_booking_deadline", date: ebLive, pct: settings.early_booking_pct ?? null }
      : ddNear
        ? { exists: true, source_field: "decision_deadline (charter start minus 35 days, MYBA balance window)", date: ddNear }
        : { exists: false, source_field: null, date: null };
  const hint = scenarioHint({
    status: r.status, hasOutbound: !!stats.first_outbound_at, ball: stats.ball,
    lastInboundText: lastIn?.text ?? "", lastInboundAt: stats.last_inbound_at,
    hadInbound: stats.had_inbound_after_first_outbound, consecutiveUnanswered: stats.consecutive_unanswered,
    clientFollowupDate: settings.client_followup_date ?? null, nowIso,
    lastOutboundText: [...items].reverse().find((i) => i.direction === "out")?.text ?? "",
  });
  const nextDue = pending[0]?.due ?? today;
  const fRaw0 = ((r.extraction as { followup?: Record<string, unknown> } | null)?.followup ?? {}) as Record<string, unknown>;
  const ackUntilForModel = typeof fRaw0.ack_until === "string" && fRaw0.ack_until > today ? fRaw0.ack_until : null;
  const dueForSlot = hint.code === "S6" && settings.client_followup_date ? settings.client_followup_date : nextDue < today ? today : nextDue;
  const weekendOk = facts.bucket === "ULTRA_SHORT";
  const emailSlot = nextSendSlot(dueForSlot, "email", tz, now.getTime(), weekendOk);
  const forwardPlan = pending.slice(0, 5).map((s: FuStep) => ({ date: s.due, touch: s.touch ?? (s.kind === "bye" ? "permission_to_close" : "nudge"), anchor: s.anchor ?? "", kind: s.kind ?? "nudge" }));
  const { list: yachts, amounts } = yachtsForModel(r.extraction);
  const budgetNums = (r.budget ?? "").match(/\d[\d,.]*/g)?.map((x) => x.replace(/[,.]/g, "")) ?? [];

  const pkg = {
    now_utc: nowIso,
    now_athens: new Date(now).toLocaleString("en-GB", { timeZone: "Europe/Athens" }),
    now_client_local: new Date(now).toLocaleString("en-US", { timeZone: tz }),
    mode: "ASSISTED",
    lead: {
      lead_id: r.id, status: r.status, contact_role: settings.contact_role ?? (isAgent ? "travel_advisor" : "principal"),
      salutation, request_type: r.request_type, client_timezone: tz, client_timezone_source: tzSource,
      charter_start: r.dates_from, charter_end: r.dates_to, region: r.area, guests: r.party_size, budget_stated: r.budget,
      occasion: r.occasion, brief: r.brief, special_requests: r.special_requests,
      george_notes: pipeline.notes ?? null, wanted_nights: pipeline.wanted_nights ?? null,
      phone_available: !!r.client_whatsapp, whatsapp_allowed: waOk, whatsapp_history: hasWaHistory,
      whatsapp_imessage_visibility: !r.client_whatsapp ? "no phone on file"
        : syncFresh ? `read from George's Mac at ${syncedAt}` : "NOT READ: George may have talked to this client on WhatsApp/iMessage and you cannot see it",
      client_requested_followup_date: settings.client_followup_date ?? null,
      option_expires_at: settings.option_expires_at ?? null,
      early_booking_deadline: settings.early_booking_deadline ?? null, early_booking_pct: settings.early_booking_pct ?? null,
      proposal_email_sent: r.email_intro ? r.email_intro.slice(0, 1500) : null,
    },
    yachts_proposed: yachts,
    timeline: trimForModel(items).map((i) => ({ ts: i.ts, channel: i.channel, direction: i.direction, author: i.author, subject: i.subject, text: i.text })),
    touches_log: doneSteps.map((s) => ({ ts: s.done_at, channel: s.how, touch_type: s.touch ?? null, subject: s.subject ?? null })),
    computed: {
      L_days_from_today: Lnow, bucket: facts.bucket, decision_deadline: facts.dd,
      scenario_hint: `${hint.code} ${hint.name}`, consecutive_unanswered: stats.consecutive_unanswered,
      ball: stats.ball, last_inbound_at: stats.last_inbound_at, last_outbound_at: stats.last_outbound_at,
      planned_touch_for_today: pending[0] ? { date: pending[0].due, touch_type: pending[0].touch ?? null, anchor: pending[0].anchor ?? null } : null,
      forward_plan: forwardPlan,
      ack_until: ackUntilForModel,
      greece_off_season_dates: !!(r.dates_from && ["11", "12", "01", "02", "03"].includes(r.dates_from.slice(5, 7))),
    },
    constraints: {
      allowed_channels: allowed,
      whatsapp_pair: waOk && allowed.includes("email")
        ? "REQUIRED: next_touch.channel = email, plus whatsapp_companion.body with the same idea in WhatsApp shape (see STEP 4, the PAIR)"
        : "none: leave whatsapp_companion empty",
      send_slot_email: emailSlot,
      forbidden_touch_types: lastTouch ? [lastTouch] : [],
      used_subjects: usedSubjects,
      real_urgency: urgency,
      availability_known: false,
    },
    george_voice_samples: voiceSamples(items, r.email_intro),
    ...(opts.differentAngle ? { regenerate_with_different_angle: `Do NOT reuse this angle or opening: ${opts.differentAngle}` } : {}),
  };

  const house = `

## HOUSE RULES FOR THIS INSTALLATION (from code; where they differ from the playbook above, these win)
- Begin every email or WhatsApp body with this exact salutation: "${salutation}"
- End an email body at "Warmly," with NOTHING after it. George's Gmail signature, with his name, is added automatically. (This replaces "Sign George" for email.)
- NEVER an em dash or en dash anywhere, in English or Greek. Use a comma or a hyphen.
- Never name a central agent, an owner's company, another broker or any partner. No links.
- ${isAgent ? "This is a TRAVEL ADVISOR: first name, collegial, \"your clients\". Never Dear/Mr/Mrs. A forwardable summary is the default shape." : "This is the client (or their household). Warm, personal, first person as George."}
- Allowed channels: ${allowed.join(", ") || "email"}. WhatsApp, calls and voice notes are done by George by hand; you only write the words.
- Do not choose times. The code computed the send window; leave send_at fields empty.
- If constraints.real_urgency.exists is false: no expiry, deadline, scarcity, "book soon" or "still available" claims of any kind. availability_known is false: never say availability was checked or confirmed.
- Use only yachts, numbers and facts present in the package. Never invent a testimonial, an event date, a price, a crew name or a crew member's qualities.
- If lead.whatsapp_imessage_visibility starts with "NOT READ", never write as if there were silence on every channel: no "it has been a while", no "I haven't heard from you", no recap of unanswered emails. Write something that is still right if they spoke yesterday on WhatsApp, and put in warnings_el: "Δεν βλέπω WhatsApp/iMessage: έλεγξε πριν στείλεις."
- ACKNOWLEDGED: if the client's last message is only an acknowledgment ("thank you", "ok", "let me look at the email", "I'll talk to my wife"), George owes nothing: do not chase. Treat it like WAIT WHEN ASKED with a date about a week later (computed.ack_until if given).
- WAIT WHEN ASKED: if the timeline shows the client is away until a time, or asked to wait, or George promised to come back on a date ("I'm in Cambodia for 12 days", "let's talk in January", "I'll wait until you're back"), do NOT propose a touch now. Set next_touch.channel = "none", explain in rationale_el, and put the right date in set_client_requested_followup_date (YYYY-MM-DD, the first sensible day after they are back or the promised day). Still write the email (and WhatsApp) for THAT day in next_touch.body so George can review it, written as if sent on that date.
- George works alone: never "my team", "our office", "my colleague", "my assistant".
- No soft scarcity either ("calendars fill up", "secure your yacht now") unless real_urgency exists.
- If the client asked a factual question (stabilisers, cabins, toys, a crew detail) and the answer is NOT in that yacht's own entry in yachts_proposed, do not guess: say you are confirming it with the captain and will come back the same day, and add a warnings_el line naming what George must check.
- A follow-up cannot carry attachments. Never write "attached", "enclosed" or "I am re-sending it here". If the proposal must reach them again, say it comes in a separate email (and add a warnings_el line: "Ξαναστείλε την πρόταση από το Send proposal").
- WhatsApp: one to three short lines, first name or a warm short greeting, never "Dear Ms." on WhatsApp, end with a light question. Use WhatsApp only if it is in allowed channels.
- Never reuse a subject from constraints.used_subjects and never the touch type in forbidden_touch_types.
- LANGUAGE: subject, body, voice_note_script and call_talking_points are written to the client in ENGLISH (American), always, even though you think in Greek for George. Only snapshot_el, rationale_el, angle_el, warnings_el and requires_human_reason_el are Greek, plain, no em dash.
- Each alternative must be a genuinely different angle (different touch_type), same channel rules.
- THE PAIR: when constraints.whatsapp_pair is REQUIRED, next_touch is the email and whatsapp_companion.body is the same idea for WhatsApp: 1 to 3 short lines, at most 45 words, the client's first name or a warm short greeting (never "Dear Ms."), no subject, no sign-off block, one light question, English. Rewrite it for WhatsApp; do not shorten the email.
- Output the strict JSON from OUTPUT and nothing else. forward_plan may be left empty (the code owns the plan).`;

  const system = loadPlaybook() + house;
  const model = process.env.FOLLOWUP_AI_MODEL || process.env.AI_MODEL || "gemini-2.5-flash";
  const yachtFacts = (Array.isArray((r.extraction as { yachts?: unknown[] } | null)?.yachts) ? (r.extraction as { yachts: unknown[] }).yachts : [])
    .map((y) => {
      const o = y as { vessel_name?: { value?: string }; pricing?: unknown };
      const { pricing: _p, ...rest } = o as Record<string, unknown>;
      void _p;
      return { name: String(o.vessel_name?.value ?? ""), text: JSON.stringify(rest).toLowerCase() };
    })
    .filter((y) => y.name);
  const ctx: CheckContext = {
    yachtFacts,
    realUrgency: urgency.exists, availabilityKnown: false,
    knownAmounts: [...amounts, ...budgetNums], forbiddenTouchTypes: lastTouch ? [lastTouch] : [],
    allowedChannels: [...allowed, "none"], isAgent,
  };

  const pairWanted = waOk && allowed.includes("email");
  const companionText = (o: ModelOut): string => {
    const c = o?.whatsapp_companion;
    return typeof c === "string" ? c : (c?.body ?? "");
  };
  const ask = async (extra?: string): Promise<ModelOut> => {
    const raw = await aiChat(system, JSON.stringify(pkg) + (extra ? `\n\nFIX THESE PROBLEMS IN YOUR PREVIOUS ANSWER AND RETURN THE FULL JSON AGAIN:\n${extra}` : ""), { maxTokens: 8192, temperature: 0.6, model });
    return parseLooseJson(raw) as ModelOut;
  };
  const problemsOf = (o: ModelOut): string[] => {
    const out: string[] = [];
    if (!o?.next_touch || typeof o.next_touch !== "object") return ["missing next_touch"];
    if (!o.snapshot_el) out.push("missing snapshot_el");
    const ch = o.next_touch.channel ?? "email";
    const hasWords = (o.next_touch.body ?? "").trim() || (o.next_touch.voice_note_script ?? "").trim() || (ch === "call" && (o.next_touch.call_talking_points ?? []).length);
    if (ch !== "none" && !hasWords) out.push("next_touch has no body");
    const fix = (d: Draft): Draft => ({ ...d, subject: deDash(d.subject ?? ""), body: deDash(d.body ?? ""), voice_note_script: deDash(d.voice_note_script ?? "") });
    if (ch !== "none") out.push(...checkDraft(fix(o.next_touch), ctx).map((x) => `next_touch: ${x}`));
    (o.alternatives ?? []).forEach((a, i) => out.push(...checkDraft(fix(a), ctx).map((x) => `alternative ${i + 1}: ${x}`)));
    if (pairWanted) {
      const wb = companionText(o);
      if (!wb.trim()) out.push("missing whatsapp_companion.body (the WhatsApp version of the same idea)");
      else out.push(...checkDraft({ channel: "whatsapp", body: deDash(wb) }, ctx).map((x) => `whatsapp_companion: ${x}`));
    }
    return out;
  };

  let out: ModelOut;
  try { out = await ask(); } catch { out = await ask("Your answer was not valid JSON. Return ONLY the JSON object."); }
  let problems = problemsOf(out);
  if (problems.length) {
    try {
      const second = await ask(problems.join("\n"));
      const p2 = problemsOf(second);
      if (p2.length <= problems.length) { out = second; problems = p2; }
    } catch { /* keep the first answer, with its warnings */ }
  }

  // 3) Code owns: scenario floor, channel, times, plan, human flags, dashes.
  //    The model may refine the scenario from the WORDS (a discount ask, an
  //    objection, a breakup already sent → nurture), but never against the
  //    facts: no "ghosted/engaged" for a client who never wrote, no "we owe"
  //    when the client's message has been answered, and S0/S1 are the code's.
  const modelCode = (typeof out.scenario === "string" ? out.scenario : "").match(/S\d+/)?.[0] ?? "";
  const hadIn = stats.had_inbound_after_first_outbound;
  const acknowledged = !!ackUntilForModel && fRaw0.last_in_ts === stats.last_inbound_at && fRaw0.last_in_needs_reply === false;
  let finalCode = hint.code === "S2" && acknowledged ? "S6" : hint.code;
  // S0 (do not contact) is decided only by the code, from the CLIENT's words
  // or the stage. George's own "I'll close the file" is not an opt-out.
  if (!acknowledged && !["S0", "S1", "S10", "S11"].includes(hint.code) && modelCode && modelCode !== "S0" && modelCode !== "S1") {
    const needsInbound = ["S2", "S3", "S4", "S5", "S7"].includes(modelCode);
    const contradicts = (needsInbound && !hadIn) || (modelCode === "S2" && stats.ball !== "we_owe") || (modelCode === "S8" && hadIn)
      || (modelCode === "S9" && stats.consecutive_unanswered < 7) || (modelCode === "S6" && !settings.client_followup_date);
    if (!contradicts) finalCode = modelCode;
  }
  const clean = (s: unknown) => (typeof s === "string" ? deDash(s) : "");
  const GREEK = /[\u0370-\u03FF\u1F00-\u1FFF]/;
  // A client subject must be English. If the model slipped into Greek, drop
  // the subject: the email then simply replies in the thread ("Re: …").
  const enSubject = (s: unknown) => { const c = clean(s); return GREEK.test(c) ? "" : c; };
  const nt = out.next_touch ?? {};
  // 17/11: the hourly re-plan also knows when the client only acknowledged
  // ("thanks, let me look at the email") and has given them room until a day.
  const fRaw = ((r.extraction as { followup?: Record<string, unknown> } | null)?.followup ?? {}) as Record<string, unknown>;
  const ackUntil = typeof fRaw.ack_until === "string" && fRaw.ack_until > today && fRaw.last_in_ts === stats.last_inbound_at && fRaw.last_in_needs_reply === false
    ? (fRaw.ack_until as string) : null;
  const modelWait = typeof out.set_client_requested_followup_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.set_client_requested_followup_date) && out.set_client_requested_followup_date > today
    ? out.set_client_requested_followup_date : null;
  const waitUntil = modelWait ?? ackUntil;
  let channel = asChannel(nt.channel);
  if (!allowed.includes(channel)) channel = "email";
  const s0 = hint.code === "S0";
  // When we owe an answer, or the client is talking now, the right moment is
  // today's next window, not the planned date.
  const answerNow = ["S2", "S3", "S4", "S5"].includes(finalCode);
  const slot = s0 ? null : nextSendSlot(waitUntil ?? (answerNow ? today : dueForSlot), channel, tz, now.getTime(), weekendOk);
  const wholeText = `${nt.body ?? ""} ${lastIn?.text ?? ""}`;
  const humanTopic = /\b(discount|commission|rebate|contract|legal|lawyer|complain|refund|cancel)/i.test(wholeText);
  const requiresHuman = !!out.requires_human || finalCode === "S4" || hint.code === "S4" || humanTopic;

  const warnings: string[] = (out.warnings_el ?? []).map(clean).filter(Boolean);
  let companion: FollowUpResult["whatsapp_companion"] = null;
  const compBody = clean(companionText(out)).trim();
  if (pairWanted && !s0 && compBody && channel === "email") {
    const since72 = stats.last_wa_out_at ? (now.getTime() - Date.parse(stats.last_wa_out_at)) / 3600000 : Infinity;
    const holdReason = stats.wa_consecutive_unanswered >= 3
      ? `Τρία WhatsApp στη σειρά χωρίς απάντηση: η έρευνα λέει σήμερα μόνο email.`
      : since72 < 72
        ? `Το τελευταίο WhatsApp έφυγε πριν ${Math.round(since72)} ώρες χωρίς απάντηση: η έρευνα λέει ένα αναπάντητο WhatsApp ανά 72 ώρες. Σήμερα μόνο email.`
        : "";
    companion = {
      body: compBody,
      hold: !!holdReason,
      hold_reason_el: holdReason,
      slot: nextSendSlot(answerNow ? today : dueForSlot, "whatsapp", tz, now.getTime(), weekendOk),
      wa_link_digits: (r.client_whatsapp ?? "").replace(/[^\d]/g, ""),
    };
  }
  if (tzSource !== "stored") warnings.push(tzSource === "phone" ? `Ζώνη ώρας πελάτη: ${tz}, από το τηλέφωνο. Διόρθωσέ τη αν δεν είναι σωστή.` : `Ζώνη ώρας άγνωστη, βάζω ${tz}. Όρισέ τη για σωστές ώρες.`);
  if (!urgency.exists) warnings.push("Δεν υπάρχει αποθηκευμένη λήξη option ή early-booking, άρα το κείμενο δεν πιέζει με προθεσμία.");
  if (!gm.ok) warnings.push("Δεν διάβασα το Gmail (σύνδεση). Το κείμενο βασίζεται μόνο στο Helm. Μην το στείλεις πριν δεις το thread.");
  if (r.client_whatsapp && !waOk) warnings.push("WhatsApp κλειστό για αυτόν τον πελάτη: δεν υπάρχει συνομιλία στο Helm. Αν μιλάτε εκεί, επικόλλησέ τη ή τσέκαρε «WhatsApp OK» στα Facts.");
  if (gm.newAddresses.length) warnings.push(`Νέες διευθύνσεις στα emails: ${gm.newAddresses.join(", ")}. Πρόσθεσέ τες αν είναι σύζυγος, βοηθός ή advisor.`);
  const bl = usBlackout(today);
  if (bl) warnings.push(`Σήμερα είναι ${bl} στις ΗΠΑ: καλύτερα να περιμένει.`);
  if (problems.length) warnings.push(`Έλεγχος κειμένου, θέλει το μάτι σου: ${problems.slice(0, 4).join("; ")}`);
  if (s0) warnings.unshift("Ο πελάτης ζήτησε να μην του ξαναγράψουμε ή είπε όχι. Δεν προτείνεται καμία επαφή.");
  if (waitUntil && !s0) warnings.unshift(!modelWait && ackUntil
    ? `Μην στείλεις σήμερα: ο πελάτης απάντησε ότι θα το δει. Δώσ' του χρόνο ως ${waitUntil}. Το κείμενο είναι γραμμένο για εκείνη τη μέρα.`
    : `Μην στείλεις σήμερα: από τη συζήτηση, η επόμενη επαφή πρέπει να γίνει ${waitUntil}. Το κείμενο είναι γραμμένο για εκείνη τη μέρα.`);
  const mustConfirm = !!r.client_whatsapp && !syncFresh;
  const phoneNote = !r.client_whatsapp ? ""
    : syncFresh ? `WhatsApp και iMessage διαβάστηκαν από το Mac (${new Date(syncedAt!).toLocaleString("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}).`
      : syncedAt ? `Το WhatsApp/iMessage διαβάστηκε τελευταία φορά ${new Date(syncedAt).toLocaleString("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}: μπορεί να μιλήσατε μετά. Έλεγξε το WhatsApp πριν στείλεις.`
        : "Δεν βλέπω το WhatsApp και τα μηνύματά σου με αυτόν τον πελάτη. Έλεγξε τι έχετε πει πριν στείλεις.";

  return {
    generated_at: nowIso,
    model,
    snapshot_el: clean(out.snapshot_el),
    temperature: clean(out.temperature) || "cool",
    scenario: finalCode === (clean(out.scenario).match(/S\d+/)?.[0] ?? "") ? clean(out.scenario) : `${hint.code} ${hint.name}`,
    scenario_code: finalCode,
    we_owe_client: out.we_owe_client ? clean(out.we_owe_client) : null,
    next_touch: {
      touch_number: doneSteps.length + 1,
      touch_type: clean(nt.touch_type),
      channel: s0 ? "none" : channel,
      recipient_role: clean(nt.recipient_role) || (isAgent ? "travel_advisor" : "principal"),
      subject: enSubject(nt.subject),
      body: clean(nt.body),
      voice_note_script: clean(nt.voice_note_script),
      call_talking_points: Array.isArray(nt.call_talking_points) ? nt.call_talking_points.map(clean) : [],
      rationale_el: clean(nt.rationale_el),
      slot,
    },
    whatsapp_companion: companion,
    alternatives: (out.alternatives ?? [])
      .map((a) => ({
        touch_type: clean(a.touch_type), channel: allowed.includes(a.channel ?? "") ? a.channel : "email",
        subject: enSubject(a.subject), body: clean(a.body) || clean(a.voice_note_script), angle_el: clean(a.angle_el),
      }))
      .filter((a) => a.body.trim())
      .slice(0, 2),
    forward_plan: forwardPlan,
    stage_change: out.stage_change ?? null,
    set_client_requested_followup_date: waitUntil,
    requires_human: requiresHuman,
    requires_human_reason_el: clean(out.requires_human_reason_el) || (requiresHuman ? "Έκπτωση, προμήθεια, συμβόλαιο ή παράπονο: αποφασίζεις εσύ." : ""),
    warnings_el: warnings,
    checks: problems,
    facts: {
      tz, tz_source: tzSource, bucket: facts.bucket, L_days: Lnow, decision_deadline: facts.dd,
      consecutive_unanswered: stats.consecutive_unanswered, last_inbound_at: stats.last_inbound_at,
      last_outbound_at: stats.last_outbound_at, ball: stats.ball, gmail_messages: gm.items.length,
    },
    reply_thread: stats.latest_thread,
    phone_channels: { synced_at: syncedAt, fresh: syncFresh, must_confirm: mustConfirm, note_el: phoneNote },
    new_addresses: gm.newAddresses,
  };
}

/** Has the client written since a draft was generated? (guardrail 2) */
export async function inboundSince(r: Pick<HelmRow, "client_email" | "created_at" | "extraction">, sinceIso: string): Promise<boolean> {
  const settings = readFollowupSettings(r.extraction);
  const gm = await readGmailByAddress([r.client_email ?? "", ...(settings.extra_emails ?? [])], sinceIso, 10);
  return gm.items.some((i) => i.direction === "in" && i.ts > sinceIso);
}
