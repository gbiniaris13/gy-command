// POST /api/hooks/newsletter-subscriber — called by the public site
// (fire-and-forget) whenever someone signs up to the Journal, so every
// subscriber lands in the CRM contacts book automatically.
//
// Why (George, 2026-07-15): the client file must live in ONE place.
// Helm clients were already contacts; site subscribers only lived in
// the site's KV. This hook mirrors them in as NEWSLETTER_SUBSCRIBER
// contacts, so a "pull the whole client list" is a single query, and
// when a subscriber later sends an inquiry the history is already
// attached to their email.
//
// Auth: Bearer NEWSLETTER_PROXY_SECRET (both apps hold it). Unlike the
// dashboard proxies this route is internet-facing by design, so it
// REQUIRES the secret — no key, no entry.
//
// Behaviour: upsert by email (case-insensitive).
//   - New email  → contact {contact_type: NEWSLETTER_SUBSCRIBER,
//     source: site_newsletter, tags_v2: [newsletter, <streams>]}.
//   - Existing   → only merges the newsletter tags into tags_v2;
//     never touches type/stage/notes of a real client record.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.NEWSLETTER_PROXY_SECRET;
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { email?: string; streams?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 320) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const streams = (Array.isArray(body.streams) ? body.streams : [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => ["bridge", "wake", "compass", "greece"].includes(s));

  const newTags = ["newsletter", ...streams.map((s) => `newsletter:${s}`)];
  const sb = createServiceClient();

  const { data: existing, error: findErr } = await sb
    .from("contacts")
    .select("id, tags_v2")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 });
  }

  if (existing) {
    const tags: string[] = Array.isArray(existing.tags_v2)
      ? existing.tags_v2
      : [];
    const merged = [...new Set([...tags, ...newTags])];
    if (merged.length !== tags.length) {
      const { error } = await sb
        .from("contacts")
        .update({ tags_v2: merged, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, action: "updated", id: existing.id });
  }

  // contact_type is CHECK-constrained in the live DB (see
  // contact-type-migration.sql) — NEWSLETTER_SUBSCRIBER is not an
  // allowed value and DDL cannot run from here. Mapping per George
  // (2026-07-15): bridge = the client journal, so subscribers land in
  // the client category; wake = trade advisors, so INDUSTRY. The
  // newsletter tags carry the distinction for filtering, and the only
  // mass automation on DIRECT_CLIENT (after-sales seasonal nudges)
  // also requires charter_end_date, which subscribers never have.
  const contactType = streams.includes("wake") && !streams.includes("bridge")
    ? "INDUSTRY"
    : "DIRECT_CLIENT";

  const { data: created, error: insErr } = await sb
    .from("contacts")
    .insert({
      email,
      contact_type: contactType,
      // "source" is also CHECK-constrained live (contacts_source_check);
      // site_newsletter is rejected, website_lead is the allowed value
      // that fits. The tags carry the newsletter provenance.
      source: "website_lead",
      tags_v2: newTags,
      notes: "Signed up via the georgeyachts.com Journal form.",
    })
    .select("id")
    .single();
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: "created", id: created.id });
}
