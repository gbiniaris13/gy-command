// src/lib/helm-admin.ts
// =============================================================
// Admin-side data layer for The Helm — the charter REQUEST
// pipeline (the sale, before the voyage). Mirrors the shape of
// cabin-admin.ts: service-role reads/writes, throw on error.
//
// The Helm runs a request from first enquiry → drafted proposal →
// sent → conversation → Won/Lost. On Won, George hands off to The
// Cabin manually (out of scope here).
// =============================================================

import { createServiceClient } from "./supabase-server";
import { upsertContactByEmail, splitName } from "./contacts";

export type HelmListItem = {
  id: string;
  status: string;
  client_name: string | null;
  client_email: string | null;
  occasion: string | null;
  dates_from: string | null;
  dates_to: string | null;
  area: string | null;
  follow_up_at: string | null;
  last_activity_at: string | null;
  proposal_pdf_path: string | null;
  mode: string | null;
  request_type: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  contact_email: string | null;
};

export type HelmMessage = {
  id: string;
  request_id: string;
  direction: "outbound" | "inbound" | null;
  channel: "email" | "whatsapp" | "note" | null;
  body: string | null;
  gmail_message_id: string | null;
  created_at: string;
};

/** CRM listing straight off helm_requests — the view lacks whatsapp/party/
 *  budget, which George's at-a-glance pipeline needs (2026-07-17). */
export type HelmCrmItem = HelmListItem & {
  client_whatsapp: string | null;
  party_size: string | null;
  budget: string | null;
  /** extraction->salon (views etc.) and extraction->supplier_threads, pulled
   *  as narrow JSON paths so the row stays light. */
  salon: { views?: number; last_at?: string; yachts?: Record<string, number> } | null;
  supplier_threads: { email: string }[] | null;
  /** true when this client's email is already a newsletter subscriber
   *  (contacts.tags_v2 contains "newsletter") — George 2026-07-17. */
  on_newsletter: boolean;
};

