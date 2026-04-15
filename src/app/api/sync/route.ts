import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { createNotification } from "@/lib/notifications";

// ─── Types ─────────────────────────────────────────────────────────────────

interface SheetRow {
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  country?: string;
  linkedin_url?: string;
  status?: string;
}

interface SyncBody {
  rows: SheetRow[];
  secret: string;
  // Optional — if the Google Apps Script bot tracks opens/bounces it can
  // push them here. If omitted, we compute what we can from the row
  // statuses. Either way the snapshot is refreshed automatically on every
  // sync so the dashboard never needs a manual update.
  stats?: {
    total_sent?: number;
    opens?: number;
    replies?: number;
    bounces?: number;
    leads_remaining?: number;
    active_followups?: number;
  };
}

// ─── Status → Stage mapping ────────────────────────────────────────────────

const STATUS_TO_STAGE: Record<string, string> = {
  "": "New",
  new: "New",
  email1: "Contacted",
  followup1: "Contacted",
  followup2: "Contacted",
  replied: "Warm",
  completed: "Contacted",
  error: "__keep__", // Keep current stage
};

const STATUS_ACTIVITIES: Record<string, string> = {
  followup1: "Follow-up 1 sent",
  followup2: "Follow-up 2 sent",
  replied: "Lead replied to outreach",
  completed: "Outreach sequence completed",
  error: "Email delivery error",
};

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: SyncBody = await request.json();

    // 1. Auth check
    const syncSecret = process.env.SYNC_SECRET;
    if (!syncSecret || body.secret !== syncSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // 2. Fetch all pipeline stages once
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .select("id, name");

    if (!stages) {
      return NextResponse.json(
        { error: "Could not load pipeline stages" },
        { status: 500 }
      );
    }

    const stageMap = new Map(stages.map((s) => [s.name, s.id]));

    // 3. Collect all emails for batch lookup
    const emails = body.rows
      .map((r) => r.email?.trim().toLowerCase())
      .filter((e): e is string => !!e);

    const uniqueEmails = [...new Set(emails)];

    // Batch lookup existing contacts
    const { data: existingContacts } = await supabase
      .from("contacts")
      .select("id, email, pipeline_stage_id, first_name, last_name, company, country")
      .in("email", uniqueEmails);

    const contactByEmail = new Map(
      (existingContacts ?? []).map((c) => [c.email!.toLowerCase(), c])
    );

    // 4. Process rows
    let synced = 0;
    let updated = 0;
    let created = 0;
    const telegramMessages: string[] = [];
    const activitiesToInsert: {
      contact_id: string;
      type: string;
      description: string;
      metadata: Record<string, unknown>;
    }[] = [];

    for (const row of body.rows) {
      const email = row.email?.trim().toLowerCase();
      if (!email) continue;

      const status = (row.status ?? "").trim().toLowerCase();
      const targetStageName = STATUS_TO_STAGE[status] ?? null;

      const existing = contactByEmail.get(email);

      if (existing) {
        // ── Update existing contact ──
        const shouldUpdateStage =
          targetStageName && targetStageName !== "__keep__";
        const targetStageId = shouldUpdateStage
          ? stageMap.get(targetStageName!)
          : null;

        const stageChanged =
          shouldUpdateStage &&
          targetStageId &&
          targetStageId !== existing.pipeline_stage_id;

        if (stageChanged) {
          await supabase
            .from("contacts")
            .update({
              pipeline_stage_id: targetStageId,
              last_activity_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          updated++;
        }

        // Add activity if applicable
        const activityDesc = STATUS_ACTIVITIES[status];
        if (activityDesc) {
          activitiesToInsert.push({
            contact_id: existing.id,
            type: "outreach_sync",
            description: activityDesc,
            metadata: { sheet_status: status, synced_at: new Date().toISOString() },
          });

          // Also update last_activity_at if no stage change already did it
          if (!stageChanged) {
            await supabase
              .from("contacts")
              .update({
                last_activity_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
          }
        }

        // Telegram + in-app notification on reply
        if (status === "replied") {
          const name = [existing.first_name, existing.last_name]
            .filter(Boolean)
            .join(" ") || email;
          telegramMessages.push(
            `<b>${name}</b> from ${existing.company ?? "Unknown"} (${existing.country ?? "?"}) replied!`
          );
          await createNotification(supabase, {
            type: "reply",
            title: `${name} replied to outreach`,
            description: existing.company
              ? `${existing.company} (${existing.country ?? "?"})`
              : existing.country ?? "",
            link: `/dashboard/contacts/${existing.id}`,
            contact_id: existing.id,
          });
        }

        synced++;
      } else {
        // ── Insert new contact ──
        const stageId = stageMap.get(targetStageName === "__keep__" ? "New" : (targetStageName ?? "New"));

        const { data: newContact } = await supabase
          .from("contacts")
          .insert({
            email,
            first_name: row.first_name?.trim() || null,
            last_name: row.last_name?.trim() || null,
            company: row.company?.trim() || null,
            country: row.country?.trim() || null,
            linkedin_url: row.linkedin_url?.trim() || null,
            source: "outreach_bot",
            pipeline_stage_id: stageId ?? null,
            last_activity_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (newContact) {
          contactByEmail.set(email, {
            id: newContact.id,
            email,
            pipeline_stage_id: stageId ?? null,
            first_name: row.first_name?.trim() || null,
            last_name: row.last_name?.trim() || null,
            company: row.company?.trim() || null,
            country: row.country?.trim() || null,
          });

          activitiesToInsert.push({
            contact_id: newContact.id,
            type: "outreach_sync",
            description: "Imported from outreach sheet",
            metadata: { sheet_status: status, synced_at: new Date().toISOString() },
          });
        }

        created++;
        synced++;
      }
    }

    // 5. Batch insert activities
    if (activitiesToInsert.length > 0) {
      await supabase.from("activities").insert(activitiesToInsert);
    }

    // 6. Send Telegram alerts
    if (telegramMessages.length > 0) {
      const msg = telegramMessages.map((m) => `🔥 ${m}`).join("\n");
      await sendTelegram(msg);
    }

    // 7. Auto-refresh the outreach stats snapshot from the rows this sync
    // just ingested. The Google Apps Script bot already POSTs the full
    // sheet on every run, so this gives the dashboard a live view with
    // zero manual input. If the bot also sends an explicit `stats`
    // object (for opens/bounces it tracks itself), those values win.
    const rowStatuses = body.rows
      .map((r) => (r.status ?? "").trim().toLowerCase())
      .filter((s) => s.length >= 0); // keep empty strings — they mean "new"

    const countWhere = (pred: (s: string) => boolean) =>
      rowStatuses.filter(pred).length;

    const rowsTotal = body.rows.length;
    const rowsRemaining = countWhere((s) => s === "" || s === "new");
    const rowsSent = rowsTotal - rowsRemaining;
    const rowsReplied = countWhere((s) => s === "replied");
    const rowsActiveFollowups = countWhere(
      (s) => s === "followup1" || s === "followup2"
    );
    const rowsErrored = countWhere((s) => s === "error");

    const snapshotPayload = {
      total_sent: body.stats?.total_sent ?? rowsSent,
      // opens isn't derivable from status — fall back to 0 until the bot
      // starts pushing it.
      opens: body.stats?.opens ?? 0,
      replies: body.stats?.replies ?? rowsReplied,
      // "error" status on the sheet is the closest proxy for a bounce.
      bounces: body.stats?.bounces ?? rowsErrored,
      leads_remaining: body.stats?.leads_remaining ?? rowsRemaining,
      active_followups: body.stats?.active_followups ?? rowsActiveFollowups,
      updated_at: new Date().toISOString(),
      source: "bot" as const,
    };

    await supabase
      .from("settings")
      .upsert(
        {
          key: "outreach_stats",
          value: JSON.stringify(snapshotPayload),
          updated_at: snapshotPayload.updated_at,
        },
        { onConflict: "key" }
      );

    return NextResponse.json({
      ok: true,
      synced,
      updated,
      created,
      activities: activitiesToInsert.length,
      telegram_alerts: telegramMessages.length,
      snapshot: snapshotPayload,
    });
  } catch (err) {
    console.error("[Sync API] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
