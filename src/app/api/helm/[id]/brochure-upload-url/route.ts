// POST /api/helm/:id/brochure-upload-url — admin-gated. Mints a one-time signed
// UPLOAD URL so the BROWSER can put a large brochure PDF straight into our
// Supabase storage, bypassing Vercel's ~4.5MB serverless request-body cap.
// The client then calls upload-media { action: "finalize-brochure", path } to
// mint the long-lived signed download URL and save it on the request.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createBrochureUploadUrl, PROPOSALS_BUCKET } from "@/lib/helm/storage";

export const runtime = "nodejs";

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !body.filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }
  try {
    const { path, token } = await createBrochureUploadUrl(id, String(body.filename));
    return NextResponse.json({ ok: true, path, token, bucket: PROPOSALS_BUCKET });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
