import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { getHolidaysToday } from "@/lib/holidays";
import { observeCron } from "@/lib/cron-observer";
import { optOutFooter, recentGreeting, greetingName, getTier } from "@/lib/greetings";

// ─── Gmail send helper ──────────────────────────────────────────────────────

function createRawEmail(to: string, subject: string, body: string): string {
  const lines: string[] = [
    `From: George Yachts <george@georgeyachts.com>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    "",
    body,
  ];
  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<boolean> {
  try {
    const raw = createRawEmail(to, subject, body);
    const res = await gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw }),
    });
    return res.ok;
  } catch (err) {
    console.error("[Holidays] Email send error:", err);
    return false;
  }
}

// ─── Holiday greeting templates (George-approved; no em dash) ─────────────────

function getHolidayGreeting(
  holidayName: string,
  firstName: string
): { subject: string; body: string } {
  switch (holidayName) {
    case "Christmas Eve":
    case "Christmas":
      return {
        subject: "Season's greetings from George Yachts",
        body: `Dear ${firstName},

Wishing you a peaceful and joyful Christmas, surrounded by the people who matter most.

Warmly,
George`,
      };

    case "New Year's Eve":
    case "New Year":
      return {
        subject: "With our wishes for the year ahead",
        body: `Dear ${firstName},

As the year turns, all of us at George Yachts send you our warmest wishes for the year to come. May it bring calm seas and good company.

Whenever the time feels right, Greek waters will be here.

Warmly,
George`,
      };

    default:
      return {
        subject: `Warm wishes this ${holidayName}`,
        body: `Dear ${firstName},

Wishing you a wonderful ${holidayName} from the team at George Yachts.

Warmly,
George`,
      };
  }
}

// ─── Contact row shape ──────────────────────────────────────────────────────

interface HolidayContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  country: string | null;
}

/**
 * Daily cron (08:00 UTC): country-based holiday greetings (Christmas +
 * New Year). Honors greetings_opt_out, a 5-day frequency cap, and
 * per-holiday same-day dedup. Sends from the apex (george@), via Gmail.
 * (Religion-specific holidays are handled separately in STEP 3B.)
 */
async function _observedImpl(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, country")
      .not("email", "is", null)
      .not("country", "is", null)
      .not("greetings_opt_out", "is", true);

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ ok: true, message: "No contacts with country data", emails_sent: 0 });
    }

    let emailsSent = 0;
    const results: { contact: string; holiday: string; sent: boolean; reason?: string }[] = [];

    for (const raw of contacts) {
      const contact = raw as unknown as HolidayContact;
      if (!contact.email || !contact.country) continue;

      const holidays = getHolidaysToday(contact.country);
      if (holidays.length === 0) continue;

      const firstName = greetingName(contact.first_name);
      const name =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Valued Client";
      const holidayName = holidays[0];
      const occasion = /new year/i.test(holidayName) ? "new_year" : "holiday";

      // Frequency cap: max one greeting per contact per rolling 5 days.
      const recent = await recentGreeting(supabase, contact.id, 5);
      if (recent) {
        results.push({ contact: name, holiday: holidayName, sent: false, reason: `freq-cap (recent: ${recent.occasion})` });
        continue;
      }

      // Per-holiday same-day dedup.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: existing } = await supabase
        .from("activities")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("type", "email_sent")
        .gte("created_at", todayStart.toISOString())
        .ilike("description", `%${holidayName}%`)
        .limit(1);
      if (existing && existing.length > 0) {
        results.push({ contact: name, holiday: holidayName, sent: false, reason: "Already sent today" });
        continue;
      }

      const tpl = getHolidayGreeting(holidayName, firstName);
      const tier = await getTier(supabase, contact.email);
      const body = tpl.body + optOutFooter(contact.id, tier);
      const sent = await sendEmail(contact.email, tpl.subject, body);

      if (sent) {
        await supabase.from("activities").insert({
          contact_id: contact.id,
          type: "email_sent",
          description: `Holiday email sent (${holidayName}): "${tpl.subject}"`,
          metadata: { subject: tpl.subject, holiday: holidayName, generated_by: "cron", occasion },
        });
        await supabase
          .from("contacts")
          .update({ last_activity_at: new Date().toISOString() })
          .eq("id", contact.id);
        emailsSent++;
        results.push({ contact: name, holiday: holidayName, sent: true });
      } else {
        results.push({ contact: name, holiday: holidayName, sent: false, reason: "Email send failed" });
      }
    }

    if (emailsSent > 0) {
      await sendTelegram(
        `\u{1F384} <b>Holiday Greetings Sent</b>\n${emailsSent} holiday email${
          emailsSent > 1 ? "s" : ""
        } sent today`
      );
    }

    return NextResponse.json({ ok: true, contacts_checked: contacts.length, emails_sent: emailsSent, results });
  } catch (err) {
    console.error("[Holidays] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("holidays", () => _observedImpl(request));
}
