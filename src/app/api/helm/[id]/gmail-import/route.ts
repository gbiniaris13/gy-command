// POST /api/helm/:id/gmail-import — George-driven Gmail import for The Helm.
//
// George's spec (2026-07-15): he does NOT want the system reading all his
// mail. He points at specific emails per request ("διάβασε αυτό το mail,
// αυτό και αυτό") — so everything here runs ONLY on his click, over ONLY
// the messages he ticks. Email bodies are appended to supplier_raw verbatim
// (zero AI calls); PDF brochures are stored in our bucket and read with ONE
// Gemini call each (free tier), their key facts appended as text so the
// existing Extract flow picks them up unchanged.
//
// Actions:
//   { action: "thread" }                      → list this request's Gmail thread
//   { action: "search", q }                   → gmail search, max 20 results
//   { action: "import", messageIds, readBrochures } → append bodies (+ brochures)

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { gmailFetch } from "@/lib/google-api";
import { createServiceClient } from "@/lib/supabase-server";
import { getRequest } from "@/lib/helm-admin";
import { uploadBrochurePdf } from "@/lib/helm/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

// ─── Gmail payload helpers ───────────────────────────────────────────────────

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

function b64urlDecode(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function header(msg: GmailMessage, name: string): string {
  const h = (msg.payload?.headers || []).find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&euro;/gi, "€")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Best readable body: prefer text/plain, fall back to stripped text/html. */
function extractBody(payload: GmailPart | undefined): string {
  let plain = "";
  let html = "";
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.body?.data && !p.filename) {
      const text = b64urlDecode(p.body.data).toString("utf8");
      if (p.mimeType === "text/plain" && text.trim().length > plain.length) plain = text;
      if (p.mimeType === "text/html" && text.length > html.length) html = text;
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  const out = plain.trim() || stripHtml(html);
  // Gmail quotes pile up fast — keep a generous but bounded excerpt.
  return out.slice(0, 20000);
}

function pdfAttachments(payload: GmailPart | undefined): { filename: string; attachmentId: string; size: number }[] {
  const found: { filename: string; attachmentId: string; size: number }[] = [];
  const walk = (p?: GmailPart) => {
    if (!p) return;
    const isPdf =
      p.mimeType === "application/pdf" || /\.pdf$/i.test(p.filename || "");
    if (isPdf && p.filename && p.body?.attachmentId) {
      found.push({ filename: p.filename, attachmentId: p.body.attachmentId, size: p.body.size || 0 });
    }
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return found;
}

// ─── Brochure reading (ONE Gemini call per PDF, native inlineData) ──────────

async function brochureFacts(bytes: Buffer, filename: string): Promise<string> {
  const key = process.env.AI_API_KEY;
  if (!key) return "";
  const model = process.env.AI_MODEL || "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: "application/pdf", data: bytes.toString("base64") } },
            { text:
              "This is a yacht charter brochure. Transcribe the FACTS verbatim as plain text lines - yacht name, builder, year built/refit, length, beam, draft, guests, cabins and cabin layout, crew count and crew roles/nationalities (NO crew member names), water toys and tenders, amenities, cruising area, rates if stated, plus ANY awards, competition placements or press mentions exactly as printed (e.g. '3rd Place, Diamond Category - Chef Competition 2024' - the award verbatim but NEVER a crew member's personal name) and any guest-review quotes printed in the brochure (verbatim, prefix each with 'Guest review:'). One fact per line, exactly as written in the brochure. Do NOT summarise, do NOT invent, do NOT add marketing language. If a field is absent, skip it." },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!res.ok) throw new Error(`Gemini brochure read failed (${res.status})`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (json.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  return text ? `Brochure facts (${filename}):\n${text}` : "";
}

// ─── Message listing (metadata only — cheap, no bodies) ─────────────────────

type Listed = { id: string; from: string; subject: string; date: string; snippet: string };

async function listMeta(ids: string[]): Promise<Listed[]> {
  const out: Listed[] = [];
  for (const id of ids.slice(0, 25)) {
    const res = await gmailFetch(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    );
    if (!res.ok) continue;
    const m = (await res.json()) as GmailMessage;
    out.push({
      id: m.id,
      from: header(m, "From"),
      subject: header(m, "Subject"),
      date: header(m, "Date"),
      snippet: m.snippet || "",
    });
  }
  return out;
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "thread") {
      if (!r.gmail_thread_id) {
        return NextResponse.json({ ok: true, messages: [] });
      }
      const res = await gmailFetch(
        `/threads/${r.gmail_thread_id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      if (!res.ok) return NextResponse.json({ error: "Gmail thread fetch failed" }, { status: 502 });
      const thread = (await res.json()) as { messages?: GmailMessage[] };
      const messages: Listed[] = (thread.messages || []).map((m) => ({
        id: m.id,
        from: header(m, "From"),
        subject: header(m, "Subject"),
        date: header(m, "Date"),
        snippet: m.snippet || "",
      }));
      return NextResponse.json({ ok: true, messages });
    }

    if (action === "search") {
      const q = String(body.q || "").trim();
      if (!q) return NextResponse.json({ error: "empty query" }, { status: 400 });
      const res = await gmailFetch(`/messages?q=${encodeURIComponent(q)}&maxResults=25`);
      if (!res.ok) return NextResponse.json({ error: "Gmail search failed" }, { status: 502 });
      const list = (await res.json()) as { messages?: { id: string }[] };
      const messages = await listMeta((list.messages || []).map((m) => m.id));
      return NextResponse.json({ ok: true, messages });
    }

    if (action === "import") {
      const ids: string[] = Array.isArray(body.messageIds)
        ? body.messageIds.map(String).slice(0, 10)
        : [];
      if (!ids.length) return NextResponse.json({ error: "no messages selected" }, { status: 400 });
      const readBrochures = body.readBrochures !== false;

      const existing = String(r.supplier_raw || "");
      const blocks: string[] = [];
      const brochures: { filename: string; url: string; facts: boolean }[] = [];
      const skipped: string[] = [];
      const warnings: string[] = [];

      for (const mid of ids) {
        // Idempotence: each imported block carries a [gmail:<id>] marker.
        if (existing.includes(`[gmail:${mid}]`)) { skipped.push(mid); continue; }

        const res = await gmailFetch(`/messages/${mid}?format=full`);
        if (!res.ok) { warnings.push(`Message ${mid}: fetch failed`); continue; }
        const m = (await res.json()) as GmailMessage;

        const from = header(m, "From");
        const subject = header(m, "Subject");
        const date = header(m, "Date");
        const text = extractBody(m.payload);

        const parts = [
          `───── EMAIL [gmail:${mid}] ─────`,
          `From: ${from}`,
          `Subject: ${subject}`,
          `Date: ${date}`,
          ``,
          text || "(no readable body)",
        ];

        for (const att of pdfAttachments(m.payload)) {
          if (att.size > 20 * 1024 * 1024) {
            warnings.push(`${att.filename}: over 20MB, skipped — upload it manually on the yacht card`);
            continue;
          }
          try {
            const ares = await gmailFetch(`/messages/${mid}/attachments/${att.attachmentId}`);
            if (!ares.ok) throw new Error(`attachment fetch ${ares.status}`);
            const adata = (await ares.json()) as { data?: string };
            if (!adata.data) throw new Error("empty attachment");
            const bytes = b64urlDecode(adata.data);
            const url = await uploadBrochurePdf(id, att.filename, new Uint8Array(bytes));

            let facts = "";
            if (readBrochures) {
              try {
                facts = await brochureFacts(bytes, att.filename);
              } catch (e) {
                warnings.push(`${att.filename}: brochure read failed (${(e as Error).message}) — PDF saved, facts not extracted`);
              }
            }
            brochures.push({ filename: att.filename, url, facts: !!facts });
            parts.push("", `[Attachment saved: ${att.filename}]`);
            if (facts) parts.push("", facts);
          } catch (e) {
            warnings.push(`${att.filename}: ${(e as Error).message}`);
          }
        }

        blocks.push(parts.join("\n"));
      }

      if (!blocks.length && !brochures.length) {
        return NextResponse.json({
          ok: true, appended: 0, brochures: [], skipped, warnings,
          note: skipped.length ? "All selected emails were already imported." : "Nothing imported.",
        });
      }

      const supplier_raw = [existing.trim(), blocks.join("\n\n")].filter(Boolean).join("\n\n");
      const db = createServiceClient();
      const { error } = await db
        .from("helm_requests")
        .update({ supplier_raw, last_activity_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);

      await db.from("helm_messages").insert({
        request_id: id,
        direction: null,
        channel: "note",
        body: `Imported ${blocks.length} email(s) from Gmail into supplier text${brochures.length ? ` + ${brochures.length} brochure PDF(s) saved` : ""}. (by ${email})`,
      });

      return NextResponse.json({ ok: true, appended: blocks.length, brochures, skipped, warnings });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
