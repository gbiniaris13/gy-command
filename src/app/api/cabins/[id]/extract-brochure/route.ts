// gy-command — proxy: forward a PDF + kind to the public-site
// admin extract-brochure endpoint, which routes through the
// capped Anthropic wrapper and persists the structured JSON.
//
// We pre-buffer the upload here so we can sign it with the
// CABIN_ADMIN_SECRET header. PDFs over 10MB are rejected
// up-front to avoid wasting an Anthropic call.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const maxDuration = 60;

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

// 2026-05-20 — Added "contract" kind for MYBA charter agreement
// extraction. The public-site endpoint writes the safe half to
// flat columns on `cabins` and the internal half (owner,
// stakeholder, fees, payment schedule, bank) to the
// contract_internal JSONB. Client-facing pages never read the
// internal column. See public-site
// /api/cabin/admin/extract-brochure for the prompt + persistence.
const ALLOWED_KINDS = new Set(["crew", "menu", "vessel", "contract"]);
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
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
  const kind = String(form.get("kind") || "");
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "kind-must-be-crew-menu-vessel-or-contract" }, { status: 400 });
  }
  if (!file || typeof file === "string" || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 });
  }
  if ((file as File).size > MAX_BYTES) {
    return NextResponse.json({ error: "pdf-too-large-10mb-max" }, { status: 413 });
  }

  // Rebuild the multipart payload for the upstream call. We can't
  // forward the parsed FormData directly — fetch needs a fresh
  // FormData with the same fields.
  const upstreamForm = new FormData();
  upstreamForm.append("file", file as File);
  upstreamForm.append("kind", kind);
  upstreamForm.append("cabin_id", id);

  const r = await fetch(`${publicHost}/api/cabin/admin/extract-brochure`, {
    method: "POST",
    headers: { "x-cabin-admin-secret": secret },
    body: upstreamForm,
  });

  // Capture upstream JSON and return as-is so the dashboard can
  // surface the same error codes (ai-cap-or-disabled etc.).
  const json = await r.json().catch(() => ({ error: "upstream-bad-json" }));
  return NextResponse.json(json, { status: r.ok ? 200 : r.status });
}
