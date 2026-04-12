import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("pipeline_stages")
    .select("id, name, position, color")
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ stages: data });
}
