// @ts-nocheck
// THE LIGHTHOUSE — the closeness engine. One place that knows every
// personal date of every client and guest, and makes sure George is
// never absent on the day it matters.
//
// Born 29/8/2026 from George's brief: "θέλω να είμαι κοντά τους με
// οποιονδήποτε τρόπο". The audit that preceded it found FOUR
// overlapping greeting systems (birthdays + holidays crons that
// auto-SENT to clients, pillar3 Gmail drafts, after-sales lifecycle)
// and ZERO birthday data in 402 contacts — machinery without fuel,
// and the wrong sending model. The Lighthouse consolidates: ONE
// occasions computation, reminders + drafts to GEORGE who sends
// personally, batch approval for mass holidays, and a real data
// layer (Cabin manifests, passports, Helm notes).
//
// Sending model, non-negotiable: personal occasions are DRAFTS for
// George's own hands. Only mass holidays go out as a batch, and only
// after he presses approve in the dashboard.

import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";
import {
  variableHolidaysForYear,
  FIXED_GREETING_HOLIDAYS,
} from "@/lib/pillar3-holidays";

// ─── Country policy (George's ruling 29/8: "η θρησκεία δεν θα είναι
// γνωστή, πάμε με τις χώρες - οι Αμερικανοί σίγουρα δεν είναι
// μουσουλμάνοι"). A known, overridden religion still wins; the
// country fills the silence. Kinds reference pillar3 holiday kinds.
const WESTERN = ["western_christmas", "western_easter", "new_year"];
const COUNTRY_POLICY = [
  { match: ["united states", "usa", "us", "america"], kinds: [...WESTERN, "us_independence_day", "thanksgiving"] },
  { match: ["united kingdom", "uk", "gb", "england", "scotland", "britain"], kinds: WESTERN },
  { match: ["canada", "australia", "new zealand", "ireland", "germany", "france", "italy", "spain", "netherlands", "austria", "switzerland", "belgium", "sweden", "norway", "denmark", "poland", "portugal", "mexico", "brazil", "argentina"], kinds: WESTERN },
  { match: ["greece", "gr", "cyprus"], kinds: ["western_christmas", "orthodox_easter", "new_year", "greek_independence_day"] },
  { match: ["russia", "serbia", "ukraine", "georgia", "romania", "bulgaria"], kinds: ["orthodox_christmas", "orthodox_easter", "new_year"] },
  { match: ["israel", "il"], kinds: ["hanukkah_first_night", "new_year"] },
  { match: ["saudi", "uae", "emirates", "qatar", "kuwait", "bahrain", "oman", "egypt", "turkey", "jordan", "lebanon", "morocco"], kinds: ["eid_al_fitr", "eid_al_adha", "new_year"] },
  { match: ["india"], kinds: ["diwali", "new_year"] },
];
const RELIGION_KINDS: Record<string, string[]> = {
  orthodox: ["western_christmas", "orthodox_easter", "new_year"],
  catholic: WESTERN,
  protestant: WESTERN,
  jewish: ["hanukkah_first_night", "new_year"],
  muslim: ["eid_al_fitr", "eid_al_adha", "new_year"],
  hindu: ["diwali", "new_year"],
};

export const HOLIDAY_LABELS: Record<string, string> = {
  western_christmas: "Christmas",
  orthodox_christmas: "Orthodox Christmas",
  western_easter: "Easter",
  orthodox_easter: "Orthodox Easter",
  new_year: "New Year",
  us_independence_day: "4th of July",
  thanksgiving: "Thanksgiving",
  greek_independence_day: "Greek Independence Day",
  eid_al_fitr: "Eid al-Fitr",
  eid_al_adha: "Eid al-Adha",
  diwali: "Diwali",
  hanukkah_first_night: "Hanukkah",
};

function thanksgivingDate(year: number): string {
  // 4th Thursday of November.
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const day = 1 + ((4 - first + 7) % 7) + 21;
  return `${year}-11-${String(day).padStart(2, "0")}`;
}

export function holidayDatesForYear(year: number): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of variableHolidaysForYear(year)) map[h.kind] = h.date;
  for (const f of FIXED_GREETING_HOLIDAYS) {
    map[f.kind] = `${year}-${String(f.month).padStart(2, "0")}-${String(f.day).padStart(2, "0")}`;
  }
  map.new_year = `${year}-01-01`;
  map.thanksgiving = thanksgivingDate(year);
  return map;
}

