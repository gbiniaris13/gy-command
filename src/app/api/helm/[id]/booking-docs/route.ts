// /api/helm/:id/booking-docs — the papers of a booking (2026-09-24).
//
// POST multipart { file, type }  -> stores the file in the PRIVATE bucket
//                                   booking-documents, records it on
//                                   extraction->booking.documents, and mirrors
//                                   it to Google Drive when the scope exists.
// GET                            -> { documents }
//
// Vercel caps a request body around 4.5 MB, so the browser is told the limit
// before it tries (the 5.4 MB contract of 29/8 never arrived and looked
// "empty"); PDFs above that are compressed on the client first.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getRequestLight } from "@/lib/helm-admin";
import {
  readBooking,
  mergeBooking,
  ensureBookingBucket,
  uploadBookingFile,
  safeFileName,
  bookingFolderName,
  DOC_TYPES,
  type BookingDoc,
  type DocType,
} from "@/lib/helm/booking";
import {
  driveScopeGranted,
  ensureFolderPath,
  uploadToDrive,
  DRIVE_ROOT_FOLDER,
  DRIVE_BOOKINGS_FOLDER,
} from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

async function sessionEmail(): Promise<string | null> {
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
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = await getRequestLight(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({ documents: readBooking(r.extraction).documents });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const r = await getRequestLight(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "no file" }, { status: 400 });
  const typeRaw = String(form.get("type") || "other");
  const type: DocType = (DOC_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as DocType) : "other";

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: "empty file" }, { status: 400 });
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: `file too large (${(bytes.length / 1048576).toFixed(1)} MB, max 4 MB)` }, { status: 413 });
  }
  const mime = file.type || "application/octet-stream";
  const name = safeFileName(file.name || `${type}.bin`);
  const docId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${id}/${docId}-${name}`;

  try {
    await ensureBookingBucket();
    await uploadBookingFile(path, bytes, mime);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const doc: BookingDoc = {
    id: docId,
    type,
    name,
    path,
    size: bytes.length,
    mime,
    uploaded_at: new Date().toISOString(),
    uploaded_by: await sessionEmail(),
    drive_file_id: null,
    drive_link: null,
    drive_error: null,
  };

  // Drive mirror, best effort: the private copy is already safe; a Drive
  // failure is recorded on the document and retried from "Sync to Drive".
  const current = readBooking(r.extraction);
  let folderId = current.drive_folder_id;
  let folderLink = current.drive_folder_link;
  try {
    if (await driveScopeGranted()) {
      if (!folderId) {
        const f = await ensureFolderPath([DRIVE_ROOT_FOLDER, DRIVE_BOOKINGS_FOLDER, bookingFolderName(r)]);
        folderId = f.id;
        folderLink = f.link;
      }
      const up = await uploadToDrive(folderId, name, mime, bytes);
      doc.drive_file_id = up.id;
      doc.drive_link = up.link;
    } else {
      doc.drive_error = "DRIVE_SCOPE_MISSING";
    }
  } catch (e) {
    doc.drive_error = (e as Error).message.slice(0, 200);
  }

  // Re-read right before writing so two uploads in a row never lose each other.
  const fresh = await getRequestLight(id);
  const latest = readBooking(fresh?.extraction);
  const booking = await mergeBooking(id, {
    documents: [...latest.documents, doc],
    drive_folder_id: folderId,
    drive_folder_link: folderLink,
  });
  return NextResponse.json({ ok: true, doc, booking });
}
