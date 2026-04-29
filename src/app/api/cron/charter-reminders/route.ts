import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

async function _observedImpl(req: NextRequest): Promise<Response> {
  // Verify cron secret in production
  const authHeader = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const today = new Date().toISOString().slice(0, 10);

    // Find due reminders: reminder_date <= today, not completed, not snoozed into the future
    const { data: dueReminders, error } = await supabase
      .from("charter_reminders")
      .select(
        "*, contact:contacts(id, first_name, last_name, charter_vessel)"
      )
      .eq("completed", false)
      .lte("reminder_date", today)
      .or(`snoozed_until.is.null,snoozed_until.lte.${today}`)
      .order("reminder_date", { ascending: true });

    if (error) {
      console.error("[Cron Charter Reminders] Query error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!dueReminders || dueReminders.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let processed = 0;

    for (const reminder of dueReminders) {
      const contact = reminder.contact as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        charter_vessel: string | null;
      } | null;

      const clientName = contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
          "Client"
        : "Client";

      const vessel = contact?.charter_vessel ?? "Yacht";

      // Send Telegram alert
      const message = [
        `<b>Charter Reminder Due</b>`,
        ``,
        `Client: ${clientName}`,
        `Vessel: ${vessel}`,
        `Task: ${reminder.description}`,
        `Due: ${reminder.reminder_date}`,
        ``,
        `<i>Mark complete in GY Command</i>`,
      ].join("\n");

      await sendTelegram(message);

      // Create notification
      await supabase.from("notifications").insert({
        type: "charter_reminder",
        title: `${reminder.description}`,
        description: `${clientName} -- ${vessel}`,
        link: contact
          ? `/dashboard/contacts/${contact.id}`
          : null,
        read: false,
        contact_id: contact?.id ?? null,
      });

      processed++;
    }

    return NextResponse.json({ processed });
  } catch (err) {
    console.error("[Cron Charter Reminders] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return observeCron("charter-reminders", () => _observedImpl(req));
}
