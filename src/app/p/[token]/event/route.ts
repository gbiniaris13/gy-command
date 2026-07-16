// POST /p/<token>/event — Salon engagement beacons (2026-07-16).
// Token-authed (same HMAC as the page); the browser sends
//   { t: "view" | "yacht" | "pdf" | "wa", y?: "<yacht name>" }
// Counters land in extraction.salon (no schema change):
//   { views, first_at, last_at, yachts: {name: count}, pdf, wa }
// George's signal, never the client's problem: any failure returns ok.
//
// Telegram pings — the broker superpower, throttled so it informs, not spams:
//   • "view": at most one ping per 6 hours per request,
//   • "yacht" (This one interests us): ALWAYS pings + logs a helm_message
//     note, because that is a buying signal George acts on immediately.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { verifyProposalToken } from "@/lib/helm/proposal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SalonStats = {
  views?: number;
  first_at?: string;
  last_at?: string;
  last_ping_at?: string;
  yachts?: Record<string, number>;
  pdf?: number;
  wa?: number;
};

const PING_GAP_MS = 6 * 3600 * 1000;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const id = verifyProposalToken(token || "");
  if (!id) return NextResponse.json({ ok: true }); // never help enumeration

  try {
    const body = (await req.json().catch(() => ({}))) as { t?: string; y?: string };
    const t = String(body.t || "");
    const yacht = String(body.y || "").slice(0, 80);
    if (!["view", "yacht", "pdf", "wa"].includes(t)) return NextResponse.json({ ok: true });

    const r = await getRequest(id);
    if (!r) return NextResponse.json({ ok: true });

    const ex = (r.extraction && typeof r.extraction === "object"
      ? r.extraction
      : {}) as Record<string, unknown>;
    const s: SalonStats = (ex.salon && typeof ex.salon === "object" ? ex.salon : {}) as SalonStats;
    const now = new Date().toISOString();

    if (t === "view") {
      s.views = (s.views ?? 0) + 1;
      s.first_at = s.first_at ?? now;
      s.last_at = now;
    } else if (t === "pdf") {
      s.pdf = (s.pdf ?? 0) + 1;
    } else if (t === "wa") {
      s.wa = (s.wa ?? 0) + 1;
    } else if (t === "yacht" && yacht) {
      s.yachts = s.yachts ?? {};
      s.yachts[yacht] = (s.yachts[yacht] ?? 0) + 1;
    }

    // Telegram — throttled views, instant buying signals.
    const client = r.client_surname || r.client_name || r.client_email || "Client";
    let ping: string | null = null;
    if (t === "view") {
      const last = s.last_ping_at ? Date.parse(s.last_ping_at) : 0;
      if (Date.now() - last > PING_GAP_MS) {
        ping = `👀 <b>${client}</b> is reading the proposal right now (Salon, view #${s.views}).`;
        s.last_ping_at = now;
      }
    } else if (t === "yacht" && yacht) {
      ping = `⭐ <b>${client}</b> pressed “This one interests us” on <b>${yacht}</b>. Call while it's warm.`;
    }

    await saveExtraction(id, { ...ex, salon: s });

    if (t === "yacht" && yacht) {
      const db = createServiceClient();
      await db.from("helm_messages").insert({
        request_id: id,
        direction: null,
        channel: "note",
        body: `[Salon] Client marked interest in ${yacht}.`,
      });
    }

    if (ping) {
      try {
        const { sendTelegram } = await import("@/lib/telegram");
        await sendTelegram(ping);
      } catch (e) {
        console.error("[salon-event] telegram failed", e);
      }
    }
  } catch (e) {
    console.error("[salon-event]", e);
  }
  return NextResponse.json({ ok: true });
}
