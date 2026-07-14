// GET /api/cron/mention-watcher — Wednesdays. Searches the live web
// (Gemini with Google Search grounding — the same free AI_API_KEY) for
// fresh pages mentioning George Yachts, and Telegrams anything new.
//
// Why: we discovered cyprusyachtingmagazine.com referring visitors by
// ACCIDENT. New mentions are backlink wins to celebrate, relationships
// to nurture, and prospects for the pitch queue. Seen-set lives in
// settings (mention_watcher_seen) so George is pinged once per URL.
// Truth-only: we report the grounded sources Gemini actually cites,
// never the model's ungrounded claims.

import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const SEEN_KEY = "mention_watcher_seen";
const OWN_HOSTS = [
  "georgeyachts.com",
  "instagram.com",
  "facebook.com",
  "linkedin.com",
  "pinterest.",
  "x.com",
  "twitter.com",
  "google.com",
  "iyba.org",
];

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: "AI_API_KEY missing" }, { status: 500 });

  // Native Gemini endpoint: the OpenAI-compat layer does not expose
  // Google Search grounding, the v1beta generateContent API does.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Search the web for pages that mention "George Yachts" OR "georgeyachts.com" OR "George Biniaris" (the Greek yacht charter brokerage). I am interested in third-party mentions: press, magazines, blogs, directories, forums. For each result give the URL and one line on what it says.',
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `gemini ${res.status}` }, { status: 500 });
  }
  const data = await res.json();

  // Grounded sources only — the citations Gemini actually retrieved.
  const chunks =
    data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const found: Array<{ uri: string; title: string }> = [];
  for (const c of chunks) {
    const uri: string | undefined = c?.web?.uri;
    const title: string = c?.web?.title || "";
    if (!uri) continue;
    if (OWN_HOSTS.some((h) => uri.includes(h) || title.includes(h))) continue;
    found.push({ uri, title });
  }

  const seenRaw = await getSetting(SEEN_KEY);
  const seen: string[] = seenRaw ? JSON.parse(seenRaw) : [];
  // Grounding URIs are redirect wrappers; dedupe by the visible title,
  // which carries the source domain.
  const fresh = found.filter((f) => f.title && !seen.includes(f.title));

  if (fresh.length) {
    await setSetting(
      SEEN_KEY,
      JSON.stringify([...seen, ...fresh.map((f) => f.title)].slice(-300)),
    );
    try {
      const { sendTelegram } = await import("@/lib/telegram");
      await sendTelegram(
        [
          `🔭 <b>Mention watcher — νέες αναφορές στο brand</b>`,
          ...fresh.slice(0, 8).map((f) => `• ${f.title}`),
          `Αν κάποιο είναι δημοσίευμα: ευχαριστήριο + σχέση. Αν είναι στόχος: μπαίνει στην ουρά pitch τη Δευτέρα.`,
        ].join("\n"),
      );
    } catch (e) {
      console.error("[mention-watcher] telegram failed", e);
    }
  }

  return NextResponse.json({ ok: true, grounded: found.length, fresh: fresh.length });
}
