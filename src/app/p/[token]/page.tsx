// /p/<token> — THE PRIVATE SALON (2026-07-16, George's GO).
// The same tamper-proof link that used to redirect straight to the PDF now
// opens the proposal as a live, private page: George's letter, his optional
// personal video, every yacht with real photos and the approved copy and
// pricing, his hand-written itineraries, and a quiet "This one interests us"
// button that pings George on Telegram the moment a client leans in.
//
// Guardrails:
//   • direct-client combined proposals ONLY — travel-agent / white-label /
//     single-mode / not-yet-generated requests fall through to the exact old
//     behavior (302 to the tracked PDF at /p/<token>/pdf), so nothing that
//     used to work changes for them.
//   • noindex/nofollow + tokened URL — private by construction.
//   • photos come from CDN/storage URLs, never proposal_json base64 (page
//     must be instant on a phone).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Cinzel, Cormorant_Garamond, Montserrat } from "next/font/google";
import { verifyProposalToken } from "@/lib/helm/proposal-token";
import { salonData, mediaFor } from "@/lib/helm/salon";
import { computePricing, fmtEur } from "@/lib/helm/pricing";
import SalonClient, { type SalonView, type SalonYachtView } from "./SalonClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "700"], variable: "--salon-display" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--salon-serif" });
const montserrat = Montserrat({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--salon-ui" });

// 2026-07-24 George, after sharing a Salon link on WhatsApp: the preview
// pulled the ROOT app metadata ("Command Center ... CRM and operations
// hub") plus a black placeholder icon - the client must never see CRM
// wording. The link now presents like the magazine itself: the private-
// selection title, a line in the house voice, and the site's branded
// navy-and-gold Forbes card as the image.
const SALON_TITLE = "A Private Charter Selection · George Yachts";
const SALON_DESC =
  "Your yachts, itineraries and pricing, prepared personally by George P. Biniaris. Boutique crewed charter, Greek waters exclusively.";

export const metadata: Metadata = {
  title: SALON_TITLE,
  description: SALON_DESC,
  robots: { index: false, follow: false },
  openGraph: {
    title: SALON_TITLE,
    description: SALON_DESC,
    siteName: "George Yachts Brokerage House",
    type: "website",
    images: [{ url: "https://georgeyachts.com/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

/** Convert a pasted video URL into something embeddable. */
function videoEmbed(url: string | null): { kind: "iframe" | "video"; src: string } | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return { kind: "iframe", src: `https://www.youtube.com/embed/${yt[1]}?rel=0` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  const loom = url.match(/loom\.com\/share\/([\w-]+)/);
  if (loom) return { kind: "iframe", src: `https://www.loom.com/embed/${loom[1]}` };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return { kind: "video", src: url };
  return { kind: "iframe", src: url };
}

export default async function SalonPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const id = verifyProposalToken(token || "");
  if (!id) {
    // Same posture as before: nothing to enumerate.
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0D1B2A", color: "#F8F5F0", fontFamily: "serif" }}>
        <p>This link is no longer valid. Please contact George Yachts.</p>
      </div>
    );
  }

  const model = await salonData(id);
  // Everything that is NOT a direct-client combined proposal keeps the exact
  // old behavior: the tracked PDF redirect.
  if (!model) redirect(`/p/${token}/pdf`);

  const d = model.proposal;
  const yachts: SalonYachtView[] = (d.yachts ?? []).map((y) => {
    const pr = computePricing(y.pricing);
    const m = mediaFor(model, y);
    // 2026-10-02 (George's review of the McCrary edition): the investment
    // box listed APA, VAT and relocation but never the charter fee itself,
    // so the client saw the parts and not the price. The fee leads the rows
    // in breakdown mode (a discounted edition already shows the net line).
    const rows: [string, string][] = pr.mode === "breakdown" && pr.charter_fee_disp && !pr.discount_note
      ? [["Charter fee", pr.charter_fee_disp], ...pr.rows]
      : pr.rows;
    return {
      name: y.name,
      tier: y.tier_label ?? null,
      spec: y.spec_line ?? null,
      voyage: y.voyage_line ?? null,
      dateNote: y.date_note ?? null,
      main: m.main ?? null,
      gallery: m.gallery,
      brochure: m.brochure ?? y.links?.brochure ?? null,
      description: cleanDescription(y.description ?? null),
      insideInfo: y.inside_info ?? null,
      crewLine: y.crew_line ?? null,
      money: {
        discountNote: pr.discount_note,
        rows,
        allIn: pr.all_in,
        // "€ 43,097.36" is not the language of the house; "around EUR 43,100"
        // is. The exact figure stays beneath it in the box.
        allInAround: aroundEur(pr.all_in),
        allInclusive: pr.all_inclusive,
        headline: pr.headline || pr.charter_fee_disp || null,
        // Per-guest figures are off the client page for good (one price per
        // yacht per week; a party of seven was reading "at 4 · at 6").
        perGuest4: null,
        perGuest6: null,
        periods: (y.period_options ?? []).map((po) => ({
          label: po.label ?? "",
          dates: po.dates ?? "",
          fee: po.fee_disp || (po.fee != null ? fmtEur(po.fee) : ""),
          note: po.note ?? "",
        })),
      },
      payableAtBase: (y.payable_at_base ?? []).map((x) => ({ label: x.label ?? "", amount: x.amount ?? "" })),
      deposit: y.security_deposit ?? null,
      freeOnboard: y.free_onboard ?? [],
      // Defensive: extraction content is loosely shaped (tuples, strings or
      // objects have all been seen live) — normalize, never crash the page.
      highlights: (y.salon_extras?.highlights ?? []).map((x) => String(x ?? "")).filter(Boolean),
      waterToys: (y.salon_extras?.water_toys ?? []).map((x) => String(x ?? "")).filter(Boolean),
      distinctions: (y.salon_extras?.distinctions ?? []).map((x) => String(x ?? "")).filter(Boolean),
      testimonials: (y.salon_extras?.testimonials ?? []).map((x) => String(x ?? "")).filter(Boolean),
      accommodation: ((y.salon_extras?.accommodation ?? []) as unknown[])
        .map((x): [string, string] =>
          Array.isArray(x)
            ? [String(x[0] ?? ""), String(x[1] ?? "")]
            : typeof x === "object" && x !== null
              ? [String(Object.values(x)[0] ?? ""), String(Object.values(x)[1] ?? "")]
              : [String(x ?? ""), ""],
        )
        .filter(([a]) => a)
        // "One master cabin / master cabin" twice on a line: the extraction
        // sometimes repeats the label as the detail. Keep one.
        .map(([a, b]): [string, string] => {
          const la = a.trim().toLowerCase();
          const lb = b.trim().toLowerCase();
          if (!lb || la === lb || la.includes(lb) || lb.includes(la)) return [a.trim().length >= b.trim().length ? a : b, ""];
          return [a, b];
        }),
      availabilityLine: model.sentAt
        ? `Availability confirmed with the owner on ${fmtLongDate(model.sentAt)}. I re-confirm the day you choose.`
        : null,
    };
  });

  // Masthead sub-line: ONLY George's own cover line, verbatim. If he wrote
  // none, we print NOTHING (2026-07-18). The old auto line stitched in a month
  // derived from the earliest yacht date and could stamp "August" on what
  // George calls a September charter — the system must never take that
  // initiative. He writes the period he wants, or the cover stays silent.
  const coverLine = (d.cover_line ?? "").trim().slice(0, 100);

  // "The Mead Edition" — same surname derivation as the PDF cover masthead.
  const editionName = (() => {
    const words = String(d.client_name ?? "")
      .replace(/\b(mr|mrs|ms|miss|dr|capt|sir|the|family)\.?\b/gi, " ")
      .trim().split(/\s+/).filter(Boolean);
    const surname = words.length ? words[words.length - 1] : "";
    return surname.length >= 2 ? `The ${surname} Edition` : null;
  })();

  const view: SalonView = {
    token,
    clientName: d.client_name ?? null,
    editionName,
    coverLine,
    // No auto-derived month on the cover masthead either (2026-07-18) — same
    // reason as coverLine; the top line falls back to the neutral publication
    // label instead of guessing a month.
    period: null,
    guests: d.guests ?? null,
    area: d.area ?? null,
    introParas: withBriefParagraph(
      (d.intro_letter ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      { guests: d.guests ?? null, area: d.area ?? null, period: coverLine || null, yachts },
    ),
    video: videoEmbed(model.videoUrl),
    yachts,
    weeks: (d.custom_weeks ?? []).map((w) => ({
      title: w.title,
      days: (w.days ?? []).map((x) => ({ leg: x.leg, note: x.note })),
    })),
    crewNote: d.crew_note ?? null,
    hasPdf: model.hasPdf,
  };

  return (
    <div className={`${cinzel.variable} ${cormorant.variable} ${montserrat.variable}`}>
      <SalonClient view={deepNoDash(view)} />
    </div>
  );
}

// George's iron rule (2026-07-18): NO long dashes in anything a client reads —
// em/en dashes read as AI-written. A short hyphen only. This sweeps every
// string in the view once, at render, so existing editions are clean on a
// refresh (no regenerate) and future ones stay clean regardless of source.
// The view is text + URLs only (photos are URLs, never base64), so this is cheap.
function deepNoDash<T>(v: T): T {
  if (typeof v === "string") return cleanText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepNoDash(x)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = deepNoDash(val);
    return o as unknown as T;
  }
  return v;
}

// The same sweep also repairs what the extraction leaves behind (2026-10-02):
// HTML entities printed as code ("&amp;"), numeric dates in two formats on
// facing pages ("15/06/2027" beside "13 June 2027"), and a decimal split by a
// space ("Bali 5. 4").
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function cleanText(s: string): string {
  return s
    .replace(/[—–]/g, "-")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, (_m, dd, mm, yyyy) => {
      const mi = Number(mm) - 1;
      return mi >= 0 && mi < 12 ? `${Number(dd)} ${MONTHS[mi]} ${yyyy}` : _m;
    })
    .replace(/(\d)\.\s+(\d)(?=\s*[A-Za-z])/g, "$1.$2");
}

function fmtLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// "€ 43,097.36" -> "around EUR 43,100". Nearest hundred, no cents.
function aroundEur(disp: string | null): string | null {
  if (!disp) return null;
  const n = Number(String(disp).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n / 100) * 100;
  return `around EUR ${r.toLocaleString("en-US")}`;
}

// A description the extraction cut mid-sentence ("... LIBRA, measures 16.")
// is worse than none. Keep it only when it ends like a sentence that was
// finished, and never when the last word is a bare number.
function cleanDescription(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/(\d)\.\s+(\d)/g, "$1.$2").trim();
  if (t.length < 40) return null;
  if (/\b(measures|is|of|at|for|with|and|to|the|a)\s+\d+(\.\d+)?\.?$/i.test(t)) return null;
  if (!/[.!?"”)]$/.test(t)) return null;
  return t;
}

// The letter speaks to their week (George 2026-10-02): one paragraph built
// from the brief and from the recommendation's own inside info, placed after
// the greeting. Nothing is written by a model at render; every clause comes
// from data George already approved in The Helm.
function withBriefParagraph(
  paras: string[],
  b: { guests: string | null; area: string | null; period: string | null; yachts: SalonYachtView[] },
): string[] {
  const first = b.yachts[0];
  if (!first) return paras;
  // The cover line is George's own summary of the brief ("Seven family
  // members. The quiet anchorages of the Small Cyclades. June 2027."); the
  // raw guests/area fields are working notes and never read well, so the
  // letter uses the cover line or nothing.
  const brief = (b.period ?? "").trim().replace(/\.$/, "");
  const n = b.yachts.length;
  const count = n === 1 ? "One yacht follows" : `${["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n] ?? n} yachts follow`;
  const why = (first.insideInfo ?? "").trim();
  if (!brief && !why) return paras;
  const sentence =
    (brief ? `Your brief, as I read it: ${brief}. ` : "") +
    `${count}, in the order I would show them to you` +
    (why ? `, and I would start with ${first.name}: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ".") +
    (why && !/[.!?]$/.test(why) ? "." : "");
  const greet = paras.findIndex((p) => /^dear\b/i.test(p));
  const out = [...paras];
  out.splice(greet >= 0 ? greet + 1 : 0, 0, sentence);
  return out;
}
