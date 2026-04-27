// /api/admin/inbox-debug — diagnostic for "why isn't this contact
// surfacing in the cockpit?".
//
// Usage:
//   /api/admin/inbox-debug?email=sandra@thebraxtonagency.com
//   /api/admin/inbox-debug?name=braxton
//
// Returns the contact row, the full activity timeline, the freshly
// computed inbox state (so you can see if the analyzer would set
// anything different), and a Gmail search probe to spot threads that
// exist in mail but never made it into activities.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { analyzeActivities } from "@/lib/inbox-analyzer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get("email");
  const name = sp.get("name");
  if (!email && !name) {
    return NextResponse.json(
      { error: "pass ?email=... or ?name=..." },
      { status: 400 },
    );
  }

  const sb = createServiceClient();

  let q = sb.from("contacts").select("*");
  if (email) q = q.ilike("email", email);
  else if (name) q = q.or(`first_name.ilike.%${name}%,last_name.ilike.%${name}%,company.ilike.%${name}%`);
  const { data: contacts } = await q.limit(20);

  const out: Array<Record<string, unknown>> = [];
  for (const c of contacts ?? []) {
    const { data: acts } = await sb
      .from("activities")
      .select("type, description, metadata, created_at")
      .eq("contact_id", c.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const liveState = analyzeActivities(
      (acts ?? []).map((a) => ({
        type: a.type,
        created_at: a.created_at,
        description: a.description,
        metadata: a.metadata,
      })),
    );

    // Probe Gmail directly for threads with this email.
    let gmailHits: Array<{ id: string; snippet?: string; date?: string }> = [];
    if (c.email) {
      try {
        const probeRes = await gmailFetch(
          `/messages?${new URLSearchParams({
            q: `(from:${c.email} OR to:${c.email}) newer_than:180d`,
            maxResults: "10",
          })}`,
        );
        if (probeRes.ok) {
          const probe = (await probeRes.json()) as {
            messages?: { id: string }[];
          };
          gmailHits = (probe.messages ?? []).slice(0, 10).map((m) => ({
            id: m.id,
          }));
        }
      } catch {}
    }

    out.push({
      contact: {
        id: c.id,
        name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
        email: c.email,
        company: c.company,
        inbox_inferred_stage: c.inbox_inferred_stage,
        inbox_gap_days: c.inbox_gap_days,
        inbox_message_count: c.inbox_message_count,
        inbox_last_direction: c.inbox_last_direction,
        inbox_analyzed_at: c.inbox_analyzed_at,
      },
      activities_in_db: (acts ?? []).map((a) => ({
        type: a.type,
        subj: (a.metadata as { subject?: string } | null)?.subject ?? null,
        msg_id:
          (a.metadata as { message_id?: string } | null)?.message_id ?? null,
        backfilled:
          (a.metadata as { backfilled?: boolean } | null)?.backfilled ?? false,
        at: a.created_at,
      })),
      live_state_if_recomputed_now: liveState,
      gmail_search_180d_message_ids: gmailHits,
      gmail_msg_count_in_window: gmailHits.length,
      verdict:
        liveState.message_count === 0 && gmailHits.length > 0
          ? "GMAIL HAS THREADS BUT ACTIVITIES TABLE IS EMPTY — backfill missed this contact"
          : liveState.message_count === 0
            ? "no email activity in DB or in Gmail (>180d, or different address)"
            : liveState.message_count !==
                (c.inbox_message_count ?? 0)
              ? "STALE: live recompute differs from cached inbox_*"
              : "in sync",
    });
  }

  return NextResponse.json({
    matched: out.length,
    results: out,
  });
}
