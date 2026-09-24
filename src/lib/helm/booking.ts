// The Helm — the BOOKING that sits on a won request (2026-09-24, George:
// "στα Won να υπάρχει στήλη: ποιο σκάφος πήραν, κατάσταση πληρωμής, σε ποια
// εταιρεία ανήκει, και εκεί να ανεβαίνουν συμβόλαια, διαβατήρια, preference
// list").
//
// Where it lives: helm_requests.extraction->booking, next to ->pipeline and
// ->salon. No new table and no migration: the production database is a Nano
// instance we reach only through PostgREST, and the extraction column is a
// few kilobytes per row (unlike proposal_json, which must never be read in a
// list). Every reader selects the narrow JSON path `extraction->booking`.
//
// The files themselves (contracts, passports, preference sheets, crew lists)
// go to a PRIVATE Supabase Storage bucket and are streamed back only through
// an admin-gated route, exactly like the proposal PDF. Each upload is also
// mirrored to George's Google Drive (George Yachts / Bookings / <charterer>)
// when the Google connection carries the Drive scope; if it does not, the
// document keeps a drive_error and a "Sync to Drive" retry exists.
//
// The owning house of the yacht is INTERNAL. It is stored here for George's
// eyes and never reaches a client surface (same rule as supplier_raw and the
// *_internal cabin columns).

import { createServiceClient } from "@/lib/supabase-server";

export const PAYMENT_STATUSES = ["unpaid", "deposit_paid", "balance_paid", "apa_paid", "settled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  balance_paid: "Balance paid",
  apa_paid: "APA paid",
  settled: "Settled",
};
export const PAYMENT_COLOR: Record<PaymentStatus, string> = {
  unpaid: "#9CA3AF",
  deposit_paid: "#F59E0B",
  balance_paid: "#60A5FA",
  apa_paid: "#34D399",
  settled: "#0d6e5a",
};

export const DOC_TYPES = [
  "contract",
  "passport",
  "preference_sheet",
  "crew_list",
  "invoice",
  "payment_proof",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DOC_LABEL: Record<DocType, string> = {
  contract: "Contract (MYBA)",
  passport: "Passport / ID",
  preference_sheet: "Preference sheet",
  crew_list: "Crew list",
  invoice: "Invoice",
  payment_proof: "Payment proof",
  other: "Other",
};

export type BookingDoc = {
  id: string;
  type: DocType;
  name: string;
  /** Path inside BOOKING_BUCKET. */
  path: string;
  size: number;
  mime: string;
  uploaded_at: string;
  uploaded_by: string | null;
  drive_file_id: string | null;
  drive_link: string | null;
  drive_error: string | null;
};

export type HelmBooking = {
  /** The yacht they actually took, e.g. "S/CAT PI2". */
  vessel: string | null;
  /** INTERNAL: the house/company that owns or centrally manages the yacht. */
  owner_company: string | null;
  payment_status: PaymentStatus;
  payment_notes: string;
  /** Booked through a partner as white label: the Lighthouse must never
   *  greet this client (the partner owns the relationship). */
  white_label: boolean;
  /** Linked Cabin (guest portal + manifest + preference sheet). */
  cabin_id: string | null;
  documents: BookingDoc[];
  drive_folder_id: string | null;
  drive_folder_link: string | null;
  updated_at: string | null;
};

export const EMPTY_BOOKING: HelmBooking = {
  vessel: null,
  owner_company: null,
  payment_status: "unpaid",
  payment_notes: "",
  white_label: false,
  cabin_id: null,
  documents: [],
  drive_folder_id: null,
  drive_folder_link: null,
  updated_at: null,
};

function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (PAYMENT_STATUSES as readonly string[]).includes(v);
}
function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}

/** Read the booking off an extraction blob (or off the narrow `booking` path). */
export function readBooking(raw: unknown): HelmBooking {
  const src =
    raw && typeof raw === "object" && "booking" in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).booking
      : raw;
  const b = (src && typeof src === "object" ? src : {}) as Record<string, unknown>;
  const docs = Array.isArray(b.documents) ? b.documents : [];
  return {
    vessel: typeof b.vessel === "string" && b.vessel.trim() ? b.vessel.trim() : null,
    owner_company: typeof b.owner_company === "string" && b.owner_company.trim() ? b.owner_company.trim() : null,
    payment_status: isPaymentStatus(b.payment_status) ? b.payment_status : "unpaid",
    payment_notes: typeof b.payment_notes === "string" ? b.payment_notes : "",
    white_label: b.white_label === true,
    cabin_id: typeof b.cabin_id === "string" && b.cabin_id ? b.cabin_id : null,
    documents: docs
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => ({
        id: String(d.id ?? ""),
        type: isDocType(d.type) ? d.type : "other",
        name: String(d.name ?? "document"),
        path: String(d.path ?? ""),
        size: typeof d.size === "number" ? d.size : 0,
        mime: String(d.mime ?? "application/octet-stream"),
        uploaded_at: String(d.uploaded_at ?? ""),
        uploaded_by: typeof d.uploaded_by === "string" ? d.uploaded_by : null,
        drive_file_id: typeof d.drive_file_id === "string" ? d.drive_file_id : null,
        drive_link: typeof d.drive_link === "string" ? d.drive_link : null,
        drive_error: typeof d.drive_error === "string" ? d.drive_error : null,
      }))
      .filter((d) => d.id && d.path),
    drive_folder_id: typeof b.drive_folder_id === "string" ? b.drive_folder_id : null,
    drive_folder_link: typeof b.drive_folder_link === "string" ? b.drive_folder_link : null,
    updated_at: typeof b.updated_at === "string" ? b.updated_at : null,
  };
}

