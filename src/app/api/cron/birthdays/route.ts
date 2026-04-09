import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";

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
    console.error("[Birthdays] Email send error:", err);
    return false;
  }
}

// ─── Contact row shape ──────────────────────────────────────────────────────

interface BirthdayContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  date_of_birth: string;
}

/**
 * Daily cron (08:00 UTC): Birthday auto-emails.
 * Queries contacts where date_of_birth matches today's month+day,
 * sends a birthday greeting, logs activity, and notifies via Telegram.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    // Find contacts with matching birthday (month-day).
    // date_of_birth is stored as YYYY-MM-DD text.
    // We filter by the MM-DD suffix.
    const { data: allContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, date_of_birth")
      .not("date_of_birth", "is", null);

    if (!allContacts || allContacts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No contacts with date_of_birth",
        emails_sent: 0,
      });
    }

    // Filter for today's birthdays (match MM-DD portion)
    const birthdayContacts = (allContacts as unknown as BirthdayContact[]).filter(
      (c) => {
        if (!c.date_of_birth) return false;
        const dob = c.date_of_birth; // "YYYY-MM-DD"
        return dob.slice(5, 7) === month && dob.slice(8, 10) === day;
      }
    );

    if (birthdayContacts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No birthdays today",
        emails_sent: 0,
      });
    }

    let emailsSent = 0;
    const results: { contact: string; sent: boolean; reason?: string }[] = [];

    for (const contact of birthdayContacts) {
      const firstName = contact.first_name ?? "Friend";
      const name =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        "Valued Client";

      if (!contact.email) {
        results.push({ contact: name, sent: false, reason: "No email" });
        continue;
      }

      // Check if we already sent a birthday email today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: existingEmails } = await supabase
        .from("activities")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("type", "email_sent")
        .gte("created_at", todayStart.toISOString())
        .ilike("description", "%birthday%")
        .limit(1);

      if (existingEmails && existingEmails.length > 0) {
        results.push({
          contact: name,
          sent: false,
          reason: "Already sent today",
        });
        continue;
      }

      const subject = `Happy Birthday, ${firstName}`;
      const body = `Dear ${firstName},

From all of us at George Yachts -- wishing you a wonderful birthday. May this year bring calm seas, warm sun, and another unforgettable voyage.

Best,
George`;

      const sent = await sendEmail(contact.email, subject, body);

      if (sent) {
        // Log activity
        await supabase.from("activities").insert({
          contact_id: contact.id,
          type: "email_sent",
          description: `Birthday email sent: "${subject}"`,
          metadata: {
            subject,
            generated_by: "cron",
            occasion: "birthday",
          },
        });

        // Update last_activity_at
        await supabase
          .from("contacts")
          .update({ last_activity_at: new Date().toISOString() })
          .eq("id", contact.id);

        // Telegram notification
        await sendTelegram(
          `\u{1F382} <b>${name}</b>'s birthday today -- email sent`
        );

        emailsSent++;
        results.push({ contact: name, sent: true });
      } else {
        results.push({ contact: name, sent: false, reason: "Email send failed" });
      }
    }

    return NextResponse.json({
      ok: true,
      birthdays_found: birthdayContacts.length,
      emails_sent: emailsSent,
      results,
    });
  } catch (err) {
    console.error("[Birthdays] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
