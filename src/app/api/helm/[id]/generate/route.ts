// POST /api/helm/:id/generate — called only AFTER George confirms the
// numbers on the review screen. Deterministic compute -> AI compose copy
// -> build proposal_json -> render PDF -> upload to Supabase Storage ->
// draft the email. Server-side STOP guard (defense in depth): refuses to
// generate if no charter fee and no "plus extras" was confirmed.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveGenerated } from "@/lib/helm-admin";
import { computePricing, type PricingInput } from "@/lib/helm/pricing";
import { composeSingleNarrative, composeEmail } from "@/lib/helm/compose";
import { buildSingleProposal, formalAddress } from "@/lib/helm/build";
import { buildProposalHtml, type SingleYacht } from "@/lib/helm/proposal-template";
import { renderProposalPdf } from "@/lib/helm/render";
import { uploadProposalPdf } from "@/lib/helm/storage";

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

type RequestRow = {
  client_title?: string | null;
  client_surname?: string | null;
  client_is_family?: boolean | null;
  brief?: string | null;
  occasion?: string | null;
  area?: string | null;
  party_size?: string | null;
  dates_from?: string | null;
  no_myba?: boolean | null;
  show_ghost_credit?: boolean | null;
  mode?: string | null;
};

function buildPeriodLine(r: RequestRow): string {
  const seg: string[] = [];
  if (r.dates_from) {
    const d = new Date(r.dates_from + "T00:00:00Z");
    if (!Number.isNaN(d.getTime())) {
      seg.push(d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase());
    }
  }
  if (r.area) seg.push(String(r.area).toUpperCase());
  if (r.party_size) seg.push(String(r.party_size).toUpperCase());
  return seg.join(" · ");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = (await getRequest(id)) as RequestRow | null;
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  const mode = body.mode || r.mode || "single";
  if (mode !== "single") {
    return NextResponse.json(
      { error: "Combined multi-yacht auto-generate is the next step. Use single mode for now (the combined template is ready)." },
      { status: 400 },
    );
  }

  // FORMAL ADDRESSING — never a bare first name. No surname => stop and ask.
  const addr = formalAddress({ title: r.client_title, surname: r.client_surname, isFamily: r.client_is_family });
  if (!addr.salutation) {
    return NextResponse.json(
      { error: "Client surname is required for formal addressing. Add a title + surname on the request first." },
      { status: 400 },
    );
  }

  // CONFIRMED pricing (from the review screen). No math is trusted from the
  // AI; compute_pricing runs here on the human-confirmed numbers.
  const p = body.pricing || {};
  const pricing: PricingInput = {
    currency: p.currency || "EUR",
    charter_fee: p.charter_fee ?? null,
    apa_pct: p.apa_pct ?? null,
    apa_amount: p.apa_amount ?? null,
    vat_pct: p.vat_pct ?? null,
    vat_amount: p.vat_amount ?? null,
    extras_text: p.extras_text || null,
    details: Array.isArray(body.details) ? body.details : [],
  };

  // SERVER-SIDE STOP GUARD (defense in depth behind the UI's disabled button).
  if ((pricing.charter_fee === null || pricing.charter_fee === undefined) && !pricing.extras_text) {
    return NextResponse.json(
      { error: "Unresolved pricing: confirm a charter fee, or mark 'plus extras'. Nothing was generated." },
      { status: 400 },
    );
  }

  try {
    const v = body.vessel || {};
    const content = body.content || {};

    // Confidentiality-safe facts for the AI: ONLY the extracted content +
    // spec line, never the raw broker email.
    const supplierFacts = [
      v.spec_line ? `Spec: ${v.spec_line}` : "",
      content.crew_line ? `Crew: ${content.crew_line}` : "",
      content.highlights?.length ? `Highlights: ${content.highlights.join("; ")}` : "",
      content.water_toys?.length ? `Water toys: ${content.water_toys.join("; ")}` : "",
      content.tech_specs?.length ? `Specs: ${content.tech_specs.map((s: [string, string]) => `${s[0]} ${s[1]}`).join("; ")}` : "",
      content.accommodation?.length ? `Accommodation: ${content.accommodation.map((a: [string, string]) => `${a[0]} (${a[1]})`).join("; ")}` : "",
    ].filter(Boolean).join("\n") || (v.name ? `${v.name}${v.type ? ` ${v.type}` : ""}` : "the yacht");

    const narr = await composeSingleNarrative({
      vessel_name: v.name || "the yacht",
      vessel_type: v.type,
      spec_line: v.spec_line,
      supplier_facts: supplierFacts,
      brief: r.brief || undefined,
      occasion: r.occasion || undefined,
    });

    const yacht: SingleYacht = {
      name: v.name || "Yacht",
      type: v.type || undefined,
      spec_line: v.spec_line || undefined,
      period_line: v.period_line || buildPeriodLine(r),
      price_sub: v.price_sub || undefined,
      experience_title: narr.experience_title,
      experience_paras: narr.experience_paras,
      highlights: Array.isArray(content.highlights) ? content.highlights : [],
      accommodation: Array.isArray(content.accommodation) ? content.accommodation : [],
      crew_line: content.crew_line || undefined,
      water_toys: Array.isArray(content.water_toys) ? content.water_toys : [],
      tech_specs: Array.isArray(content.tech_specs) ? content.tech_specs : [],
      pricing,
      gallery_slots: typeof v.gallery_slots === "number" ? v.gallery_slots : 4,
      links: v.links && Object.keys(v.links).length ? v.links : undefined,
      images: {},
    };
    const proposal = buildSingleProposal(yacht, {
      no_myba: !!r.no_myba,
      show_ghost_credit: r.show_ghost_credit !== false,
    });

    const pr = computePricing(pricing);
    const email_draft = await composeEmail({
      salutation: addr.salutation,
      occasion: r.occasion || undefined,
      brief: r.brief || undefined,
      selection_summary: `${yacht.name}${v.spec_line ? ` - ${v.spec_line}` : ""} - ${pr.headline}${pricing.extras_text ? "" : " plus APA and VAT"}`,
    });

    const pdf = await renderProposalPdf(buildProposalHtml(proposal));
    const path = await uploadProposalPdf(id, pdf);

    await saveGenerated(id, {
      proposal_json: proposal,
      proposal_pdf_path: path,
      email_subject: email_draft.subject,
      email_intro: email_draft.body,
      mode: "single",
      client_name: addr.coverName,
    });

    return NextResponse.json({
      ok: true,
      proposal_pdf_path: path,
      email_subject: email_draft.subject,
      email_intro: email_draft.body,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
