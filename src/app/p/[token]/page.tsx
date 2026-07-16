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

export const metadata: Metadata = {
  title: "A Private Charter Selection · George Yachts",
  robots: { index: false, follow: false },
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
    return {
      name: y.name,
      tier: y.tier_label ?? null,
      spec: y.spec_line ?? null,
      voyage: y.voyage_line ?? null,
      dateNote: y.date_note ?? null,
      main: m.main ?? null,
      gallery: m.gallery,
      brochure: m.brochure ?? y.links?.brochure ?? null,
      description: y.description ?? null,
      insideInfo: y.inside_info ?? null,
      crewLine: y.crew_line ?? null,
      money: {
        discountNote: pr.discount_note,
        rows: pr.rows,
        allIn: pr.all_in,
        allInclusive: pr.all_inclusive,
        headline: pr.headline || pr.charter_fee_disp || null,
        perGuest4: pr.per_person_4,
        perGuest6: pr.per_person_6,
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
      accommodation: ((y.salon_extras?.accommodation ?? []) as unknown[])
        .map((x): [string, string] =>
          Array.isArray(x)
            ? [String(x[0] ?? ""), String(x[1] ?? "")]
            : typeof x === "object" && x !== null
              ? [String(Object.values(x)[0] ?? ""), String(Object.values(x)[1] ?? "")]
              : [String(x ?? ""), ""],
        )
        .filter(([a]) => a),
    };
  });

  // Masthead sub-line: George's cover line verbatim; otherwise the SAME
  // guarded auto line as the PDF cover — an over-long guests/area field is a
  // leaked internal note (seen live on the Mead request) and is dropped,
  // never published.
  const guests = String(d.guests ?? "").trim();
  const area = String(d.area ?? "").trim();
  const coverLine = (d.cover_line ?? "").trim()
    ? (d.cover_line ?? "").trim().slice(0, 100)
    : [
        guests && guests.length <= 24 ? (/(guest|adult|children)/i.test(guests) ? guests : `${guests} Guests`) : "",
        area && area.length <= 48 ? area : "Greek Waters",
        String(d.period ?? "").trim(),
      ].filter(Boolean).join(" · ");

  const view: SalonView = {
    token,
    clientName: d.client_name ?? null,
    coverLine,
    period: d.period ?? null,
    guests: d.guests ?? null,
    area: d.area ?? null,
    introParas: (d.intro_letter ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
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
      <SalonClient view={view} />
    </div>
  );
}
