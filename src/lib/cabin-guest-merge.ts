// src/lib/cabin-guest-merge.ts
// =============================================================
// 2026-05-26 — Brief 02 (Task B1, single-responsibility rework).
//
// Shared helper: merge a cabin's per-member self-filled
// personal_details with the principal-seeded
// cabin_guests_manifest into one MergedGuest[] that's safe to
// use as the SINGLE SOURCE OF TRUTH on every operator surface.
//
// Why this exists:
//   /preference-sheet/page.tsx + /print/page.tsx used to read
//   guest PII (DOB, passport, nationality, cabin pairing, shoe
//   size, allergies) DIRECTLY from cabin_guests_manifest. Under
//   the new model (Brief 02, PART A) guests fill their own
//   /cabin/me — their data lives in cabin_members.personal_
//   details, not the manifest. The preference sheet / print
//   were showing blank dashes for those guests. THIS HELPER
//   fixes that by merging both sources with the member's own
//   write winning when present.
//
// Members WITHOUT a matching manifest row are still included
// in the result (the new-model guest may have no manifest
// entry at all). That matters because the principal might
// never seed a manifest — under the new model they don't have
// to; each guest fills their own line.
//
// Merge rule (same as the original crew-list inline merge):
//   1. SEED from cabin_members. Every non-deleted member
//      becomes a MergedGuest, sourced from personal_details +
//      cabin_members fallbacks.
//   2. LAYER manifest rows on top — but ONLY fill BLANKS. A
//      member who wrote their DOB beats a stale principal-
//      seeded one. A manifest row with no matching member
//      becomes its own MergedGuest (paperwork completeness).
//   3. SORT principal_charterer first, then designated_
//      assistant, then guests alphabetically by name.
// =============================================================

type AnyRec = Record<string, unknown>;

export interface MergedGuest {
  // Identity + access
  id: string | null;               // cabin_members.id when seeded from member; null if manifest-only
  name: string;
  role: string;
  email: string;

  // Port-authority (crew-list) fields
  mobile: string;
  gender: string;
  date_of_birth: string;
  nationality: string;
  passport_number: string;
  passport_expiry: string;

  // Brief 02 / Task B1: preference-sheet additions.
  // cabin_pairing + shoe_size are guest-aboard niceties; allergies
  // + dietary are safety-critical and now reach the chef
  // regardless of what the principal typed into the Health section.
  cabin_pairing: string;
  shoe_size: string;
  allergies_dietary: string;
  // dietary lives ONLY in cabin_members.personal_details
  // (dietary_preferences[]). No manifest column. Surfaced on the
  // preference-sheet chef block so the chef can plan around
  // "No pork", "Vegetarian", etc. even if the member typed
  // nothing into allergies_dietary.
  dietary: string[];
  allergies_severity: string;
  emergency_note: string;
  is_minor: boolean;

  // Provenance — which source provided the bulk of this row.
  // Useful for the CRM UI to caveat "(CRM manifest)" when a
  // guest hasn't joined yet. member_self = guest filled their
  // own /cabin/me; manifest = principal seeded via CRM
  // manifest editor; principal_seed = bare-bones fallback.
  source: "member_self" | "manifest" | "principal_seed";
}

function s(v: unknown): string {
  return v == null ? "" : String(v);
}

function fmtIsoSafe(v: unknown): string {
  if (!v) return "";
  const str = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : "";
}

/**
 * Merge cabin members + cabin_guests_manifest into one canonical
 * per-person list. Member-self data wins for fields the user
 * filled in /cabin/me; manifest fills blanks; manifest-only rows
 * (e.g. for guests who haven't joined yet) are surfaced too.
 *
 * @param members        rows from cabin_members (.is("deleted_at", null))
 * @param manifest       rows from cabin_guests_manifest (ordered by guest_order)
 * @param principalSeed  { full_name, email, mobile } — falls back to this
 *                       when a member row exists but has no display_name
 *                       (typically only matters for the principal's own row
 *                       in a brand-new cabin)
 */
