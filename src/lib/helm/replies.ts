// src/lib/helm/replies.ts
// Reply capture for The Helm. Reads a request's Gmail thread, logs any new
// INBOUND messages as helm_messages (idempotent by gmail_message_id), and on
// a new reply: last_activity_at = now, stage sent → in_conversation, clear
// follow_up_at. Used by BOTH the on-demand "Check replies" button and the
// daily follow-up cron. Does NOT touch the existing inbox cron.

import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";

type ThreadMessage = { id: string; labelIds?: string[]; snippet?: string; internalDate?: string };

export async function captureReplies(requestId: string): Promise<{ newReplies: number }> {
  const db = createServiceClient();
  const { data: r } = await db
    .from("helm_requests")
    .select("gmail_thread_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!r?.gmail_thread_id) return { newReplies: 0 };

  const res = await gmailFetch(`/threads/${r.gmail_thread_id}?format=metadata&metadataHeaders=From`);
  if (!res.ok) return { newReplies: 0 };
  const thread = (await res.json()) as { messages?: ThreadMessage[] };
  const messages = thread.messages || [];

  let newReplies = 0;
  let latestInboundId: string | null = null;
  for (const m of messages) {
    const labels = m.labelIds || [];
    // Inbound = not one of our own sent/draft messages.
    if (labels.includes("SENT") || labels.includes("DRAFT")) continue;
    const { data: existing } = await db
      .from("helm_messages")
      .select("id")
      .eq("request_id", requestId)
      .eq("gmail_message_id", m.id)
      .maybeSingle();
    if (existing) continue;
    await db.from("helm_messages").insert({
      request_id: requestId,
      direction: "inbound",
      channel: "email",
      body: m.snippet || "(reply received — open the Gmail thread for the full message)",
      gmail_message_id: m.id,
    });
    newReplies++;
    latestInboundId = m.id;
  }

  if (newReplies > 0) {
    const patch: Record<string, unknown> = {
      last_activity_at: new Date().toISOString(),
      follow_up_at: null,
      updated_at: new Date().toISOString(),
    };
    if (r.status === "sent") patch.status = "in_conversation"; // don't regress negotiating/won
    if (latestInboundId) patch.gmail_last_message_id = latestInboundId;
    await db.from("helm_requests").update(patch).eq("id", requestId);
  }
  return { newReplies };
}
