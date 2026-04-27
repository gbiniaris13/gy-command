// /api/admin/inbox-cleanup-noise-emails — purge contacts whose
// email matches the (now-broader) noise localpart patterns.
//
// Contacts created before the noise filter was strengthened can sit
// in the cockpit polluting the owed_reply pile (DMARC reports,
// invoice@, support@, dealermessage@, etc). This deletes them and
// cascade-removes their backfilled activities.
//
// Safe-to-delete: source=outreach_bot, no notes, no charter_fee.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { isNoiseEmail } from "@/lib/email-signature-parser";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const apply = sp.get("apply") === "1";
  const sb = createServiceClient();

  const candidateIds: string[] = [];
  const sample: Array<{ id: string; email: string; reason?: string }> = [];
  let page = 0;
  const PAGE = 1000;
  while (true) {
    const { data: rows, error } = await sb
      .from("contacts")
      .select("id, email, first_name, last_name")
      .eq("source", "outreach_bot")
      .is("notes", null)
      .or("charter_fee.is.null,charter_fee.eq.0")
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error || !rows || rows.length === 0) break;
    for (const r of rows) {
      const email = r.email as string;
      const verdict = isNoiseEmail({
        from: email,
        fromEmail: email.toLowerCase(),
        subject: "",
        headers: {},
      });
      if (verdict.noise) {
        candidateIds.push(r.id as string);
        if (sample.length < 25)
          sample.push({ id: r.id as string, email, reason: verdict.reason });
      }
    }
    if (rows.length < PAGE) break;
    page++;
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      dry: true,
      noise_email_contacts: candidateIds.length,
      sample,
      hint: "Add &apply=1 to delete (cascades activities).",
    });
  }

  let deleted = 0;
  const CHUNK = 500;
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    const slice = candidateIds.slice(i, i + CHUNK);
    const { error } = await sb.from("contacts").delete().in("id", slice);
    if (error) {
      return NextResponse.json(
        { error: error.message, deleted_before_error: deleted },
        { status: 500 },
      );
    }
    deleted += slice.length;
  }
  return NextResponse.json({ ok: true, deleted });
}