export function mergeGuestRecords(
  members: AnyRec[],
  manifest: AnyRec[],
  principalSeed: { full_name: string; email: string; mobile: string },
): MergedGuest[] {
  const byEmail = new Map<string, MergedGuest>();

  // 1) SEED from cabin_members. Member-self is the canonical
  // source for everything the user can write in /cabin/me.
  for (const m of members ?? []) {
    const pd = (m.personal_details as AnyRec) || {};
    const email = String(m.email ?? "").toLowerCase();
    // 2026-05-26 — Name fallback chain (Brief 02 follow-up):
    //   1. display_name when set                       (every normal case)
    //   2. principalSeed.full_name — ONLY for the principal row.
    //      The old code applied this fallback to every member with
    //      null display_name, which made guests with no display_name
    //      surface AS THE PRINCIPAL (e.g. EFFIE STAR's konstantinos
    //      member row appeared as a duplicate "Patricia R. Stevens"
    //      card in §02 of the preference sheet).
    //   3. email — the most useful identifier when we have no name.
    //   4. "—" as a last-resort placeholder so the card never
    //      renders an empty heading.
    const role = s(m.role);
    const isPrincipalRow = role === "principal_charterer";
    const name =
      s(m.display_name) ||
      (isPrincipalRow ? principalSeed.full_name : "") ||
      s(m.email) ||
      "—";
    byEmail.set(email, {
      id: m.id ? String(m.id) : null,
      name,
      role,
      email,
      mobile: s(pd.mobile) || s(m.mobile),
      gender: s(pd.gender),
      date_of_birth: s(pd.date_of_birth),
      nationality: s(pd.nationality),
      passport_number: s(pd.passport_number),
      passport_expiry: s(pd.passport_expiry),
      cabin_pairing: s(pd.cabin_pairing),
      // Brief 02 (PART A, Task A3.3) added shoe_size to the
      // sanitiser allowlist on the public site, so it now lands
      // in personal_details.shoe_size for any member who fills
      // /cabin/me Aboard fields. Falls back to manifest below.
      shoe_size: s(pd.shoe_size),
      // Allergies live ONLY in personal_details on the public
      // side. allergies_severity + emergency_note live ONLY on
      // the manifest today (per-guest severity isn't captured
      // in /cabin/me/private). Both source lines layer in step 2.
      allergies_dietary: s(pd.allergies_dietary),
      // dietary_preferences[] from /cabin/me/private. Sanitised
      // to non-empty strings. Defaults to empty array.
      dietary: Array.isArray(pd.dietary_preferences)
        ? (pd.dietary_preferences as unknown[])
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v): v is string => v.length > 0)
        : [],
      allergies_severity: "",
      emergency_note: "",
      is_minor: false,
      source: "member_self",
    });
  }

  // 2) LAYER manifest rows on top — only filling BLANKS for
  // anything the member also filled themselves. Member-self
  // wins by design.
  for (const g of manifest ?? []) {
    const email = String(g.email ?? "").toLowerCase();
    const existingKey = email || `manifest-${g.id}`;
    const existing = byEmail.get(existingKey);
    if (existing) {
      existing.date_of_birth ||= fmtIsoSafe(g.date_of_birth);
      existing.nationality ||= s(g.nationality);
      existing.passport_number ||= s(g.passport_number);
      existing.passport_expiry ||= fmtIsoSafe(g.passport_expiry);
      existing.mobile ||= s(g.mobile);
      existing.gender ||= s(g.gender);
      existing.cabin_pairing ||= s(g.cabin_pairing);
      existing.shoe_size ||= s(g.shoe_size);
      existing.allergies_dietary ||= s(g.allergies_dietary);
      // Severity + emergency-note come only from the manifest.
      // No member-self override exists, so always trust manifest.
      existing.allergies_severity =
        existing.allergies_severity || s(g.allergies_severity);
      existing.emergency_note =
        existing.emergency_note || s(g.emergency_note);
      existing.is_minor = existing.is_minor || Boolean(g.is_minor);
      // Manifest full_name wins if the member never set display_name
      // (rare, but possible for a freshly-seeded cabin).
      existing.name = s(g.full_name) || existing.name;
    } else {
      // Manifest-only entry (no portal member yet). Include with
      // whatever manifest data we have so harbour paperwork is
      // complete even before the guest joins the portal.
      byEmail.set(existingKey, {
        id: null,
        name: s(g.full_name) || "—",
        role: "guest",
        email,
        mobile: s(g.mobile),
        gender: s(g.gender),
        date_of_birth: fmtIsoSafe(g.date_of_birth),
        nationality: s(g.nationality),
        passport_number: s(g.passport_number),
        passport_expiry: fmtIsoSafe(g.passport_expiry),
        cabin_pairing: s(g.cabin_pairing),
        shoe_size: s(g.shoe_size),
        allergies_dietary: s(g.allergies_dietary),
        // Manifest has no dietary_preferences column today.
        // Empty array — chef-roll-up filter handles it.
        dietary: [],
        allergies_severity: s(g.allergies_severity),
        emergency_note: s(g.emergency_note),
        is_minor: Boolean(g.is_minor),
        source: "manifest",
      });
    }
  }

  // 3) SORT — principal_charterer first, then assistants, then
  // guests alphabetically by name. Matches the existing crew-
  // list ordering so no operator-facing reorder regression.
  const out = Array.from(byEmail.values());
  out.sort((a, b) => {
    const order: Record<string, number> = {
      principal_charterer: 0,
      designated_assistant: 1,
      guest: 2,
    };
    const ao = order[a.role] ?? 99;
    const bo = order[b.role] ?? 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return out;
}
