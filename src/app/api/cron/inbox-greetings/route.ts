// Pillar 3 — nightly Gmail-draft generator for upcoming greetings.
//
// Runs 06:00 Athens. Looks ahead by 1 day to give George a morning
// reminder ("3 greetings drafted for tomorrow — review and send").
//
// For each contact:
//   - is tomorrow their birthday or name day?
//   - is tomorrow a fixed-date holiday for their country?
//   - is tomorrow a variable-date religious holiday for their religion?
// If yes, and we haven't already drafted for them this year, generate
// a Gmail draft with the right template, label it gy-greetings/<kind>,
// and write a greeting_drafts row.
//
// Auto-DRAFTS only. Never sends. The brief is explicit on this.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import {
  variableHolidaysForYear,
  FIXED_GREETING_HOLIDAYS,
  HOLIDAY_RELIGION_MAP,
  type HolidayDate,
} from "@/lib/pillar3-holidays";
import { templateFor, shouldSkipForMissingName } from "@/lib/pillar3-greeting-templates";
import { inferReligion } from "@/lib/pillar3-religion-inferrer";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 300;

type ScheduledHoliday = {
  kind: string;
  religions?: readonly string[];
  countries?: readonly string[];
};

// Tomorrow in Athens time (CET/EET). Greeting "for tomorrow" is the
// design — gives George the morning to review before the day starts.
function tomorrowAthens(): { year: number; month: number; day: number } {
  const now = new Date();
  // Athens UTC offset: +2 winter / +3 summer. Use +2 as a conservative
  // floor — at worst we draft a few hours early, never late.
  const athensNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  athensNow.setDate(athensNow.getDate() + 1);
  return {
    year: athensNow.getUTCFullYear(),
    month: athensNow.getUTCMonth() + 1,
    day: athensNow.getUTCDate(),
  };
}

function pickHolidaysForTomorrow(): ScheduledHoliday[] {
  const t = tomorrowAthens();
  const out: ScheduledHoliday[] = [];

  // Fixed-date holidays
  for (const h of FIXED_GREETING_HOLIDAYS) {
    if (h.month === t.month && h.day === t.day) {
      out.push({
        kind: h.kind,
        religions: "religions" in h ? h.religions : undefined,
        countries: "countries" in h ? h.countries : undefined,
      });
    }
  }

  // Variable-date religious holidays
  const variable = variableHolidaysForYear(t.year);
  for (const v of variable) {
    const [yy, mm, dd] = v.date.split("-").map(Number);
    if (yy === t.year && mm === t.month && dd === t.day) {
      out.push({ kind: v.kind, religions: HOLIDAY_RELIGION_MAP[v.kind] });
    }
  }

  return out;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  country: string | null;
  birthday: string | null;
  name_day: string | null;
  inferred_religion: string | null;
  greetings_opt_out: boolean | null;
}

