// src/lib/sent-copy.ts
// 2026-11-05 — George's own copy of a tracked email carries no tracker.
//
// Why. Gmail fetches every image through its proxy in exactly the same way
// for the client's inbox and for George's Sent folder, so an open of his own
// copy cannot be told apart from the client's (see the note on /api/t/self).
// Detecting it is impossible; preventing it is not. After a tracked email
// leaves, we put in his Sent folder a copy of the very same message, byte for
// byte, except in its HTML:
//   - our open pixels are gone (also old ones quoted from earlier emails),
//   - our tracked links point straight at their destination again,
//   - Edition links carry ?gs=<sig>, so a proposal opened from his copy, in
//     any browser including the Gmail app's, is the house and never a view.
// Then the original Sent copy goes to the Trash (never a permanent delete).
// The client's email is untouched: it left before any of this happens.
//
// Safety, in order:
//   - nothing is trashed unless the new copy was created, has a different id
//     and is in the same thread (Gmail may dedupe by Message-ID; if it ever
//     hands back the original, we stop),
//   - same Message-ID, Subject, Date, labels and thread, so replies, Helm's
//     follow-ups and the reply poller see one conversation as before,
//   - Helm rows that stored the original id are moved to the new one,
//   - any failure leaves the original exactly where it was.

import { after } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { verifyClick, staffSig, trackingBaseUrl, recordMeta, readMeta, noteSentMessage, sleep } from "@/lib/email-tracking";
import { resolveEditionRef } from "@/lib/helm/edition-link";

const MAX_BYTES = 30 * 1024 * 1024;
const KEEP_LABEL = /^(SENT|INBOX|IMPORTANT|STARRED|UNREAD|Label_.+)$/;

// ── MIME, just enough: walk multiparts, rewrite text/html parts ─────────
// Everything is handled as a latin1 "binary" string so bytes survive 1:1.

function splitEntity(entity: string): { head: string; sep: string; body: string } {
  const crlf = entity.indexOf("\r\n\r\n");
  const lf = entity.indexOf("\n\n");
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { head: entity.slice(0, crlf), sep: "\r\n\r\n", body: entity.slice(crlf + 4) };
  if (lf >= 0) return { head: entity.slice(0, lf), sep: "\n\n", body: entity.slice(lf + 2) };
  return { head: entity, sep: "", body: "" };
}

function headerValue(head: string, name: string): string {
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ");
  const re = new RegExp(`^${name}:[ \\t]*(.*)$`, "im");
  return (unfolded.match(re)?.[1] || "").trim();
}

function param(value: string, name: string): string {
  const m = value.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i"));
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function dropHeader(head: string, name: string): string {
  const eol = head.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  let skipping = false;
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) out.push(line);
      continue;
    }
    skipping = new RegExp(`^${name}:`, "i").test(line);
    if (!skipping) out.push(line);
  }
  return out.join(eol);
}

function decodeBody(body: string, cte: string): Buffer {
  const enc = cte.toLowerCase();
  if (enc === "base64") return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (enc === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(s.charCodeAt(i) & 0xff);
      }
    }
    return Buffer.from(bytes);
  }
  return Buffer.from(body, "latin1");
}

