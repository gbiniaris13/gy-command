import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { sendTelegram } from "@/lib/telegram";

// ─── Email Templates ────────────────────────────────────────────────────────

interface EmailTemplate {
  step: number;
  daysSince: number;
  subject: string;
  body: (name: string) => string;
}

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    step: 0,
    daysSince: 1,
    subject: "Thank you -- it was our pleasure",
    body: (name: string) =>
      `Dear ${name},

Thank you for choosing George Yachts for your charter experience. It was our genuine pleasure to have you on board.

We hope every moment exceeded your expectations -- from the destinations to the service. Your satisfaction means the world to us.

If there is anything at all we can do for you, or if you would like to share any feedback, please do not hesitate to reach out.

We look forward to welcoming you aboard again soon.

Warm regards,
George P. Biniaris
Managing Broker
George Yachts Brokerage House LLC`,
  },
  {
    step: 1,
    daysSince: 30,
    subject: "How's the tan holding up?",
    body: (name: string) =>
      `Dear ${name},

It has been a month since your charter with us and I hope the memories (and the tan!) are still going strong.

I wanted to check in and see if there is anything we can assist with -- whether it is planning your next getaway, recommending a destination for the upcoming season, or simply catching up.

The Greek islands have been magnificent this year and I have some wonderful itineraries that I think you would love.

Looking forward to hearing from you.

Best,
George P. Biniaris
Managing Broker
George Yachts Brokerage House LLC`,
  },
  {
    step: 2,
    daysSince: 90,
    subject: "Already thinking about next summer?",
    body: (name: string) =>
      `Dear ${name},

As the seasons change, I find myself already looking ahead to next summer -- and I thought of you.

The best yachts and dates tend to book up early, and I would love to help you secure something special before availability tightens. Whether it is the same yacht you loved or something entirely new, I have some excellent options in mind.

Shall we start exploring possibilities? I am happy to put together a few tailored suggestions whenever you are ready.

Warm regards,
George P. Biniaris
Managing Broker
George Yachts Brokerage House LLC`,
  },
];

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
    console.error("[Post-Charter] Email send error:", err);
    return false;
  }
}

// ─── Contact row shape ──────────────────────────────────────────────────────

interface CharterContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  charter_end_date: string;
  post_charter_step: number;
  pipeline_stage: { name: string } | { name: string }[] | null;
}

/**
 * Daily cron (09:00 UTC): post-charter follow-up email automation.
 * Sends Day 1, Day 30, Day 90 follow-up emails based on charter_end_date.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Find "Closed Won" stage
    const { data: closedWonStage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("name", "Closed Won")
      .single();

    if (!closedWonStage) {
      return NextResponse.json({
        ok: true,
        message: "No 'Closed Won' stage found",
        emails_sent: 0,
      });
    }

    // Find contacts with charter_end_date set and in Closed Won stage
    const { data: contacts } = await supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, company, charter_end_date, post_charter_step, pipeline_stage:pipeline_stages(name)"
      )
      .eq("pipeline_stage_id", closedWonStage.id)
      .not("charter_end_date", "is", null)
      .lt("post_charter_step", 3);

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No post-charter follow-ups due",
        emails_sent: 0,
      });
    }

    let emailsSent = 0;
    const results: { contact: string; step: number; sent: boolean; reason?: string }[] = [];

    for (const raw of contacts) {
      const contact = raw as unknown as CharterContact;
      if (!contact.email || !contact.charter_end_date) continue;

      const name =
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
        "Valued Client";
      const daysSinceEnd = Math.floor(
        (Date.now() - new Date(contact.charter_end_date).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      // Find the template that matches current step and day threshold
      const template = EMAIL_TEMPLATES.find(
        (t) =>
          t.step === contact.post_charter_step &&
          daysSinceEnd >= t.daysSince
      );

      if (!template) {
        results.push({
          contact: name,
          step: contact.post_charter_step,
          sent: false,
          reason: `Not due yet (${daysSinceEnd}d since charter end)`,
        });
        continue;
      }

      // Check if contact has replied since charter_end_date (skip if so)
      const { data: recentReplies } = await supabase
        .from("activities")
        .select("id")
        .eq("contact_id", contact.id)
        .eq("type", "email_received")
        .gte("created_at", contact.charter_end_date)
        .limit(1);

      if (recentReplies && recentReplies.length > 0) {
        results.push({
          contact: name,
          step: contact.post_charter_step,
          sent: false,
          reason: "Contact replied -- skipping",
        });
        continue;
      }

      // Send email
      const emailBody = template.body(name);
      const sent = await sendEmail(
        contact.email,
        template.subject,
        emailBody
      );

      if (sent) {
        const nextStep = contact.post_charter_step + 1;

        // Update step
        await supabase
          .from("contacts")
          .update({
            post_charter_step: nextStep,
            last_activity_at: new Date().toISOString(),
          })
          .eq("id", contact.id);

        // Log activity
        await supabase.from("activities").insert({
          contact_id: contact.id,
          type: "email_sent",
          description: `Post-charter email ${nextStep} sent: "${template.subject}"`,
          metadata: {
            post_charter_step: nextStep,
            subject: template.subject,
            generated_by: "cron",
          },
        });

        // Telegram notification
        await sendTelegram(
          [
            `<b>Post-Charter Email Sent</b>`,
            `To: ${name} (${contact.company ?? "N/A"})`,
            `Step: ${nextStep}/3`,
            `Subject: ${template.subject}`,
            `Days since charter: ${daysSinceEnd}`,
          ].join("\n")
        );

        emailsSent++;
        results.push({ contact: name, step: nextStep, sent: true });
      } else {
        results.push({
          contact: name,
          step: contact.post_charter_step,
          sent: false,
          reason: "Email send failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      contacts_checked: contacts.length,
      emails_sent: emailsSent,
      results,
    });
  } catch (err) {
    console.error("[Post-Charter] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
