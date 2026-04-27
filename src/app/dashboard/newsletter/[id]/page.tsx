// v3 Pillar 4 — Per-campaign composer.

import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import ComposerClient from "./ComposerClient";

export const dynamic = "force-dynamic";

interface CampaignRow {
  id: string;
  stream: string;
  subject: string;
  body_markdown: string | null;
  body_html: string | null;
  audience_definition: Record<string, unknown> | null;
  audience_size: number | null;
  status: string;
  test_sent_to: string | null;
  test_sent_at: string | null;
  sent_at: string | null;
  ai_generated: boolean | null;
  ai_model_used: string | null;
}

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  filter_definition: Record<string, unknown>;
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  const [{ data: campaign }, { data: segments }, { data: sends }] =
    await Promise.all([
      sb.from("newsletter_campaigns").select("*").eq("id", id).maybeSingle(),
      sb
        .from("audience_segments")
        .select("id, name, description, filter_definition")
        .eq("is_archived", false)
        .order("name"),
      sb
        .from("newsletter_sends")
        .select("status")
        .eq("campaign_id", id),
    ]);

  type S = { status: string };
  const counts: Record<string, number> = {};
  for (const s of (sends ?? []) as S[])
    counts[s.status] = (counts[s.status] ?? 0) + 1;

  return (
    <ComposerClient
      campaign={(campaign ?? null) as CampaignRow | null}
      segments={(segments ?? []) as SegmentRow[]}
      sendCounts={counts}
    />
  );
}
