// GET /api/t/self?t=TOKEN&k=open|click&s=SIG — "that was me".
//
// 2026-08-18, George: "θέλω να το ανοίγω εγώ και να μη με μετράει σαν άνοιγμα."
//
// Why this is a button and not a rule. Gmail proxies every image through
// googleusercontent, and it does so identically whether the fetch is the
// recipient displaying the message in their inbox or George re-reading his
// own copy in Sent. There is no header, no IP and no user agent that
// separates the two when the recipient is also on Gmail. HubSpot solves it
// with a browser extension reading the open Gmail tab; we have no extension,
// so we do not pretend to detect it. We give George one click instead.
//
// What the click does:
//   1. Rewrites the most recent `human` hit of that kind to verdict `self`,
//      so the audit trail keeps the row and tells the truth about it.
//   2. Rolls the counter back by one and clears first_open_at (or
//      first_click_at) if that self hit was the one that set it.
//   3. RE-ARMS the notification. This is the important part: the client's
//      real first open still reaches George later. Suppressing without
//      re-arming would trade a false alarm for a missed lead, and a missed
//      lead is the expensive one.
//
// Signed with the same HMAC as the click redirect so the link cannot be
// guessed or replayed by anyone who has not seen the notification.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { signSelf } from "@/lib/email-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, detail: string): NextResponse {
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f6f3;
      font:400 17px/1.6 ui-serif,Georgia,"Times New Roman",serif;color:#2b2b28;padding:24px}
 .card{max-width:30rem;background:#fff;border:1px solid #e6e2d9;padding:2.5rem 2.25rem;text-align:center}
 h1{font-size:1.35rem;font-weight:400;letter-spacing:.01em;margin:0 0 .75rem}
 p{margin:0;color:#5c574e;font-size:.97rem}
</style>
<div class="card"><h1>${title}</h1><p>${detail}</p></div>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get("t") || "";
  const kind = req.nextUrl.searchParams.get("k") === "click" ? "click" : "open";
  const sig = req.nextUrl.searchParams.get("s") || "";

  if (!token || token.length > 40 || sig !== signSelf(token, kind)) {
    return page("Link not recognised", "This correction link is not valid. Nothing was changed.");
  }

  const noun = kind === "click" ? "click" : "open";

  try {
    const sb = createServiceClient();

    const { data: row } = await sb
      .from("email_tracking")
      .select(
        "id, recipient, open_count, click_count, first_open_at, first_click_at, open_notified, click_notified",
      )
      .eq("token", token)
      .maybeSingle();

    if (!row) {
      return page("Nothing to correct", "That email is no longer being tracked.");
    }

    // The hit we are disowning: the newest one we counted as a human.
    const { data: hit } = await sb
      .from("email_tracking_hits")
      .select("id, at")
      .eq("token", token)
      .eq("kind", kind)
      .eq("verdict", "human")
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!hit) {
      return page(
        "Already corrected",
        `There is no counted ${noun} left to disown on this email.`,
      );
    }

    await sb.from("email_tracking_hits").update({ verdict: "self" }).eq("id", hit.id);

    const countField = kind === "click" ? "click_count" : "open_count";
    const firstField = kind === "click" ? "first_click_at" : "first_open_at";
    const notifiedField = kind === "click" ? "click_notified" : "open_notified";

    const current = (kind === "click" ? row.click_count : row.open_count) || 0;
    const firstAt = kind === "click" ? row.first_click_at : row.first_open_at;

    // If the hit we just disowned is the one that set "first", clear it and
    // re-arm the notification so the client's genuine first one still lands.
    const wasFirst =
      !!firstAt && Math.abs(Date.parse(firstAt) - Date.parse(hit.at)) < 5_000;

    const patch: Record<string, unknown> = {
      [countField]: Math.max(0, current - 1),
    };
    if (wasFirst) {
      patch[firstField] = null;
      patch[notifiedField] = false;
    }

    await sb.from("email_tracking").update(patch).eq("id", row.id);

    return page(
      "Noted, that one was you",
      wasFirst
        ? `The ${noun} has been removed from the count for ${row.recipient || "this email"}, and the alert is armed again. You will still hear about the real first ${noun}.`
        : `The ${noun} has been removed from the count for ${row.recipient || "this email"}.`,
    );
  } catch (e) {
    console.error("[t/self]", e);
    return page("Could not correct that", "Something went wrong. The count is unchanged.");
  }
}
