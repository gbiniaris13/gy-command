// src/lib/contacts.ts
// =============================================================
// Shared contact helpers. The CRM keys everything off the single
// `contacts` hub (FK contact_id everywhere). New modules that take
// in a client by email should reuse upsertContactByEmail rather
// than re-implementing the match-by-email dance inline.
//
// Extracted 2026-05-29 from the inline logic in
// cron/gmail-poll-replies (upsertContactFromEmail) so The Helm and
// future modules share one path. `email` has NO unique constraint
// in the DB, so we match case-insensitively (ilike) instead of
// relying on ON CONFLICT.
// =============================================================

import { createServiceClient } from "./supabase-server";

type PipelineStage = { id: string; name: string; position: number };

export type UpsertContactInput = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  company?: string | null;
  country?: string | null;
  // Must be one of the contacts.source CHECK values:
  //   outreach_bot | website_lead | website_inquiry | manual | referral | partner
  source?: string;
};

/**
 * Find-or-create a contact by email. Returns { id, created } or null
 * if no email was supplied. On an existing contact, only fills in
 * fields that are currently blank — never overwrites good data with
 * empty values.
 */
export async function upsertContactByEmail(
  input: UpsertContactInput,
): Promise<{ id: string; created: boolean } | null> {
  const email = input.email?.trim().toLowerCase();
  if (!email) return null;

  const db = createServiceClient();

  const { data: existing } = await db
    .from("contacts")
    .select("id, first_name, last_name, phone, company, country")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    const updates: Record<string, unknown> = {};
    if (input.firstName && !existing.first_name) updates.first_name = input.firstName;
    if (input.lastName && !existing.last_name) updates.last_name = input.lastName;
    if (input.phone && !existing.phone) updates.phone = input.phone;
    if (input.company && !existing.company) updates.company = input.company;
    if (input.country && !existing.country) updates.country = input.country;
    if (Object.keys(updates).length > 0) {
      updates.last_activity_at = new Date().toISOString();
      await db.from("contacts").update(updates).eq("id", existing.id);
    }
    return { id: existing.id, created: false };
  }

  // Default pipeline stage "New" (fall back to the lowest-position stage).
  const { data: stages } = await db
    .from("pipeline_stages")
    .select("id, name, position")
    .order("position", { ascending: true });
  const newStage =
    (stages as PipelineStage[] | null)?.find((s) => s.name === "New") ??
    (stages as PipelineStage[] | null)?.[0];

  const { data: inserted, error } = await db
    .from("contacts")
    .insert({
      email,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      country: input.country ?? null,
      source: input.source ?? "website_inquiry",
      pipeline_stage_id: newStage?.id ?? null,
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: inserted.id, created: true };
}

/** Split a free-text "First Last" name into first/last parts. */
export function splitName(full?: string | null): {
  first: string | null;
  last: string | null;
} {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
