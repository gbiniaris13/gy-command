// Thin helper for inserting in-app notifications. Called from any place
// that already has a Supabase service client (classify, sync, cron jobs,
// etc). Fire-and-forget — never let a notification insert fail the
// parent operation.

export type NotificationType =
  | "hot_lead"
  | "lead"
  | "email"
  | "reply"
  | "ig_dm"
  | "form_submission"
  | "charter_reminder"
  | "info";

export interface NotificationInput {
  type: NotificationType;
  title: string;
  description?: string;
  link?: string;
  contact_id?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createNotification(sb: any, input: NotificationInput) {
  try {
    await sb.from("notifications").insert({
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      link: input.link ?? null,
      contact_id: input.contact_id ?? null,
    });
  } catch {
    // Intentionally silent — notifications are a side-effect, never a hard
    // dependency of the parent operation.
  }
}
