// v3 Pillar 9 — Multi-Guest Network Capture.
//
// Every passport / guest_list / PIF that comes through the document
// extractor cascades into contact creation. Each onboard guest becomes
// a first-class contact in the CRM with:
//   - relationship_to_primary  ("spouse" | "child" | "family" | "friend" | "colleague" | "unknown")
//   - network_source           e.g. "effie_star_jun_2026_charter"
//   - is_minor + parent_email  for under-18 children
//   - linked_charters          jsonb array of deal_ids
//
// The charter_guests join table records the per-charter relationship
// so the same person across multiple charters is visible.
//
// Idempotent — matches by email when present, then falls back to
// (deal_id, full_name) for guests who didn't share an email.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PassportExtraction,
  GuestListExtraction,
  PifExtraction,
} from "@/lib/charter-doc-extractor";

export interface GuestLinkResult {
  contact_id: string;
  charter_guest_id: string;
  created_contact: boolean;
  full_name: string | null;
  role: string | null;
}

export interface CascadeSummary {
  ok: boolean;
  deal_id: string;
  guests_processed: number;
  contacts_created: number;
  contacts_linked: number;
  charter_guest_rows: number;
  results: GuestLinkResult[];
  errors: string[];
}

interface DealRef {
  id: string;
  vessel_name: string | null;
  charter_start_date: string | null;
}

function networkSourceFor(deal: DealRef): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  const v = deal.vessel_name ? slug(deal.vessel_name) : "charter";
  if (deal.charter_start_date) {
    const d = new Date(deal.charter_start_date);
    const months = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    return `${v}_${months[d.getUTCMonth()]}_${d.getUTCFullYear()}_charter`;
  }
  return `${v}_charter`;
}

