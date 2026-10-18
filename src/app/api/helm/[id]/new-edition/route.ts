// POST /api/helm/:id/new-edition — the SECOND (third, …) edition for the
// same client, on the same card (George, 18 October 2026: "θέλω να μπορώ να
// του στείλω και ένα δεύτερο edition, updated, στην ίδια καρτέλα").
//
// The conversation moved on: the client no longer wants catamarans, or a
// different supplier answered with better boats. George pastes the new
// supplier email and chooses:
//   keep = false  → a FRESH edition: the new yachts replace the old cards
//   keep = true   → the new yachts are ADDED to the current cards
//
// Either way the edition number goes up (extraction.edition_no), the previous
// edition is remembered in extraction.edition_history (what was sent, when,
// which yachts, which PDF), the supplier text is appended to supplier_raw, and
// NOTHING else on the card moves: the client, the brief, the follow-up plan,
// the thread, the short link. The client keeps the SAME link
// (edition.georgeyachts.com/<surname>-<code>): after George reviews the numbers
// and presses Generate, that link shows the new edition, and Send goes out in
// the same Gmail thread as an update.
//
// A fresh edition also clears combined_media: the Salon photos are keyed by
// card index, and index 0 of the old edition is not index 0 of the new one.
// Generate refills them from the Fleet Book / fleet photos as usual.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { applyDossiers } from "@/lib/helm/dossier";
import { createServiceClient } from "@/lib/supabase-server";
import { extractSupplierYachts } from "@/lib/helm/extract";

export const runtime = "nodejs";
export const maxDuration = 300;

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

type YachtCard = { vessel_name?: { value?: unknown } };

function yachtNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return (list as YachtCard[])
    .map((y) => String(y?.vessel_name?.value ?? "").trim())
    .filter(Boolean);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (r.mode !== "combined") {
    return NextResponse.json({ error: "A new edition works on combined (multi-yacht) requests." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const text = (body?.text ?? "").toString().trim();
  const keep = body?.keep === true;
  if (!text) return NextResponse.json({ error: "Paste the new supplier's email first." }, { status: 400 });

  try {
    const rr = r as unknown as { dates_from?: string | null; dates_to?: string | null; area?: string | null };
    const result = await extractSupplierYachts(text, r.brief || undefined, { dates_from: rr.dates_from ?? null, dates_to: rr.dates_to ?? null, area: rr.area ?? null });
    const added = (await applyDossiers({ yachts: result.yachts })).yachts;
    if (!added.length) {
      return NextResponse.json({ error: "No yachts found in the pasted text. Check it and try again." }, { status: 400 });
    }

    const ex = (r.extraction && typeof r.extraction === "object") ? (r.extraction as Record<string, unknown>) : {};
    const existing = Array.isArray(ex.yachts) ? (ex.yachts as unknown[]) : [];
    const prevNo = Number(ex.edition_no) >= 1 ? Number(ex.edition_no) : 1;
    const nextNo = prevNo + 1;
    const pipeline = (ex.pipeline && typeof ex.pipeline === "object") ? (ex.pipeline as { sent_at?: unknown }) : {};
    const nowIso = new Date().toISOString();

    // Remember the edition we are leaving behind.
    const history = Array.isArray(ex.edition_history) ? (ex.edition_history as unknown[]) : [];
    history.push({
      no: prevNo,
      closed_at: nowIso,
      sent_at: typeof pipeline.sent_at === "string" ? pipeline.sent_at : null,
      yachts: yachtNames(existing),
      pdf_path: r.proposal_pdf_path ?? null,
      replaced: !keep,
    });

    // featured_index indexes the OLD card order; reconciliation is per paste.
    const { featured_index: _staleCover, reconciliation: _oldRecon, ...rest } = ex;
    void _staleCover; void _oldRecon;
    const extraction = {
      ...rest,
      yachts: keep ? [...existing, ...added] : added,
      edition_no: nextNo,
      edition_history: history,
      ...(result.reconciliation ? { reconciliation: result.reconciliation } : {}),
    };
    await saveExtraction(id, extraction);

    const db = createServiceClient();
    const sep = `\n\n----- EDITION No. ${nextNo} (${keep ? "added to" : "replacing"} the previous yachts, ${nowIso.slice(0, 10)}) -----\n\n`;
    await db
      .from("helm_requests")
      .update({
        supplier_raw: r.supplier_raw ? `${r.supplier_raw}${sep}${text}` : text,
        ...(keep ? {} : { combined_media: {} }),
        updated_at: nowIso,
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, edition_no: nextNo, added: added.length, total: extraction.yachts.length, keep });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
