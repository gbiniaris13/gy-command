// GET /p/<ref>/cover — the edition's cover photograph, served from our own
// address so a WhatsApp or iMessage preview of the link never points at a
// third-party photo host (house rule: no partner name anywhere a client looks).
// Resolves the first yacht's main image and streams it through, cached a day.

import { NextRequest, NextResponse } from "next/server";
import { resolveEditionRef } from "@/lib/helm/edition-link";
import { salonData, mediaFor } from "@/lib/helm/salon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK = "https://georgeyachts.com/opengraph-image";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const id = await resolveEditionRef(token || "");
  let src = FALLBACK;
  try {
    if (id) {
      const model = await salonData(id);
      const first = model ? (model.proposal.yachts ?? [])[0] : null;
      const main = model && first ? mediaFor(model, first).main : null;
      if (main && /^https?:\/\//.test(main)) src = main;
    }
  } catch {
    src = FALLBACK;
  }
  try {
    const up = await fetch(src, { headers: { accept: "image/*" }, cache: "no-store" });
    if (!up.ok || !up.body) throw new Error(String(up.status));
    const type = up.headers.get("content-type") || "image/jpeg";
    return new NextResponse(up.body, {
      status: 200,
      headers: {
        "content-type": type.startsWith("image/") ? type : "image/jpeg",
        "cache-control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch {
    return NextResponse.redirect(FALLBACK, 302);
  }
}
