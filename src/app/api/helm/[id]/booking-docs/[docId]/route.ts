// /api/helm/:id/booking-docs/:docId
//   GET    -> streams the private file to the dashboard (never a public URL)
//   DELETE -> removes it from the bucket and from the booking. The Drive copy
//             is George's own archive and is deliberately left alone.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getRequestLight } from "@/lib/helm-admin";
import { readBooking, mergeBooking, downloadBookingFile, deleteBookingFile } from "@/lib/helm/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { id, docId } = await ctx.params;
  const r = await getRequestLight(id);
  if (!r) return new Response("not found", { status: 404 });
  const doc = readBooking(r.extraction).documents.find((d) => d.id === docId);
  if (!doc) return new Response("no such document", { status: 404 });
  try {
    const { bytes, mime } = await downloadBookingFile(doc.path);
    const inline = /^(application\/pdf|image\/)/.test(doc.mime || mime);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": doc.mime || mime,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { id, docId } = await ctx.params;
  const r = await getRequestLight(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const booking = readBooking(r.extraction);
  const doc = booking.documents.find((d) => d.id === docId);
  if (!doc) return NextResponse.json({ error: "no such document" }, { status: 404 });
  try {
    await deleteBookingFile(doc.path);
  } catch {
    /* the record is removed regardless; a stray object in a private bucket harms nobody */
  }
  const next = await mergeBooking(id, { documents: booking.documents.filter((d) => d.id !== docId) });
  return NextResponse.json({ ok: true, booking: next });
}
