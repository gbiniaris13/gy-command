// gy-command — proxy: forward auto-extracted brochure photo
// JPEGs to the public-site upload endpoint.
//
// 2026-05-22 — George's directive: photos should come from the
// vessel brochure, not random placeholders. The CRM extracts
// page JPEGs client-side (src/lib/brochure-photos.ts) and POSTs
// them here. We stream the multipart through to the public
// site's admin endpoint, which writes the storage paths to
// cabins.vessel_photos.
//
// The CRM never sees CABIN_ADMIN_SECRET in the browser — this
// proxy adds it server-side.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Pro plan caps function bodies at ~4.5 MB. Each
// JPEG is ~400-700 KB; batching 6-8 fits comfortably. If
// George's brochures grow to need more, we can chunk later.
const MAX_BYTES = 8 * 1024 * 1024;

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const me = await adminEmail();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const publicHost = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CABIN_ADMIN_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad-multipart" }, { status: 400 });
  }

  // Rebuild the form forwarding to the upstream endpoint. We
  // copy every photo + caption + page; cabin_id we set
  // explicitly from the URL.
  const upstreamForm = new FormData();
  upstreamForm.append("cabin_id", id);
  upstreamForm.append(
    "replace_existing",
    String(form.get("replace_existing") || "true"),
  );

  const photoFiles = form.getAll("photo");
  if (photoFiles.length === 0) {
    return NextResponse.json({ error: "no-photo-fields" }, { status: 400 });
  }

  let totalBytes = 0;
  for (const f of photoFiles) {
    if (typeof f === "string" || !("arrayBuffer" in f)) continue;
    totalBytes += (f as File).size;
    upstreamForm.append("photo", f as File);
  }
  if (totalBytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "photo-batch-too-large", max_bytes: MAX_BYTES },
      { status: 413 },
    );
  }

  for (const c of form.getAll("captions[]")) {
    upstreamForm.append("captions[]", String(c));
  }
  for (const p of form.getAll("pages[]")) {
    upstreamForm.append("pages[]", String(p));
  }

  const r = await fetch(`${publicHost}/api/cabin/admin/brochure-photos`, {
    method: "POST",
    headers: { "x-cabin-admin-secret": secret },
    body: upstreamForm,
  });
  const json = await r.json().catch(() => ({ error: "upstream-bad-json" }));
  return NextResponse.json(json, { status: r.ok ? 200 : r.status });
}
