// gy-command — proxy: forward a MYBA contract PDF to the public-
// site preview-extraction endpoint and return the parsed JSON to
// the dashboard. No cabin_id is involved — this runs BEFORE a
// cabin exists, as part of the new-cabin extract-first flow.
//
// The public-site endpoint does the Gemini call + JSON parse and
// crucially does NOT persist anything. We pass the result through
// untouched so the CRM /dashboard/cabins/new form can pre-fill.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function POST(req: Request) {
  const me = await adminEmail();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
  const file = form.get("file");
  if (!file || typeof file === "string" || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 });
  }
  if ((file as File).size > MAX_BYTES) {
    return NextResponse.json(
      { error: "pdf-too-large-10mb-max" },
      { status: 413 },
    );
  }

  // Rebuild the multipart payload for the upstream call. fetch
  // needs a fresh FormData; we can't forward the parsed one.
  const upstreamForm = new FormData();
  upstreamForm.append("file", file as File);

  const r = await fetch(`${publicHost}/api/cabin/admin/extract-myba-preview`, {
    method: "POST",
    headers: { "x-cabin-admin-secret": secret },
    body: upstreamForm,
  });

  const json = await r.json().catch(() => ({ error: "upstream-bad-json" }));
  return NextResponse.json(json, { status: r.ok ? 200 : r.status });
}
