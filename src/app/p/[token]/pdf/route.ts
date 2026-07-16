// GET /p/<token>/pdf — the tracked PDF redirect (was /p/<token> before the
// Salon, 2026-07-16). The Salon page's "Download the proposal" button and
// every non-Salon case (travel agent / white-label / single mode / nothing
// generated) land here. Behavior is byte-for-byte the old route: verify the
// HMAC token, record a real human open into extraction.opens, 302 to a
// freshly-signed PDF URL. Never blocks delivery on tracking errors.

import { NextRequest, NextResponse } from "next/server";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { getSignedProposalUrl } from "@/lib/helm/storage";
import { verifyProposalToken } from "@/lib/helm/proposal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// User-agents that fetch a link for a preview card (or are crawlers),
// not a human opening it. Matched case-insensitively as a substring.
const PREVIEW_BOTS = [
  "WhatsApp",
  "facebookexternalhit",
  "Twitterbot",
  "Slackbot",
  "TelegramBot",
  "Discordbot",
  "LinkedInBot",
  "Google-PageRenderer",
  "bingbot",
];

function isPreviewOrBot(ua: string): boolean {
  if (!ua.trim()) return true; // empty UA — treat as a non-human fetch
  const low = ua.toLowerCase();
  return PREVIEW_BOTS.some((b) => low.includes(b.toLowerCase()));
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const id = verifyProposalToken(token || "");
  if (!id) return new NextResponse("Not found", { status: 404 });

  const r = await getRequest(id);
  if (!r || !r.proposal_pdf_path) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Record a real open — best-effort, never blocks the redirect.
  const ua = req.headers.get("user-agent") || "";
  if (!isPreviewOrBot(ua)) {
    try {
      const ex =
        r.extraction && typeof r.extraction === "object"
          ? (r.extraction as Record<string, unknown>)
          : {};
      const prev =
        ex.opens && typeof ex.opens === "object"
          ? (ex.opens as { count?: number; first_at?: string })
          : null;
      const now = new Date().toISOString();
      const opens = {
        count: (prev?.count ?? 0) + 1,
        first_at: prev?.first_at ?? now,
        last_at: now,
      };
      await saveExtraction(id, { ...ex, opens });
    } catch (err) {
      console.error("[p/token/pdf] open-tracking error:", err);
      // fall through — delivery is never blocked by tracking
    }
  }

  const url = await getSignedProposalUrl(r.proposal_pdf_path);
  return NextResponse.redirect(url, 302);
}
