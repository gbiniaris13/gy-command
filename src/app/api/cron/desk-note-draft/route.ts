// Mondays 05:10 UTC: the Bridge desk note, drafted from the Helm's numbers,
// parked for George's one-click approval in the morning brief.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { observeCron } from "@/lib/cron-observer";
import { draftDeskNote } from "@/lib/newsletter-desk-note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  return observeCron("desk-note-draft", async () => NextResponse.json({ ok: true, ...(await draftDeskNote()) }));
}
