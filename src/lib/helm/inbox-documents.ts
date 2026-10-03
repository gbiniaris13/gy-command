// GY INBOX (George, 2 October 2026): a paper arrives, is recognised, and
// files itself under the right charter. Two doors, both free and both
// narrow by design (George: no program reading all his mail, nothing that
// reads the Mac):
//
//   1. Gmail. Only attachments on messages FROM a won client's own address,
//      or messages George sends to himself with "GY INBOX" in the subject.
//      Scanned every half hour, labelled gy-filed once handled.
//   2. The drop zone at /dashboard/helm/inbox: George drops files, they
//      are read, matched and filed, or he is asked once when unsure.
//
// Reading = one vision call that says WHAT the paper is and WHOSE it is
// (surname, vessel). Passports: the kind only, never the number (house
// rule, src/app/api/lighthouse/passport). Filing = the same private bucket
// and Drive mirror as the booking panel. Unsure = the paper waits in the
// inbox list and the morning brief says so.

import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch, getSetting, setSetting } from "@/lib/google-api";
import { loadCharters, type Charter } from "@/lib/helm/timeline";
import { readBooking, mergeBooking, ensureBookingBucket, uploadBookingFile, safeFileName, bookingFolderName, DOC_TYPES, type BookingDoc, type DocType } from "@/lib/helm/booking";
import { driveScopeGranted, ensureFolderPath, uploadToDrive, DRIVE_ROOT_FOLDER, DRIVE_BOOKINGS_FOLDER } from "@/lib/google-drive";
import { getRequestLight, logHelmMessage } from "@/lib/helm-admin";

export const INBOX_LABEL = "gy-filed";
const MAX_BYTES = 20 * 1024 * 1024;
const OK_MIME = /^(application\/pdf|image\/(jpeg|png|heic|heif|webp))$/i;

export type Reading = {
  type: DocType;
  surname: string | null;
  vessel: string | null;
  dates: string | null;
  confidence: number;
  summary: string;
};

export type Pending = {
  key: string;                 // gmail:<messageId>:<attachmentId> or drop:<id>
  name: string;
  from?: string;
  received_at?: string;
  reading?: Reading;
  guess?: string;              // "Hong · S/CAT PI 2"
  message_id?: string;
  attachment_id?: string;
  mime?: string;
  size?: number;
};

// ─── reading a paper ────────────────────────────────────────────────────────

