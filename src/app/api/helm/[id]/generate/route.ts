// POST /api/helm/:id/generate — called only AFTER George confirms the
// numbers on the review screen. Deterministic compute -> AI compose copy
// -> build proposal_json -> render PDF -> upload to Supabase Storage ->
// draft the email. Server-side STOP guard (defense in depth): refuses to
// generate if no charter fee and no "plus extras" was confirmed.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest, saveGenerated } from "@/lib/helm-admin";
import { computePricing, allInNumber, type PricingInput } from "@/lib/helm/pricing";
import { composeSingleNarrative, composeEmail, composeYachtInsideInfo, composeCombinedIntro } from "@/lib/helm/compose";
import { buildSingleProposal, buildCombinedProposal, formalAddress } from "@/lib/helm/build";
import { buildProposalHtml, type SingleYacht, type CombinedYacht } from "@/lib/helm/proposal-template";
import { renderProposalPdf } from "@/lib/helm/render";
import { uploadProposalPdf } from "@/lib/helm/storage";
import { optimizedUrl } from "@/lib/helm/cloudinary";
import { assertWhiteLabelClean } from "@/lib/helm/whitelabel";

export const runtime = "nodejs";
// Combined mode composes copy for N yachts + the intro letter before rendering,
// so allow more headroom than a single proposal.
export const maxDuration = 120;

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
  request_type?: string | null;
  vessel_photos?: { url?: string; source?: string }[] | null;
  brochure_url?: string | null;
  combined_media?: Record<string, { main_url?: string | null; brochure_url?: string | null }> | null;
};

// One yacht as posted by the combined review UI (confirmed numbers + facts).
type CombinedInputYacht = {
  vessel?: { name?: string; type?: string; spec_line?: string; embarkation?: string; disembarkation?: string; date_from?: string; date_to?: string };
  pricing?: {
    mode?: PricingInput["mode"];
    currency?: string;
    charter_fee?: number | null;
    apa_pct?: number | null;
    apa_amount?: number | null;
    vat_pct?: number | null;
    vat_amount?: number | null;
    extras_text?: string | null;
    all_inclusive_total?: number | null;
    discount_pct?: number | null;
    relocation_fee?: number | null;
    relocation_note?: string | null;
    all_in_override?: number | null;
  };
  content?: {
    highlights?: string[];
    accommodation?: [string, string][];
    water_toys?: string[];
    tech_specs?: [string, string][];
    crew_line?: string;
  };
};

// Assemble the per-yacht voyage line for the proposal: embark/disembark ports +
// charter dates, e.g. "Athens -> Mykonos · 25 June - 3 July". undefined when
// nothing is set (so the line is omitted and existing proposals are unchanged).
function voyageLine(embark?: string, disembark?: string, from?: string, to?: string): string | undefined {
  const em = (embark || "").trim(), di = (disembark || "").trim();
  const fr = (from || "").trim(), t2 = (to || "").trim();
  const parts: string[] = [];
  if (em || di) parts.push(`${em || "?"} → ${di || "?"}`);
  if (fr || t2) parts.push([fr, t2].filter(Boolean).join(" - "));
  return parts.length ? parts.join(" · ") : undefined;
}