/** Whether a booking carries anything worth showing in the list. */
export function bookingHasContent(b: HelmBooking): boolean {
  return !!(b.vessel || b.owner_company || b.cabin_id || b.documents.length || b.white_label || b.payment_status !== "unpaid");
}

/**
 * Read-modify-write of extraction->booking, the same shape as mergePipeline.
 * `patch` may carry a full documents array (the callers own that list); every
 * other field is validated here so a stray value can never poison the row.
 */
export async function mergeBooking(id: string, patch: Partial<HelmBooking>): Promise<HelmBooking> {
  const db = createServiceClient();
  const { data: row, error: readErr } = await db
    .from("helm_requests")
    .select("extraction")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  const extraction = (row?.extraction as Record<string, unknown> | null) ?? {};
  const current = readBooking(extraction);

  const next: HelmBooking = { ...current };
  if ("vessel" in patch) next.vessel = patch.vessel?.toString().trim() || null;
  if ("owner_company" in patch) next.owner_company = patch.owner_company?.toString().trim() || null;
  if ("payment_status" in patch && isPaymentStatus(patch.payment_status)) next.payment_status = patch.payment_status;
  if ("payment_notes" in patch) next.payment_notes = (patch.payment_notes ?? "").toString().slice(0, 2000);
  if ("white_label" in patch) next.white_label = patch.white_label === true;
  if ("cabin_id" in patch) next.cabin_id = patch.cabin_id ? String(patch.cabin_id) : null;
  if ("documents" in patch && Array.isArray(patch.documents)) next.documents = patch.documents;
  if ("drive_folder_id" in patch) next.drive_folder_id = patch.drive_folder_id ?? null;
  if ("drive_folder_link" in patch) next.drive_folder_link = patch.drive_folder_link ?? null;
  next.updated_at = new Date().toISOString();

  const { error } = await db
    .from("helm_requests")
    .update({ extraction: { ...extraction, booking: next }, updated_at: next.updated_at })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return next;
}

// ─── Private storage for the papers ──────────────────────────────────────────
// Raw storage REST with the service key (the pattern of /api/lighthouse/upload):
// no public URL ever exists for these objects.

export const BOOKING_BUCKET = "booking-documents";

function storageEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase storage is not configured");
  return { url, key };
}

export async function ensureBookingBucket(): Promise<void> {
  const { url, key } = storageEnv();
  const head = await fetch(`${url}/storage/v1/bucket/${BOOKING_BUCKET}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (head.ok) return;
  await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ name: BOOKING_BUCKET, id: BOOKING_BUCKET, public: false }),
  });
}

export function safeFileName(name: string): string {
  return String(name || "document").replace(/[^a-z0-9._-]/gi, "_").slice(0, 90);
}

export async function uploadBookingFile(path: string, bytes: Buffer, mime: string): Promise<void> {
  const { url, key } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BOOKING_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": mime || "application/octet-stream",
      "x-upsert": "false",
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function downloadBookingFile(path: string): Promise<{ bytes: Buffer; mime: string }> {
  const { url, key } = storageEnv();
  const res = await fetch(`${url}/storage/v1/object/${BOOKING_BUCKET}/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (!res.ok) throw new Error(`storage ${res.status}`);
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return { bytes: Buffer.from(await res.arrayBuffer()), mime };
}

export async function deleteBookingFile(path: string): Promise<void> {
  const { url, key } = storageEnv();
  await fetch(`${url}/storage/v1/object/${BOOKING_BUCKET}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
}

/** The Drive folder name for a booking: "Surname, 2027-06-19 to 2027-06-26". */
export function bookingFolderName(r: {
  client_surname?: string | null;
  client_name?: string | null;
  client_email?: string | null;
  dates_from?: string | null;
  dates_to?: string | null;
}): string {
  const who =
    (r.client_surname || "").trim() ||
    (r.client_name || "").trim() ||
    (r.client_email || "").split("@")[0] ||
    "Charterer";
  const dates = r.dates_from ? ` ${r.dates_from}${r.dates_to ? ` to ${r.dates_to}` : ""}` : "";
  return `${who}${dates}`.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 120);
}
