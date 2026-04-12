// @ts-nocheck
import { NextResponse } from "next/server";

export async function GET() {
  // Use Supabase Management API or direct pg connection
  // Since we can't run raw SQL via REST, provide the SQL to run manually
  const sql = `
CREATE TABLE IF NOT EXISTS ig_posts (
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
);

-- Allow anon/authenticated access
ALTER TABLE ig_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON ig_posts FOR ALL USING (true) WITH CHECK (true);
`;

  // Try using the Supabase service role with pg endpoint
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ sql, message: "Run this SQL in Supabase SQL Editor" });
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
    });

    // This won't work for DDL — return SQL for manual execution
    return NextResponse.json({ sql, message: "Run this SQL in Supabase SQL Editor at: " + supabaseUrl.replace('.supabase.co', '.supabase.co/project/default/sql') });
  } catch {
    return NextResponse.json({ sql, message: "Run this SQL in Supabase SQL Editor" });
  }
}
