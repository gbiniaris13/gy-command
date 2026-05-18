// src/lib/cabin-admin.ts
// =============================================================
// Admin-side helpers for The Cabin · Filotimo. Uses the
// existing service-role Supabase client. All mutations write
// audit log entries; see lib/cabin-admin.ts in georgeyachts.com
// for the matching client-side companion.
// =============================================================

import { createServiceClient } from "./supabase-server";

export type CabinAdminListItem = {
  id: string;
  status: string;
  vessel_name: string;
  charter_period_from: string;
  charter_period_to: string;
  principal_charterer_name: string;
  principal_charterer_email: string;
  brief_completion_percent: number;
  brief_submitted_at: string | null;
  concierge_mode_active: boolean;
  created_at: string;
  members_count: number;
};

export async function listCabins(): Promise<CabinAdminListItem[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("cabin_listing")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCabin(id: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("cabins")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getCabinSections(cabinId: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("cabin_brief_sections")
    .select("section_key, data, completed, last_edited_at, last_edited_by_email, last_edited_concierge")
    .eq("cabin_id", cabinId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Per-guest manifest rows (full_name, DOB, passport, nationality,
// cabin pairing, shoe size, allergies, etc.). Drives the Guest
// Preferences section of the preference sheet and the captain's
// port-authority crew list. Returned in submission order so the
// principal stays first.
export async function getCabinGuestsManifest(cabinId: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("cabin_guests_manifest")
    .select("*")
    .eq("cabin_id", cabinId)
    .order("guest_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getCabinMembers(cabinId: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from("cabin_members")
    .select("*")
    .eq("cabin_id", cabinId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCabin(input: {
  vessel_name: string;
  vessel_make_model?: string;
  vessel_length?: string;
  vessel_capacity?: number;
  homeport?: string;
  charter_period_from: string;
  charter_period_to: string;
  port_embarkation?: string;
  port_disembarkation?: string;
  cruising_area?: string;
  principal_charterer_name: string;
  principal_charterer_email: string;
  principal_charterer_mobile?: string;
  captain_name_internal?: string;
  chef_name_internal?: string;
  hostess_name_internal?: string;
  central_agent_internal?: string;
  charter_fee_eur?: number;
  apa_eur?: number;
  myba_contract_number?: string;
  crew_display?: unknown;
  sample_menu?: unknown;
  actorEmail: string;
}) {
  const db = createServiceClient();
  const { actorEmail, ...rest } = input;

  // Normalize email to lowercase so the unique constraint on
  // cabin_members(cabin_id, email) and Filotimo enrolments
  // never silently duplicate the same person.
  const normalizedEmail = rest.principal_charterer_email.trim().toLowerCase();

  const { data, error } = await db
    .from("cabins")
    .insert({
      ...rest,
      principal_charterer_email: normalizedEmail,
      status: "draft",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await db.from("cabin_members").insert({
    cabin_id: data.id,
    role: "principal_charterer",
    email: normalizedEmail,
    display_name: data.principal_charterer_name,
    mobile: data.principal_charterer_mobile,
  });

  // Pre-create empty section rows
  const sections = [
    "arrival", "guests", "health", "itinerary", "life_aboard",
    "dining", "beverages", "little_things",
  ] as const;
  await db
    .from("cabin_brief_sections")
    .insert(sections.map((k) => ({ cabin_id: data.id, section_key: k, data: {} })));

  await db.from("cabin_audit_log").insert({
    cabin_id: data.id,
    actor_email: actorEmail.toLowerCase(),
    actor_role: "admin",
    action: "cabin_created",
    metadata: { source: "gy-command" },
  });

  return data;
}

export async function updateCabin(id: string, patch: Record<string, unknown>, actorEmail: string) {
  const db = createServiceClient();

  // Read current status so we can detect status transitions that
  // trigger downstream actions (e.g. Memory Anchors when cabin
  // moves to 'completed').
  const { data: prev } = await db
    .from("cabins")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = await db
    .from("cabins")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: actorEmail.toLowerCase(),
    actor_role: "admin",
    action: "cabin_updated",
    metadata: { keys: Object.keys(patch) },
  });

  // Auto-trigger Memory Anchors when status transitions to
  // 'completed'. Fire-and-forget: any failure logs but doesn't
  // block the cabin update.
  if (
    patch.status === "completed" &&
    prev?.status !== "completed"
  ) {
    void triggerAutoAnchors(id, actorEmail).catch((e) =>
      console.error("[auto-anchors] failed for cabin", id, e)
    );
  }

  return data;
}

async function triggerAutoAnchors(cabinId: string, actorEmail: string) {
  const publicHost = process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const secret = process.env.CABIN_ADMIN_SECRET;
  if (!secret) {
    console.warn(
      "[cabin-admin] CABIN_ADMIN_SECRET not set; auto-anchors NOT scheduled for",
      cabinId,
    );
    return;
  }
  const r = await fetch(`${publicHost}/api/cabin/admin/schedule-anchors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cabin-admin-secret": secret,
    },
    body: JSON.stringify({ cabin_id: cabinId, actor_email: actorEmail }),
  });
  if (!r.ok) {
    // Surface failure so the caller (status-transition) sees it.
    const txt = await r.text().catch(() => "");
    throw new Error(`[cabin-admin] schedule-anchors ${r.status}: ${txt.slice(0, 200)}`);
  }
}

export async function toggleConciergeMode(id: string, on: boolean, actorEmail: string) {
  const db = createServiceClient();
  await db
    .from("cabins")
    .update({
      concierge_mode_active: on,
      concierge_mode_activated_at: on ? new Date().toISOString() : null,
      concierge_mode_activated_by_email: on ? actorEmail.toLowerCase() : null,
    })
    .eq("id", id);

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: actorEmail.toLowerCase(),
    actor_role: "admin",
    action: on ? "concierge_mode_on" : "concierge_mode_off",
  });
}

export async function sendInvite(id: string, actorEmail: string) {
  // The actual magic-link send lives in the public site
  // (georgeyachts.com /api/cabin/auth/request-link). The admin
  // here just stamps invite_sent_at and writes the audit log,
  // then calls the public endpoint with a server-to-server fetch.
  const db = createServiceClient();
  const { data: cabin, error: e1 } = await db
    .from("cabins")
    .select("principal_charterer_email, status")
    .eq("id", id)
    .single();
  if (e1) throw new Error(e1.message);

  const publicHost =
    process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";

  // Pass cabin_id so the public site pins this specific cabin as
  // the active one for this magic-link session. Without it, the
  // recipient (especially an admin like George who is principal on
  // multiple test cabins) lands on whichever cabin sorts first,
  // not the one we just clicked "Send invite" from.
  const r = await fetch(`${publicHost}/api/cabin/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: cabin.principal_charterer_email,
      cabin_id: id,
    }),
  });
  if (!r.ok) throw new Error(`request-link failed: ${r.status}`);

  await db
    .from("cabin_members")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("cabin_id", id)
    .eq("role", "principal_charterer");

  // Only promote draft → invited. Re-sending the invite for a cabin
  // that's already moved past invited (active/in_voyage/completed)
  // must NOT regress the lifecycle.
  if (cabin.status === "draft") {
    await db.from("cabins").update({ status: "invited" }).eq("id", id);
  }

  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: actorEmail.toLowerCase(),
    actor_role: "admin",
    action: "cabin_invite_sent",
    metadata: { to: cabin.principal_charterer_email },
  });
}