export async function listHelmCrm(): Promise<HelmCrmItem[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("helm_requests")
    .select(
      "id, status, client_name, client_surname, client_email, client_whatsapp, party_size, budget, occasion, dates_from, dates_to, area, follow_up_at, last_activity_at, proposal_pdf_path, mode, request_type, created_at, salon:extraction->salon, supplier_threads:extraction->supplier_threads",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // Which of these clients are already on the newsletter? One lightweight
  // lookup over contacts tagged "newsletter" (tags_v2 is jsonb). Best-effort:
  // a failure here must never break the pipeline list.
  const newsletterEmails = new Set<string>();
  try {
    // tags_v2 is jsonb, so the containment value must be JSON ('["newsletter"]'),
    // not a PG array literal ('{newsletter}') — hence .filter(cs) with a JSON
    // string rather than .contains([...]).
    const { data: nl } = await db
      .from("contacts")
      .select("email")
      .filter("tags_v2", "cs", JSON.stringify(["newsletter"]));
    for (const c of nl ?? []) {
      const e = (c as { email: string | null }).email?.trim().toLowerCase();
      if (e) newsletterEmails.add(e);
    }
  } catch {
    /* ignore — the badge just won't show */
  }

  return (data || []).map((r) => ({
    first_name: null,
    last_name: null,
    contact_email: null,
    on_newsletter: newsletterEmails.has((r.client_email || "").trim().toLowerCase()),
    ...r,
  })) as HelmCrmItem[];
}

export async function listHelm(): Promise<HelmListItem[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("helm_listing")
    .select("*")
    .order("last_activity_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getRequest(id: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("helm_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Is this one email already a newsletter subscriber? (contacts.tags_v2 has
 *  "newsletter"). Best-effort; false on any error. Used on the request detail
 *  header so George sees at once whether the client is on the list. */
export async function isEmailOnNewsletter(email: string | null | undefined): Promise<boolean> {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("contacts")
      .select("id")
      .ilike("email", e)
      .filter("tags_v2", "cs", JSON.stringify(["newsletter"]))
      .limit(1);
    return !!(data && data.length);
  } catch {
    return false;
  }
}

export async function getMessages(requestId: string): Promise<HelmMessage[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("helm_messages")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as HelmMessage[]) ?? [];
}

export type CreateHelmInput = {
  client_name?: string;
  client_title?: string;
  client_surname?: string;
  client_is_family?: boolean;
  client_email?: string;
  client_whatsapp?: string;
  brief?: string;
  occasion?: string;
  party_size?: string;
  dates_from?: string | null;
  dates_to?: string | null;
  area?: string;
  budget?: string;
  special_requests?: string;
  supplier_raw?: string;
  mode?: "single" | "combined" | null;
  request_type?: "direct_client" | "travel_agent" | null;
  no_myba?: boolean;
  show_ghost_credit?: boolean;
  actorEmail: string;
};

export async function createRequest(input: CreateHelmInput) {
  const db = createServiceClient();
  // actorEmail is recorded for future audit; not persisted in this skeleton.
  const { actorEmail: _actorEmail, ...rest } = input;
  void _actorEmail;

  // Link to the shared contacts hub when we have an email.
  let contactId: string | null = null;
  const clientEmail = rest.client_email?.trim().toLowerCase() || null;
  if (clientEmail) {
    const { first, last } = splitName(rest.client_name);
    const c = await upsertContactByEmail({
      email: clientEmail,
      firstName: first,
      lastName: last,
      source: "website_inquiry",
    });
    contactId = c?.id ?? null;
  }

  const { data, error } = await db
    .from("helm_requests")
    .insert({
      ...rest,
      client_email: clientEmail,
      contact_id: contactId,
      status: "new",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Seed the conversation log with the brief as an internal note,
  // so the detail page has context from the start.
  if (rest.brief && rest.brief.trim()) {
    await db.from("helm_messages").insert({
      request_id: data.id,
      direction: null,
      channel: "note",
      body: rest.brief.trim(),
    });
  }

  return data;
}

export async function updateRequest(id: string, patch: Record<string, unknown>) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("helm_requests")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function addNote(requestId: string, body: string) {
  const db = createServiceClient();
  const { error } = await db.from("helm_messages").insert({
    request_id: requestId,
    direction: null,
    channel: "note",
    body,
  });
  if (error) throw new Error(error.message);
  await db
    .from("helm_requests")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", requestId);
}

// Step 3 — store the AI extraction (pre-confirm, no math done yet).
export async function saveExtraction(id: string, extraction: unknown) {
  const db = createServiceClient();
  const { error } = await db
    .from("helm_requests")
    .update({ extraction, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Step 3 — store the generated proposal + email draft; advance to 'drafted'.
export async function saveGenerated(
  id: string,
  fields: {
    proposal_json: unknown;
    proposal_pdf_path: string;
    email_subject: string;
    email_intro: string;
    mode: "single" | "combined";
    client_name?: string | null;
  },
) {
  const db = createServiceClient();
  const { error } = await db
    .from("helm_requests")
    .update({
      proposal_json: fields.proposal_json,
      proposal_pdf_path: fields.proposal_pdf_path,
      proposal_generated_at: new Date().toISOString(),
      email_subject: fields.email_subject,
      email_intro: fields.email_intro,
      mode: fields.mode,
      ...(fields.client_name ? { client_name: fields.client_name } : {}),
      status: "drafted",
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Feature 2 — send / reply logging.
export async function logHelmMessage(
  requestId: string,
  msg: {
    direction: "outbound" | "inbound" | null;
    channel: "email" | "whatsapp" | "note";
    body: string;
    gmail_message_id?: string | null;
  },
) {
  const db = createServiceClient();
  const { error } = await db.from("helm_messages").insert({
    request_id: requestId,
    direction: msg.direction,
    channel: msg.channel,
    body: msg.body,
    gmail_message_id: msg.gmail_message_id ?? null,
  });
  if (error) throw new Error(error.message);
}

// After a proposal email is sent: store thread refs, advance to Sent, and set
// the 4-day follow-up. (The actual Gmail send happens in the send route.)
export async function markRequestSent(
  id: string,
  fields: {
    gmail_thread_id: string;
    gmail_last_message_id: string;
    email_subject: string;
    email_intro: string;
  },
) {
  const db = createServiceClient();
  const followUp = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await db
    .from("helm_requests")
    .update({
      gmail_thread_id: fields.gmail_thread_id,
      gmail_last_message_id: fields.gmail_last_message_id,
      email_subject: fields.email_subject,
      email_intro: fields.email_intro,
      status: "sent",
      follow_up_at: followUp,
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Addition B — media (Cloudinary URLs or pasted links) on the request.
type VesselPhotoRow = { url: string; source: "upload" | "link"; caption?: string };

export async function addVesselPhoto(id: string, photo: VesselPhotoRow) {
  const db = createServiceClient();
  const { data } = await db.from("helm_requests").select("vessel_photos").eq("id", id).maybeSingle();
  const cur: VesselPhotoRow[] = Array.isArray(data?.vessel_photos) ? data!.vessel_photos : [];
  if (!cur.some((p) => p?.url === photo.url)) cur.push(photo);
  const { error } = await db
    .from("helm_requests")
    .update({ vessel_photos: cur, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return cur;
}

export async function removeVesselPhoto(id: string, url: string) {
  const db = createServiceClient();
  const { data } = await db.from("helm_requests").select("vessel_photos").eq("id", id).maybeSingle();
  const cur: VesselPhotoRow[] = (Array.isArray(data?.vessel_photos) ? data!.vessel_photos : []).filter(
    (p: VesselPhotoRow) => p?.url !== url,
  );
  const { error } = await db
    .from("helm_requests")
    .update({ vessel_photos: cur, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return cur;
}

// Feature 1 (combined multi-yacht) — per-yacht media, keyed by yacht index:
//   { "0": { main_url, brochure_url }, "1": {...} }  (combined_media jsonb)
type CombinedMediaEntry = { main_url?: string | null; brochure_url?: string | null; extra_urls?: string[] | null };

// Gallery strip (Helm v2): append ONE extra photo URL to a combined yacht's
// media (cap 3, deduped). Read-modify-write because extra_urls is an array.
export async function appendCombinedExtraUrl(id: string, index: number, url: string) {
  const db = createServiceClient();
  const { data } = await db.from("helm_requests").select("combined_media").eq("id", id).maybeSingle();
  const cur: Record<string, CombinedMediaEntry> =
    data?.combined_media && typeof data.combined_media === "object" ? data.combined_media : {};
  const key = String(index);
  const existing = Array.isArray(cur[key]?.extra_urls) ? (cur[key]!.extra_urls as string[]) : [];
  // Salon gallery carousel takes up to 24; the PDF strip still prints the first 3.
  const next = [...new Set([...existing, url.trim()])].slice(0, 24);
  return setCombinedMedia(id, index, { extra_urls: next });
}

export async function removeCombinedExtraUrl(id: string, index: number, url: string) {
  const db = createServiceClient();
  const { data } = await db.from("helm_requests").select("combined_media").eq("id", id).maybeSingle();
  const cur: Record<string, CombinedMediaEntry> =
    data?.combined_media && typeof data.combined_media === "object" ? data.combined_media : {};
  const key = String(index);
  const existing = Array.isArray(cur[key]?.extra_urls) ? (cur[key]!.extra_urls as string[]) : [];
  const next = existing.filter((u) => u !== url);
  return setCombinedMedia(id, index, { extra_urls: next });
}

export async function setCombinedMedia(id: string, index: number, patch: CombinedMediaEntry) {
  const db = createServiceClient();
  const { data } = await db.from("helm_requests").select("combined_media").eq("id", id).maybeSingle();
  const cur: Record<string, CombinedMediaEntry> =
    data?.combined_media && typeof data.combined_media === "object" ? data.combined_media : {};
  const key = String(index);
  const next = { ...(cur[key] || {}), ...patch };
  // drop nulled fields so removal actually clears them (empty arrays too)
  for (const k of Object.keys(next) as (keyof CombinedMediaEntry)[]) {
    const v = next[k];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
  }
  cur[key] = next;
  const { error } = await db
    .from("helm_requests")
    .update({ combined_media: cur, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return cur;
}

export async function setBrochureUrl(id: string, url: string | null) {
  const db = createServiceClient();
  const { error } = await db
    .from("helm_requests")
    .update({ brochure_url: url, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Hard delete (cascades to helm_messages). The Helm holds no
// post-sale record worth preserving the way a completed Cabin does,
// and George wants to clear test fixtures cleanly. If a soft-delete
// is ever needed, add a deleted_at column + filter the view.
export async function deleteRequest(id: string): Promise<{ ok: true }> {
  const db = createServiceClient();
  const { error } = await db.from("helm_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
