// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// Cron: publishes scheduled Instagram posts when their time arrives
export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured", processed: 0 });
  }

  const sb = createServiceClient();
  const { data: posts } = await sb
    .from("ig_posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("schedule_time", new Date().toISOString());

  let processed = 0;

  for (const post of posts ?? []) {
    try {
      // Mark as publishing
      await sb.from("ig_posts").update({ status: "publishing" }).eq("id", post.id);

      // Step 1: Create media container (use "me" for Instagram Login tokens)
      const containerRes = await fetch(
        `https://graph.instagram.com/v21.0/me/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: post.image_url,
            caption: post.caption,
            access_token: token,
          }),
        }
      );
      const containerData = await containerRes.json();
      if (!containerData.id) throw new Error(containerData.error?.message || "Container failed");

      // Step 2: Publish
      const publishRes = await fetch(
        `https://graph.instagram.com/v21.0/me/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: containerData.id,
            access_token: token,
          }),
        }
      );
      const publishData = await publishRes.json();
      if (!publishData.id) throw new Error(publishData.error?.message || "Publish failed — no media ID returned");

      // Step 3: Update status
      await sb.from("ig_posts").update({
        status: "published",
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
      }).eq("id", post.id);

      processed++;
    } catch (err) {
      await sb.from("ig_posts").update({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      }).eq("id", post.id);
    }
  }

  return NextResponse.json({ processed });
}
