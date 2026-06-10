// POST /api/helm/:id/booking — { action: "generate", chosen_yacht } -> drafts the
// two WON next-step emails: (1) the MYBA contract request to the central agency,
// (2) a short confirmation to the client/agent. Returns drafts only (the UI shows
// them with Copy); George reviews and sends. No send here.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@/lib/helm-admin";
import { helmSalutation } from "@/lib/helm/addressing";
import { composeBookingNextSteps } from "@/lib/helm/compose";

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

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const chosen = (body?.chosen_yacht ?? "").toString().trim();
  if (!chosen) return NextResponse.json({ error: "Which yacht did they choose? Add it first." }, { status: 400 });

  const from = fmtDate(r.dates_from);
  const to = fmtDate(r.dates_to);
  const dates = from && to ? `${from} - ${to}` : from || to || undefined;
  const { salutation, isAgent } = helmSalutation(r);

  try {
    const draft = await composeBookingNextSteps({
      chosen_yacht: chosen,
      dates,
      agent: isAgent,
      confirm_salutation: salutation,
    });
    return NextResponse.json({ ok: true, agency_request: draft.agency_request, confirmation: draft.confirmation });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
