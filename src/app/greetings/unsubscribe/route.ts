// src/app/greetings/unsubscribe/route.ts
// =============================================================
// One-click greeting opt-out. Brief 06 / after-sales STEP 3A.
//
// GET /greetings/unsubscribe?token=<contactId.hmac>
// Verifies the signed token (no login), sets contacts.greetings_opt_out
// = true, and renders a calm confirmation page. Idempotent. A bad or
// missing token shows the same neutral page (never leaks whether an
// id exists). Logs an activity row for the audit trail.
// =============================================================

import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { verifyUnsubscribeToken } from "@/lib/greetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(message: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>George Yachts</title></head>
<body style="margin:0;background:#F8F5F0;font-family:Georgia,serif;color:#0D1B2A;">
  <div style="max-width:520px;margin:64px auto;padding:40px;background:#fff;border:1px solid rgba(13,27,42,0.08);text-align:center;">
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;letter-spacing:3px;font-size:11px;text-transform:uppercase;color:#C9A84C;font-weight:600;">George Yachts</div>
    <p style="font-size:16px;line-height:1.7;margin-top:24px;">${message}</p>
    <p style="font-size:13px;color:rgba(13,27,42,0.55);margin-top:28px;">If this was a mistake, just reply to any note from George and we will add you back.</p>
  </div>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get("token") || "";
  const contactId = verifyUnsubscribeToken(token);

  // Neutral page for any invalid/missing token (no enumeration).
  if (!contactId) {
    return page("This unsubscribe link is no longer valid.");
  }

  try {
    const sb = createServiceClient();
    await sb
      .from("contacts")
      .update({ greetings_opt_out: true })
      .eq("id", contactId);
    await sb.from("activities").insert({
      contact_id: contactId,
      type: "email_sent",
      description: "Greetings opt-out (one-click unsubscribe)",
      metadata: { occasion: "opt_out", generated_by: "unsubscribe_link" },
    });
  } catch (err) {
    console.error("[greetings/unsubscribe] error:", err);
    // Still confirm to the user; the click intent is honored best-effort.
  }

  return page(
    "You have been unsubscribed from our occasional greetings. We wish you calm seas.",
  );
}
