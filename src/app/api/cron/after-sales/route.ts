// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";

// After-Sales Lifecycle Cron — runs daily at 08:00 UTC
// Checks for: thank-you, feedback, photo sharing, birthdays,
// charter anniversaries, seasonal nudges, holiday greetings

const GEORGE_EMAIL = "george@georgeyachts.com";

interface AutoMessage {
  contact_id: string;
  message_type: string;
  subject: string;
  body: string;
}

// ─── Holiday dates (2026) ───────────────────────────────────────────────────
function getHolidays2026(): Array<{ date: string; type: string; religions: string[]; nationalities: string[]; greeting: string }> {
  return [
    { date: "2026-04-13", type: "orthodox_easter", religions: ["orthodox"], nationalities: [], greeting: "Καλό Πάσχα! Happy Easter from George Yachts" },
    { date: "2026-04-06", type: "western_easter", religions: ["catholic", "protestant"], nationalities: [], greeting: "Happy Easter from George Yachts!" },
    { date: "2026-11-26", type: "thanksgiving", religions: [], nationalities: ["US", "United States"], greeting: "Happy Thanksgiving from George Yachts!" },
    { date: "2026-12-24", type: "christmas", religions: ["orthodox", "catholic", "protestant", "unknown"], nationalities: [], greeting: "Merry Christmas! Καλά Χριστούγεννα!" },
    { date: "2026-12-31", type: "new_year", religions: [], nationalities: [], greeting: "Happy New Year! Καλή Χρονιά! 🥂" },
  ];
}

