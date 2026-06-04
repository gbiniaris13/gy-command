// Resolve the central-agency (supplier) recipients for a broker-to-supplier
// inquiry. George naturally pastes the agency email(s) into the "Supplier source"
// box (supplier_raw), so we accept them from there as well as from the dedicated
// central_agency_email field. The explicit field wins when set; otherwise we pull
// the emails out of the raw supplier source. The client's own email is ALWAYS
// excluded as a safety net so an inquiry can never be addressed to the client.

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Extract unique, valid-looking email addresses from free text, preserving order
// and excluding any address in `exclude` (case-insensitive).
export function extractEmails(
  text?: string | null,
  exclude: (string | null | undefined)[] = [],
): string[] {
  if (!text) return [];
  const ex = new Set(
    exclude.filter(Boolean).map((e) => (e as string).toLowerCase().trim()),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.match(EMAIL_RE) || []) {
    const e = raw.trim();
    const k = e.toLowerCase();
    if (!k || ex.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

// Central-agency recipients: the dedicated field wins; otherwise fall back to the
// emails found in the raw supplier source. Always excludes the client's email.
export function resolveAgencyRecipients(
  centralAgencyEmail?: string | null,
  supplierRaw?: string | null,
  clientEmail?: string | null,
): string[] {
  const explicit = extractEmails(centralAgencyEmail, [clientEmail]);
  if (explicit.length) return explicit;
  return extractEmails(supplierRaw, [clientEmail]);
}