const AI_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export async function readPaper(bytes: Buffer, mime: string, filename: string, charters: Charter[]): Promise<Reading> {
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || "gemini-2.5-flash";
  const fallback: Reading = { type: "other", surname: null, vessel: null, dates: null, confidence: 0, summary: "" };
  if (!key) return fallback;
  const known = charters.slice(0, 40).map((c) => `${c.client} / ${c.vessel} / ${c.from} to ${c.to}`).join("\n");
  const prompt = [
    "You are filing a charter broker's papers. Look at this document and answer in JSON only.",
    `Fields: {"type": one of ${DOC_TYPES.join("|")}, "surname": the charterer's surname if written, else null, "vessel": the yacht name if written, else null, "dates": charter dates if written, else null, "confidence": 0 to 1, "summary": one short line}.`,
    "contract = a charter agreement (MYBA or similar). passport = a passport or ID page. payment_proof = a bank transfer, remittance or wire confirmation. invoice = an invoice or receipt. crew_list = a crew list or guest manifest. preference_sheet = a preference or guest questionnaire. Anything else = other.",
    "HARD RULE: never write a passport number, document number or any identifier in your answer; for a passport give only the type, the surname and your confidence.",
    "These are the open charters; prefer a surname or vessel that matches one of them exactly:",
    known,
    `File name: ${filename}`,
  ].join("\n");
  try {
    const res = await fetch(`${AI_URL(model)}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: mime, data: bytes.toString("base64") } }, { text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return fallback;
    const j = await res.json();
    const text: string = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const o = JSON.parse(m[0]) as Partial<Reading>;
    const type = (DOC_TYPES as readonly string[]).includes(String(o.type)) ? (o.type as DocType) : "other";
    return {
      type,
      surname: typeof o.surname === "string" && o.surname.trim() ? o.surname.trim().slice(0, 60) : null,
      vessel: typeof o.vessel === "string" && o.vessel.trim() ? o.vessel.trim().slice(0, 60) : null,
      dates: typeof o.dates === "string" && o.dates.trim() ? o.dates.trim().slice(0, 60) : null,
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
      summary: typeof o.summary === "string" ? o.summary.replace(/\d{6,}/g, "…").slice(0, 160) : "",
    };
  } catch {
    return fallback;
  }
}

// ─── whose is it ────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/^(m\/?cat|s\/?cat|p\/?cat|m\/?y|s\/?y)\s+/, "").replace(/[^a-z0-9]/g, "");

export function matchCharter(charters: Charter[], hints: { email?: string | null; surname?: string | null; vessel?: string | null }): { charter: Charter | null; sure: boolean } {
  const email = (hints.email ?? "").trim().toLowerCase();
  if (email) {
    const byEmail = charters.filter((c) => (c.email ?? "").toLowerCase() === email);
    if (byEmail.length === 1) return { charter: byEmail[0], sure: true };
    if (byEmail.length > 1) {
      const v = norm(hints.vessel);
      const pick = v ? byEmail.find((c) => norm(c.vessel) === v) : null;
      return { charter: pick ?? byEmail[0], sure: !!pick || byEmail.length === 1 };
    }
  }
  const sn = norm(hints.surname);
  const v = norm(hints.vessel);
  if (sn) {
    const bySurname = charters.filter((c) => norm(c.row.client_surname) === sn || norm(c.client).includes(sn));
    if (bySurname.length === 1) return { charter: bySurname[0], sure: true };
    if (bySurname.length > 1) {
      const pick = v ? bySurname.find((c) => norm(c.vessel) === v) : null;
      if (pick) return { charter: pick, sure: true };
      return { charter: bySurname[0], sure: false };
    }
  }
  if (v) {
    const byVessel = charters.filter((c) => norm(c.vessel) === v);
    if (byVessel.length === 1) return { charter: byVessel[0], sure: !sn };
    if (byVessel.length > 1) return { charter: byVessel[0], sure: false };
  }
  return { charter: null, sure: false };
}

// ─── filing ─────────────────────────────────────────────────────────────────

export async function fileUnder(requestId: string, bytes: Buffer, mime: string, filename: string, type: DocType, by: string, note?: string): Promise<BookingDoc> {
  const r = await getRequestLight(requestId);
  if (!r) throw new Error("request not found");
  const name = safeFileName(filename || `${type}.bin`);
  const docId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${requestId}/${docId}-${name}`;
  await ensureBookingBucket();
  await uploadBookingFile(path, bytes, mime);
  const doc: BookingDoc = { id: docId, type, name, path, size: bytes.length, mime, uploaded_at: new Date().toISOString(), uploaded_by: by, drive_file_id: null, drive_link: null, drive_error: null };
  const current = readBooking(r.extraction);
  let folderId = current.drive_folder_id;
  let folderLink = current.drive_folder_link;
  try {
    if (await driveScopeGranted()) {
      if (!folderId) {
        const f = await ensureFolderPath([DRIVE_ROOT_FOLDER, DRIVE_BOOKINGS_FOLDER, bookingFolderName(r as Parameters<typeof bookingFolderName>[0])]);
        folderId = f.id; folderLink = f.link;
      }
      const up = await uploadToDrive(folderId!, name, mime, bytes);
      doc.drive_file_id = up.id; doc.drive_link = up.link;
    } else {
      doc.drive_error = "DRIVE_SCOPE_MISSING";
    }
  } catch (e) {
    doc.drive_error = (e as Error).message.slice(0, 200);
  }
  const fresh = await getRequestLight(requestId);
  const latest = readBooking(fresh?.extraction);
  await mergeBooking(requestId, { documents: [...latest.documents, doc], drive_folder_id: folderId ?? latest.drive_folder_id, drive_folder_link: folderLink ?? latest.drive_folder_link });
  await logHelmMessage(requestId, { direction: null, channel: "note", body: `[Papers] ${name} filed as ${type}${note ? ` · ${note}` : ""}` });
  return doc;
}

// ─── the Gmail door ─────────────────────────────────────────────────────────

type GmailPart = { mimeType?: string; filename?: string; body?: { attachmentId?: string; size?: number }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };

function walk(p: GmailPart | undefined, out: { mime: string; filename: string; attachmentId: string; size: number }[]) {
  if (!p) return;
  if (p.body?.attachmentId && p.filename) out.push({ mime: p.mimeType || "", filename: p.filename, attachmentId: p.body.attachmentId, size: p.body.size || 0 });
  for (const c of p.parts ?? []) walk(c, out);
}
const hdr = (hs: { name: string; value: string }[] | undefined, n: string) => (hs ?? []).find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
const addr = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();

async function labelId(): Promise<string | null> {
  try {
    const list = await gmailFetch("/labels");
    if (!list.ok) return null;
    const j = (await list.json()) as { labels?: { id: string; name: string }[] };
    const ex = (j.labels ?? []).find((l) => l.name === INBOX_LABEL);
    if (ex) return ex.id;
    const c = await gmailFetch("/labels", { method: "POST", body: JSON.stringify({ name: INBOX_LABEL, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
    return c.ok ? ((await c.json()) as { id: string }).id : null;
  } catch { return null; }
}

export async function fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
  const res = await gmailFetch(`/messages/${messageId}/attachments/${attachmentId}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: string };
  return j.data ? Buffer.from(j.data.replace(/-/g, "+").replace(/_/g, "/"), "base64") : null;
}

export type ScanResult = { filed: { client: string; type: string; name: string; id: string }[]; pending: Pending[]; looked_at: number };

export async function scanGmailForPapers(opts: { dryRun?: boolean } = {}): Promise<ScanResult> {
  const charters = await loadCharters();
  const clientEmails = new Set(charters.map((c) => (c.email ?? "").toLowerCase()).filter(Boolean));
  const me = "george@georgeyachts.com";
  const result: ScanResult = { filed: [], pending: [], looked_at: 0 };
  const prevPending = await readPending();
  const pendingKeys = new Set(prevPending.map((p) => p.key));
  const q = `in:inbox has:attachment newer_than:3d -label:${INBOX_LABEL}`;
  const list = await gmailFetch(`/messages?q=${encodeURIComponent(q)}&maxResults=40`);
  if (!list.ok) return result;
  const ids: string[] = (((await list.json()) as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
  const lid = opts.dryRun ? null : await labelId();
  for (const mid of ids) {
    const mr = await gmailFetch(`/messages/${mid}?format=full`);
    if (!mr.ok) continue;
    const m = (await mr.json()) as { payload?: GmailPart; internalDate?: string };
    const from = addr(hdr(m.payload?.headers, "From"));
    const subject = hdr(m.payload?.headers, "Subject");
    const fromClient = clientEmails.has(from);
    const fromMe = from === me && /gy\s*inbox/i.test(subject);
    if (!fromClient && !fromMe) continue;
    result.looked_at++;
    const atts: { mime: string; filename: string; attachmentId: string; size: number }[] = [];
    walk(m.payload, atts);
    let handledAll = true;
    for (const a of atts) {
      if (!OK_MIME.test(a.mime) || a.size > MAX_BYTES) continue;
      const key = `gmail:${mid}:${a.attachmentId.slice(0, 24)}`;
      if (pendingKeys.has(key)) { handledAll = false; continue; }
      const bytes = await fetchAttachment(mid, a.attachmentId);
      if (!bytes) { handledAll = false; continue; }
      const reading = await readPaper(bytes, a.mime, a.filename, charters);
      const { charter, sure } = matchCharter(charters, { email: fromClient ? from : null, surname: reading.surname, vessel: reading.vessel });
      const confident = charter && sure && reading.confidence >= 0.7 && reading.type !== "other";
      if (confident && !opts.dryRun) {
        await fileUnder(charter.id, bytes, a.mime, a.filename, reading.type, "gy-inbox", `from ${from}${reading.summary ? ` · ${reading.summary}` : ""}`);
        result.filed.push({ client: charter.client, type: reading.type, name: a.filename, id: charter.id });
      } else if (confident && opts.dryRun) {
        result.filed.push({ client: charter.client, type: reading.type, name: a.filename, id: charter.id });
      } else {
        handledAll = false;
        result.pending.push({ key, name: a.filename, from, received_at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : undefined, reading, guess: charter ? `${charter.client} · ${charter.vessel}` : undefined, message_id: mid, attachment_id: a.attachmentId, mime: a.mime, size: a.size });
      }
    }
    if (handledAll && lid && !opts.dryRun) {
      await gmailFetch(`/messages/${mid}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [lid] }) }).catch(() => {});
    }
  }
  if (!opts.dryRun) {
    const merged = [...prevPending.filter((p) => !result.pending.some((n) => n.key === p.key)), ...result.pending].slice(-40);
    await setSetting("inbox_pending", JSON.stringify(merged));
    try { await setSetting("inbox_documents_latest", JSON.stringify({ generated_at: new Date().toISOString(), filed: result.filed, pending: merged.map((p) => ({ name: p.name, from: p.from, guess: p.guess })) })); } catch {}
  }
  return result;
}

export async function readPending(): Promise<Pending[]> {
  try { const raw = await getSetting("inbox_pending"); const j = raw ? JSON.parse(raw) : []; return Array.isArray(j) ? j : []; } catch { return []; }
}
export async function dropPending(key: string): Promise<void> {
  const p = await readPending();
  await setSetting("inbox_pending", JSON.stringify(p.filter((x) => x.key !== key)));
}

/** The Gmail pending list and the won charters, for the inbox page. */
export async function inboxOverview() {
  const [pending, charters] = await Promise.all([readPending(), loadCharters()]);
  return { pending, charters: charters.map((c) => ({ id: c.id, client: c.client, vessel: c.vessel, from: c.from, to: c.to })) };
}

export { DOC_TYPES };
export async function pendingByKey(key: string): Promise<Pending | null> {
  return (await readPending()).find((p) => p.key === key) ?? null;
}
export function dbClient() { return createServiceClient(); }
