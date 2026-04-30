import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

/**
 * Daily cron: find Warm/Hot leads idle for 7+ days and create reminder activities.
 * Called by Vercel Cron at 07:00 UTC daily.
 */
async function _observedImpl(request: NextRequest): Promise<Response> {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Find Warm and Hot stage IDs
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select("id, name")
      .in("name", ["Warm", "Hot"]);

    if (!stages || stages.length === 0) {
      return NextResponse.json({ ok: true, idle: 0, message: "No Warm/Hot stages found" });
    }

    const stageIds = stages.map((s) => s.id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Find idle contacts
    const { data: idleContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company, country, last_activity_at, pipeline_stage:pipeline_stages(name)")
      .in("pipeline_stage_id", stageIds)
      .lt("last_activity_at", sevenDaysAgo)
      .order("last_activity_at", { ascending: true });

    if (!idleContacts || idleContacts.length === 0) {
      return NextResponse.json({ ok: true, idle: 0, message: "No idle leads" });
    }

    // Create activities for each idle contact
    const activities = idleContacts.map((contact) => {
      const daysSince = Math.floor(
        (Date.now() - new Date(contact.last_activity_at!).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown";

      return {
        contact_id: contact.id,
        type: "idle_alert",
        description: `Idle for ${daysSince} days -- follow up needed`,
        metadata: {
          days_idle: daysSince,
          contact_name: name,
          company: contact.company,
          created_by: "cron",
        },
      };
    });

    await supabase.from("activities").insert(activities);

    // Send Telegram summary
    const lines = idleContacts.slice(0, 10).map((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
      const days = Math.floor(
        (Date.now() - new Date(c.last_activity_at!).getTime()) / (1000 * 60 * 60 * 24)
      );
      const stageData = c.pipeline_stage as unknown as { name: string } | { name: string }[] | null;
      const stage = Array.isArray(stageData) ? stageData[0]?.name ?? "?" : stageData?.name ?? "?";
      return `  - ${name} (${c.company ?? "?"}) [${stage}] -- ${days}d idle`;
    });

    const telegramMsg = [
      `Idle leads: ${idleContacts.length} contacts need follow-up`,
      "",
      ...lines,
      idleContacts.length > 10 ? `  ... and ${idleContacts.length - 10} more` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendTelegram(telegramMsg);

    return NextResponse.json({
      ok: true,
      idle: idleContacts.length,
      activities_created: activities.length,
      contacts: idleContacts.map((c) => ({
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        company: c.company,
        days_idle: Math.floor(
          (Date.now() - new Date(c.last_activity_at!).getTime()) / (1000 * 60 * 60 * 24)
        ),
      })),
    });
  } catch (err) {
    console.error("[Idle Leads Cron] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  return observeCron("idle-leads", () => _observedImpl(request));
}