function decodeText(buf: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** Every text/html part of a message, decoded (used to find a token). */
export function htmlParts(entity: string): string[] {
  const out: string[] = [];
  walk(entity, (html) => {
    out.push(html);
    return null;
  });
  return out;
}

/**
 * Rewrites each text/html part with fn. fn returns null to leave a part
 * byte-identical. Returns the new entity and whether anything changed.
 */
export function walk(entity: string, fn: (html: string) => string | null): string {
  const { head, sep, body } = splitEntity(entity);
  const ctype = headerValue(head, "Content-Type") || "text/plain";
  const lower = ctype.toLowerCase();

  if (lower.startsWith("multipart/")) {
    const boundary = param(ctype, "boundary");
    if (!boundary) return entity;
    const delim = `--${boundary}`;
    const pieces = body.split(delim);
    // pieces[0] = preamble; then parts; a piece starting with "--" closes.
    for (let i = 1; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.startsWith("--")) break;
      const lead = p.match(/^[ \t]*\r?\n/)?.[0] ?? "";
      const tail = p.match(/\r?\n$/)?.[0] ?? "";
      const inner = p.slice(lead.length, p.length - tail.length);
      pieces[i] = lead + walk(inner, fn) + tail;
    }
    return head + sep + pieces.join(delim);
  }

  if (lower.startsWith("text/html")) {
    const cte = headerValue(head, "Content-Transfer-Encoding") || "7bit";
    const html = decodeText(decodeBody(body, cte), param(ctype, "charset"));
    const next = fn(html);
    if (next === null || next === html) return entity;
    const eol = head.includes("\r\n") || sep === "\r\n\r\n" ? "\r\n" : "\n";
    let h = dropHeader(dropHeader(head, "Content-Transfer-Encoding"), "Content-Type");
    h = `${h}${h ? eol : ""}Content-Type: text/html; charset="UTF-8"${eol}Content-Transfer-Encoding: base64`;
    const b64 = Buffer.from(next, "utf8").toString("base64").replace(/.{76}/g, `$&${eol}`);
    return `${h}${eol}${eol}${b64}${eol}`;
  }

  return entity;
}

// ── The house copy of the HTML ──────────────────────────────────────────

