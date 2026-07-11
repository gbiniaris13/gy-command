// GET /api/cron/rebooking-ritual — daily. The post-charter cycle George
// approved 2026-07-09, reading THE CABIN (real charters), two moments:
//
//   1. THANK-YOU: 2-10 days after a charter ends → a warm welcome-home
//      draft with the review ask (Google first, then Trustpilot — the
//      standing rule for every review ask).
//   2. REBOOKING (January only): every past charterer gets a "shall I
//      hold your week for the new season" draft, once per year.
//
// Like the Helm follow-up machine: Gmail DRAFTS only, never sent — the
// draft waits for George's own Send button, and a Telegram ping tells
// him it is there. Once-only state lives in settings keys
// (cabin_thanks_<id>, cabin_rebook_<year>_<id>) — no schema change.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { createHelmDraft } from "@/lib/helm/gmail-send";
import { getSetting, setSetting } from "@/lib/google-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const GOOGLE_REVIEW = "https://g.page/r/CR_fG1ftsKWBEBM/review";
const TRUSTPILOT_REVIEW = "https://www.trustpilot.com/evaluate/georgeyachts.com";

type Cabin = {
  id: string;
  vessel_name: string | null;
  principal_charterer_name: string | null;
  principal_charterer_email: string | null;
  charter_period_from: string | null;
  charter_period_to: string | null;
  cruising_area: string | null;
  deleted_at: string | null;
};

function firstName(full: string | null): string | null {
  const t = (full || "").trim().split(/\s+/)[0];
  return t && t.length >= 2 ? t : null;
}

function thankYouBody(c: Cabin): string {
  const name = firstName(c.principal_charterer_name);
  const vessel = (c.vessel_name || "the yacht").trim();
  const area = (c.cruising_area || "").trim();
  return (
    `Dear ${name || "friends"},\n\n` +
    `Welcome home. It was a genuine pleasure to have you aboard ${vessel}` +
    `${area ? `, and I hope the ${area} waters gave you a week worth keeping` : ""}.\n\n` +
    `If any photographs from on board made you smile, I would love to see one or two.\n\n` +
    `And if you feel our care deserves it, a short review means the world to a boutique house like ours:\n\n` +
    `Google: ${GOOGLE_REVIEW}\n` +
    `Trustpilot: ${TRUSTPILOT_REVIEW}\n\n` +
    `Whenever the sea calls again, my desk is yours.\n\n` +
    `Warm regards from Athens,`
  );
}

function rebookBody(c: Cabin, season: number): string {
  const name = firstName(c.principal_charterer_name);
  const vessel = (c.vessel_name || "").trim();
  return (
    `Dear ${name || "friends"},\n\n` +
    `Happy New Year from Athens. I am beginning to plan the ${season} season with my owners and captains, ` +
    `and I thought of your week${vessel ? ` aboard ${vessel}` : ""} first.\n\n` +
    `If you would like the same week held for you this coming summer, or a different one entirely, ` +
    `one line is enough and I will prepare everything personally.\n\n` +
    `It would be an honour to welcome you back on the water.\n\n` +
    `Warm regards from Athens,`
  );
}

async function ping(text: string) {
  try {
    const { sendTelegram } = await import("@/lib/telegram");
    await sendTelegram(text);
  } catch (e) {
    console.error("[rebooking-ritual] telegram failed", e);
  }
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const { data: cabins, error } = await db
    .from("cabins")
    .select(
      "id, vessel_name, principal_charterer_name, principal_charterer_email, charter_period_from, charter_period_to, cruising_area, deleted_at",
    )
    .is("deleted_at", null)
    .not("charter_period_to", "is", null)
    .not("principal_charterer_email", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const today = now.getTime();
  const DAY = 24 * 60 * 60 * 1000;
  let thanks = 0;
  let rebooks = 0;

  for (const c of (cabins || []) as Cabin[]) {
    const email = (c.principal_charterer_email || "").trim();
    if (!email.includes("@")) continue;
    const ended = new Date(`${c.charter_period_to}T12:00:00Z`).getTime();

    // 1) Welcome-home draft, 2-10 days after disembarkation. The window's
    // far edge means an old charter never triggers a months-late "welcome
    // home" if the cron was down that week.
    const age = today - ended;
    if (age >= 2 * DAY && age <= 10 * DAY) {
      const key = `cabin_thanks_${c.id}`;
      if (!(await getSetting(key))) {
        try {
          await createHelmDraft({
            to: email,
            subject: `Welcome home from ${(c.vessel_name || "your charter").trim()}`,
            body: thankYouBody(c),
          });
          await setSetting(key, now.toISOString().slice(0, 10));
          thanks++;
          await ping(
            [
              `🌊 <b>Rebooking ritual — welcome-home draft ready</b>`,
              `${c.principal_charterer_name || email} · ${c.vessel_name || ""}`,
              `Thank-you + review ask (Google first) waiting in Gmail Drafts. Review and Send.`,
            ].join("\n"),
          );
        } catch (e) {
          console.error("[rebooking-ritual] thank-you draft failed", c.id, e);
        }
      }
    }

    // 2) January rebooking — once per client per season, only for charters
    // that ended before this year (last season's guests).
    if (now.getUTCMonth() === 0 && ended < Date.UTC(now.getUTCFullYear(), 0, 1)) {
      const season = now.getUTCFullYear();
      const key = `cabin_rebook_${season}_${c.id}`;
      if (!(await getSetting(key))) {
        try {
          await createHelmDraft({
            to: email,
            subject: `Your week on the water, ${season}`,
            body: rebookBody(c, season),
          });
          await setSetting(key, now.toISOString().slice(0, 10));
          rebooks++;
          await ping(
            [
              `⚓️ <b>Rebooking ritual — ${season} rebooking draft ready</b>`,
              `${c.principal_charterer_name || email} · ${c.vessel_name || ""}`,
              `"Your week held for ${season}" waiting in Gmail Drafts. Review and Send.`,
            ].join("\n"),
          );
        } catch (e) {
          console.error("[rebooking-ritual] rebook draft failed", c.id, e);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: cabins?.length || 0,
    thanks,
    rebooks,
  });
}