async function getOrCreateLabelId(name: string): Promise<string | null> {
  const list = await gmailFetch("/labels");
  if (!list.ok) return null;
  const j = (await list.json()) as { labels?: { id: string; name: string }[] };
  const existing = (j.labels ?? []).find((l) => l.name === name);
  if (existing) return existing.id;
  const create = await gmailFetch("/labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  if (!create.ok) return null;
  return ((await create.json()) as { id: string }).id;
}

function buildRawDraft(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

async function createDraft(args: {
  to: string;
  subject: string;
  body: string;
  labelIds: string[];
}): Promise<{ id: string; messageId?: string } | null> {
  const raw = buildRawDraft(args.to, args.subject, args.body);
  const draftRes = await gmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });
  if (!draftRes.ok) return null;
  const draft = (await draftRes.json()) as {
    id: string;
    message?: { id?: string };
  };
  if (args.labelIds.length > 0 && draft.message?.id) {
    await gmailFetch(`/messages/${draft.message.id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: args.labelIds }),
    });
  }
  return { id: draft.id, messageId: draft.message?.id };
}

async function _observedImpl(): Promise<Response> {
  try {
    const sb = createServiceClient();
    const t = tomorrowAthens();
    const tomorrowMonth = t.month;
    const tomorrowDay = t.day;
    const year = t.year;

    const holidays = pickHolidaysForTomorrow();
    let drafted = 0;
    let skipped = 0;
    const breakdown: Record<string, number> = {};

    // Pull contacts that might match. For volume sanity we only walk
    // contacts with an email; greetings_opt_out filters obvious nopes.
    const { data: contacts } = await sb
      .from("contacts")
      .select(
        "id, first_name, last_name, email, country, birthday, name_day, inferred_religion, greetings_opt_out",
      )
      .not("email", "is", null)
      .not("greetings_opt_out", "is", true)
      .limit(5000);

    for (const c of (contacts ?? []) as ContactRow[]) {
      if (!c.email || shouldSkipForMissingName(c.first_name)) continue;

      const candidates: string[] = [];

      // Birthday
      if (c.birthday) {
        const b = new Date(c.birthday);
        if (b.getUTCMonth() + 1 === tomorrowMonth && b.getUTCDate() === tomorrowDay)
          candidates.push("birthday");
      }
      // Name day (Greek contacts; column already populated by enrich step)
      if (c.name_day) {
        const n = new Date(c.name_day);
        if (n.getUTCMonth() + 1 === tomorrowMonth && n.getUTCDate() === tomorrowDay)
          candidates.push("name_day");
      }
      // Holidays for tomorrow
      const religion =
        c.inferred_religion ?? inferReligion({ country: c.country, first_name: c.first_name });
      for (const h of holidays) {
        const religionMatch = h.religions
          ? h.religions.includes(religion)
          : false;
        const countryMatch = h.countries
          ? h.countries.some(
              (cc) =>
                c.country === cc ||
                c.country?.toLowerCase() === cc.toLowerCase(),
            )
          : false;
        if (religionMatch || countryMatch) candidates.push(h.kind);
      }

      if (candidates.length === 0) continue;

      for (const kind of candidates) {
        // Dedup: have we already drafted this contact for this kind+year?
        const { data: existing } = await sb
          .from("greeting_drafts")
          .select("id")
          .eq("contact_id", c.id)
          .eq("holiday_kind", kind)
          .eq("holiday_year", year)
          .maybeSingle();
        if (existing) {
          skipped++;
          continue;
        }
        const tpl = templateFor({
          holiday_kind: kind,
          first_name: c.first_name,
          country: c.country,
        });
        if (!tpl) continue;

        const labelName = `gy-greetings/${kind}`;
        const labelId = await getOrCreateLabelId(labelName);
        const draft = await createDraft({
          to: c.email,
          subject: tpl.subject,
          body: tpl.body,
          labelIds: labelId ? [labelId] : [],
        });
        if (!draft) {
          skipped++;
          continue;
        }
        await sb.from("greeting_drafts").insert({
          contact_id: c.id,
          holiday_kind: kind,
          holiday_year: year,
          gmail_draft_id: draft.id,
          gmail_label: labelName,
        });
        drafted++;
        breakdown[kind] = (breakdown[kind] ?? 0) + 1;
      }
    }

    if (drafted > 0) {
      await sendTelegram(
        `📬 <b>${drafted} greetings drafted for tomorrow</b>\n` +
          Object.entries(breakdown)
            .map(([k, n]) => `· ${k}: ${n}`)
            .join("\n") +
          `\n\nReview in Gmail under <code>gy-greetings/</code> labels.`,
      ).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      tomorrow_athens: `${year}-${String(tomorrowMonth).padStart(2, "0")}-${String(tomorrowDay).padStart(2, "0")}`,
      holidays_today: holidays.map((h) => h.kind),
      drafted,
      skipped_already_drafted: skipped,
      breakdown,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[inbox-greetings] crashed:", msg);
    await sendTelegram(
      `⚠️ <b>Inbox greetings cron crashed</b>\n<code>${msg.slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(): Promise<Response> {
  return observeCron("inbox-greetings", _observedImpl);
}
