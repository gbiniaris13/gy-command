// /api/helm/:id/booking — the BOOKING on a won request (2026-09-24).
//
// GET  -> { booking, cabins, drive: { granted } }  the panel's data in one call
// POST -> { action: "save", ...fields }            vessel / owner house / payment / white label
//         { action: "link_cabin", cabin_id }       attach an existing Cabin
//         { action: "create_cabin" }               open a Cabin from the request
//         { action: "sync_drive" }                 retry the Drive mirror for every document
//         { action: "generate", chosen_yacht }     the two WON next-step drafts (unchanged)
//
// The owner house is INTERNAL and only ever comes back to this dashboard.
// Turning white label on or off flags the Lighthouse snapshot stale, because
// that switch decides whether a family is greeted at all.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getRequest, getRequestLight } from "@/lib/helm-admin";
import { helmSalutation } from "@/lib/helm/addressing";
import { composeBookingNextSteps } from "@/lib/helm/compose";
import {
  readBooking,
  mergeBooking,
  bookingFolderName,
  downloadBookingFile,
  PAYMENT_STATUSES,
  type PaymentStatus,
  type BookingDoc,
} from "@/lib/helm/booking";
import { listCabins, getCabin, createCabin } from "@/lib/cabin-admin";
import { markLighthouseStale } from "@/lib/lighthouse-cache";
import {
  driveScopeGranted,
  ensureFolderPath,
  uploadToDrive,
  DRIVE_ROOT_FOLDER,
  DRIVE_BOOKINGS_FOLDER,
} from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

