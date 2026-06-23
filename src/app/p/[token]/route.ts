// src/app/p/[token]/route.ts
// =============================================================
// Tracked redirect for LINK-delivered charter proposals.
//
// GET /p/<token>  →  302 to a freshly-signed proposal PDF URL.
// The token (see lib/helm/proposal-token.ts) HMAC-encodes the request
// id, so the link is tamper-proof and we can record a real "open" the
// moment a human follows it — without exposing the raw signed URL.
//
//   • The open is recorded into extraction.opens (no new column):
//       { count, first_at, last_at }. We merge ...existingExtraction
//       so yachts / featured_index / white_label survive.
//   • Bots and link-preview crawlers (WhatsApp, facebookexternalhit,
//     Slackbot, …) STILL get the PDF but DO NOT count as an open, so
//     the signal reflects a real human, not the preview fetch that
//     fires before the client even taps the link.
//   • Fail-safe: any error while recording is swallowed — we always
//     redirect to the PDF, never block delivery.
//
// A tampered/unknown token, or a request without a proposal PDF, is a
// 404 (no enumeration of valid ids).
// =============================================================

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
      console.error("[p/token] open-tracking error:", err);
      // fall through — delivery is never blocked by tracking
    }
  }

  const url = await getSignedProposalUrl(r.proposal_pdf_path);
  return NextResponse.redirect(url, 302);
}
