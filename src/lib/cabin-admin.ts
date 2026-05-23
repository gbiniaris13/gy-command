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

  // 2026-05-23 — Berth Map Phase 2: when berth coordinates change,
  // refresh the cached nearby info (airport / helipad / ATMs /
  // hospital / pharmacy). Fire-and-forget — the cabin save has
  // already succeeded; this is best-effort background enrichment.
  // If Overpass / OSRM are down, berth_nearby_error gets recorded
  // and we log; the cabin row is otherwise intact.
  if ("berth_lat" in patch || "berth_lng" in patch) {
    const lat = Number(data?.berth_lat);
    const lng = Number(data?.berth_lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      void refreshBerthNearby(id, lat, lng).catch((e) =>
        console.error("[berth-nearby] refresh failed for cabin", id, e)
      );
    }
  }

  return data;
}

// 2026-05-23 — Berth Map Phase 2.
// Refresh the cached nearby info for a cabin. Called fire-and-forget
// from updateCabin when berth coordinates change, OR directly by the
// "Refresh nearby" button in EditBasicsForm.
//
// Always writes berth_nearby_fetched_at to mark the attempt. On
// fetch failure, writes berth_nearby_error and leaves berth_nearby
// at its previous value (so we don't blank out good data because
// of a transient Overpass outage).
export async function refreshBerthNearby(
  cabinId: string,
  lat: number,
  lng: number,
): Promise<{ ok: boolean; partial: boolean; errors?: string[] }> {
  const { fetchAllNearby } = await import("./berth-nearby");
  const db = createServiceClient();

  try {
    const result = await fetchAllNearby(lat, lng);

    const patch: Record<string, unknown> = {
      berth_nearby: result,
      berth_nearby_fetched_at: result.generated_at,
      berth_nearby_error: result.partial
        ? `partial: ${(result.errors || []).join("; ")}`
        : null,
    };
    const { error } = await db
      .from("cabins")
      .update(patch)
      .eq("id", cabinId);
    if (error) throw new Error(error.message);

    return {
      ok: true,
      partial: !!result.partial,
      errors: result.errors,
    };
  } catch (e) {
    const msg = (e as Error).message;
    // Don't blank berth_nearby — preserve last-good result. Just
    // record the error and the attempt timestamp.
    await db
      .from("cabins")
      .update({
        berth_nearby_error: msg,
        berth_nearby_fetched_at: new Date().toISOString(),
      })
      .eq("id", cabinId);
    return { ok: false, partial: true, errors: [msg] };
  }
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

// 2026-05-21 — Pass 7 follow-up (George):
//   "Έχω πάρα πολλά τεστς εκεί μέσα, θέλω να μπορώ να διαγράφω
//    κάποιες καμπίνες, έτσι ώστε να τις ξαναρχίζω από την αρχή."
//
// Two flavours of delete, both safe:
//
// SOFT — set deleted_at = NOW() on the cabins row. Reversible by
//   manual SQL. The cabin disappears from:
//     - the CRM dashboard list (cabin_listing view filters
//       deleted_at IS NULL)
//     - the public-site /cabin auth lookup (lib/cabin/auth.js
//       filters deleted_at IS NULL on resolveSessionCabin)
//     - the brief, chat, mood-board, anchors, voyage-photos
//       loaders (all gate on deleted_at IS NULL through the cabin
//       lookup)
//   Operational data (cabin_members, cabin_brief_sections,
//   cabin_guests_manifest, cabin_chat_messages, cabin_mood_board,
//   cabin_voyage_photos, cabin_memory_anchors) is preserved on
//   disk, so a soft-delete can be undone by clearing deleted_at.
//
// HARD — actually DELETE FROM cabins WHERE id = ?. The FK cascade
//   chain wipes everything operational (members, brief, manifest,
//   chat, mood board, voyage photos, memory anchors) but PRESERVES
//   the GDPR / audit / trust-trail tables:
//     - cabin_audit_log         (ON DELETE SET NULL)
//     - cabin_data_consents     (ON DELETE SET NULL)
//     - cabin_time_capsules     (ON DELETE SET NULL — the guest's
//                                letter-to-future-self survives)
//     - filotimo_circle_members.last_voyage_cabin_id
//                               (ON DELETE SET NULL — loyalty record
//                                survives, just unlinks from cabin)
//   Hard-delete is appropriate for test fixtures George wants to
//   re-create from scratch. NOT appropriate for real customer
//   cabins after the voyage — those should soft-delete (or archive
//   via status change) to keep the operational record.
export async function deleteCabin(
  id: string,
  actorEmail: string,
  mode: "soft" | "hard" = "soft",
): Promise<{ ok: true; mode: "soft" | "hard"; vessel_name: string | null }> {
  const db = createServiceClient();

  // Snapshot what we're about to delete — so the audit log line
  // carries the vessel name even after the row is gone (hard mode).
  const { data: snap } = await db
    .from("cabins")
    .select("vessel_name, principal_charterer_email, status")
    .eq("id", id)
    .maybeSingle();

  if (!snap) {
    throw new Error("cabin-not-found");
  }

  // Write the audit line BEFORE the cabin row goes away in hard
  // mode — the FK is SET NULL on cabin_audit_log so the row would
  // survive either way, but stamping the metadata explicitly keeps
  // the line legible if you grep the log later.
  await db.from("cabin_audit_log").insert({
    cabin_id: id,
    actor_email: actorEmail.toLowerCase(),
    actor_role: "admin",
    action: mode === "hard" ? "cabin_hard_deleted" : "cabin_soft_deleted",
    metadata: {
      mode,
      vessel_name: snap.vessel_name,
      principal_email: snap.principal_charterer_email,
      previous_status: snap.status,
    },
  });

  if (mode === "hard") {
    const { error } = await db.from("cabins").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true, mode, vessel_name: snap.vessel_name };
  }

  const { error } = await db
    .from("cabins")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true, mode, vessel_name: snap.vessel_name };
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
  // here calls the public endpoint with a server-to-server fetch,
  // verifies the email actually went out (mailed:true), and only
  // then stamps invite_sent_at + audits.
  //
  // 2026-05-22 — Previously this stamped invite_sent_at + audited
  // BEFORE checking whether Resend had accepted the send. The
  // public endpoint silently swallowed Resend exceptions and
  // returned 200, so the CRM showed "✓ Magic link sent" while
  // the customer never received anything. Now: we pass the shared
  // CABIN_ADMIN_SECRET as a Bearer header, the public endpoint
  // returns { mailed, error? }, and we throw with the actual
  // Resend error if it failed.
  const db = createServiceClient();
  const { data: cabin, error: e1 } = await db
    .from("cabins")
    .select("principal_charterer_email, status")
    .eq("id", id)
    .single();
  if (e1) throw new Error(e1.message);

  const publicHost =
    process.env.CABIN_PUBLIC_URL || "https://georgeyachts.com";
  const adminSecret = process.env.CABIN_ADMIN_SECRET;
  if (!adminSecret) {
    throw new Error("CABIN_ADMIN_SECRET not configured on the CRM");
  }

  // Pass cabin_id so the public site pins this specific cabin as
  // the active one for this magic-link session. Without it, the
  // recipient (especially an admin like George who is principal on
  // multiple test cabins) lands on whichever cabin sorts first,
  // not the one we just clicked "Send invite" from.
  const r = await fetch(`${publicHost}/api/cabin/auth/request-link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify({
      email: cabin.principal_charterer_email,
      cabin_id: id,
    }),
  });
  let payload: { ok?: boolean; mailed?: boolean; error?: string } = {};
  try {
    payload = await r.json();
  } catch {
    // body wasn't JSON — fall through to status-based error
  }
  if (!r.ok) {
    throw new Error(payload?.error || `request-link failed: ${r.status}`);
  }
  if (payload?.mailed !== true) {
    // The send failed (or no membership exists). Surface the real
    // reason so the operator UI can show it instead of lying.
    throw new Error(payload?.error || "email send failed (no detail)");
  }

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
