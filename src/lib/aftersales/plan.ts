// src/lib/aftersales/plan.ts
// 2026-11-25 — THE AFTER SALES CALENDAR (George's decisions, 25/11/2026,
// from AFTER-SALES-PLAN-2026-11-25.md). Computed fresh on every read from the
// charters (The Cabin + won Helm requests); only what George did is stored.
//
//   thank_you             day 0 (disembarkation), every adult with an email
//   review                day +3 (until +7), every adult, separately
//   review_after_problem  replaces review once George presses "Λύθηκε"
//   advisor_report        +7 (until +21), to the travel advisor only
//   birthday              on the day, every adult with a date of birth
//   holiday               one a year: Thanksgiving for Americans, else Christmas
//   anniversary           +1 and +2 years, the lead charterer
//   next_season           15 Sep to 31 Oct each year, the lead charterer
//
// Rules in code: never two messages to one person on the same day; the
// keep-warm messages wait 14 days after anything else was sent to that
// person; advisor bookings: nothing to the client, ever; white-label: nothing;
// "Κάτι πήγε στραβά" holds every review of that charter until "Λύθηκε".

import { createServiceClient } from "@/lib/supabase-server";
import { mergeGuestRecords } from "@/lib/cabin-guest-merge";
import { normalizeNationality } from "@/lib/national-days";
import { readState, emailKey, type AfterSalesState, type TouchState } from "./store";
import { athensToday, addDays, daysBetween, sameDayInYear, thanksgiving, ageOn } from "./dates";

export const GOOGLE_REVIEW_LINK = "https://g.page/r/CR_fG1ftsKWBEBM/review";

export type Kind =
  | "thank_you" | "review" | "review_after_problem" | "advisor_report"
  | "birthday" | "holiday" | "anniversary" | "next_season";

export const KIND_EL: Record<Kind, string> = {
  thank_you: "Ευχαριστώ",
  review: "Κριτική Google",
  review_after_problem: "Κριτική μετά το πρόβλημα",
  advisor_report: "Αναφορά στον advisor",
  birthday: "Γενέθλια",
  holiday: "Γιορτινό γράμμα",
  anniversary: "Επέτειος ταξιδιού",
  next_season: "Νέα σεζόν",
};

// Lower number wins when two fall on one person the same day.
const PRIORITY: Record<Kind, number> = {
  review_after_problem: 0, thank_you: 1, review: 2, advisor_report: 3,
  birthday: 4, holiday: 5, anniversary: 6, next_season: 7,
};
const KEEP_WARM: Kind[] = ["birthday", "holiday", "anniversary", "next_season"];
const SPACING_DAYS = 14;

export type Person = {
  email: string;
  first_name: string;
  name_source: "george" | "record";
  full_name: string;
  role: "lead" | "guest" | "advisor";
  dob: string | null;
  country: string | null; // ISO-2 when known
};

export type Charter = {
  key: string; // cabin id, or "req:<helm id>"
  cabin_id: string | null;
  request_id: string | null;
  vessel: string;
  vessel_type: string;
  from: string | null;
  to: string;
  port_from: string | null;
  port_to: string | null;
  area: string | null;
  lead_email: string | null;
  lead_first_name: string;
  via_advisor: boolean;
  white_label: boolean;
  people: Person[]; // adults with an email (or the advisor)
  problem: { on: boolean; note: string; at: string | null; resolved_at: string | null; overdue: boolean };
};

export type TouchView = {
  id: string;
  kind: Kind;
  kind_el: string;
  charter_key: string;
  vessel: string;
  person: Person;
  due: string;
  expires: string;
  status: "due" | "upcoming" | "held" | "waiting" | "generated" | "sent" | "skipped";
  reason_el: string;
  state: TouchState | null;
};

type AnyRec = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(s(v)) ? s(v).slice(0, 10) : null);