const ESC: Record<string, string> = { "&amp;": "&", "&#38;": "&", "&#x26;": "&" };
const unescapeAmp = (s: string) => s.replace(/&amp;|&#38;|&#x26;/gi, (m) => ESC[m.toLowerCase()] || "&");
const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const EDITION_RE = /^https:\/\/(?:edition\.georgeyachts\.com\/([a-z0-9]{1,24}-[a-z0-9]{6})|[a-z0-9.-]+\/p\/([A-Za-z0-9_.-]{6,200}))\/?(?:[?#].*)?$/i;

function trackingHost(): string {
  try {
    return new URL(trackingBaseUrl()).host;
  } catch {
    return "command.georgeyachts.com";
  }
}

/** Original destination of one of our click links, or null. */
function untrack(href: string): string | null {
  const plain = unescapeAmp(href);
  let u: URL;
  try {
    u = new URL(plain);
  } catch {
    return null;
  }
  if (u.host !== trackingHost() || u.pathname !== "/api/t/c") return null;
  const t = u.searchParams.get("t") || "";
  const s = u.searchParams.get("s") || "";
  let dest = "";
  try {
    dest = Buffer.from(u.searchParams.get("u") || "", "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!dest.startsWith("http")) return null;
  try {
    return verifyClick(t, dest, s) ? dest : null;
  } catch {
    return null;
  }
}

export async function houseHtml(html: string): Promise<string> {
  // 1. our pixels, ours only (any token: quoted older emails carry theirs).
  const host = trackingHost().replace(/\./g, "\\.");
  let out = html.replace(new RegExp(`<img\\b[^>]*${host}\\/api\\/t\\/o\\?[^>]*>`, "gi"), "");

  // 2. tracked links back to their destination.
  out = out.replace(
    new RegExp(`https?:\\/\\/${host}\\/api\\/t\\/c\\?[^"'\\s<>]+`, "gi"),
    (m) => {
      const dest = untrack(m);
      return dest ? escapeAttr(dest) : m;
    },
  );

  // 3. Edition links: the house marker.
  const refs = new Map<string, string | null>();
  const hrefRe = /href="([^"]+)"/gi;
  for (const m of out.matchAll(hrefRe)) {
    const plain = unescapeAmp(m[1]);
    const em = plain.match(EDITION_RE);
    const ref = em?.[1] || em?.[2];
    if (ref && !/\/p\/[^/]+\/(event|cover|pdf|cabin)/.test(plain) && !refs.has(ref)) refs.set(ref, null);
  }
  for (const ref of refs.keys()) {
    try {
      refs.set(ref, await resolveEditionRef(ref));
    } catch {
      /* leave it unmarked */
    }
  }
  out = out.replace(hrefRe, (whole, href: string) => {
    const plain = unescapeAmp(href);
    const em = plain.match(EDITION_RE);
    const id = em ? refs.get(em[1] || em[2]) : null;
    if (!id || /[?&]gs=/.test(plain)) return whole;
    const [base, hash = ""] = plain.split("#");
    const marked = `${base}${base.includes("?") ? "&" : "?"}gs=${staffSig(id)}${hash ? `#${hash}` : ""}`;
    return `href="${escapeAttr(marked)}"`;
  });
  return out;
}

// ── Swap ────────────────────────────────────────────────────────────────

type RawMessage = { id: string; threadId: string; labelIds?: string[]; raw?: string; sizeEstimate?: number };

async function getRaw(id: string): Promise<RawMessage | null> {
  const res = await gmailFetch(`/messages/${id}?format=raw`);
  if (!res.ok) return null;
  return (await res.json()) as RawMessage;
}

function toBinary(raw: string): string {
  return Buffer.from(raw, "base64url").toString("latin1");
}

function carriesToken(binary: string, token: string): boolean {
  const needle = `/api/t/o?t=${token}`;
  return htmlParts(binary).some((h) => h.includes(needle) || h.includes(`t=${token}&`) || h.includes(`t=${token}&amp;`));
}

export type CleanResult = "done" | "already" | "not-found" | "failed" | "skipped";

/**
 * Replace one Sent message with its house copy. `token` must be in it.
 * Idempotent: a token cleaned before is never cleaned again.
 */
export async function cleanSentCopy(token: string, messageId: string): Promise<CleanResult> {
  try {
    const prior = await readMeta(token, "copy");
    if (prior && ["done", "skipped", "gave-up"].includes(prior.verdict)) return "already";
    // Transient failures retry, three times at most.
    const sb0 = createServiceClient();
    const { count: fails } = await sb0
      .from("email_tracking_hits")
      .select("id", { count: "exact", head: true })
      .eq("token", token)
      .eq("kind", "copy")
      .eq("verdict", "failed");
    if ((fails || 0) >= 3) return "already";

    const msg = await getRaw(messageId);
    if (!msg?.raw) return "not-found";
    const labels = msg.labelIds || [];
    if (!labels.includes("SENT") || labels.includes("TRASH") || labels.includes("DRAFT")) return "not-found";
    if ((msg.sizeEstimate || 0) > MAX_BYTES) {
      await recordMeta(token, "copy", "skipped", { why: "size", o: messageId });
      return "skipped";
    }

    const binary = toBinary(msg.raw);
    if (!carriesToken(binary, token)) return "not-found";

    // walk() needs async-free fn: precompute each html part's house version.
    const originals = htmlParts(binary);
    const houses = await Promise.all(originals.map((h) => houseHtml(h)));
    let i = 0;
    const next = walk(binary, (html) => {
      const k = i++;
      return originals[k] === html ? houses[k] : html;
    });
    if (next === binary) {
      await recordMeta(token, "copy", "skipped", { why: "nothing to remove", o: messageId });
      return "skipped";
    }

    const keep = labels.filter((l) => KEEP_LABEL.test(l));
    const boundary = `gyhouse_${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ threadId: msg.threadId, labelIds: keep });
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`, "utf8"),
      Buffer.from(next, "latin1"),
      Buffer.from(`\r\n--${boundary}--`, "utf8"),
    ]);
    const ins = await gmailFetch(
      "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages?uploadType=multipart&internalDateSource=dateHeader",
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: payload },
    );
    if (!ins.ok) {
      await recordMeta(token, "copy", "failed", { why: `insert ${ins.status}`, o: messageId, e: (await ins.text()).slice(0, 200) });
      return "failed";
    }
    const created = (await ins.json()) as { id?: string; threadId?: string };
    if (!created.id || created.id === messageId) {
      await recordMeta(token, "copy", "gave-up", { why: "dedupe", o: messageId });
      return "failed";
    }
    // The copy must really be there, without our pixel, before the original goes.
    const check = await getRaw(created.id);
    const stillTracked = !!check?.raw && htmlParts(toBinary(check.raw)).some((h) => h.includes(`/api/t/o?t=${token}`));
    if (!check?.raw || stillTracked) {
      await gmailFetch(`/messages/${created.id}/trash`, { method: "POST" }).catch(() => null);
      await recordMeta(token, "copy", "gave-up", { why: "verify", o: messageId, m: created.id });
      return "failed";
    }

    const tr = await gmailFetch(`/messages/${messageId}/trash`, { method: "POST" });
    if (!tr.ok) {
      // Two copies in Sent is untidy, never harmful. Remove ours instead.
      await gmailFetch(`/messages/${created.id}/trash`, { method: "POST" }).catch(() => null);
      await recordMeta(token, "copy", "gave-up", { why: `trash ${tr.status}`, o: messageId });
      return "failed";
    }

    await recordMeta(token, "copy", "done", { o: messageId, m: created.id, th: created.threadId || msg.threadId });

    // Helm remembers Gmail ids for follow-ups; point them at the copy.
    try {
      const sb = createServiceClient();
      await sb.from("helm_requests").update({ gmail_last_message_id: created.id }).eq("gmail_last_message_id", messageId);
      await sb.from("helm_messages").update({ gmail_message_id: created.id }).eq("gmail_message_id", messageId);
    } catch {
      /* the thread id is unchanged, so threading holds regardless */
    }
    return "done";
  } catch (err) {
    console.error("[sent-copy] failed:", err);
    await recordMeta(token, "copy", "failed", { why: "threw", o: messageId });
    return "failed";
  }
}

