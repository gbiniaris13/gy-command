import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// GET — list scheduled/draft posts
export async function GET() {
  const sb = createServiceClient();

  // Ensure table exists (create if not)
  await sb.rpc("exec_sql", {
    query: `CREATE TABLE IF NOT EXISTS ig_posts (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      image_url TEXT NOT NULL,
      caption TEXT,
      schedule_time TIMESTAMPTZ,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','publishing','published','failed')),
      ig_media_id TEXT,
      published_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )`
  }).catch(() => { /* table may already exist or rpc not available */ });

  const { data, error } = await sb
    .from("ig_posts")
    .select("*")
    .order("schedule_time", { ascending: true });

  if (error) {
    // Table might not exist yet — return empty
    return NextResponse.json({ posts: [] });
  }
  return NextResponse.json({ posts: data ?? [] });
}

// POST — create new post (draft or scheduled)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const sb = createServiceClient();

  const { data, error } = await sb
    .from("ig_posts")
    .insert({
      image_url: body.image_url,
      caption: body.caption || "",
      schedule_time: body.schedule_time || null,
      status: body.schedule_time ? "scheduled" : "draft",
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}

// PATCH — update post
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const sb = createServiceClient();

  if (!body.id) {
    return NextResponse.json({ error: "Post ID required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("caption" in body) updates.caption = body.caption;
  if ("image_url" in body) updates.image_url = body.image_url;
  if ("schedule_time" in body) {
    updates.schedule_time = body.schedule_time;
    updates.status = body.schedule_time ? "scheduled" : "draft";
  }
  if ("status" in body) updates.status = body.status;

  const { data, error } = await sb
    .from("ig_posts")
    .update(updates)
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}

// DELETE — remove post
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  const sb = createServiceClient();
  await sb.from("ig_posts").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
