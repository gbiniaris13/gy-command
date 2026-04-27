// v3 Pillar 4 — One-click unsubscribe.
//
// GET /api/newsletter/unsubscribe?token=<unsubscribe_token>
//
// Each newsletter_sends row carries a per-recipient token. Following
// the link flips the linked contact's subscribed_to_newsletter to
// false and stamps unsubscribed_at. We render a tiny HTML confirmation
// instead of a JSON response so this works as a one-click link in
// every email client.

import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function page(title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #222; }
    h1 { font-weight: 500; font-size: 24px; }
    p { line-height: 1.5; }
    .tag { color: #888; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
  <p class="tag">George Yachts · Athens</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return page("Missing token", "<p>This link is missing its token.</p>");
  }
  if (token === "test") {
    return page(
      "Test unsubscribe",
      "<p>This was a test send — no contact was modified.</p>",
    );
  }

  const sb = createServiceClient();
  const { data: send } = await sb
    .from("newsletter_sends")
    .select("id, contact_id, recipient_email")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (!send) {
    return page(
      "Already unsubscribed or invalid link",
      "<p>If you wanted to unsubscribe and this didn't work, reply to George directly and he'll take you off the list himself.</p>",
    );
  }

  const now = new Date().toISOString();
  if (send.contact_id) {
    await sb
      .from("contacts")
      .update({ subscribed_to_newsletter: false, unsubscribed_at: now })
      .eq("id", send.contact_id);
  }
  await sb
    .from("newsletter_sends")
    .update({ status: "unsubscribed" })
    .eq("id", send.id);

  return page(
    "You're unsubscribed",
    `<p>Thanks for letting us know. You won't get any more newsletters at <strong>${send.recipient_email}</strong>.</p>
     <p>If George ever wants to reach you about a specific charter, he'll still write you directly — but mass mail stops here.</p>`,
  );
}