export function kindsForPerson(p: { country?: string; religion?: string; religion_overridden?: boolean }): string[] {
  const rel = (p.religion || "").toLowerCase();
  if (p.religion_overridden && RELIGION_KINDS[rel]) return RELIGION_KINDS[rel];
  const c = (p.country || "").toLowerCase().trim();
  if (c) {
    for (const pol of COUNTRY_POLICY) {
      if (pol.match.some((m) => c === m || c.includes(m))) return pol.kinds;
    }
  }
  if (RELIGION_KINDS[rel]) return RELIGION_KINDS[rel];
  // Unknown country, unknown religion: only the universally safe one.
  return ["new_year"];
}

// ─── People, from every source the house has ──────────────────────

export async function loadPeople() {
  // THE HELM IS THE DOOR (George, 29/8 second round): "Sto The Helm
  // einai oi pelates mou. Sto inbox einai ola mou ta email." The first
  // Lighthouse swept the whole contacts table and dragged in every
  // test submission and newsletter address. Now the universe is:
  // helm_requests (won, lost, open, all real charter conversations)
  // plus Cabin guests, who by definition have sailed with the house.
  // A contacts row is only used to ENRICH a person already inside.
  const sb = createServiceClient();
  const [reqRes, conRes, gueRes, memRes, manualRaw] =
    await Promise.all([
      sb
        .from("helm_requests")
        .select(
          "id, client_title, client_name, client_surname, client_email, client_whatsapp, status, area, occasion, dates_from, proposal_json, contact_id",
        )
        .limit(1000),
      sb
        .from("contacts")
        .select(
          "id, first_name, last_name, email, phone, country, nationality, religion, religion_overridden, birthday, date_of_birth, anniversary_date, charter_vessel, charter_embarkation, charter_start_date, greetings_opt_out, vip",
        )
        .limit(2000),
      sb
        .from("cabin_guests_manifest")
        .select("id, cabin_id, full_name, date_of_birth, nationality, email, mobile, is_minor")
        .limit(2000),
      sb
        .from("cabin_members")
        .select("id, display_name, email, mobile, personal_details, deleted_at")
        .is("deleted_at", null)
        .limit(2000),
      getSetting("lighthouse_manual_dates"),
    ]);
  const requests = reqRes.data, contacts = conRes.data, guests = gueRes.data, members = memRes.data;
  // Silent-empty is the enemy: keep each query's error for the API to
  // surface (the 29/8 prod mystery: Helm empty while REST worked).
  const _errors = {
    helm: reqRes.error?.message ?? null,
    contacts: conRes.error?.message ?? null,
    guests: gueRes.error?.message ?? null,
    members: memRes.error?.message ?? null,
  };
  const manual = manualRaw ? JSON.parse(manualRaw) : [];

  const nameKey = (n) =>
    String(n || "")
      .toLowerCase()
      .replace(/[,.]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(" ");
  const contactByEmail = new Map();
  const contactById = new Map();
  for (const c of contacts ?? []) {
    if (c.email) contactByEmail.set(c.email.toLowerCase(), c);
    contactById.set(c.id, c);
  }

  const people = new Map();

  // 1. Helm requests: the clients themselves, with the yachts we
  //    actually discussed pulled from the proposal.
  for (const r of requests ?? []) {
    const email = (r.client_email || "").toLowerCase();
    if (!email && !r.client_whatsapp) continue;
    const key = email ? `helm:${email}` : `helm:${r.id}`;
    const first = (r.client_name || "").trim();
    const last = (r.client_surname || "").trim();
    // The pipeline sometimes stores "Debbie"/"Debbie" or "Mrs.
    // Williams"/"Williams"; collapse the duplication.
    const name =
      first && last && !first.toLowerCase().includes(last.toLowerCase())
        ? `${first} ${last}`
        : first || last || email;
    const pj = r.proposal_json || {};
    const discussed = Array.isArray(pj.yachts)
      ? pj.yachts.map((y) => (y && typeof y === "object" ? y.name : String(y))).filter(Boolean).slice(0, 4)
      : [];
    const won = r.status === "won";
    const existing = people.get(key);
    if (existing) {
      existing.discussed = [...new Set([...(existing.discussed ?? []), ...discussed])].slice(0, 5);
      existing.won = existing.won || won;
      if (won && r.dates_from && !existing.charter_date) existing.charter_date = r.dates_from;
      continue;
    }
    const c = (r.contact_id && contactById.get(r.contact_id)) || contactByEmail.get(email) || {};
    people.set(key, {
      key,
      contact_id: c.id ?? r.contact_id ?? null,
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || name,
      email: email || c.email || null,
      phone: r.client_whatsapp || c.phone || null,
      country: c.country || c.nationality || null,
      religion: c.religion ?? null,
      religion_overridden: c.religion_overridden ?? false,
      birthday: c.birthday || c.date_of_birth || null,
      anniversary: c.anniversary_date || null,
      charter_vessel: c.charter_vessel || (won ? discussed[0] : null) || null,
      charter_date: c.charter_embarkation || c.charter_start_date || (won ? r.dates_from : null) || null,
      discussed,
      helm_status: r.status,
      won: won || !!c.charter_vessel,
      opt_out: !!c.greetings_opt_out,
      vip: !!c.vip,
      is_minor: false,
      source: "helm",
    });
  }

  // 2. Cabin guests and members: they sailed, they are clients.
  const addOrMerge = (key, entry) => {
    const em = (entry.email || "").toLowerCase();
    const ek = nameKey(entry.name);
    const match =
      (em && [...people.values()].find((p) => (p.email || "").toLowerCase() === em)) ||
      (ek && [...people.values()].find((p) => nameKey(p.name) === ek)) ||
      null;
    if (match) {
      if (!match.birthday && entry.birthday) match.birthday = entry.birthday;
      if (!match.country && entry.country) match.country = entry.country;
      if (!match.email && entry.email) match.email = entry.email;
      match.source = match.source === "helm" ? "helm+cabin" : match.source;
    } else {
      people.set(key, entry);
    }
  };
  for (const g of guests ?? []) {
    if (!g.full_name) continue;
    addOrMerge(`guest:${g.id}`, {
      key: `guest:${g.id}`, contact_id: null, name: g.full_name,
      email: g.email || null, phone: g.mobile || null,
      country: g.nationality || null, religion: null, religion_overridden: false,
      birthday: g.date_of_birth || null, anniversary: null,
      charter_vessel: null, charter_date: null, discussed: [],
      helm_status: "guest", won: true, opt_out: false, vip: false,
      is_minor: !!g.is_minor, source: "cabin",
    });
  }
  for (const m of members ?? []) {
    const pd = m.personal_details || {};
    if (!m.display_name && !m.email) continue;
    addOrMerge(`member:${m.id}`, {
      key: `member:${m.id}`, contact_id: null, name: m.display_name || m.email,
      email: m.email || null, phone: m.mobile || pd.mobile || null,
      country: pd.nationality || null, religion: null, religion_overridden: false,
      birthday: pd.date_of_birth || null, anniversary: null,
      charter_vessel: null, charter_date: null, discussed: [],
      helm_status: "guest", won: true, opt_out: false, vip: false,
      is_minor: false, source: "cabin",
    });
  }

  // 3. Manual dates.
  for (const m of manual) {
    const p = people.get(m.person_key);
    if (!p) continue;
    if (m.kind === "birthday" && !p.birthday) p.birthday = m.date;
    if (m.kind === "anniversary" && !p.anniversary) p.anniversary = m.date;
    (p.custom ??= []).push(m);
  }

  // Final pass: fold CRM duplicates. "Tricia Stevens" and "Patricia
  // Rhodes Stevens" are two contact rows for one woman; the identical
  // birthday plus a shared surname token is proof enough, and one
  // person must never get two cards.
  const out = [...people.values()];
  const byBday = new Map();
  for (const p of out) {
    if (!p.birthday) continue;
    const k = String(p.birthday).slice(0, 10);
    (byBday.get(k) ?? byBday.set(k, []).get(k)).push(p);
  }
  const hidden = new Set();
  for (const group of byBday.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const ta = new Set(nameKey(a.name).split(" "));
        const common = nameKey(b.name).split(" ").filter((t) => ta.has(t));
        if (common.length >= 1 && common.some((t) => t.length > 3)) {
          // Keep the row with the most substance (contact beats guest,
          // more fields beats fewer); the other is absorbed.
          const score = (p) => (p.contact_id ? 4 : 0) + (p.email ? 2 : 0) + (p.charter_vessel ? 1 : 0);
          const [keep, drop] = score(a) >= score(b) ? [a, b] : [b, a];
          keep.email = keep.email || drop.email;
          keep.phone = keep.phone || drop.phone;
          keep.country = keep.country || drop.country;
          keep.discussed = [...new Set([...(keep.discussed ?? []), ...(drop.discussed ?? [])])];
          keep.source = "helm+cabin";
          (keep.aliases ??= []).push(drop.name);
          hidden.add(drop.key);
        }
      }
    }
  }
  return { people: out.filter((p) => !hidden.has(p.key)), manual, errors: _errors };
}

