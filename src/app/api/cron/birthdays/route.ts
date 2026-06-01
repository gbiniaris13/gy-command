import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { optOutFooter, recentGreeting, OCCASION_PRIORITY } from "@/lib/greetings";

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

// ─── Templates (George-approved copy; no em dash, no "--") ───────────────────

function greetingFor(
  occasion: "birthday" | "anniversary",
  firstName: string
): { subject: string; body: string } {
  if (occasion === "anniversary") {
    return {
      subject: "With our warmest wishes",
      body: `Dear ${firstName},

Wishing you a very happy anniversary. Moments worth celebrating deserve a setting worth remembering, and we hope this year takes you both somewhere beautiful.

Warmly,
George`,
    };
  }
  return {
    subject: "A note from George Yachts",
    body: `Dear ${firstName},

Happy birthday from all of us at George Yachts. We hope the day is everything you wish it to be, with the sea never far from your thoughts.

Whenever you are ready to return to Greek waters, your place is waiting.

Warmly,
George`,
  };
}

// ─── Contact row shape ──────────────────────────────────────────────────────

interface PersonalDateContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  anniversary_date: string | null;
}

function isTodayMMDD(dateStr: string | null, month: string, day: string): boolean {
  if (!dateStr) return false;
  return dateStr.slice(5, 7) === month && dateStr.slice(8, 10) === day;
}

/**
 * Daily cron (08:00 UTC): personal-date greetings (birthday + wedding
 * anniversary). Honors greetings_opt_out, a 5-day frequency cap, and
 * per-occasion same-day dedup. Sends from the apex (george@), via Gmail.
 */
async function _observedImpl(request: NextRequest): Promise<Response> {
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

    // Pull everyone with a personal date set and not opted out.
    const { data: allContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, date_of_birth, anniversary_date")
      .not("greetings_opt_out", "is", true)
      .or("date_of_birth.not.is.null,anniversary_date.not.is.null");

    if (!allContacts || allContacts.length === 0) {
      return NextResponse.json({ ok: true, message: "No personal-date contacts", emails_sent: 0 });
    }

    let emailsSent = 0;
    const results: { contact: string; occasion?: string; sent: boolean; reason?: string }[] = [];

    for (const raw of allContacts as unknown as PersonalDateContact[]) {
      const contact = raw;
      if (!contact.email) continue;

      // Build today's candidate occasions, keep the highest priority one.
      const candidates: ("birthday" | "anniversary")[] = [];
      if (isTodayMMDD(contact.date_of_birth, month, day)) candidates.push("birthday");
      if (isTodayMMDD(contact.anniversary_date, month, day)) candidates.push("anniversary");
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => (OCCASION_PRIORITY[b] ?? 0) - (OCCASION_PRIORITY[a] ?? 0));
      const occasion = candidates[0];

      const firstName = contact.first_name ?? "Friend";
      const name =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Valued Client";

      // Frequency cap: max one greeting per contact per rolling 5 days.
      const recent = await recentGreeting(supabase, contact.id, 5);
      if (recent) {
        results.push({ contact: name, occasion, sent: false, reason: `freq-cap (recent: ${recent.occasion})` });
        continue;
      }

      // Per-occasion same-day dedup.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: existing } = await supabase
        .from("activities")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("type", "email_sent")
        .gte("created_at", todayStart.toISOString())
        .ilike("description", `%${occasion}%`)
        .limit(1);
      if (existing && existing.length > 0) {
        results.push({ contact: name, occasion, sent: false, reason: "Already sent today" });
        continue;
      }

      const tpl = greetingFor(occasion, firstName);
      const body = tpl.body + optOutFooter(contact.id);
      const sent = await sendEmail(contact.email, tpl.subject, body);

      if (sent) {
        await supabase.from("activities").insert({
          contact_id: contact.id,
          type: "email_sent",
          description: `${occasion} email sent: "${tpl.subject}"`,
          metadata: { subject: tpl.subject, generated_by: "cron", occasion },
        });
        await supabase
          .from("contacts")
          .update({ last_activity_at: new Date().toISOString() })
          .eq("id", contact.id);
        const icon = occasion === "anniversary" ? "\u{1F490}" : "\u{1F382}";
        await sendTelegram(`${icon} <b>${name}</b> ${occasion} today, email sent`);
        emailsSent++;
        results.push({ contact: name, occasion, sent: true });
      } else {
        results.push({ contact: name, occasion, sent: false, reason: "Email send failed" });
      }
    }

    return NextResponse.json({ ok: true, emails_sent: emailsSent, results });
  } catch (err) {
    console.error("[Birthdays] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("birthdays", () => _observedImpl(request));
}
