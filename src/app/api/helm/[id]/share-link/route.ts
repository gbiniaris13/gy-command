// POST /api/helm/:id/share-link — a time-limited link to the proposal PDF plus
// a ready-to-send WhatsApp message, for sharing by WhatsApp or manually.
// Admin-gated. White-label aware:
//   • direct_client → George-voice message to the client
//   • travel_agent  → B2B note (George → the agent) pointing at the
//     white-labeled PDF the agent forwards to their own client.
// The PDF itself is already white-labeled for travel_agent (unchanged), and the
// signed URL filename is the neutral request id — no George identity leaks.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@/lib/helm-admin";
import { proposalToken } from "@/lib/helm/proposal-token";

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

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (!r.proposal_pdf_path) {
    return NextResponse.json({ error: "Generate the proposal PDF first." }, { status: 400 });
  }

  try {
    // Tracked redirect link (/p/<token>) instead of the raw signed URL,
    // so we can record a real "open" when the client follows it. The
    // PDF is freshly signed at click time inside that route.
    const origin =
      new URL(req.url).origin ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://command.georgeyachts.com";
    const url = `${origin}/p/${proposalToken(id)}`;
    const isAgent = r.request_type === "travel_agent";
    const title = String(r.client_title || "").trim();
    const surname = String(r.client_surname || "").trim();

    let message: string;
    if (isAgent) {
      // George → agent (B2B). The linked PDF is white-labeled; the agent
      // forwards it as their own to their client.
      message = `Hello — here is the white-label charter proposal you can forward to your client exactly as is:\n${url}`;
    } else {
      const who = surname ? `${title ? title + " " : ""}${surname}` : "there";
      message = `Dear ${who},\n\nHere is your Greek charter proposal:\n${url}\n\nWarmly,\nGeorge`;
    }

    const whatsapp = String(r.client_whatsapp || "").replace(/\D/g, "");
    return NextResponse.json({ ok: true, url, message, whatsapp });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
