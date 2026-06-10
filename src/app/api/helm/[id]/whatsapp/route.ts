// POST /api/helm/:id/whatsapp — { action: "generate" } -> a short WhatsApp nudge
// text (George WhatsApps the client/agent after emailing the proposal). Returns
// plain text only; the UI offers Copy + an "Open WhatsApp" wa.me link. No send.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@/lib/helm-admin";
import { agentFirstName } from "@/lib/helm/addressing";
import { composeWhatsApp } from "@/lib/helm/compose";

export const runtime = "nodejs";
export const maxDuration = 30;

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

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  try {
    const draft = await composeWhatsApp({
      firstName: agentFirstName(r),
      agent: r.request_type === "travel_agent",
      occasion: r.occasion || undefined,
    });
    return NextResponse.json({ ok: true, text: draft.text });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
