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

import { createServiceClient } from "@/lib/supabase-server";
import { getRequestWithProposal } from "@/lib/helm-admin";
import { optimizedUrl } from "@/lib/helm/cloudinary";
import type { CombinedProposal, CombinedYacht } from "@/lib/helm/proposal-template";

export type SalonYachtMedia = { main?: string; gallery: string[]; brochure?: string };

export type SalonModel = {
  requestId: string;
  proposal: CombinedProposal;
  /** keyed by normalized yacht name */
  media: Record<string, SalonYachtMedia>;
  videoUrl: string | null;
  // When George sent this edition (extraction.pipeline.sent_at). The yacht
  // spreads say "availability confirmed with the owner on <date>" from it.
  sentAt: string | null;
  createdAt: string | null;
  // "No. 41": this edition's place in the run of editions George has
  // composed, counted from the requests that carry a proposal.
  issueNo: number | null;
  // After the yes (George, 2 October 2026): the same link becomes "The
  // <Surname> Week", built from the booking and The Cabin.
  week: SalonWeek | null;
  clientWhatsApp: string | null;
  hasPdf: boolean;
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function isHttpUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

/** Build the Salon view model, or null when this request must NOT get a
 *  Salon (agent/white-label, single mode, or nothing generated yet). */
export type SalonWeek = {
  vessel: string;
  from: string | null;
  to: string | null;
  portEmbarkation: string | null;
  portDisembarkation: string | null;
  berth: string | null;
  crew: { role: string; years: number | null }[];
  menu: { title: string | null; tagline: string | null; sections: { name: string; items: string[] }[] } | null;
};

function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
}

function titleRole(s: string): string {
  const t = String(s || "").replace(/_/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

async function weekFor(r: { status?: string | null; extraction?: unknown }): Promise<SalonWeek | null> {
  if (r.status !== "won") return null;
  const booking = (r.extraction as { booking?: { vessel?: unknown; cabin_id?: unknown; white_label?: unknown } } | null)?.booking;
  const vessel = typeof booking?.vessel === "string" ? booking.vessel.trim() : "";
  if (!vessel || booking?.white_label === true) return null;
  const week: SalonWeek = {
    vessel, from: null, to: null, portEmbarkation: null, portDisembarkation: null, berth: null, crew: [], menu: null,
  };
  const cabinId = typeof booking?.cabin_id === "string" ? booking.cabin_id : null;
  if (!cabinId) return week;
  try {
    const db = createServiceClient();
    const { data: c } = await db
      .from("cabins")
      .select("charter_period_from, charter_period_to, port_embarkation, port_disembarkation, berth_label, crew_display, sample_menu")
      .eq("id", cabinId)
      .maybeSingle();
    if (!c) return week;
    week.from = c.charter_period_from ?? null;
    week.to = c.charter_period_to ?? null;
    week.portEmbarkation = c.port_embarkation ?? null;
    week.portDisembarkation = c.port_disembarkation ?? null;
    week.berth = c.berth_label ?? null;
    // Crew by role only (George: names and faces change; the role is what
    // is promised). Years of experience when the Cabin has a number.
    const crew = parseJson(c.crew_display);
    if (Array.isArray(crew)) {
      week.crew = crew
        .map((m) => {
          const role = titleRole(String((m as { role?: unknown })?.role ?? ""));
          const y = Number((m as { years_experience?: unknown })?.years_experience);
          return role ? { role, years: Number.isFinite(y) && y > 0 ? y : null } : null;
        })
        .filter((x): x is { role: string; years: number | null } => x !== null);
    }
    const menu = parseJson(c.sample_menu) as { title?: unknown; tagline?: unknown; sections?: unknown } | null;
    if (menu && Array.isArray(menu.sections)) {
      week.menu = {
        title: typeof menu.title === "string" ? menu.title : null,
        tagline: typeof menu.tagline === "string" ? menu.tagline : null,
        sections: (menu.sections as { name?: unknown; items?: unknown; dishes?: unknown }[])
          .map((s) => ({
            name: String(s?.name ?? "").trim(),
            items: ((Array.isArray(s?.items) ? s.items : Array.isArray(s?.dishes) ? s.dishes : []) as unknown[])
              .map((x) => (typeof x === "string" ? x : String((x as { name?: unknown })?.name ?? ""))).filter(Boolean).slice(0, 5),
          }))
          .filter((s) => s.name && s.items.length > 0)
          .slice(0, 8),
      };
    }
  } catch {
    /* the booking stands without the Cabin's details */
  }
  return week;
}

async function issueNumberFor(createdAt: string | null): Promise<number | null> {
  if (!createdAt) return null;
  try {
    const db = createServiceClient();
    const { count } = await db
      .from("helm_requests")
      .select("id", { count: "exact", head: true })
      .not("proposal_json", "is", null)
      .lte("created_at", createdAt);
    return typeof count === "number" && count > 0 ? count : null;
  } catch {
    return null;
  }
}

export async function salonData(requestId: string): Promise<SalonModel | null> {
  const r = await getRequestWithProposal(requestId);
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
      .slice(0, 24)
      .map((u) => optimizedUrl(u));
    const entry: SalonYachtMedia = { gallery };
    if (isHttpUrl(m.main_url)) entry.main = optimizedUrl(m.main_url);
    if (isHttpUrl(m.brochure_url)) entry.brochure = m.brochure_url;
    media[name] = entry;
  }

  // George's kill switch (2026-07-16): "no video this time" without losing
  // the saved link - the panel checkbox sets salon_video_off and the client
  // simply sees no video block.
  const draft = r.review_draft as { salon_video?: unknown; salon_video_off?: unknown } | null;
  const videoUrlRaw = draft?.salon_video;
  const videoUrl = draft?.salon_video_off === true ? null : isHttpUrl(videoUrlRaw) ? videoUrlRaw : null;

  return {
    requestId,
    proposal,
    media,
    videoUrl,
    sentAt: (() => {
      const p = (r.extraction as { pipeline?: { sent_at?: unknown } } | null)?.pipeline;
      return typeof p?.sent_at === "string" ? p.sent_at : null;
    })(),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
    issueNo: await issueNumberFor(typeof r.created_at === "string" ? r.created_at : null),
    week: await weekFor(r),
    clientWhatsApp: r.client_whatsapp ? String(r.client_whatsapp) : null,
    hasPdf: !!r.proposal_pdf_path,
  };
}

/** Media for one proposal yacht (matched by name), with graceful emptiness. */
export function mediaFor(model: SalonModel, y: CombinedYacht): SalonYachtMedia {
  return model.media[norm(y.name)] || { gallery: [] };
}
