// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export async function GET() {
  const sb = createServiceClient();

  // Check if column already exists
  const { data: existing } = await sb
    .from("contacts")
    .select("contact_type")
    .limit(1);

  if (existing !== null) {
    return NextResponse.json({
      status: "already_exists",
      message: "contact_type column already exists on contacts table",
    });
  }

  return NextResponse.json({
    status: "needs_migration",
    message: "Run this SQL in Supabase SQL Editor:",
    sql: `
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_type TEXT DEFAULT 'OUTREACH_LEAD';

ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check
CHECK (contact_type IN ('CENTRAL_AGENT','B2B_PARTNER','BROKER_CLIENT','DIRECT_CLIENT','PRESS_MEDIA','INDUSTRY','OUTREACH_LEAD'));

CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts(contact_type);
    `.trim(),
  });
}
