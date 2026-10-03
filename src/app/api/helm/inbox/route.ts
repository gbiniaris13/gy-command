// The GY Inbox API.
//   GET  → { pending, charters }
//   POST multipart { file }            → read + match; filed at once when sure,
//                                        else parked as a drop with a suggestion
//   POST json { action:"file", key, request_id, type }   → file a parked paper
//   POST json { action:"discard", key }                   → forget a parked paper
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { readPaper, matchCharter, fileUnder, inboxOverview, readPending, dropPending, fetchAttachment, pendingByKey, type Pending } from "@/lib/helm/inbox-documents";
import { loadCharters } from "@/lib/helm/timeline";
import { DOC_TYPES, ensureBookingBucket, uploadBookingFile, downloadBookingFile, deleteBookingFile, type DocType } from "@/lib/helm/booking";
import { setSetting } from "@/lib/google-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, ...(await inboxOverview()) });
}

async function park(p: Pending) {
  const all = await readPending();
  await setSetting("inbox_pending", JSON.stringify([...all.filter((x) => x.key !== p.key), p].slice(-40)));
}

export async function POST(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const ctype = req.headers.get("content-type") || "";

  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "Over 4 MB: email it to yourself with GY INBOX in the subject and it files itself." }, { status: 413 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    const charters = await loadCharters();
    const reading = await readPaper(bytes, mime, file.name, charters);
    const { charter, sure } = matchCharter(charters, { surname: reading.surname, vessel: reading.vessel });
    if (charter && sure && reading.confidence >= 0.7 && reading.type !== "other") {
      const doc = await fileUnder(charter.id, bytes, mime, file.name, reading.type, "gy-inbox-drop", reading.summary || undefined);
      return NextResponse.json({ ok: true, filed: { client: charter.client, vessel: charter.vessel, id: charter.id, type: reading.type, name: doc.name } });
    }
    // Not sure: keep the bytes aside and ask once.
    const key = `drop:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const path = `_inbox/${key.slice(5)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
    await ensureBookingBucket();
    await uploadBookingFile(path, bytes, mime);
    const p: Pending = { key, name: file.name, received_at: new Date().toISOString(), reading, guess: charter ? `${charter.client} · ${charter.vessel}` : undefined, mime, size: bytes.length, attachment_id: path };
    await park(p);
    return NextResponse.json({ ok: true, pending: p, suggestion: charter ? { id: charter.id, client: charter.client, vessel: charter.vessel } : null });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.action === "discard" && body.key) {
    const p = await pendingByKey(String(body.key));
    if (p?.key.startsWith("drop:") && p.attachment_id) await deleteBookingFile(p.attachment_id).catch(() => {});
    await dropPending(String(body.key));
    return NextResponse.json({ ok: true });
  }
  if (body?.action === "file" && body.key && body.request_id) {
    const p = await pendingByKey(String(body.key));
    if (!p) return NextResponse.json({ error: "That paper is no longer waiting." }, { status: 404 });
    const type = (DOC_TYPES as readonly string[]).includes(String(body.type)) ? (body.type as DocType) : (p.reading?.type ?? "other");
    let bytes: Buffer | null = null;
    if (p.key.startsWith("gmail:") && p.message_id && p.attachment_id) bytes = await fetchAttachment(p.message_id, p.attachment_id);
    else if (p.key.startsWith("drop:") && p.attachment_id) bytes = await downloadBookingFile(p.attachment_id).then((d) => d.bytes).catch(() => null);
    if (!bytes) return NextResponse.json({ error: "I could not read the paper again. Drop it once more." }, { status: 500 });
    const doc = await fileUnder(String(body.request_id), bytes, p.mime || "application/octet-stream", p.name, type, "gy-inbox", p.from ? `from ${p.from}` : undefined);
    if (p.key.startsWith("drop:") && p.attachment_id) await deleteBookingFile(p.attachment_id).catch(() => {});
    await dropPending(p.key);
    return NextResponse.json({ ok: true, doc });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
