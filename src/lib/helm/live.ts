// src/lib/helm/live.ts
// 2026-11-06 — what the client has done, for The Helm's table, kept current.
//
// George: "να έχω μια στήλη που να μου λέει ότι έχει ανοιχτεί το mail μου...
// την ημερομηνία του mail και δίπλα ένα πράσινο tick... και τι link έχει
// πατήσει. Real time, σε διάρκεια ενός λεπτού."
//
// Two things per request, both cheap to read:
//   - the proposal signals (extraction->salon: views, interest, hold, dwell),
//   - every tracked email that went to that client (email_tracking), with
//     whether it was opened, how often, and which links were pressed.
// The Helm page renders them on load and then asks /api/helm/live once a
// minute; nothing here touches proposal_json or the yacht dossiers.

import { createServiceClient } from "@/lib/supabase-server";

export type SalonJson = {
  views?: number;
  last_at?: string;
  yachts?: Record<string, number>;
  dwell?: Record<string, number>;
  hold?: { yacht: string; at: string };
} | null;

export type SalonSignals = {
  salonViews: number;
  salonLastAt: string | null;
  interest: string | null;
  dwellYacht: string | null;
  dwellMin: number | null;
  holdYacht: string | null;
  holdAt: string | null;
};

export function signalsFromSalon(salon: SalonJson): SalonSignals {
  const interest = salon?.yachts
    ? Object.entries(salon.yachts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    : null;
  // The yacht they stared at longest, and a 48-hour hold request.
  const dwellTop = salon?.dwell
    ? Object.entries(salon.dwell).sort((a, b) => b[1] - a[1])[0] ?? null
    : null;
  return {
    salonViews: salon?.views ?? 0,
    salonLastAt: salon?.last_at ?? null,
    interest,
    dwellYacht: dwellTop && dwellTop[1] >= 20 ? dwellTop[0] : null,
    dwellMin: dwellTop ? Math.max(1, Math.round(dwellTop[1] / 60)) : null,
    holdYacht: salon?.hold?.yacht ?? null,
    holdAt: salon?.hold?.at ?? null,
  };
}

export type HelmEmail = {
  at: string; // when it left
  subject: string;
  /** opened | unopened | apple (Apple Mail loaded it itself: cannot tell) */
  state: "opened" | "unopened" | "apple";
  opens: number;
  lastOpenAt: string | null;
  clicks: { url: string; at: string }[];
};

const SINCE_DAYS = 150;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

function decodeSubject(s: string): string {
  return s.replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/gi, (_m, b64: string) => {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return "";
    }
  });
}

function tidyUrl(u: string): string {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (k.startsWith("utm_") || k === "gs") x.searchParams.delete(k);
    return `${x.host.replace(/^www\./, "")}${x.pathname === "/" ? "" : x.pathname}${x.search}`.slice(0, 70);
  } catch {
    return u.slice(0, 70);
  }
}

type TrackRow = {
  token: string;
  source: string;
  recipient: string | null;
  subject: string | null;
  sent_at: string;
  open_count: number | null;
  last_open_at: string | null;
};
type HitRow = { token: string; kind: string; verdict: string; at: string; url: string | null };