// ─── Occasions in a window ────────────────────────────────────────

function nextOccurrence(dateStr: string, from: Date): Date | null {
  const m = String(dateStr).match(/(\d{2})-(\d{2})$/) || String(dateStr).match(/^(\d{2})-(\d{2})$/);
  const md = m ? { month: +m[1], day: +m[2] } : null;
  if (!md) return null;
  for (const y of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, md.month - 1, md.day));
    if (d >= from) return d;
  }
  return null;
}

export async function upcomingOccasions(days = 30) {
  const { people } = await loadPeople();
  const today = new Date(new Date().toLocaleDateString("en-US", { timeZone: "Europe/Athens" }));
  const from = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const until = new Date(from.getTime() + days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const personal = [];
  for (const p of people) {
    if (p.opt_out) continue;
    const add = (kind, dateStr, label, extra = {}) => {
      const occ = nextOccurrence(dateStr, from);
      if (occ && occ <= until) {
        personal.push({ ...extra, kind, label, date: iso(occ), person: p });
      }
    };
    if (p.birthday) add("birthday", p.birthday, "Birthday");
    if (p.anniversary) add("anniversary", p.anniversary, "Anniversary");
    if (p.charter_date) {
      add("charter_anniversary", p.charter_date, "Charter anniversary", {
        vessel: p.charter_vessel,
        first_date: p.charter_date,
      });
    }
    for (const m of p.custom ?? []) {
      if (m.kind === "custom") add("custom", m.date, m.label || "Occasion", { note: m.note });
    }
  }
  personal.sort((a, b) => (a.date < b.date ? -1 : 1));

  // Mass holidays in the window, with their audiences.
  const years = new Set([from.getUTCFullYear(), until.getUTCFullYear()]);
  const holidays = [];
  for (const y of years) {
    const map = holidayDatesForYear(y);
    for (const [kind, date] of Object.entries(map)) {
      if (date < iso(from) || date > iso(until)) continue;
      const audience = people.filter(
        (p) => !p.opt_out && !p.is_minor && p.email && kindsForPerson(p).includes(kind),
      );
      if (audience.length) {
        holidays.push({
          kind,
          label: HOLIDAY_LABELS[kind] ?? kind,
          date,
          recipients: audience.length,
          sample: audience.slice(0, 5).map((p) => p.name),
        });
      }
    }
  }
  holidays.sort((a, b) => (a.date < b.date ? -1 : 1));

  // The full year of holidays, independent of the personal window —
  // George (29/8): "δεν βρήκα κανένα κουμπί για Χριστούγεννα". Now the
  // whole year is always on the board; the send button unlocks near
  // the day.
  const yearHolidays = [];
  for (const y of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    const map = holidayDatesForYear(y);
    for (const [kind, date] of Object.entries(map)) {
      if (date < iso(from) || date > iso(new Date(from.getTime() + 365 * 86400000))) continue;
      const audience = people.filter(
        (p) => !p.opt_out && !p.is_minor && p.email && kindsForPerson(p).includes(kind),
      );
      if (audience.length) {
        yearHolidays.push({
          kind,
          label: HOLIDAY_LABELS[kind] ?? kind,
          date,
          recipients: audience.length,
          sample: audience.slice(0, 5).map((p) => p.name),
        });
      }
    }
  }
  yearHolidays.sort((a, b) => (a.date < b.date ? -1 : 1));

  const sentRaw = await getSetting("lighthouse_sent");
  const sent = sentRaw ? JSON.parse(sentRaw) : {};
  return { personal, holidays, holidays_year: yearHolidays, sent, generated_at: new Date().toISOString() };
}

export function occasionKey(o) {
  const year = o.date.slice(0, 4);
  return `${o.person?.key ?? "all"}:${o.kind}:${year}`;
}

export async function markSent(key: string) {
  const raw = await getSetting("lighthouse_sent");
  const sent = raw ? JSON.parse(raw) : {};
  sent[key] = new Date().toISOString();
  await setSetting("lighthouse_sent", JSON.stringify(sent));
}

// ─── Drafts, in George's voice ────────────────────────────────────
// Deterministic templates, personalised with what the house actually
// knows. English, warm, short, zero em dashes, signed George.

const SIGN = "\n\nWarm regards,\nGeorge P. Biniaris\nGeorge Yachts Brokerage House";

function firstNameOf(full: string): string {
  let n = String(full || "").trim();
  if (!n) return "there";
  // Passport style "STEVENS, PATRICIA RHODES" -> given names after the comma.
  if (n.includes(",")) n = n.split(",")[1]?.trim() || n;
  const first = n.split(/\s+/)[0] || "there";
  // De-shout: PATRICIA -> Patricia.
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function draftFor(o): { subject: string; body: string } {
  const first = firstNameOf(o.person?.name);
  if (o.kind === "birthday") {
    return {
      subject: `Happy birthday, ${first}!`,
      body:
        `Dear ${first},\n\nHappy birthday! I hope your day is filled with the people you love and a glass of something good.` +
        (o.person?.charter_vessel
          ? ` Every year this date reminds me of the pleasure of hosting you aboard ${o.person.charter_vessel}, and I hope Greek waters see you again soon.`
          : ` And whenever you feel like celebrating a year of life properly, the Aegean is always here.`) +
        SIGN,
    };
  }
  if (o.kind === "anniversary") {
    return {
      subject: `Happy anniversary, ${first}!`,
      body: `Dear ${first},\n\nHappy anniversary to you both! Wishing you a beautiful day and many more years of adventures together. If one of those adventures should ever involve a quiet bay in Greece, you know where to find me.${SIGN}`,
    };
  }
  if (o.kind === "charter_anniversary") {
    const vessel = o.vessel ? ` aboard ${o.vessel}` : " in Greek waters";
    return {
      subject: `A year ago today, you were sailing`,
      body: `Dear ${first},\n\nA year ago today you were${vessel}, and I still think of that charter with great pleasure. Anniversaries like this are my favourite excuse to say hello. If the sea is calling again, the ${new Date().getFullYear() + 1} calendar is open and the best weeks always go first.${SIGN}`,
    };
  }
  // Holidays.
  const H: Record<string, [string, string]> = {
    western_christmas: ["Merry Christmas from Greece", "Merry Christmas! May your holidays be warm, bright and full of joy."],
    orthodox_christmas: ["Merry Christmas", "Wishing you a blessed Christmas full of warmth and light."],
    western_easter: ["Happy Easter", "Happy Easter! Wishing you a beautiful spring day with your loved ones."],
    orthodox_easter: ["Kalo Pascha from Greece", "Christos Anesti! Wishing you a joyful Easter, the greatest celebration of the Greek year."],
    new_year: ["Happy New Year", "Happy New Year! May it bring you health, joy and at least one unforgettable week at sea."],
    us_independence_day: ["Happy 4th of July", "Happy Independence Day! Wishing you a wonderful celebration with family and friends."],
    thanksgiving: ["Happy Thanksgiving", "Happy Thanksgiving! Among the things I am grateful for this year are clients who became friends."],
    greek_independence_day: ["Zito i Ellas", "Warm wishes from Athens on Greek Independence Day."],
    eid_al_fitr: ["Eid Mubarak", "Eid Mubarak! Wishing you and your family a blessed and joyful celebration."],
    eid_al_adha: ["Eid Mubarak", "Eid Mubarak! May the celebration bring you and your loved ones peace and happiness."],
    diwali: ["Happy Diwali", "Happy Diwali! Wishing you a festival full of light, warmth and sweetness."],
    hanukkah_first_night: ["Happy Hanukkah", "Happy Hanukkah! Wishing you eight nights of light and warmth with your family."],
  };
  const [subject, line] = H[o.kind] ?? ["Warm wishes", "Warm wishes for the day!"];
  return { subject, body: `Dear ${first},\n\n${line}${SIGN}` };
}
