// One-shot: fill in NULL post_type on legacy ig_posts rows so the
// downstream FB/TT mirrors actually see them.
//
// Sets post_type='image' for any row where it's NULL. Idempotent.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  const sb = createServiceClient();
  const { data: rows } = await sb
    .from("ig_posts")
    .select("id, status")
    .is("post_type", null)
    .limit(500);
  let fixed = 0;
  for (const r of (rows ?? []) as { id: string; status: string }[]) {
    const { error } = await sb
      .from("ig_posts")
      .update({ post_type: "image" })
      .eq("id", r.id);
    if (!error) fixed += 1;
  }
  return NextResponse.json({ ok: true, examined: (rows ?? []).length, fixed });
}
