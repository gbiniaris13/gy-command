import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { requireUser } from "@/lib/require-user";

export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
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
