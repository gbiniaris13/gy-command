// POST /api/helm/:id/video-upload-sign — admin-gated. Mints the signed params
// for a DIRECT browser -> Cloudinary video upload (the Salon personal video).
// The file never touches our serverless functions (Vercel ~4.5MB body cap);
// the panel posts it straight to api.cloudinary.com and saves the returned
// secure_url into review_draft.salon_video.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { signVideoUpload, isCloudinaryConfigured } from "@/lib/helm/cloudinary";

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

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isCloudinaryConfigured()) {
    return NextResponse.json({ error: "Cloudinary is not configured - paste a YouTube/Loom link instead." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...signVideoUpload(`helm/${id}/video`) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
