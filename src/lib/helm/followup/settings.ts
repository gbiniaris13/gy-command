// src/lib/helm/followup/settings.ts
// Per-request follow-up facts George can set by hand, stored inside the
// existing extraction JSON (extraction.followup), so no migration is needed.
// Only facts that the playbook needs and the Helm did not hold before:
//   tz                     the client's IANA time zone (else inferred from the phone)
//   option_expires_at      a REAL option/hold expiry from the central agent
//   early_booking_deadline a REAL early-booking deadline offered by the owner
//   early_booking_pct      its percentage, if known
//   extra_emails           spouse / assistant / family office / advisor addresses
//   client_followup_date   "talk in January" → the day the client asked for
//   contact_role           who we are writing to
// Urgency in a draft is allowed ONLY when one of these dated fields is set.

export type ContactRole = "principal" | "spouse" | "assistant" | "family_office" | "travel_advisor";

export type FollowupSettings = {
  tz?: string | null;
  option_expires_at?: string | null;
  early_booking_deadline?: string | null;
  early_booking_pct?: number | null;
  extra_emails?: string[];
  client_followup_date?: string | null;
  contact_role?: ContactRole | null;
  whatsapp_ok?: boolean; // the client writes on WhatsApp, or said it is fine
};

export function readFollowupSettings(extraction: unknown): FollowupSettings {
  const e = extraction && typeof extraction === "object" ? (extraction as Record<string, unknown>) : {};
  const f = e.followup && typeof e.followup === "object" ? (e.followup as Record<string, unknown>) : {};
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  return {
    tz: typeof f.tz === "string" ? f.tz : null,
    option_expires_at: date(f.option_expires_at),
    early_booking_deadline: date(f.early_booking_deadline),
    early_booking_pct: typeof f.early_booking_pct === "number" ? f.early_booking_pct : null,
    extra_emails: Array.isArray(f.extra_emails) ? (f.extra_emails as unknown[]).filter((x): x is string => typeof x === "string" && x.includes("@")) : [],
    client_followup_date: date(f.client_followup_date),
    contact_role: typeof f.contact_role === "string" ? (f.contact_role as ContactRole) : null,
    whatsapp_ok: f.whatsapp_ok === true,
  };
}

/** Clean an incoming patch from the panel. Unknown keys are dropped. */
export function sanitizeSettingsPatch(body: Record<string, unknown>): Partial<FollowupSettings> {
  const out: Partial<FollowupSettings> = {};
  const date = (v: unknown) => (v === null || v === "" ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  if ("tz" in body) out.tz = typeof body.tz === "string" && body.tz ? body.tz : null;
  for (const k of ["option_expires_at", "early_booking_deadline", "client_followup_date"] as const) {
    if (k in body) { const d = date(body[k]); if (d !== undefined) out[k] = d; }
  }
  if ("early_booking_pct" in body) {
    const n = Number(body.early_booking_pct);
    out.early_booking_pct = Number.isFinite(n) && n > 0 && n < 50 ? n : null;
  }
  if ("extra_emails" in body) {
    const raw = Array.isArray(body.extra_emails) ? body.extra_emails : String(body.extra_emails ?? "").split(/[\s,;]+/);
    out.extra_emails = Array.from(new Set(raw.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))).slice(0, 6);
  }
  if ("whatsapp_ok" in body) out.whatsapp_ok = body.whatsapp_ok === true;
  if ("contact_role" in body) {
    const r = String(body.contact_role ?? "");
    out.contact_role = ["principal", "spouse", "assistant", "family_office", "travel_advisor"].includes(r) ? (r as ContactRole) : null;
  }
  return out;
}
