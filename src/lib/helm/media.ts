// src/lib/helm/media.ts
// Media helpers for The Helm. Confidentiality: a pasted link on a known
// central-agency / brokerage domain MIGHT leak the source, so we warn George
// to confirm the brochure itself is genuinely white-label (no agency name or
// branding) before it ships. The operator vets and decides; the link is
// included on the proposal as provided (no silent stripping).

export type VesselPhoto = { url: string; source: "upload" | "link"; caption?: string };

const AGENCY_DOMAINS = [
  "yachtfolio.com", "yachtbrochures.com", "charterworld.com", "fraseryachts.com",
  "burgessyachts.com", "northropandjohnson.com", "camperandnicholsons.com",
  "yachtcharterfleet.com", "boatinternational.com", "centralyachtagent.com",
  "yatco.com", "ila-global.com", "moravia", "ankor",
];

/** Returns a warning string if the URL is on a known agency/brokerage
 *  domain (so George can swap in a clean copy), else null. */
export function agencyDomainWarning(url?: string | null): string | null {
  if (!url) return null;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = AGENCY_DOMAINS.some((d) => host.includes(d));
  return hit
    ? `Heads up: this link is on "${host}", which looks like a central-agency / brokerage domain. It WILL be included on the proposal - make sure the brochure itself is white-label (no agency name or branding) before you send.`
    : null;
}

export function isAgencyDomain(url?: string | null): boolean {
  return agencyDomainWarning(url) !== null;
}
