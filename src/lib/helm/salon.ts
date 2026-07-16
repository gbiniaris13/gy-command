// The Private Salon (2026-07-16, George's GO) — the proposal as a LIVE page
// on /p/<token>, alongside the PDF. This module assembles the sanitized view
// model the page renders:
//   • text/pricing come from proposal_json (exactly what George approved),
//   • photos come from combined_media / storage URLs — NEVER the base64 data
//     URIs embedded in proposal_json (megabytes of HTML would make the page
//     slow on a phone, and a slow link undoes the whole impression),
//   • the personal video link lives in review_draft.salon_video (no schema
//     change), set from the combined panel.
// Salon is DIRECT-CLIENT ONLY: travel-agent / white-label proposals keep the
// straight PDF redirect (a George-branded page would break white-label).

import { getRequest } from "@/lib/helm-admin";
import { optimizedUrl } from "@/lib/helm/cloudinary";
import type { CombinedProposal, CombinedYacht } from "@/lib/helm/proposal-template";

export type SalonYachtMedia = { main?: string; gallery: string[]; brochure?: string };

export type SalonModel = {
  requestId: string;
  proposal: CombinedProposal;
  /** keyed by normalized yacht name */
  media: Record<string, SalonYachtMedia>;
  videoUrl: string | null;
  clientWhatsApp: string | null;
  hasPdf: boolean;
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

/** Build the Salon view model, or null when this request must NOT get a
 *  Salon (agent/white-label, single mode, or nothing generated yet). */
export async function salonData(requestId: string): Promise<SalonModel | null> {
  const r = await getRequest(requestId);
  if (!r || !r.proposal_json) return null;
  if (r.request_type === "travel_agent") return null;
  const proposal = r.proposal_json as CombinedProposal;
  if (proposal.mode !== "combined" || proposal.white_label) return null;
  if (!Array.isArray(proposal.yachts) || !proposal.yachts.length) return null;

  // name -> media URLs. combined_media is keyed by the ORIGINAL card index;
  // the card's (possibly edited) name lives in review_draft, falling back to
  // the extraction. Excluded yachts simply never match a proposal yacht.
  const media: Record<string, SalonYachtMedia> = {};
  const cm = (r.combined_media && typeof r.combined_media === "object"
    ? r.combined_media
    : {}) as Record<string, { main_url?: string; brochure_url?: string; extra_urls?: unknown }>;
  const draftYachts = Array.isArray((r.review_draft as { yachts?: unknown[] } | null)?.yachts)
    ? ((r.review_draft as { yachts: { vessel?: { name?: string } }[] }).yachts)
    : [];
  const exYachts = Array.isArray((r.extraction as { yachts?: unknown[] } | null)?.yachts)
    ? ((r.extraction as { yachts: { vessel_name?: { value?: string } }[] }).yachts)
    : [];
  const count = Math.max(draftYachts.length, exYachts.length, Object.keys(cm).length);
  for (let i = 0; i < count; i++) {
    const name = norm(draftYachts[i]?.vessel?.name || exYachts[i]?.vessel_name?.value);
    if (!name) continue;
    const m = cm[String(i)] || {};
    const gallery = (Array.isArray(m.extra_urls) ? m.extra_urls : [])
      .filter(isHttpUrl)
      .slice(0, 8)
      .map((u) => optimizedUrl(u));
    const entry: SalonYachtMedia = { gallery };
    if (isHttpUrl(m.main_url)) entry.main = optimizedUrl(m.main_url);
    if (isHttpUrl(m.brochure_url)) entry.brochure = m.brochure_url;
    media[name] = entry;
  }

  const videoUrlRaw = (r.review_draft as { salon_video?: unknown } | null)?.salon_video;
  const videoUrl = isHttpUrl(videoUrlRaw) ? videoUrlRaw : null;

  return {
    requestId,
    proposal,
    media,
    videoUrl,
    clientWhatsApp: r.client_whatsapp ? String(r.client_whatsapp) : null,
    hasPdf: !!r.proposal_pdf_path,
  };
}

/** Media for one proposal yacht (matched by name), with graceful emptiness. */
export function mediaFor(model: SalonModel, y: CombinedYacht): SalonYachtMedia {
  return model.media[norm(y.name)] || { gallery: [] };
}
