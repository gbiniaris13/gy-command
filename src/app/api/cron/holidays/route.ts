import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { getHolidaysToday } from "@/lib/holidays";

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

// ─── Holiday greeting templates ─────────────────────────────────────────────

function getHolidayGreeting(
  holidayName: string,
  firstName: string
): { subject: string; body: string } {
  switch (holidayName) {
    case "Christmas Eve":
    case "Christmas":
      return {
        subject: `Merry Christmas, ${firstName}`,
        body: `Dear ${firstName},

Wishing you a very Merry Christmas from the George Yachts family. May this season bring you joy, warmth, and time well spent with those you love.

Here is to smooth sailing in the year ahead.

Warm regards,
George P. Biniaris
Managing Broker
George Yachts Brokerage House LLC`,
      };

    case "New Year's Eve":
    case "New Year":
      return {
        subject: `Happy New Year, ${firstName}`,
        body: `Dear ${firstName},

Happy New Year from all of us at George Yachts! We hope this year brings you extraordinary adventures on and off the water.

We look forward to making your next voyage truly unforgettable.

Best wishes,
George P. Biniaris
Managing Broker
George Yachts Brokerage House LLC`,
      };

    default:
      return {
        subject: `Happy ${holidayName}, ${firstName}`,
        body: `Dear ${firstName},

Wishing you a wonderful ${holidayName} from the team at George Yachts.

Warm regards,
George P. Biniaris
Managing Broker
George Yachts Brokerage House LLC`,
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
 * Daily cron (08:00 UTC): Holiday greeting emails.
 * Checks contacts by country, sends appropriate holiday greetings.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Get all contacts with country and email
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, country")
      .not("email", "is", null)
      .not("country", "is", null);

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No contacts with country data",
        emails_sent: 0,
      });
    }

    let emailsSent = 0;
    const results: {
      contact: string;
      holiday: string;
      sent: boolean;
      reason?: string;
    }[] = [];

    for (const raw of contacts) {
      const contact = raw as unknown as HolidayContact;
      if (!contact.email || !contact.country) continue;

      const holidays = getHolidaysToday(contact.country);
      if (holidays.length === 0) continue;

      const firstName = contact.first_name ?? "Friend";
      const name =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        "Valued Client";

      // Use the first matching holiday
      const holidayName = holidays[0];

      // Check if we already sent a holiday email today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: existingEmails } = await supabase
        .from("activities")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("type", "email_sent")
        .gte("created_at", todayStart.toISOString())
        .ilike("description", `%${holidayName}%`)
        .limit(1);

      if (existingEmails && existingEmails.length > 0) {
        results.push({
          contact: name,
          holiday: holidayName,
          sent: false,
          reason: "Already sent today",
        });
        continue;
      }

      const { subject, body } = getHolidayGreeting(holidayName, firstName);
      const sent = await sendEmail(contact.email, subject, body);

      if (sent) {
        // Log activity
        await supabase.from("activities").insert({
          contact_id: contact.id,
          type: "email_sent",
          description: `Holiday email sent (${holidayName}): "${subject}"`,
          metadata: {
            subject,
            holiday: holidayName,
            generated_by: "cron",
            occasion: "holiday",
          },
        });

        // Update last_activity_at
        await supabase
          .from("contacts")
          .update({ last_activity_at: new Date().toISOString() })
          .eq("id", contact.id);

        emailsSent++;
        results.push({ contact: name, holiday: holidayName, sent: true });
      } else {
        results.push({
          contact: name,
          holiday: holidayName,
          sent: false,
          reason: "Email send failed",
        });
      }
    }

    // Telegram summary
    if (emailsSent > 0) {
      await sendTelegram(
        `\u{1F384} <b>Holiday Greetings Sent</b>\n${emailsSent} holiday email${
          emailsSent > 1 ? "s" : ""
        } sent today`
      );
    }

    return NextResponse.json({
      ok: true,
      contacts_checked: contacts.length,
      emails_sent: emailsSent,
      results,
    });
  } catch (err) {
    console.error("[Holidays] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
