// GET /api/helm/:id/supplier-replies — every supplier reply that belongs to
// THIS request, matched automatically (2026-07-17, George: "με δυσκολεύει
// πάρα πολύ να βρω ποιο mail πάει πού").
//
// Two matchers, merged:
//   1. The Gmail THREADS bound at inquiry-send time
//      (extraction.supplier_threads — one per recipient).
//   2. A Ref-code sweep: any OTHER inbox mail whose subject carries this
//      request's GYddmmyyhhmm code (covers the supplier who starts a fresh
//      email instead of replying).
// Inbound messages only (our own SENT are filtered out). Each message is
// flagged `imported` when its [gmail:<id>] marker already sits in
// supplier_raw, so the panel shows what is new at a glance.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@/lib/helm-admin";
import { gmailFetch } from "@/lib/google-api";
import { refCode } from "@/lib/helm/refcode";

export const runtime = "nodejs";
export const maxDuration = 60;

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

type GmailMsg = {
  id: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

function header(m: GmailMsg, name: string): string {
  return (m.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await getRequest(id);
  if (!r) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const ex = (r.extraction && typeof r.extraction === "object" ? r.extraction : {}) as Record<string, unknown>;
  const threads = (Array.isArray(ex.supplier_threads) ? ex.supplier_threads : []) as
    { email: string; thread_id: string; message_id: string; at: string }[];
  const supplierRaw = String(r.supplier_raw ?? "");
  const code = refCode((r as { created_at?: string }).created_at);

  type Reply = { id: string; from: string; subject: string; date: string; snippet: string; imported: boolean };
  const groups: { supplier: string; replies: Reply[] }[] = [];
  const seenIds = new Set<string>();

  try {
    // 1) bound threads, one group per supplier
    for (const t of threads) {
      const res = await gmailFetch(
        `/threads/${t.thread_id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      if (!res.ok) continue;
      const thread = (await res.json()) as { messages?: GmailMsg[] };
      const replies: Reply[] = [];
      for (const m of thread.messages || []) {
        const labels = m.labelIds || [];
        if (labels.includes("SENT") || labels.includes("DRAFT")) continue; // ours
        if (seenIds.has(m.id)) continue;
        seenIds.add(m.id);
        replies.push({
          id: m.id,
          from: header(m, "From"),
          subject: header(m, "Subject"),
          date: header(m, "Date"),
          snippet: m.snippet || "",
          imported: supplierRaw.includes(`[gmail:${m.id}]`),
        });
      }
      if (replies.length) groups.push({ supplier: t.email, replies });
      else groups.push({ supplier: t.email, replies: [] }); // shown as "no reply yet"
    }

    // 2) Ref-code strays (fresh emails quoting the code, not in any bound thread)
    if (code) {
      const q = encodeURIComponent(`"${code}" in:inbox`);
      const res = await gmailFetch(`/messages?q=${q}&maxResults=20`);
      if (res.ok) {
        const list = (await res.json()) as { messages?: { id: string }[] };
        const strays: Reply[] = [];
        for (const s of list.messages || []) {
          if (seenIds.has(s.id)) continue;
          const mres = await gmailFetch(
            `/messages/${s.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          );
          if (!mres.ok) continue;
          const m = (await mres.json()) as GmailMsg;
          const labels = m.labelIds || [];
          if (labels.includes("SENT") || labels.includes("DRAFT")) continue;
          seenIds.add(m.id);
          strays.push({
            id: m.id,
            from: header(m, "From"),
            subject: header(m, "Subject"),
            date: header(m, "Date"),
            snippet: m.snippet || "",
            imported: supplierRaw.includes(`[gmail:${m.id}]`),
          });
        }
        if (strays.length) groups.push({ supplier: `Ref ${code} (new emails quoting the code)`, replies: strays });
      }
    }

    const newCount = groups.reduce((n, g) => n + g.replies.filter((x) => !x.imported).length, 0);
    return NextResponse.json({ ok: true, code, groups, newCount });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
