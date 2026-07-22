import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { greetingName, properCaseName } from "@/lib/greetings";
import { nationalDaysToday } from "@/lib/national-days";

// Occasions Digest — the "keep every guest alive all year" engine
// (George 2026-07-21). Every morning at 08:30 Athens it:
//
//   1. SYNCS The Cabin guest manifests into contacts (name, DOB, nationality,
//      email when given) — ONLY people who have actually chartered with us,
//      never bought lists. Existing contact values are never overwritten.
//   2. Finds TODAY's occasions among charter guests: birthdays, wedding
//      anniversaries, and their country's national day — plus a 3-days-ahead
//      heads-up so nothing lands on George cold.
//   3. Emails GEORGE (and pings Telegram) with a ready personal draft per
//      person. NOTHING is sent to any client from here — George sends each
//      wish himself, personally, which is the whole point
//      ("μας νιώθουν δίπλα τους").
//
// The old birthdays/holidays crons auto-sent generic wishes; they are now
// gated behind settings.greetings_mode = "auto" (see those files). Default
// mode is notify-first: this digest informs, George sends.

export const runtime = "nodejs";
export const maxDuration = 120;

const GEORGE_EMAIL = "george@georgeyachts.com";

// ─── Gmail: send the digest to George himself ───────────────────────────────

