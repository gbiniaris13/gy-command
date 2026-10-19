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

const EDITION_SEP = /\n?----- EDITION No\. \d+ [^\n]*-----\n?/g;

/** The supplier text that belongs to the NEXT edition: imported Gmail blocks
 *  after the last EDITION separator, plus any block dated after the previous
 *  edition was sent (or generated). Pasted text after the separator counts too. */
function importedSince(raw: string, ex: Record<string, unknown>, generatedAt: string | null): string {
  if (!raw.trim()) return "";
  const seps = [...raw.matchAll(EDITION_SEP)];
  const lastSep = seps.length ? seps[seps.length - 1] : null;
  const tail = lastSep ? raw.slice((lastSep.index ?? 0) + lastSep[0].length) : "";
  const pipeline = (ex.pipeline && typeof ex.pipeline === "object") ? (ex.pipeline as { sent_at?: unknown }) : {};
  const baseIso = typeof pipeline.sent_at === "string" ? pipeline.sent_at : generatedAt;
  const base = baseIso ? Date.parse(baseIso) : NaN;
  const head = lastSep ? raw.slice(0, lastSep.index ?? 0) : raw;
  const parts: string[] = [];
  const seen = new Set<string>();
  const pushBlock = (b: string) => { const t = b.trim(); if (t && !seen.has(t)) { seen.add(t); parts.push(t); } };
  // Blocks before the last separator: only those dated after the previous edition.
  if (Number.isFinite(base)) {
    for (const b of head.split(/(?=───── EMAIL \[gmail:)/)) {
      if (!b.startsWith("───── EMAIL [gmail:")) continue;
      const m = b.match(/^Date:\s*(.+)$/m);
      const d = m ? Date.parse(m[1].trim()) : NaN;
      if (Number.isFinite(d) && d > base) pushBlock(b);
    }
  }
  // Everything after the last separator belongs to this edition.
  const tailClean = tail.replace(/^\(edition No\. \d+ extracted from the emails imported above\)\s*/m, "");
  for (const b of tailClean.split(/(?=───── EMAIL \[gmail:)/)) pushBlock(b);
  return parts.join("\n\n").trim();
}

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
  const keep = body?.keep === true;
  const useImported = body?.useImported === true;
  const ex0 = (r.extraction && typeof r.extraction === "object") ? (r.extraction as Record<string, unknown>) : {};
  // "From the emails I imported" (George, 19 October 2026: he wants the same
  // flow as the first edition, Import from Gmail and extract, not a paste).
  // The new edition's text = the Gmail blocks that arrived AFTER the previous
  // edition: everything past the last EDITION separator, plus any imported
  // email dated after that edition went out (or was generated).
  const text = useImported ? importedSince(String(r.supplier_raw || ""), ex0, r.proposal_generated_at ?? null) : (body?.text ?? "").toString().trim();
  if (!text) {
    return NextResponse.json({
      error: useImported
        ? "No supplier emails imported after the previous edition. Import the new emails from Gmail first (the box above), then press again."
        : "Paste the new supplier's email first.",
    }, { status: 400 });
  }

  try {
    const rr = r as unknown as { dates_from?: string | null; dates_to?: string | null; area?: string | null };
    const result = await extractSupplierYachts(text, r.brief || undefined, { dates_from: rr.dates_from ?? null, dates_to: rr.dates_to ?? null, area: rr.area ?? null });
    const added = (await applyDossiers({ yachts: result.yachts })).yachts;
    if (!added.length) {
      return NextResponse.json({ error: "No yachts found in the pasted text. Check it and try again." }, { status: 400 });
    }

    const ex = ex0;
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
    // A fresh edition also drops the saved review draft's yacht rows: they
    // describe the OLD cards, and a draft with the same count as the new
    // extraction would have been restored over the new yachts. The itinerary
    // pages, cover line and video on the draft stay.
    const draft = (r.review_draft && typeof r.review_draft === "object") ? (r.review_draft as Record<string, unknown>) : null;
    const { yachts: _oldDraftYachts, ...draftRest } = draft || {};
    void _oldDraftYachts;
    await db
      .from("helm_requests")
      .update({
        // When the text came from imported emails it is already on the record:
        // only the separator is added, so a re-extract knows where this edition starts.
        supplier_raw: useImported ? `${r.supplier_raw || ""}${sep}(edition No. ${nextNo} extracted from the emails imported above)` : (r.supplier_raw ? `${r.supplier_raw}${sep}${text}` : text),
        ...(keep ? {} : { combined_media: {}, review_draft: draft ? draftRest : null }),
        updated_at: nowIso,
      })
      .eq("id", id);

    return NextResponse.json({ ok: true, edition_no: nextNo, added: added.length, total: extraction.yachts.length, keep });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