function splitName(full: string | null): { first: string; last: string } {
  if (!full) return { first: "", last: "" };
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function isMinorFromDob(dob: string | null): boolean {
  if (!dob) return false;
  const birth = new Date(dob);
  const now = new Date();
  const age = (now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return age < 18;
}

async function fetchDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<DealRef | null> {
  const { data } = await sb
    .from("deals")
    .select("id, vessel_name, charter_start_date")
    .eq("id", dealId)
    .maybeSingle();
  return (data ?? null) as DealRef | null;
}

interface NormalizedGuest {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  notes: string | null;
  date_of_birth: string | null;
  is_minor: boolean;
  nationality: string | null;
  passport_last_4: string | null;
  passport_expiry: string | null;
  linked_via:
    | "passport_upload"
    | "guest_list"
    | "pif"
    | "email_thread"
    | "manual";
}

export function normalizeFromPassport(
  p: PassportExtraction,
): NormalizedGuest[] {
  if (!p.passenger_full_name) return [];
  return [
    {
      full_name: p.passenger_full_name,
      email: null,
      phone: null,
      role: p.guest_role_inferred,
      notes: null,
      date_of_birth: p.date_of_birth,
      is_minor: p.is_minor,
      nationality: p.nationality,
      passport_last_4: p.passport_number_last_4,
      passport_expiry: p.expiry_date,
      linked_via: "passport_upload",
    },
  ];
}

export function normalizeFromGuestList(
  g: GuestListExtraction,
): NormalizedGuest[] {
  return (g.guests ?? []).map((row) => ({
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    notes: row.notes,
    date_of_birth: null,
    is_minor: false,
    nationality: null,
    passport_last_4: null,
    passport_expiry: null,
    linked_via: "guest_list",
  }));
}

export function normalizeFromPif(p: PifExtraction): NormalizedGuest[] {
  return (p.guests ?? []).map((g) => ({
    full_name: g.name,
    email: null,
    phone: null,
    role: g.role,
    notes: null,
    date_of_birth: null,
    is_minor: false,
    nationality: null,
    passport_last_4: null,
    passport_expiry: null,
    linked_via: "pif",
  }));
}

/**
 * Cascade a list of normalized guests into contacts + charter_guests
 * rows. Idempotent — repeated calls for the same charter dedup by email
 * (when present) or by (deal_id, full_name).
 */
export async function cascadeGuests(
  sb: SupabaseClient,
  args: {
    deal_id: string;
    guests: NormalizedGuest[];
    primary_contact_id?: string | null;
  },
): Promise<CascadeSummary> {
  const summary: CascadeSummary = {
    ok: true,
    deal_id: args.deal_id,
    guests_processed: 0,
    contacts_created: 0,
    contacts_linked: 0,
    charter_guest_rows: 0,
    results: [],
    errors: [],
  };

  const deal = await fetchDeal(sb, args.deal_id);
  if (!deal) {
    summary.ok = false;
    summary.errors.push(`deal ${args.deal_id} not found`);
    return summary;
  }
  const networkSource = networkSourceFor(deal);

  // Pre-fetch existing charter_guests for this deal so we can dedup
  // without a per-guest round-trip.
  const { data: existingGuests } = await sb
    .from("charter_guests")
    .select("id, contact_id")
    .eq("deal_id", args.deal_id);
  const existingByContact = new Map<string, string>();
  for (const g of (existingGuests ?? []) as {
    id: string;
    contact_id: string | null;
  }[]) {
    if (g.contact_id) existingByContact.set(g.contact_id, g.id);
  }

  for (const g of args.guests) {
    if (!g.full_name && !g.email) continue;
    summary.guests_processed += 1;

    // Step A — resolve / create the contact.
    let contactId: string | null = null;
    let createdContact = false;

    if (g.email) {
      const { data: existing } = await sb
        .from("contacts")
        .select("id")
        .ilike("email", g.email)
        .maybeSingle();
      if (existing?.id) contactId = existing.id as string;
    }

    if (!contactId) {
      // Try (deal-linked) match by full_name as a soft fallback for
      // guests without email (children, plus-ones).
      if (g.full_name) {
        const { first, last } = splitName(g.full_name);
        if (first && last) {
          const { data: nameMatch } = await sb
            .from("contacts")
            .select("id")
            .ilike("first_name", first)
            .ilike("last_name", last)
            .maybeSingle();
          if (nameMatch?.id) contactId = nameMatch.id as string;
        }
      }
    }

    if (!contactId) {
      const { first, last } = splitName(g.full_name);
      const isMinor = g.is_minor || isMinorFromDob(g.date_of_birth);
      const insertPayload: Record<string, unknown> = {
        first_name: first || null,
        last_name: last || null,
        email: g.email,
        phone: g.phone,
        country: null,
        contact_type:
          g.role === "primary" ? "DIRECT_CLIENT" : "GUEST_NETWORK",
        source: "manual",
        relationship_to_primary: g.role ?? null,
        network_source: networkSource,
        nationality: g.nationality,
        date_of_birth: g.date_of_birth,
        is_minor: isMinor,
        passport_last_4: g.passport_last_4,
        passport_expiry: g.passport_expiry,
        last_activity_at: new Date().toISOString(),
      };
      const { data: inserted, error: insertErr } = await sb
        .from("contacts")
        .insert(insertPayload)
        .select("id")
        .single();
      if (insertErr || !inserted) {
        summary.errors.push(
          `insert contact "${g.full_name ?? g.email}": ${insertErr?.message ?? "unknown"}`,
        );
        continue;
      }
      contactId = inserted.id as string;
      createdContact = true;
      summary.contacts_created += 1;
    } else {
      // Existing contact — gently enrich.
      const enrichPatch: Record<string, unknown> = {
        last_activity_at: new Date().toISOString(),
      };
      if (g.role) enrichPatch.relationship_to_primary = g.role;
      if (g.nationality) enrichPatch.nationality = g.nationality;
      if (g.date_of_birth) enrichPatch.date_of_birth = g.date_of_birth;
      if (g.passport_last_4) enrichPatch.passport_last_4 = g.passport_last_4;
      if (g.passport_expiry) enrichPatch.passport_expiry = g.passport_expiry;
      if (g.is_minor) enrichPatch.is_minor = true;
      if (Object.keys(enrichPatch).length > 1) {
        await sb.from("contacts").update(enrichPatch).eq("id", contactId);
      }
      summary.contacts_linked += 1;
    }

    // Append the deal_id to linked_charters jsonb (idempotent).
    const { data: cur } = await sb
      .from("contacts")
      .select("linked_charters")
      .eq("id", contactId)
      .maybeSingle();
    const list = Array.isArray(cur?.linked_charters)
      ? (cur!.linked_charters as string[])
      : [];
    if (!list.includes(args.deal_id)) {
      list.push(args.deal_id);
      await sb
        .from("contacts")
        .update({ linked_charters: list })
        .eq("id", contactId);
    }

    // Step B — upsert the charter_guests row for this (deal, contact).
    let guestRowId = existingByContact.get(contactId) ?? null;
    if (guestRowId) {
      await sb
        .from("charter_guests")
        .update({
          role: g.role ?? null,
          linked_via: g.linked_via,
          linked_at: new Date().toISOString(),
        })
        .eq("id", guestRowId);
    } else {
      const { data: gRow, error: gErr } = await sb
        .from("charter_guests")
        .insert({
          deal_id: args.deal_id,
          contact_id: contactId,
          role: g.role ?? null,
          linked_via: g.linked_via,
        })
        .select("id")
        .single();
      if (gErr || !gRow) {
        summary.errors.push(
          `insert charter_guest for ${g.full_name ?? g.email}: ${gErr?.message ?? "unknown"}`,
        );
        continue;
      }
      guestRowId = gRow.id as string;
      existingByContact.set(contactId, guestRowId);
      summary.charter_guest_rows += 1;
    }

    summary.results.push({
      contact_id: contactId,
      charter_guest_id: guestRowId,
      created_contact: createdContact,
      full_name: g.full_name,
      role: g.role,
    });
  }

  return summary;
}