async function actorEmail(request: Request): Promise<string> {
  // requireUser already accepted the session; the actor for the audit log is
  // read from the same cookie session.
  try {
    const { cookies } = await import("next/headers");
    const { createServerClient } = await import("@supabase/ssr");
    const jar = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => jar.getAll(), setAll: () => {} } },
    );
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) return data.user.email;
  } catch {}
  void request;
  return "george@georgeyachts.com";
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = await getRequestLight(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const booking = readBooking(r.extraction);
  const [cabins, granted] = await Promise.all([
    listCabins().catch(() => []),
    driveScopeGranted().catch(() => false),
  ]);
  const cabin = booking.cabin_id ? await getCabin(booking.cabin_id).catch(() => null) : null;
  return NextResponse.json({
    booking,
    cabin: cabin
      ? {
          id: cabin.id,
          status: cabin.status,
          vessel_name: cabin.vessel_name,
          charter_period_from: cabin.charter_period_from,
          charter_period_to: cabin.charter_period_to,
          principal_charterer_name: cabin.principal_charterer_name,
          myba_contract_number: cabin.myba_contract_number,
          central_agent_internal: cabin.central_agent_internal,
          vessel_owner_internal: cabin.vessel_owner_internal,
          deleted_at: cabin.deleted_at,
        }
      : null,
    cabins: cabins.map((c) => ({
      id: c.id,
      label: `${c.vessel_name} · ${c.principal_charterer_name} · ${c.charter_period_from}`,
      status: c.status,
    })),
    drive: { granted },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "generate");

  if (action === "generate") {
    const r = await getRequest(id);
    if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
    const chosen = (body.chosen_yacht ?? "").toString().trim();
    if (!chosen) return NextResponse.json({ error: "Which yacht did they choose? Add it first." }, { status: 400 });
    const from = fmtDate(r.dates_from);
    const to = fmtDate(r.dates_to);
    const dates = from && to ? `${from} - ${to}` : from || to || undefined;
    const { salutation, isAgent } = helmSalutation(r);
    try {
      const draft = await composeBookingNextSteps({
        chosen_yacht: chosen,
        dates,
        agent: isAgent,
        confirm_salutation: salutation,
      });
      // The chosen yacht is the booking's vessel unless one is already set.
      const current = readBooking(r.extraction);
      if (!current.vessel) await mergeBooking(id, { vessel: chosen });
      return NextResponse.json({ ok: true, agency_request: draft.agency_request, confirmation: draft.confirmation });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const r = await getRequestLight(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const current = readBooking(r.extraction);

  if (action === "save") {
    const patch: Record<string, unknown> = {};
    if ("vessel" in body) patch.vessel = body.vessel;
    if ("owner_company" in body) patch.owner_company = body.owner_company;
    if ("payment_status" in body) {
      const ps = String(body.payment_status);
      if (!(PAYMENT_STATUSES as readonly string[]).includes(ps)) {
        return NextResponse.json({ error: "bad payment_status" }, { status: 400 });
      }
      patch.payment_status = ps as PaymentStatus;
    }
    if ("payment_notes" in body) patch.payment_notes = body.payment_notes;
    if ("white_label" in body) patch.white_label = body.white_label === true;
    try {
      const booking = await mergeBooking(id, patch);
      if ("white_label" in body && booking.white_label !== current.white_label) await markLighthouseStale();
      return NextResponse.json({ ok: true, booking });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "link_cabin") {
    const cabinId = body.cabin_id ? String(body.cabin_id) : null;
    if (cabinId) {
      const cabin = await getCabin(cabinId).catch(() => null);
      if (!cabin) return NextResponse.json({ error: "cabin not found" }, { status: 404 });
    }
    const booking = await mergeBooking(id, { cabin_id: cabinId });
    await markLighthouseStale();
    return NextResponse.json({ ok: true, booking });
  }

  if (action === "create_cabin") {
    if (current.cabin_id) return NextResponse.json({ error: "a Cabin is already linked" }, { status: 409 });
    if (!r.dates_from || !r.dates_to) {
      return NextResponse.json({ error: "Set the charter dates on the request first (from and to)." }, { status: 400 });
    }
    if (!r.client_email) {
      return NextResponse.json({ error: "The request has no client email; the Cabin invite needs one." }, { status: 400 });
    }
    const vessel = current.vessel || (body.vessel ? String(body.vessel) : "");
    if (!vessel) return NextResponse.json({ error: "Name the yacht they took first." }, { status: 400 });
    const principal =
      [r.client_title, r.client_name, r.client_surname].filter(Boolean).join(" ").trim() ||
      r.client_name ||
      r.client_email;
    try {
      const cabin = await createCabin({
        vessel_name: vessel,
        charter_period_from: r.dates_from,
        charter_period_to: r.dates_to,
        cruising_area: r.area || undefined,
        principal_charterer_name: principal,
        principal_charterer_email: r.client_email,
        principal_charterer_mobile: r.client_whatsapp || undefined,
        central_agent_internal: current.owner_company || undefined,
        actorEmail: await actorEmail(req),
      });
      const booking = await mergeBooking(id, { cabin_id: cabin.id });
      await markLighthouseStale();
      return NextResponse.json({ ok: true, booking, cabin_id: cabin.id });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "sync_drive") {
    const granted = await driveScopeGranted();
    if (!granted) {
      return NextResponse.json(
        { error: "DRIVE_SCOPE_MISSING", message: "Reconnect Google once (Settings, Connect Gmail) to allow Drive." },
        { status: 409 },
      );
    }
    try {
      let folderId = current.drive_folder_id;
      let folderLink = current.drive_folder_link;
      if (!folderId) {
        const f = await ensureFolderPath([DRIVE_ROOT_FOLDER, DRIVE_BOOKINGS_FOLDER, bookingFolderName(r)]);
        folderId = f.id;
        folderLink = f.link;
      }
      const docs: BookingDoc[] = [];
      let synced = 0;
      for (const d of current.documents) {
        if (d.drive_file_id) {
          docs.push(d);
          continue;
        }
        try {
          const { bytes, mime } = await downloadBookingFile(d.path);
          const up = await uploadToDrive(folderId, d.name, d.mime || mime, bytes);
          docs.push({ ...d, drive_file_id: up.id, drive_link: up.link, drive_error: null });
          synced += 1;
        } catch (e) {
          docs.push({ ...d, drive_error: (e as Error).message.slice(0, 200) });
        }
      }
      const booking = await mergeBooking(id, { documents: docs, drive_folder_id: folderId, drive_folder_link: folderLink });
      return NextResponse.json({ ok: true, booking, synced });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
