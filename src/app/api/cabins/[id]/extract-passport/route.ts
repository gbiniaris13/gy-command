// gy-command — proxy: forward a passport PDF (or image) to the
// public-site extract-passport endpoint. The upstream call
// extracts identity fields, upserts the principal's manifest row,
// patches cabins.principal_charterer_name with the signature
// display name, and enrols / refreshes the principal in the
// Filotimo Circle.
//
// George's brief: passport = source of truth for the customer-
// facing name. Back-office keeps the full bundle (DOB, passport
// number, expiry, nationality) for marina paperwork.

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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
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
  if (!file || typeof file === "string" || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "no-file" }, { status: 400 });
  }
  if ((file as File).size > MAX_BYTES) {
    return NextResponse.json({ error: "file-too-large-10mb-max" }, { status: 413 });
  }
  const guestOrder = String(form.get("guest_order") || "1");

  const upstreamForm = new FormData();
  upstreamForm.append("file", file as File);
  upstreamForm.append("cabin_id", id);
  upstreamForm.append("guest_order", guestOrder);

  const r = await fetch(`${publicHost}/api/cabin/admin/extract-passport`, {
    method: "POST",
    headers: { "x-cabin-admin-secret": secret },
    body: upstreamForm,
  });
  const json = await r.json().catch(() => ({ error: "upstream-bad-json" }));
  return NextResponse.json(json, { status: r.ok ? 200 : r.status });
}