/**
 * Find the Sent message for a token and clean it. For sends George pressed
 * himself (Helm drafts, Gmail with GY Track) we only know recipient and time.
 */
export async function findAndClean(row: { token: string; recipient: string | null; sent_at: string }): Promise<CleanResult> {
  const known = (await readMeta(row.token, "msg"))?.data?.m;
  if (known) {
    const r = await cleanSentCopy(row.token, known);
    if (r !== "not-found") return r;
  }
  const to = (row.recipient || "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]+/)?.[0];
  if (!to) return "not-found";
  const after = Math.floor(Date.parse(row.sent_at) / 1000) - 3600;
  const q = `in:sent to:${to} after:${after}`;
  const res = await gmailFetch(`/messages?${new URLSearchParams({ q, maxResults: "8" })}`);
  if (!res.ok) return "failed";
  const list = ((await res.json()) as { messages?: { id: string }[] }).messages || [];
  // Oldest first: a later reply that quotes this email carries its pixel
  // too, and the email itself is always older than anything quoting it.
  for (const m of [...list].reverse()) {
    const r = await cleanSentCopy(row.token, m.id);
    if (r !== "not-found") return r;
  }
  return "not-found";
}

/**
 * Right after an API send: remember the message, and swap George's copy a
 * few seconds later, once the request has answered. Outside a request (or
 * if anything goes wrong) the 2-minute cron does the same job.
 */
export async function afterTrackedSend(token: string | null, messageId: string, threadId?: string): Promise<void> {
  if (!token || !messageId) return;
  await noteSentMessage(token, messageId, threadId);
  try {
    after(async () => {
      await sleep(4_000);
      await cleanSentCopy(token, messageId);
    });
  } catch {
    /* the cron will catch it */
  }
}