export async function GET() {
  const sb = createServiceClient();

  // 2026-04-24 audit: this cron OVERLAPS with /api/cron/birthdays and
  // /api/cron/holidays — all three fire at 08:00 UTC and read the
  // same `contacts` table. To avoid duplicate emails to clients we
  // flag-gate this cron OFF by default. Birthdays + holidays already
  // run from their dedicated crons (which have CRON_SECRET + Telegram
  // telemetry — this one has neither). Flip
  // settings.after_sales_enabled = "true" if you ever want to
  // consolidate everything back into this single cron.
  const { data: flag } = await sb
    .from("settings")
    .select("value")
    .eq("key", "after_sales_enabled")
    .maybeSingle();
  if (flag?.value !== "true") {
    return NextResponse.json({
      skipped: "after_sales_disabled — birthdays + holidays crons handle this. Flip flag to consolidate.",
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const messages: AutoMessage[] = [];

  // ─── 1. BIRTHDAYS ──────────────────────────────────────────────────────────
  const { data: birthdayContacts } = await sb
    .from("contacts")
    .select("id, first_name, last_name, email, date_of_birth")
    .not("date_of_birth", "is", null)
    .not("email", "is", null);

  for (const c of birthdayContacts ?? []) {
    if (!c.date_of_birth) continue;
    const dob = c.date_of_birth.slice(5); // MM-DD
    const todayMMDD = today.slice(5);
    if (dob === todayMMDD) {
      // Check if already sent this year
      const { data: sent } = await sb.from("automated_messages")
        .select("id").eq("contact_id", c.id).eq("message_type", "birthday")
        .gte("sent_at", `${today.slice(0, 4)}-01-01`).limit(1);
      if (!sent?.length) {
        messages.push({
          contact_id: c.id,
          message_type: "birthday",
          subject: `Happy Birthday, ${c.first_name}! 🎂`,
          body: `Dear ${c.first_name},\n\nHappy Birthday! Wishing you fair winds, calm seas, and another wonderful year ahead.\n\nWarm regards,\nGeorge Biniaris\nGeorge Yachts`,
        });
      }
    }
  }

  // ─── 2. POST-CHARTER SEQUENCE ──────────────────────────────────────────────
  const { data: charterContacts } = await sb
    .from("contacts")
    .select("id, first_name, last_name, email, charter_end_date, charter_vessel, after_sales_stage")
    .not("charter_end_date", "is", null)
    .not("email", "is", null);

  for (const c of charterContacts ?? []) {
    if (!c.charter_end_date) continue;
    const endDate = new Date(c.charter_end_date);
    const now = new Date();
    const hoursAfter = (now.getTime() - endDate.getTime()) / (1000 * 60 * 60);
    const daysAfter = hoursAfter / 24;

    const stage = c.after_sales_stage || "none";

    // Thank you — 4-6 hours after disembarkation
    if (stage === "none" && hoursAfter >= 4 && hoursAfter <= 48) {
      messages.push({
        contact_id: c.id,
        message_type: "thank_you",
        subject: `It was a pleasure, ${c.first_name}`,
        body: `Dear ${c.first_name},\n\nIt was a genuine pleasure managing your charter${c.charter_vessel ? ` aboard ${c.charter_vessel}` : ""}. I hope the Aegean exceeded every expectation.\n\nIf there's anything at all — feedback, photos, or just to stay in touch — don't hesitate to reach out.\n\nFair winds,\nGeorge`,
      });
    }

    // Feedback — 48 hours after
    if (stage === "thank_you_sent" && daysAfter >= 2 && daysAfter <= 7) {
      messages.push({
        contact_id: c.id,
        message_type: "feedback_request",
        subject: `How was your experience, ${c.first_name}?`,
        body: `Dear ${c.first_name},\n\nI hope you're settling back in after your charter. I'd love to hear how everything went — your feedback helps us, and helps future guests.\n\nJust a quick reply with your thoughts would mean the world:\n1. What was the highlight of your trip?\n2. Anything we could improve?\n3. Would you recommend us to a friend?\n\nThank you,\nGeorge`,
      });
    }

    // Photo sharing — 14 days after
    if (stage === "feedback_sent" && daysAfter >= 14 && daysAfter <= 21) {
      messages.push({
        contact_id: c.id,
        message_type: "photo_sharing",
        subject: `A memory from the Aegean`,
        body: `Dear ${c.first_name},\n\nI came across a beautiful shot from one of the anchorages you visited and thought you might enjoy it.\n\nThe Greek islands have a way of staying with you — especially the coves nobody else knows about.\n\nHope to welcome you back someday.\n\nWarmly,\nGeorge`,
      });
    }
  }

  // ─── 3. CHARTER ANNIVERSARY (1 week before signing date) ───────────────────
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: anniversaryContacts } = await sb
    .from("contacts")
    .select("id, first_name, email, contract_signing_date, charter_vessel")
    .not("contract_signing_date", "is", null)
    .not("email", "is", null);

  for (const c of anniversaryContacts ?? []) {
    if (!c.contract_signing_date) continue;
    const signingMMDD = c.contract_signing_date.slice(5);
    const nextWeekMMDD = nextWeek.slice(5);
    if (signingMMDD === nextWeekMMDD) {
      const { data: sent } = await sb.from("automated_messages")
        .select("id").eq("contact_id", c.id).eq("message_type", "anniversary")
        .gte("sent_at", `${today.slice(0, 4)}-01-01`).limit(1);
      if (!sent?.length) {
        messages.push({
          contact_id: c.id,
          message_type: "anniversary",
          subject: `One year already, ${c.first_name}?`,
          body: `Dear ${c.first_name},\n\nIn one week, it will be exactly a year since you signed for ${c.charter_vessel || "your charter"}. How fast did that go?\n\nWant me to check if she's available for the same dates this summer?\n\nJust say the word.\n\nGeorge`,
        });
      }
    }
  }

  // ─── 4. SEASONAL NUDGES (Jan 15 + Mar 1) ──────────────────────────────────
  if (today === `${today.slice(0, 4)}-01-15` || today === `${today.slice(0, 4)}-03-01`) {
    const nudgeType = today.endsWith("01-15") ? "early_booking" : "season_opening";
    const { data: pastClients } = await sb
      .from("contacts")
      .select("id, first_name, email, charter_vessel")
      .not("charter_end_date", "is", null)
      .not("email", "is", null)
      .eq("contact_type", "DIRECT_CLIENT");

    for (const c of pastClients ?? []) {
      const { data: sent } = await sb.from("automated_messages")
        .select("id").eq("contact_id", c.id).eq("message_type", nudgeType)
        .gte("sent_at", `${today.slice(0, 4)}-01-01`).limit(1);
      if (!sent?.length) {
        const subject = nudgeType === "early_booking"
          ? `2027 is filling up, ${c.first_name}`
          : `The Mediterranean is waking up`;
        const body = nudgeType === "early_booking"
          ? `Dear ${c.first_name},\n\nThe 2027 summer season is opening. Last year${c.charter_vessel ? ` ${c.charter_vessel}` : " your yacht"} booked out by March.\n\nWant me to check availability for the same dates?\n\nGeorge`
          : `Dear ${c.first_name},\n\nThe Mediterranean wakes up. Availability is tightening — if you've been thinking about this summer, now is the time.\n\nI'd love to help plan another perfect week.\n\nGeorge`;
        messages.push({ contact_id: c.id, message_type: nudgeType, subject, body });
      }
    }
  }

  // ─── 5. HOLIDAY GREETINGS ──────────────────────────────────────────────────
  const holidays = getHolidays2026().filter(h => h.date === today);
  for (const holiday of holidays) {
    const isNewYear = holiday.type === "new_year";
    let query = sb.from("contacts").select("id, first_name, email, nationality, religion").not("email", "is", null);

    // New Year goes to EVERYONE
    if (!isNewYear) {
      if (holiday.religions.length) {
        query = query.in("religion", holiday.religions);
      }
      if (holiday.nationalities.length) {
        query = query.in("nationality", holiday.nationalities);
      }
    }

    const { data: recipients } = await query;
    for (const c of recipients ?? []) {
      const { data: sent } = await sb.from("automated_messages")
        .select("id").eq("contact_id", c.id).eq("message_type", `holiday_${holiday.type}`)
        .gte("sent_at", `${today.slice(0, 4)}-01-01`).limit(1);
      if (!sent?.length) {
        messages.push({
          contact_id: c.id,
          message_type: `holiday_${holiday.type}`,
          subject: holiday.greeting,
          body: `Dear ${c.first_name},\n\n${holiday.greeting}\n\nFrom all of us at George Yachts, we wish you health, happiness, and calm seas.\n\nWarmly,\nGeorge Biniaris`,
        });
      }
    }
  }

  // ─── SEND ALL MESSAGES ─────────────────────────────────────────────────────
  let sent = 0;
  for (const msg of messages) {
    try {
      // Log to database
      await sb.from("automated_messages").insert({
        contact_id: msg.contact_id,
        message_type: msg.message_type,
        subject: msg.subject,
        body_preview: msg.body.slice(0, 200),
        channel: "email",
        status: "queued",
      });

      // Update after_sales_stage for post-charter sequence
      if (msg.message_type === "thank_you") {
        await sb.from("contacts").update({ after_sales_stage: "thank_you_sent" }).eq("id", msg.contact_id);
      } else if (msg.message_type === "feedback_request") {
        await sb.from("contacts").update({ after_sales_stage: "feedback_sent" }).eq("id", msg.contact_id);
      } else if (msg.message_type === "photo_sharing") {
        await sb.from("contacts").update({ after_sales_stage: "complete" }).eq("id", msg.contact_id);
      }

      sent++;
    } catch (err) {
      console.error(`[After-Sales] Failed to process ${msg.message_type} for ${msg.contact_id}:`, err);
    }
  }

  return NextResponse.json({
    processed: sent,
    total_triggers: messages.length,
    types: [...new Set(messages.map(m => m.message_type))],
    date: today,
  });
}