function rawEmail(to: string, subject: string, body: string): string {
  const lines = [
    `From: GY Command <${GEORGE_EMAIL}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function emailGeorge(subject: string, body: string): Promise<boolean> {
  try {
    const res = await gmailFetch("users/me/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: rawEmail(GEORGE_EMAIL, subject, body) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Cabin manifest → contacts sync ─────────────────────────────────────────

type ManifestRow = {
  full_name: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  email: string | null;
};

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

async function syncCabinGuests(sb: ReturnType<typeof createServiceClient>): Promise<{ created: number; enriched: number }> {
  const { data: rows } = await sb
    .from("cabin_guests_manifest")
    .select("full_name, date_of_birth, nationality, email");
  let created = 0;
  let enriched = 0;
  for (const g of (rows ?? []) as ManifestRow[]) {
    const fullName = (g.full_name ?? "").trim();
    if (!fullName) continue;
    // Nothing greetable? Skip — we only sync rows that add a date or country.
    if (!g.date_of_birth && !g.nationality) continue;

    const email = (g.email ?? "").trim().toLowerCase() || null;
    const { first, last } = splitName(fullName);

    // Match an existing contact by email first, then by exact name.
    let existing: { id: string; date_of_birth: string | null; nationality: string | null; email: string | null } | null = null;
    if (email) {
      const { data } = await sb
        .from("contacts")
        .select("id, date_of_birth, nationality, email")
        .ilike("email", email)
        .limit(1);
      existing = data?.[0] ?? null;
    }
    if (!existing) {
      const { data } = await sb
        .from("contacts")
        .select("id, date_of_birth, nationality, email")
        .ilike("first_name", first)
        .ilike("last_name", last || "%")
        .limit(1);
      existing = data?.[0] ?? null;
    }

    if (existing) {
      // Enrich only what is MISSING — a manifest never overwrites CRM truth.
      const patch: Record<string, string> = {};
      if (!existing.date_of_birth && g.date_of_birth) patch.date_of_birth = g.date_of_birth;
      if (!existing.nationality && g.nationality) patch.nationality = g.nationality;
      if (!existing.email && email) patch.email = email;
      if (Object.keys(patch).length) {
        const { error } = await sb.from("contacts").update(patch).eq("id", existing.id);
        if (!error) enriched++;
      }
      continue;
    }

    // New contact. source 'cabin_guest' needs the migration that widens the
    // CHECK; until it runs on live we fall back to 'manual' with a marker in
    // notes so nothing is ever lost to a constraint error.
    const base = {
      first_name: properCaseName(first),
      last_name: properCaseName(last) || null,
      email,
      date_of_birth: g.date_of_birth || null,
      nationality: g.nationality || null,
      notes: "Cabin guest (auto-synced from The Cabin guest manifest)",
    };
    const ins1 = await sb.from("contacts").insert({ ...base, source: "cabin_guest" });
    if (ins1.error) {
      const ins2 = await sb.from("contacts").insert({ ...base, source: "manual" });
      if (!ins2.error) created++;
    } else {
      created++;
    }
  }
  return { created, enriched };
}

// ─── Occasion collection ────────────────────────────────────────────────────

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  anniversary_date: string | null;
  nationality: string | null;
  charter_vessel: string | null;
  notes: string | null;
  source: string | null;
  greetings_opt_out: boolean | null;
};

type Occasion = {
  kind: "birthday" | "anniversary" | "national";
  label: string; // "Birthday" | "Wedding anniversary" | "4th of July"
  contact: ContactRow;
  draft: string;
};

function fullName(c: ContactRow): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";
}

/** True when this contact has actually chartered with us — George's rule:
 *  wishes go ONLY to people who have booked, never to cold leads. */
function isCharterGuest(c: ContactRow): boolean {
  if (c.source === "cabin_guest") return true;
  if (c.charter_vessel) return true;
  if ((c.notes ?? "").includes("Cabin guest")) return true;
  return false;
}

function birthdayDraft(c: ContactRow): string {
  const name = greetingName(c.first_name);
  const vessel = c.charter_vessel ? ` aboard ${c.charter_vessel}` : " in Greek waters";
  return `Dear ${name},\n\nHappy birthday! I hope the day is a beautiful one, wherever it finds you. It is always a joy remembering the time we shared${vessel}, and I hope the sea brings us together again soon.\n\nWith my warmest wishes,\nGeorge`;
}

function anniversaryDraft(c: ContactRow): string {
  const name = greetingName(c.first_name);
  return `Dear ${name},\n\nHappy anniversary to you both! Moments like these deserve a setting to match, and whenever you feel like celebrating one of them on the water, you know where to find me.\n\nWith my warmest wishes,\nGeorge`;
}

function nationalDraft(c: ContactRow, line: string, dayName: string): string {
  const name = greetingName(c.first_name);
  return `Dear ${name},\n\n${line}! Thinking of you and your family on ${dayName}, and sending you sunshine from Greece.\n\nWarmly,\nGeorge`;
}

function occasionsOn(contacts: ContactRow[], mmdd: string, year: number): Occasion[] {
  const out: Occasion[] = [];
  for (const c of contacts) {
    if (c.greetings_opt_out) continue;
    if (!isCharterGuest(c)) continue;
    if ((c.date_of_birth ?? "").slice(5, 10) === mmdd) {
      out.push({ kind: "birthday", label: "Birthday", contact: c, draft: birthdayDraft(c) });
    }
    if ((c.anniversary_date ?? "").slice(5, 10) === mmdd) {
      out.push({ kind: "anniversary", label: "Wedding anniversary", contact: c, draft: anniversaryDraft(c) });
    }
    for (const d of nationalDaysToday(c.nationality, mmdd, year)) {
      out.push({ kind: "national", label: d.name, contact: c, draft: nationalDraft(c, d.line, d.name) });
    }
  }
  return out;
}

// ─── The digest ─────────────────────────────────────────────────────────────

const KIND_ICON: Record<Occasion["kind"], string> = {
  birthday: "\u{1F382}",
  anniversary: "\u{1F490}",
  national: "\u{1F389}",
};

function athensNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Athens" }));
}

function mmddOf(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function _observedImpl(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = createServiceClient();
  const now = athensNow();
  const todayISO = now.toISOString().slice(0, 10);

  // Once per day, ever — even if the cron fires twice.
  const { data: lastRun } = await sb
    .from("settings")
    .select("value")
    .eq("key", "occasions_digest_last_sent")
    .maybeSingle();
  if (lastRun?.value === todayISO) {
    return NextResponse.json({ ok: true, skipped: "already sent today" });
  }

  // 1. Cabin guests → contacts.
  const sync = await syncCabinGuests(sb);

  // 2. Everyone who might have an occasion.
  const { data: contacts } = await sb
    .from("contacts")
    .select(
      "id, first_name, last_name, email, date_of_birth, anniversary_date, nationality, charter_vessel, notes, source, greetings_opt_out",
    )
    .or("date_of_birth.not.is.null,anniversary_date.not.is.null,nationality.not.is.null");

  const all = (contacts ?? []) as ContactRow[];
  const today = occasionsOn(all, mmddOf(now), now.getFullYear());
  const ahead = new Date(now);
  ahead.setDate(ahead.getDate() + 3);
  const upcoming = occasionsOn(all, mmddOf(ahead), ahead.getFullYear());

  if (today.length === 0 && upcoming.length === 0) {
    // Quiet day — no noise, just record the run.
    await sb.from("settings").upsert({ key: "occasions_digest_last_sent", value: todayISO }, { onConflict: "key" });
    return NextResponse.json({ ok: true, occasions: 0, synced: sync });
  }

  // 3. Compose George's email: one block per person, draft ready to copy.
  const dateLine = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const parts: string[] = [`Good morning George,\n\nYour people today, ${dateLine}:`];

  for (const o of today) {
    const c = o.contact;
    const reach = [c.email, c.charter_vessel ? `guest of ${c.charter_vessel}` : null].filter(Boolean).join(" · ") || "no email on file - reach via the booking party";
    parts.push(
      `${KIND_ICON[o.kind]} ${o.label.toUpperCase()} - ${fullName(c)}\n(${reach})\n\nDraft, ready to make yours:\n----------------------------------------\n${o.draft}\n----------------------------------------`,
    );
  }

  if (upcoming.length) {
    const lines = upcoming.map((o) => `  ${KIND_ICON[o.kind]} ${fullName(o.contact)} - ${o.label}`);
    parts.push(`COMING IN 3 DAYS (${ahead.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}):\n${lines.join("\n")}`);
  }

  parts.push(
    `Nothing has been sent to anyone - these are yours to personalise and send.\n(Synced from The Cabin this morning: ${sync.created} new guests, ${sync.enriched} enriched.)`,
  );

  const subject =
    today.length > 0
      ? `Today: ${today.map((o) => `${fullName(o.contact)} (${o.label})`).join(", ")}`
      : `Heads-up: ${upcoming.length} occasion${upcoming.length === 1 ? "" : "s"} in 3 days`;

  const emailed = await emailGeorge(`\u{1F4EF} ${subject}`, parts.join("\n\n\n"));

  // 4. Telegram nudge so it never slips.
  const tg = [
    `\u{1F4EF} <b>Occasions today</b>`,
    ...today.map((o) => `${KIND_ICON[o.kind]} <b>${fullName(o.contact)}</b> - ${o.label}`),
    ...(upcoming.length ? [`\u{23F3} In 3 days: ${upcoming.map((o) => fullName(o.contact)).join(", ")}`] : []),
    today.length ? `Drafts are in your inbox - nothing auto-sent.` : `Details in your inbox.`,
  ].join("\n");
  await sendTelegram(tg);

  await sb.from("settings").upsert({ key: "occasions_digest_last_sent", value: todayISO }, { onConflict: "key" });

  return NextResponse.json({
    ok: true,
    today: today.map((o) => ({ who: fullName(o.contact), what: o.label })),
    upcoming: upcoming.map((o) => ({ who: fullName(o.contact), what: o.label })),
    emailed,
    synced: sync,
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("occasions-digest", () => _observedImpl(request));
}