// Build just the month/year for the combined cover "period" line (area + guests
// are shown separately on that template).
function monthYearLine(r: RequestRow): string {
  if (!r.dates_from) return "";
  const d = new Date(r.dates_from + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

// Fetch a (Cloudinary-optimized) image URL and inline it as a base64 data
// URI so the PDF render is self-contained + reliable (no network at render).
async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

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

  // Travel-agent white-label: the attached PDF must carry NO George Yachts
  // identity (anonymous PDF copy + neutral footer + a hard deny-list guard
  // before finalizing). The agent email itself stays George-voice (B2B).
  const whiteLabel = r.request_type === "travel_agent";

  // FORMAL ADDRESSING — never a bare first name. No surname => stop and ask.
  const addr = formalAddress({ title: r.client_title, surname: r.client_surname, isFamily: r.client_is_family });
  if (!addr.salutation) {
    return NextResponse.json(
      { error: "Client surname is required for formal addressing. Add a title + surname on the request first." },
      { status: 400 },
    );
  }

  // ============================================================
  // COMBINED MULTI-YACHT — one proposal, N yachts, sorted cheapest -> priciest
  // by deterministic all-in. Each yacht's pricing is computed in code (never
  // the AI); a per-yacht server guard rejects a missing/<=0 required figure.
  // ============================================================
  if (mode === "combined") {
    const inYachts: CombinedInputYacht[] = Array.isArray(body.yachts) ? body.yachts : [];
    if (!inYachts.length) {
      return NextResponse.json({ error: "No yachts to generate. Extract the supplier email first." }, { status: 400 });
    }

    // SERVER-SIDE STOP GUARD per yacht (defense in depth behind the UI gate).
    for (let i = 0; i < inYachts.length; i++) {
      const p = inYachts[i]?.pricing || {};
      const pm = p.mode || (p.all_inclusive_total != null ? "all_inclusive" : p.extras_text ? "plus_extras" : "breakdown");
      const label = inYachts[i]?.vessel?.name ? `"${inYachts[i].vessel!.name}"` : `#${i + 1}`;
      if (pm === "all_inclusive") {
        if (p.all_inclusive_total == null || Number(p.all_inclusive_total) <= 0) {
          return NextResponse.json({ error: `Yacht ${label}: confirm an all-inclusive total greater than 0. Nothing was generated.` }, { status: 400 });
        }
      } else if ((p.charter_fee === null || p.charter_fee === undefined) && !p.extras_text) {
        return NextResponse.json({ error: `Yacht ${label}: confirm a charter fee, or mark 'plus extras'. Nothing was generated.` }, { status: 400 });
      }
    }

    try {
      const combinedMedia = (r.combined_media && typeof r.combined_media === "object") ? r.combined_media : {};

      // Build each yacht (compute pricing + compose copy + embed its photo) in
      // parallel, then sort. allInNumber is the deterministic sort key.
      const built = await Promise.all(inYachts.map(async (iy, i) => {
        const v = iy.vessel || {};
        const content = iy.content || {};
        const pricing: PricingInput = {
          currency: iy.pricing?.currency || "EUR",
          mode: iy.pricing?.mode || undefined,
          charter_fee: iy.pricing?.charter_fee ?? null,
          apa_pct: iy.pricing?.apa_pct ?? null,
          apa_amount: iy.pricing?.apa_amount ?? null,
          vat_pct: iy.pricing?.vat_pct ?? null,
          vat_amount: iy.pricing?.vat_amount ?? null,
          extras_text: iy.pricing?.extras_text || null,
          all_inclusive_total: iy.pricing?.all_inclusive_total ?? null,
          discount_pct: iy.pricing?.discount_pct ?? null,
          relocation_fee: iy.pricing?.relocation_fee ?? null,
          relocation_note: iy.pricing?.relocation_note ?? null,
          all_in_override: iy.pricing?.all_in_override ?? null,
        };

        const supplierFacts = [
          v.spec_line ? `Spec: ${v.spec_line}` : "",
          content.crew_line ? `Crew: ${content.crew_line}` : "",
          content.highlights?.length ? `Highlights: ${content.highlights.join("; ")}` : "",
          content.water_toys?.length ? `Water toys: ${content.water_toys.join("; ")}` : "",
          content.tech_specs?.length ? `Specs: ${content.tech_specs.map((s) => `${s[0]} ${s[1]}`).join("; ")}` : "",
          content.accommodation?.length ? `Accommodation: ${content.accommodation.map((a) => `${a[0]} (${a[1]})`).join("; ")}` : "",
        ].filter(Boolean).join("\n") || (v.name ? `${v.name}${v.type ? ` ${v.type}` : ""}` : "the yacht");

        const info = await composeYachtInsideInfo({
          vessel_name: v.name || "the yacht",
          vessel_type: v.type,
          spec_line: v.spec_line,
          supplier_facts: supplierFacts,
          brief: r.brief || undefined,
          occasion: r.occasion || undefined,
          anonymous: whiteLabel,
        });

        // per-yacht media (confidentiality: agency-domain brochure links withheld)
        const media = combinedMedia[String(i)] || {};
        const mainImg = media.main_url ? await toDataUri(optimizedUrl(media.main_url)) : null;
        const links: Record<string, string> = {};
        // Operator-vetted: include the brochure link as provided (George confirms white-label).
        if (media.brochure_url) links.brochure = media.brochure_url;

        const specStrip = (Array.isArray(content.tech_specs) ? content.tech_specs : []).slice(0, 3) as [string, string][];
        const yacht: CombinedYacht = {
          name: v.name || "Yacht",
          type: v.type || undefined,
          spec_line: v.spec_line || undefined,
          voyage_line: voyageLine(v.embarkation, v.disembarkation, v.date_from, v.date_to),
          spec_strip: specStrip.length ? specStrip : undefined,
          description: info.description,
          inside_info: info.inside_info,
          pricing,
          links: Object.keys(links).length ? links : undefined,
          images: mainImg ? { main: mainImg } : {},
        };
        const ain = allInNumber(pricing);
        const sortKey = ain ?? (pricing.charter_fee != null ? Number(pricing.charter_fee) : Number.POSITIVE_INFINITY);
        return { yacht, sortKey };
      }));

      built.sort((a, b) => a.sortKey - b.sortKey);
      const sorted = built.map((b) => b.yacht);
      // tier labels at the ends (only when there is a genuine spread)
      if (sorted.length >= 2) {
        sorted[0].tier_label = "The Considered Value";
        sorted[sorted.length - 1].tier_label = "The Statement";
      }

      // cover image = the cheapest yacht's photo if any has one
      const images: Record<string, string | null> = {};
      const withPhoto = sorted.find((y) => y.images?.main);
      if (withPhoto?.images?.main) images.cover = withPhoto.images.main as string;

      const summary = sorted.map((y) => {
        const pr = computePricing(y.pricing);
        return `${y.name}${y.spec_line ? ` - ${y.spec_line}` : ""} - ${pr.headline}${pr.all_inclusive ? " all-inclusive (APA, VAT and extras included)" : pr.extras_mode ? "" : " plus APA and VAT"}`;
      }).join("\n");

      const [intro, email_draft] = await Promise.all([
        // PDF intro is anonymous for white-label; the email stays George-voice.
        composeCombinedIntro({ salutation: addr.salutation, occasion: r.occasion || undefined, brief: r.brief || undefined, yacht_summary: summary, anonymous: whiteLabel }),
        composeEmail({ salutation: addr.salutation, occasion: r.occasion || undefined, brief: r.brief || undefined, selection_summary: summary }),
      ]);

      const proposal = buildCombinedProposal(
        {
          // White-label cover carries no client/agent name (the agent presents it).
          coverName: whiteLabel ? null : addr.coverName,
          period: monthYearLine(r),
          guests: r.party_size || undefined,
          area: r.area || undefined,
          intro_letter: intro,
          images,
        },
        sorted,
        { no_myba: !!r.no_myba, show_ghost_credit: r.show_ghost_credit !== false, white_label: whiteLabel },
      );

      const html = buildProposalHtml(proposal);
      // HARD WHITE-LABEL GUARD — abort if any George Yachts token survives.
      if (whiteLabel) assertWhiteLabelClean({ html, title: "Charter Proposal", filename: "Charter_Proposal.pdf" });
      const pdf = await renderProposalPdf(html);
      const path = await uploadProposalPdf(id, pdf);
      await saveGenerated(id, {
        proposal_json: proposal,
        proposal_pdf_path: path,
        email_subject: email_draft.subject,
        email_intro: email_draft.body,
        mode: "combined",
        client_name: addr.coverName,
      });
      return NextResponse.json({ ok: true, proposal_pdf_path: path, email_subject: email_draft.subject, email_intro: email_draft.body, yachts: sorted.length });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // CONFIRMED pricing (from the review screen). No math is trusted from the
  // AI; compute_pricing runs here on the human-confirmed numbers.
  const p = body.pricing || {};
  const pricing: PricingInput = {
    currency: p.currency || "EUR",
    mode: p.mode || undefined,
    charter_fee: p.charter_fee ?? null,
    apa_pct: p.apa_pct ?? null,
    apa_amount: p.apa_amount ?? null,
    vat_pct: p.vat_pct ?? null,
    vat_amount: p.vat_amount ?? null,
    extras_text: p.extras_text || null,
    all_inclusive_total: p.all_inclusive_total ?? null,
    discount_pct: p.discount_pct ?? null,
    relocation_fee: p.relocation_fee ?? null,
    relocation_note: p.relocation_note ?? null,
    all_in_override: p.all_in_override ?? null,
    details: Array.isArray(body.details) ? body.details : [],
  };

  // SERVER-SIDE STOP GUARD (defense in depth behind the UI's disabled button).
  const pricingMode = pricing.mode
    || (pricing.all_inclusive_total != null ? "all_inclusive" : pricing.extras_text ? "plus_extras" : "breakdown");
  if (pricingMode === "all_inclusive") {
    if (pricing.all_inclusive_total == null || Number(pricing.all_inclusive_total) <= 0) {
      return NextResponse.json(
        { error: "Unresolved pricing: confirm an all-inclusive total greater than 0. Nothing was generated." },
        { status: 400 },
      );
    }
  } else if ((pricing.charter_fee === null || pricing.charter_fee === undefined) && !pricing.extras_text) {
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
      anonymous: whiteLabel,
    });

    // ---- media: base64-embed web-optimized vessel photos into the PDF; add a
    // brochure button (agency-domain brochure links are WITHHELD — confidentiality).
    const photoUrls = (Array.isArray(r.vessel_photos) ? r.vessel_photos : [])
      .map((p) => p?.url)
      .filter((u): u is string => !!u);
    const dataUris = await Promise.all(photoUrls.map((u) => toDataUri(optimizedUrl(u))));
    const imgs = dataUris.filter((d): d is string => !!d);
    const mediaImages: Record<string, string | null> = {};
    const SLOTS = ["cover", "experience", "interior1", "interior2", "exterior", "closing"];
    imgs.slice(0, 6).forEach((d, i) => { mediaImages[SLOTS[i]] = d; });
    const galleryImgs = imgs.slice(6);
    const mediaLinks: Record<string, string> = { ...(v.links || {}) };
    // Operator-vetted: include the brochure link as provided (George confirms white-label).
    if (r.brochure_url) mediaLinks.brochure = r.brochure_url;

    const yacht: SingleYacht = {
      name: v.name || "Yacht",
      type: v.type || undefined,
      spec_line: v.spec_line || undefined,
      period_line: v.period_line || buildPeriodLine(r),
      voyage_line: voyageLine(v.embarkation, v.disembarkation, v.date_from, v.date_to),
      price_sub: v.price_sub || undefined,
      experience_title: narr.experience_title,
      experience_paras: narr.experience_paras,
      highlights: Array.isArray(content.highlights) ? content.highlights : [],
      accommodation: Array.isArray(content.accommodation) ? content.accommodation : [],
      crew_line: content.crew_line || undefined,
      water_toys: Array.isArray(content.water_toys) ? content.water_toys : [],
      tech_specs: Array.isArray(content.tech_specs) ? content.tech_specs : [],
      pricing,
      gallery: galleryImgs.length ? galleryImgs : undefined,
      gallery_slots: imgs.length === 0 ? 4 : undefined,
      links: Object.keys(mediaLinks).length ? mediaLinks : undefined,
      images: mediaImages,
    };
    const proposal = buildSingleProposal(yacht, {
      no_myba: !!r.no_myba,
      show_ghost_credit: r.show_ghost_credit !== false,
      white_label: whiteLabel,
    });

    const pr = computePricing(pricing);
    const email_draft = await composeEmail({
      salutation: addr.salutation,
      occasion: r.occasion || undefined,
      brief: r.brief || undefined,
      selection_summary: `${yacht.name}${v.spec_line ? ` - ${v.spec_line}` : ""} - ${pr.headline}${pr.all_inclusive ? " all-inclusive (APA, VAT and extras included)" : pricing.extras_text ? "" : " plus APA and VAT"}`,
    });

    const html = buildProposalHtml(proposal);
    // HARD WHITE-LABEL GUARD — abort if any George Yachts token survives.
    if (whiteLabel) assertWhiteLabelClean({ html, title: yacht.name, filename: "Charter_Proposal.pdf" });
    const pdf = await renderProposalPdf(html);
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
