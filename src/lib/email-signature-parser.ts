// Email signature + noise-filter helpers for the inbox-driven CRM.
//
// The "CRM is your inbox" pattern — every real inbound email creates or
// updates a contact, and the body's signature block is mined for name,
// title, company, phone, LinkedIn. We can't assume the sender is a real
// human unless we strip out the obvious noise first (newsletters,
// platform notifications, transactional mail).

export type ParsedSignature = {
  name: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  website: string | null;
};

// Friendly-from parser: "George P. Biniaris <george@georgeyachts.com>"
export function parseFromHeader(from: string): {
  name: string | null;
  email: string | null;
} {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim() || null, email: match[2].trim().toLowerCase() };
  }
  // Bare email
  if (/^[^@\s]+@[^@\s]+$/.test(from.trim())) {
    return { name: null, email: from.trim().toLowerCase() };
  }
  return { name: null, email: null };
}

// Domain heuristic for "this is a real company, not a personal inbox"
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me", "mail.com",
  "gmx.com", "gmx.de", "web.de", "yandex.com", "yandex.ru",
  "hey.com", "fastmail.com",
]);

export function companyFromEmail(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  if (PERSONAL_DOMAINS.has(domain)) return null;
  // Strip common TLDs + subdomain noise → capitalize first segment
  const root = domain.replace(/\.(com|co\.uk|co|org|net|io|ai|us|eu|de|fr|gr|it|es|ae|ca)$/i, "");
  const first = root.split(".").pop() ?? root;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// Strong noise patterns — drop these before creating contacts. All
// lowercase substrings matched against the from-email localpart or
// full from string. Extend as we see more.
const NOISE_LOCALPARTS = [
  "no-reply", "noreply", "do-not-reply", "donotreply",
  "notifications", "notification", "alerts", "alert",
  "mailer-daemon", "postmaster", "bounce", "bounces",
  "updates@", "news@", "newsletter@",
  "billing@", "invoice@", "receipts@", "receipt@",
  "security@", "account@", "accounts@", "password@",
  "notify@",
  // Cross-domain support / system / dealer / report noise
  "support@", "team@", "info@", "hello@",
  "dealermessage", "dealermail", "dealerresponse",
  "dmarcreport", "dmarc-report", "dmarc_report", "dmarc@",
  "failed-payments", "failed_payments",
  "statements@", "statement@", "invoice+", "billing+",
  "kundenservice", // German "customer service"
  "system@", "automated@", "robot@",
  "reports@", "report@", "digest@",
  "verification@", "verify@", "confirm@", "confirmation@",
  "recruiting@", "recruit@", "talent@",
  "marketing@", "promo@", "promotions@",
  "wingfinder", // Red Bull career bot
  "tryapollo", "meetapollo", "useapollo", // Apollo platform
  "successfactors", // SAP system noise
];

const NOISE_HEADERS = (h: Record<string, string>) =>
  !!h["list-unsubscribe"] ||
  !!h["list-id"] ||
  /^(bulk|list|auto[_-]generated|auto[_-]replied)/i.test(h["precedence"] ?? "") ||
  /^(auto[_-]replied|auto[_-]generated)/i.test(h["auto-submitted"] ?? "");

export function isNoiseEmail(args: {
  from: string;
  fromEmail: string;
  subject: string;
  headers: Record<string, string>;
}): { noise: boolean; reason?: string } {
  const local = args.fromEmail.split("@")[0] ?? "";
  if (NOISE_LOCALPARTS.some((p) => args.fromEmail.includes(p) || local.startsWith(p))) {
    return { noise: true, reason: "noise_localpart" };
  }
  if (NOISE_HEADERS(args.headers)) {
    return { noise: true, reason: "bulk_headers" };
  }
  return { noise: false };
}

// Signature extraction. Real signatures almost always sit at the
// bottom of the reply (below a "--" separator, above the quoted
// thread, or after the last "Best,/Regards,/Thanks,/Kind regards"
// closer). We walk those anchors and mine the 6-10 lines that follow.
export function parseSignature(bodyRaw: string): ParsedSignature {
  const body = (bodyRaw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n");

  // Strip quoted lines (lines starting with >) before searching
  const cleaned = body
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");

  // Find signature anchor
  const sigAnchorRegex =
    /\n\s*(--|—|best(?:\s+regards)?,|kind regards,|warm(?:ly|est|est regards)?,|regards,|thanks,|thank\s+you,|cheers,|sincerely,|yours(?:\s+sincerely)?,|all the best,|talk soon,|speak soon,)\s*\n/i;
  const match = cleaned.match(sigAnchorRegex);

  const tail = match
    ? cleaned.slice(match.index! + match[0].length)
    : cleaned.slice(-1200); // fallback: last 1.2k chars

  const lines = tail
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length < 200)
    .slice(0, 15);

  // Phone: international-ish or US/EU formats
  const phoneRegex =
    /(?:\+?\d[\d\s().-]{7,}\d)|(?:\(\d{2,4}\)\s?\d{3,}[\s-]?\d{3,})/;
  // LinkedIn
  const linkedinRegex =
    /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9_\-]+/i;
  // Website (non-linkedin, non-email)
  const websiteRegex =
    /https?:\/\/(?!(?:[a-z]{2,3}\.)?linkedin\.com)[^\s<>]+/i;

  let phone: string | null = null;
  let linkedinUrl: string | null = null;
  let website: string | null = null;
  let name: string | null = null;
  let title: string | null = null;
  let company: string | null = null;

  // Name heuristic: first line that looks like a human name
  // (2-4 words, mostly letters, no email/URL/phone/company markers).
  for (const line of lines) {
    if (
      !name &&
      /^[A-Z][a-zA-Z'.-]*(?:\s[A-Z][a-zA-Z'.-]*){1,3}$/.test(line) &&
      !/\b(inc|llc|ltd|gmbh|corp|co\.?|company|agency|studios?|group|enterprises?|global|ventures?|holdings?|consulting|partners|advisors?)\b/i.test(line)
    ) {
      name = line;
      continue;
    }
    if (!phone) {
      const m = line.match(phoneRegex);
      if (m) phone = m[0].replace(/\s+/g, " ").trim();
    }
    if (!linkedinUrl) {
      const m = line.match(linkedinRegex);
      if (m) linkedinUrl = m[0];
    }
    if (!website) {
      const m = line.match(websiteRegex);
      if (m) website = m[0];
    }
    // Title pattern: "Chief X", "VP of X", "Director of X", "Founder & CEO", etc.
    if (!title && /^(chief|founder|co[- ]founder|vp|vice president|president|director|head of|managing|senior|principal|partner|ceo|cto|cfo|coo|cmo|owner|broker|agent|advisor|consultant|manager|lead)\b/i.test(line)) {
      title = line;
    }
    // Company pattern: line containing typical suffix
    if (!company && /\b(inc|llc|ltd|gmbh|s\.a\.|sa|corp|co\.?|company|agency|group|ventures?|holdings?|consulting|partners|advisors?|collection|studios?|enterprises?)\b/i.test(line)) {
      company = line;
    }
  }

  return { name, title, company, phone, linkedinUrl, website };
}

// Merge-if-missing: only fill fields that are currently null on the
// contact. Never overwrite existing values (user edits are sacred).
export function mergeContactFields<T extends Record<string, any>>(
  existing: T,
  incoming: Partial<T>,
): Partial<T> {
  const updates: Partial<T> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null || v === undefined || v === "") continue;
    if (existing[k] === null || existing[k] === undefined || existing[k] === "") {
      (updates as any)[k] = v;
    }
  }
  return updates;
}
