// @ts-nocheck
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";

export async function GET(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const raw = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (!raw) return NextResponse.json({ error: "GA_SERVICE_ACCOUNT_JSON not set" });

  try {
    const parsed = JSON.parse(raw);
    return NextResponse.json({
      client_email: parsed.client_email,
      project_id: parsed.project_id,
      ga_property_id: process.env.GA_PROPERTY_ID || "513730342",
      instruction: `Add ${parsed.client_email} as Viewer to GA4 property ${process.env.GA_PROPERTY_ID || "513730342"} in Google Analytics Admin → Property Access Management`,
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse GA_SERVICE_ACCOUNT_JSON" });
  }
}
