import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

// One-time migration endpoint — adds missing columns
export async function GET() {
  const sb = createServiceClient();

  // Check if charter_end_date exists by trying to query it
  const { error } = await sb
    .from("contacts")
    .select("charter_end_date")
    .limit(1);

  if (error && error.message.includes("charter_end_date")) {
    // Column doesn't exist — we can't run raw SQL via REST
    // But we can use Supabase's pg_net extension or just report
    return NextResponse.json({
      message: "charter_end_date column missing. Run this SQL in Supabase SQL Editor:",
      sql: "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS charter_end_date date; ALTER TABLE contacts ADD COLUMN IF NOT EXISTS post_charter_step int DEFAULT 0;",
      workaround: "For now, charter_end_date is stored in charter_notes field.",
    });
  }

  // If column exists, update Tricia
  const { data, error: updateError } = await sb
    .from("contacts")
    .update({
      charter_end_date: "2026-07-04",
      post_charter_step: 0,
    })
    .eq("id", "18f8d30d-50a8-46b4-9806-3ef087a72fc0")
    .select("first_name, last_name, charter_end_date");

  if (updateError) {
    return NextResponse.json({ error: updateError.message });
  }

  return NextResponse.json({
    message: "Migration check complete",
    tricia: data,
  });
}
