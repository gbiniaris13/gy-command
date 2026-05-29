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
  client_email?: string;
  client_whatsapp?: string;
  brief?: string;
  occasion?: string;
  party_size?: string;
  dates_from?: string | null;
  dates_to?: string | null;
  area?: string;
  supplier_raw?: string;
  mode?: "single" | "combined" | null;
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