/** "S/CAT SUMMER STAR" -> "Summer Star", "SEABARIT LX" -> "Seabarit LX". */
export function yachtName(raw: string): string {
  const n = s(raw).replace(/^(m\/y|s\/y|m\/cat|s\/cat|m\/s|my|sy|cat)\.?\s+/i, "").trim();
  if (!n) return "";
  return n.split(/\s+/).map((w) => (/^(i{1,3}|iv|v|vi{0,3}|ix|x|lx|xl|[a-z]?\d+)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

export function firstNameOf(full: string): string {
  let n = s(full);
  if (n.includes(",")) n = n.split(",")[1]?.trim() || n; // "STEVENS, PATRICIA"
  n = n.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "");
  const first = n.split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Every charter that ended (or ends) and can be written to after the week. */
export async function loadCharters(state: AfterSalesState): Promise<Charter[]> {
  const db = createServiceClient();
  const today = athensToday();

  const { data: reqs } = await db
    .from("helm_requests")
    .select("id, status, request_type, client_email, client_name, client_surname, dates_from, dates_to, area, booking:extraction->booking")
    .eq("status", "won")
    .limit(1000);
  const byCabin = new Map<string, AnyRec>();
  const noCabin: AnyRec[] = [];
  for (const r of (reqs ?? []) as AnyRec[]) {
    const b = (r.booking ?? {}) as AnyRec;
    if (s(b.cabin_id)) byCabin.set(s(b.cabin_id), r);
    else noCabin.push(r);
  }

  const { data: cabins } = await db
    .from("cabins")
    .select("id, status, vessel_name, vessel_make_model, charter_period_from, charter_period_to, port_embarkation, port_disembarkation, cruising_area, principal_charterer_email, principal_charterer_name, principal_charterer_mobile, deleted_at")
    .is("deleted_at", null)
    .not("charter_period_to", "is", null)
    .limit(1000);
  const cabinRows = ((cabins ?? []) as AnyRec[]).filter((c) => s(c.status) !== "draft" || byCabin.has(s(c.id)));
  const ids = cabinRows.map((c) => s(c.id));

  const members: AnyRec[] = [];
  const manifest: AnyRec[] = [];
  if (ids.length) {
    const [m, g] = await Promise.all([
      db.from("cabin_members").select("*").in("cabin_id", ids).is("deleted_at", null).order("created_at", { ascending: true }),
      db.from("cabin_guests_manifest").select("*").in("cabin_id", ids).order("guest_order", { ascending: true }),
    ]);
    members.push(...((m.data ?? []) as AnyRec[]));
    manifest.push(...((g.data ?? []) as AnyRec[]));
  }

  const person = (email: string, fullName: string, role: Person["role"], dob: string | null, nat: string | null): Person => {
    const k = emailKey(email);
    const pref = state.people[k]?.first_name?.trim();
    return {
      email: k,
      first_name: pref || firstNameOf(fullName) || "there",
      name_source: pref ? "george" : "record",
      full_name: fullName,
      role,
      dob,
      country: normalizeNationality(nat) ?? null,
    };
  };

  const out: Charter[] = [];
  const problemOf = (key: string, to: string): Charter["problem"] => {
    const p = state.charters[key] ?? {};
    const on = !!p.problem;
    const overdue = on && !p.resolved_at && !!p.problem_at && daysBetween(p.problem_at.slice(0, 10), today) >= 10;
    void to;
    return { on, note: p.problem_note ?? "", at: p.problem_at ?? null, resolved_at: p.resolved_at ?? null, overdue };
  };

  for (const c of cabinRows) {
    const to = iso(c.charter_period_to);
    if (!to) continue;
    const req = byCabin.get(s(c.id)) ?? null;
    const booking = ((req?.booking ?? {}) as AnyRec);
    const viaAdvisor = s(req?.request_type) === "travel_agent";
    const whiteLabel = booking.white_label === true;
    const leadEmail = emailKey(s(c.principal_charterer_email)) || null;
    const merged = mergeGuestRecords(
      members.filter((m) => s(m.cabin_id) === s(c.id)),
      manifest.filter((m) => s(m.cabin_id) === s(c.id)),
      { full_name: s(c.principal_charterer_name), email: s(c.principal_charterer_email), mobile: s(c.principal_charterer_mobile) },
    );
    const people: Person[] = [];
    const seen = new Set<string>();
    if (!viaAdvisor && !whiteLabel) {
      for (const g of merged) {
        const e = emailKey(g.email || "");
        if (!e.includes("@") || seen.has(e)) continue;
        if (g.is_minor) continue;
        const age = g.date_of_birth ? ageOn(g.date_of_birth, to) : null;
        if (age !== null && age < 18) continue;
        seen.add(e);
        const role: Person["role"] = e === leadEmail || g.role === "principal_charterer" ? "lead" : "guest";
        people.push(person(e, g.name || s(c.principal_charterer_name), role, iso(g.date_of_birth), g.nationality || null));
      }
      if (leadEmail && !seen.has(leadEmail)) people.unshift(person(leadEmail, s(c.principal_charterer_name), "lead", null, null));
    } else if (viaAdvisor && s(req?.client_email)) {
      people.push(person(s(req?.client_email), s(req?.client_name), "advisor", null, null));
    }
    const lead = people.find((p) => p.role === "lead");
    out.push({
      key: s(c.id),
      cabin_id: s(c.id),
      request_id: req ? s(req.id) : null,
      vessel: yachtName(s(c.vessel_name) || s(booking.vessel)) || "the yacht",
      vessel_type: s(c.vessel_make_model),
      from: iso(c.charter_period_from),
      to,
      port_from: s(c.port_embarkation) || null,
      port_to: s(c.port_disembarkation) || null,
      area: s(c.cruising_area) || null,
      lead_email: lead?.email ?? leadEmail,
      lead_first_name: lead?.first_name ?? firstNameOf(s(c.principal_charterer_name)),
      via_advisor: viaAdvisor,
      white_label: whiteLabel,
      people,
      problem: problemOf(s(c.id), to),
    });
  }

  // Won requests with no Cabin: only the person who wrote to us is known.
  for (const r of noCabin) {
    const to = iso(r.dates_to);
    const e = emailKey(s(r.client_email));
    if (!to || !e.includes("@")) continue;
    const b = (r.booking ?? {}) as AnyRec;
    const viaAdvisor = s(r.request_type) === "travel_agent";
    const whiteLabel = b.white_label === true;
    const key = `req:${s(r.id)}`;
    const full = [s(r.client_name), s(r.client_surname)].filter(Boolean).join(" ");
    const people = whiteLabel ? [] : [person(e, full, viaAdvisor ? "advisor" : "lead", null, null)];
    out.push({
      key,
      cabin_id: null,
      request_id: s(r.id),
      vessel: yachtName(s(b.vessel)) || "the yacht",
      vessel_type: "",
      from: iso(r.dates_from),
      to,
      port_from: null,
      port_to: null,
      area: s(r.area) || null,
      lead_email: viaAdvisor ? null : e,
      lead_first_name: viaAdvisor ? "" : (people[0]?.first_name ?? ""),
      via_advisor: viaAdvisor,
      white_label: whiteLabel,
      people,
      problem: problemOf(key, to),
    });
  }
  return out.sort((a, b) => b.to.localeCompare(a.to));
}

type Raw = { kind: Kind; person: Person; due: string; expires: string };

function rawTouches(c: Charter, today: string): Raw[] {
  const out: Raw[] = [];
  const years = [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1];
  for (const p of c.people) {
    if (p.role === "advisor") {
      out.push({ kind: "advisor_report", person: p, due: addDays(c.to, 7), expires: addDays(c.to, 21) });
      continue;
    }
    out.push({ kind: "thank_you", person: p, due: c.to, expires: addDays(c.to, 2) });
    if (c.problem.on && c.problem.resolved_at) {
      const due = [addDays(c.to, 3), c.problem.resolved_at.slice(0, 10)].sort().pop()!;
      out.push({ kind: "review_after_problem", person: p, due, expires: addDays(due, 7) });
    } else {
      out.push({ kind: "review", person: p, due: addDays(c.to, 3), expires: addDays(c.to, 7) });
    }
    for (const y of years) {
      if (p.dob) {
        const d = sameDayInYear(p.dob, y);
        if (d > c.to) out.push({ kind: "birthday", person: p, due: d, expires: addDays(d, 1) });
      }
      const us = !p.country || p.country === "US";
      const hd = us ? addDays(thanksgiving(y), -3) : `${y}-12-18`;
      const hx = us ? thanksgiving(y) : `${y}-12-24`;
      if (hd > addDays(c.to, 14)) out.push({ kind: "holiday", person: p, due: hd, expires: hx });
      if (p.role === "lead") {
        const ns = `${y}-09-15`;
        if (ns > addDays(c.to, 30)) out.push({ kind: "next_season", person: p, due: ns, expires: `${y}-10-31` });
        const yearsAfter = y - Number(c.to.slice(0, 4));
        if (yearsAfter === 1 || yearsAfter === 2) {
          const a = sameDayInYear(c.to, y);
          out.push({ kind: "anniversary", person: p, due: a, expires: addDays(a, 3) });
        }
      }
    }
  }
  return out;
}

export const touchId = (c: Charter, r: Raw) => `${r.kind}|${c.key}|${r.person.email}|${r.due}`;

/** The whole calendar, from 30 days back to `horizonDays` ahead. */
export async function buildCalendar(opts: { horizonDays?: number; state?: AfterSalesState } = {}): Promise<{
  today: string;
  mode: "test" | "live";
  charters: Charter[];
  touches: TouchView[];
}> {
  const state = opts.state ?? (await readState());
  const today = athensToday();
  const horizon = addDays(today, opts.horizonDays ?? 60);
  const charters = await loadCharters(state);

  // Last sent date per person (from what George sent through After sales).
  const lastSent = new Map<string, string>();
  for (const [id, t] of Object.entries(state.touches)) {
    if (t.status !== "sent" || t.test) continue;
    const email = id.split("|")[2];
    const d = t.at.slice(0, 10);
    if (!lastSent.has(email) || lastSent.get(email)! < d) lastSent.set(email, d);
  }

  const views: TouchView[] = [];
  for (const c of charters) {
    for (const r of rawTouches(c, today)) {
      if (r.expires < addDays(today, -30) || r.due > horizon) continue;
      const id = touchId(c, r);
      const st = state.touches[id] ?? null;
      const never = state.people[r.person.email]?.never;
      let status: TouchView["status"];
      let reason = "";
      if (st?.status === "sent") { status = "sent"; reason = st.test ? "στάλθηκε ως δοκιμή σε σένα" : "στάλθηκε"; }
      else if (st?.status === "skipped") { status = "skipped"; reason = st.skip_reason || "παραλείφθηκε"; }
      else if (never) { status = "skipped"; reason = "«Μην ξαναγράψεις» σε αυτόν τον άνθρωπο"; }
      else if (r.expires < today) continue; // missed, never sent out of time
      else if ((r.kind === "review") && c.problem.on && !c.problem.resolved_at) { status = "held"; reason = "Κάτι πήγε στραβά: σε αναμονή μέχρι το «Λύθηκε»"; }
      else if (r.due > today) { status = "upcoming"; }
      else if (st?.status === "generated") { status = "generated"; reason = "έτοιμο, περιμένει το Send σου"; }
      else { status = "due"; }
      views.push({ id, kind: r.kind, kind_el: KIND_EL[r.kind], charter_key: c.key, vessel: c.vessel, person: r.person, due: r.due, expires: r.expires, status, reason_el: reason, state: st });
    }
  }

  // Spacing: keep-warm messages wait 14 days after the last real send to that
  // person, and never two to one person on the same day.
  const actionable = views.filter((v) => v.status === "due" || v.status === "generated");
  const byPerson = new Map<string, TouchView[]>();
  for (const v of actionable) byPerson.set(v.person.email, [...(byPerson.get(v.person.email) ?? []), v]);
  for (const [email, list] of byPerson) {
    list.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
    const last = lastSent.get(email);
    let first = true;
    for (const v of list) {
      if (KEEP_WARM.includes(v.kind) && last && daysBetween(last, today) < SPACING_DAYS) {
        const free = addDays(last, SPACING_DAYS);
        v.status = "waiting";
        v.reason_el = free <= v.expires ? `περιμένει ως ${free}: του έγραψες πριν από λιγότερο από 14 μέρες` : "δεν χωράει φέτος: του έγραψες πριν από λιγότερο από 14 μέρες";
        continue;
      }
      if (!first) { v.status = "waiting"; v.reason_el = "ένα μήνυμα τη μέρα σε κάθε άνθρωπο: έρχεται αύριο"; continue; }
      first = false;
    }
  }

  views.sort((a, b) => a.due.localeCompare(b.due) || PRIORITY[a.kind] - PRIORITY[b.kind]);
  return { today, mode: state.mode, charters, touches: views };
}
