// 2026-10-26 (George): every link to georgeyachts.com that leaves this house
// by email carries a source, so a click from a proposal, a greeting, a press
// pitch or the morning brief never lands in the analytics as "Direct".
//
// Only links to the public site are tagged. The Helm, the Edition and the
// tracking endpoints (/api/...) are left alone, and a link that already
// carries utm parameters is not tagged twice. Works on plain text and HTML.

export type Utm = { source: string; medium?: string; campaign?: string };

const SITE_LINK = /https?:\/\/(?:www\.)?georgeyachts\.com(\/[^\s"'<>)\]]*)?/g;

export function tagSiteLinks(text: string, utm: Utm): string {
  if (!text) return text;
  const medium = utm.medium || "email";
  const campaign = utm.campaign || utm.source;
  const params = `utm_source=${encodeURIComponent(utm.source)}&utm_medium=${encodeURIComponent(medium)}&utm_campaign=${encodeURIComponent(campaign)}`;
  return text.replace(SITE_LINK, (match: string, path: string | undefined) => {
    let url = match;
    let trail = "";
    // A URL at the end of a sentence keeps its punctuation outside the link.
    const m = url.match(/[.,;:!?]+$/);
    if (m) { trail = m[0]; url = url.slice(0, -trail.length); }
    const p = (path || "").replace(/[.,;:!?]+$/, "");
    if (p.startsWith("/api/") || /[?&]utm_/.test(url)) return match;
    const [base, hash] = url.split("#");
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${params}${hash ? `#${hash}` : ""}${trail}`;
  });
}