async function pageAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 6000; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/** Every tracked email that really left, keyed by recipient address. */
export async function emailsByAddress(): Promise<Map<string, HelmEmail[]>> {
  const sb = createServiceClient();
  const since = new Date(Date.now() - SINCE_DAYS * 86400_000).toISOString();

  const rows = await pageAll<TrackRow>((from, to) =>
    sb
      .from("email_tracking")
      .select("token, source, recipient, subject, sent_at, open_count, last_open_at")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .range(from, to),
  );
  // Proof of sending (copy/msg), the links pressed, and Apple's own loads.
  const hits = await pageAll<HitRow>((from, to) =>
    sb
      .from("email_tracking_hits")
      .select("token, kind, verdict, at, url")
      .gte("at", since)
      .or("kind.in.(click,copy,msg),and(kind.eq.open,verdict.eq.apple-mpp)")
      .order("at", { ascending: true })
      .range(from, to),
  );

  const sent = new Set<string>();
  const apple = new Set<string>();
  const clicks = new Map<string, Map<string, string>>();
  for (const h of hits) {
    if (h.kind === "copy" || h.kind === "msg") {
      if (/"(o|m)":"[^"]+"/.test(h.url || "")) sent.add(h.token);
    } else if (h.kind === "open") {
      apple.add(h.token);
    } else if (h.kind === "click" && h.verdict === "human" && h.url) {
      const m = clicks.get(h.token) || new Map<string, string>();
      m.set(tidyUrl(h.url), h.at); // latest press of each link wins
      clicks.set(h.token, m);
    }
  }

  const byAddress = new Map<string, HelmEmail[]>();
  for (const r of rows) {
    // A Helm draft, or a Gmail draft that came back with Undo, only counts
    // once it has been found in Sent. Helm and Cabin send through the API.
    const left = r.source === "helm" || r.source === "cabin" || sent.has(r.token);
    if (!left) continue;
    const opens = r.open_count || 0;
    const email: HelmEmail = {
      at: r.sent_at,
      subject: decodeSubject(r.subject || "").slice(0, 120),
      state: opens > 0 ? "opened" : apple.has(r.token) ? "apple" : "unopened",
      opens,
      lastOpenAt: r.last_open_at,
      clicks: [...(clicks.get(r.token) || new Map<string, string>()).entries()]
        .map(([url, at]) => ({ url, at }))
        .sort((a, b) => b.at.localeCompare(a.at)),
    };
    for (const addr of new Set((r.recipient || "").toLowerCase().match(EMAIL_RE) || [])) {
      const list = byAddress.get(addr) || [];
      list.push(email);
      byAddress.set(addr, list);
    }
  }
  return byAddress;
}

/**
 * The emails that belong to each request: everything sent to its client's
 * address from the day the request came in, up to the client's next request
 * (a returning client's new season is a new row with its own emails).
 */
export function emailsForRequests(
  reqs: { id: string; client_email: string | null; created_at: string }[],
  byAddress: Map<string, HelmEmail[]>,
): Record<string, HelmEmail[]> {
  const out: Record<string, HelmEmail[]> = {};
  const perAddress = new Map<string, { id: string; created: number }[]>();
  for (const r of reqs) {
    const a = (r.client_email || "").trim().toLowerCase();
    if (!a) continue;
    const list = perAddress.get(a) || [];
    list.push({ id: r.id, created: Date.parse(r.created_at) || 0 });
    perAddress.set(a, list);
  }
  for (const [addr, list] of perAddress) {
    const emails = byAddress.get(addr) || [];
    list.sort((x, y) => x.created - y.created);
    list.forEach((req, i) => {
      // The first request also takes anything sent before it was filed.
      const from = i === 0 ? 0 : req.created - 86400_000;
      const until = i + 1 < list.length ? list[i + 1].created - 86400_000 : Infinity;
      out[req.id] = emails.filter((e) => {
        const t = Date.parse(e.at);
        return t >= from && t < until;
      });
    });
  }
  return out;
}

export type LiveRow = SalonSignals & { emails: HelmEmail[] };

/** One light read of every request's live signals, for the minute poll. */
export async function helmLive(): Promise<Record<string, LiveRow>> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("helm_requests")
    .select("id, client_email, created_at, salon:extraction->salon")
    .order("created_at", { ascending: false })
    .range(0, 1999);
  const reqs = (data || []) as { id: string; client_email: string | null; created_at: string; salon: SalonJson }[];
  const emails = emailsForRequests(reqs, await emailsByAddress());
  const out: Record<string, LiveRow> = {};
  for (const r of reqs) out[r.id] = { ...signalsFromSalon(r.salon), emails: emails[r.id] || [] };
  return out;
}
