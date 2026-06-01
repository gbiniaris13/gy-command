// src/lib/helm/media.ts
// Media helpers for The Helm. Confidentiality: a pasted link on a known
// central-agency / brokerage domain would leak the source, so we warn
// George AND keep such a brochure link OFF the client proposal until he
// swaps in a clean (George-hosted / white-label) copy.

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
    ? `This link is on "${host}", which looks like a central-agency / brokerage domain. It will NOT be shown on the client proposal (confidentiality). Swap in a georgeyachts.com or clean white-label copy.`
    : null;
}

export function isAgencyDomain(url?: string | null): boolean {
  return agencyDomainWarning(url) !== null;
}
