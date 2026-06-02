// src/lib/helm/whitelabel.ts
// =============================================================
// HARD WHITE-LABEL GUARD for travel-agent proposals.
//
// A travel agent presents the PDF to their own client under their own name.
// Before a travel_agent PDF is finalized we scan the rendered HTML, the PDF
// title (document metadata) AND the download filename, case-insensitively,
// for any token that would betray George Yachts. If ANY is found we FAIL the
// generation loudly rather than silently ship a leaky white-label. This
// mirrors the existing source-agency strip safety pattern in extract.ts.
// =============================================================

// Deny-list. Order longest/most-specific first for clearer hit labels; the
// scan reports every distinct match. Tokens are lowercase substrings.
const DENY: { token: string; label: string }[] = [
  { token: "george yachts", label: "George Yachts" },
  { token: "georgeyachts", label: "georgeyachts (domain / email)" },
  { token: "biniaris", label: "Biniaris" },
  { token: "george", label: "George" },
  { token: "6970380999", label: "Athens phone" },
  { token: "7867988798", label: "Miami / WhatsApp phone" },
  { token: "calendly", label: "Calendly CTA" },
  { token: "ghost", label: "GHOST colophon" },
  { token: "sheridan", label: "Sheridan address" },
  { token: "wy 82801", label: "WY 82801 address" },
  { token: "82801", label: "ZIP 82801" },
  { token: "30 n gould", label: "street address" },
  { token: "gould st", label: "street address" },
];

/** Returns the distinct deny-list labels found across the given parts.
 *  We scan only what the recipient can actually see: the <body> markup + the
 *  PDF title/filename. The <style> block is stripped first because it is never
 *  rendered AND it legitimately contains both 3 MB base64 font blobs (which by
 *  chance hold short ASCII runs like "george") and a CSS comment mentioning
 *  "George-hosted URLs". Remaining base64 (body images) is stripped too. */
export function scanWhiteLabel(...parts: (string | null | undefined)[]): string[] {
  const hay = parts.filter(Boolean).join("\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")        // CSS: fonts + comments, never rendered
    .replace(/data:[^,]*,[A-Za-z0-9+/=]+/g, " ")       // body-embedded base64 images
    .toLowerCase();
  const hits = new Set<string>();
  for (const d of DENY) if (hay.includes(d.token)) hits.add(d.label);
  return [...hits];
}

/** Throws if any George-Yachts token survives in a travel-agent document. */
export function assertWhiteLabelClean(parts: { html: string; title?: string; filename?: string }): void {
  const hits = scanWhiteLabel(parts.html, parts.title, parts.filename);
  if (hits.length) {
    throw new Error(
      `White-label guard FAILED: the travel-agent document still contains [${hits.join(", ")}]. ` +
      `Generation was aborted so nothing leaky is shipped. Check the proposal copy and footer.`,
    );
  }
}
