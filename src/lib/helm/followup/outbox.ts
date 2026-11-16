// src/lib/helm/followup/outbox.ts — the WhatsApp outbox shared by the Helm
// ("Send on WhatsApp") and the Mac agent (see /api/helm/wa-outbox).
import { getSetting, setSetting } from "@/lib/google-api";

export type OutboxItem = {
  id: string;
  request_id: string;
  phone: string; // digits with country code
  text: string;
  first_name: string;
  last_name: string; // "Surname GY client 2027" (George's contacts style)
  org: string;
  note: string;
  created_at: string;
  status: "queued" | "sending" | "sent" | "failed";
  detail?: string;
  done_at?: string;
};

export async function readOutbox(): Promise<OutboxItem[]> {
  try { const v = JSON.parse((await getSetting("wa_outbox")) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export async function writeOutbox(items: OutboxItem[]): Promise<void> {
  await setSetting("wa_outbox", JSON.stringify(items.slice(-60)));
}

