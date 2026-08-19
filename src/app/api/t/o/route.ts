// GET /api/t/o?t=TOKEN — the open pixel.
// Returns a 1x1 transparent GIF always (even on bad tokens). Every hit is
// LOGGED to email_tracking_hits with a verdict (human / prefetch / bot /
// apple-mpp — see classifyOpen); only a HUMAN open updates the counters and
// notifies George. HubSpot-grade filtering, per hit, because our volume
// affords the full audit trail.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { emailGeorgeReport, athensTime, classifyOpen, selfFooter } from "@/lib/email-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function gif(): NextResponse {
  return new NextResponse(GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (!token || token.length > 40) return gif();

  try {
    const sb = createServiceClient();
    const { data: row } = await sb
      .from("email_tracking")
      .select("id, sent_at, open_count, first_open_at, open_notified, subject, recipient, source")
      .eq("token", token)
      .maybeSingle();
    if (!row) return gif();

    const now = new Date();
    const userAgent = req.headers.get("user-agent");
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const sentMs = Date.parse(row.sent_at);

    const verdict = classifyOpen({
      userAgent,
      sentAtMs: Number.isFinite(sentMs) ? sentMs : null,
      nowMs: now.getTime(),
    });

    // Full audit trail — every hit, every verdict. Never blocks the pixel.
    await sb.from("email_tracking_hits").insert({
      token,
      kind: "open",
      user_agent: (userAgent || "").slice(0, 400),
      ip,
      verdict,
    });

    if (verdict !== "human") return gif();

    const isFirst = !row.first_open_at;
    await sb
      .from("email_tracking")
      .update({
        open_count: (row.open_count || 0) + 1,
        last_open_at: now.toISOString(),
        ...(isFirst ? { first_open_at: now.toISOString() } : {}),
        ...(isFirst ? { open_notified: true } : {}),
      })
      .eq("id", row.id);

    if (isFirst && !row.open_notified) {
      const body = [
        `Your email was just opened.`,
        ``,
        `To:      ${row.recipient || "unknown"}`,
        `Subject: ${row.subject || "(no subject)"}`,
        `Sent:    ${athensTime(row.sent_at)} (Athens)`,
        `Opened:  ${athensTime(now.toISOString())} (Athens)`,
        `Via:     ${row.source}`,
        ``,
        `Machine fetches (Gmail prefetch, scanners, Apple proxy) are filtered out - this one classified as a real reader.`,
        `Further opens and clicks are counted silently - the evening digest has the totals.`,
        ...selfFooter(token, "open"),
      ].join("\n");
      await emailGeorgeReport(
        `\u{1F4EC} Opened: ${(row.subject || "(no subject)").slice(0, 60)} - ${row.recipient || ""}`,
        body,
      );
    }
  } catch (err) {
    console.error("[tracking/open] failed:", err);
  }
  return gif();
}
