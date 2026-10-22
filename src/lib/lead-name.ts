// 2026-10-22 (George): a website lead with no name is never filed as
// "Micro brief" or "Concierge card lead". The name is read from the email
// the way a person would read it: enzo.burito@gmail.com is Enzo Burito. A
// handle that does not split into words (jsmith77) is kept as the handle.
const PLACEHOLDER =
  /\b(micro|brief|concierge|card|lead|express|inquiry|enquiry|form|visitor|guest|test|unknown|website|anonymous)\b/i;
const GENERIC = /^(info|contact|hello|mail|admin|office|sales|noreply|no-reply|team|support|enquiries|inquiries|booking|reservations)$/;

export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = String(name || "").trim();
  return !n || PLACEHOLDER.test(n);
}

export function nameFromEmail(email: string | null | undefined): string {
  const local = String(email || "").trim().toLowerCase().split("@")[0] || "";
  if (!local) return "";
  const tokens = local.split(/[._\-+]+/).map((t) => t.replace(/\d+$/g, "")).filter((t) => /^[a-z]{2,}$/.test(t));
  if (tokens.length >= 2 && !GENERIC.test(tokens[0])) {
    return tokens.slice(0, 3).map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" ");
  }
  if (GENERIC.test(local) || local.length < 3) return "";
  return local;
}

/** The name for the card: the guest's own, else one read from the email, else the label as sent. */
export function leadDisplayName(name: string | null | undefined, email: string | null | undefined): string {
  const n = String(name || "").trim();
  if (!isPlaceholderName(n)) return n;
  return nameFromEmail(email) || n;
}
