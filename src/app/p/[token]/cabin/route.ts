// GET /p/<ref>/cabin — the door from the edition into The Cabin.
// The edition's address is already the client's private key; this route turns
// it into a Cabin sign-in: it asks the public site (the Cabin's home) for the
// principal's magic link, pinned to this booking's cabin, and sends the
// browser there. No password, no email round-trip. White-label bookings and
// bookings without a Cabin go to the Cabin's own front door instead.

import { NextResponse } from "next/server";
import { resolveEditionRef } from "@/lib/helm/edition-link";
import { getRequest } from "@/lib/helm-admin";
import { readBooking } from "@/lib/helm/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const id = await resolveEditionRef(token || "");
  if (!id) return NextResponse.redirect(`${SITE}/cabin/login`, 302);
  const r = await getRequest(id);
  if (!r || r.status !== "won") return NextResponse.redirect(`${SITE}/cabin/login`, 302);
  const b = readBooking(r.extraction);
  const email = (r.client_email || "").trim().toLowerCase();
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!b.cabin_id || b.white_label || !email || !secret) return NextResponse.redirect(`${SITE}/cabin/login`, 302);
  try {
    const res = await fetch(`${SITE}/api/cabin/auth/request-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ email, cabin_id: b.cabin_id, return_link: true }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => ({}))) as { link?: string };
    if (res.ok && j.link && /^https:\/\//.test(j.link)) return NextResponse.redirect(j.link, 302);
  } catch { /* fall through to the front door */ }
  return NextResponse.redirect(`${SITE}/cabin/login`, 302);
}
