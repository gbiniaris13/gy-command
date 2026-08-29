// @ts-nocheck
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";
import { dfsFetch } from "@/lib/dataforseo";

// WEB MENTIONS — pages across the web that talk about us.
//
// The unlinked mention is the easiest backlink that exists: someone
// already wrote about the house and simply forgot the link, so a
// polite note usually lands. Content Analysis is the finder.
//
// Query hygiene, learned 29/8: a bare "george yachts" phrase matches
// every Cape George sailboat listing in America. So we search the
// unambiguous phrases only, and drop our own domain plus obvious
// aggregator noise.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const SNAP_KEY = "web_mentions_latest";
// "biniaris" alone drags in every actor and kickboxer of the name
// (verified 29/8: Takis, Aris, Georgios-the-heavyweight...). Only
// unambiguous phrases survive.
const PHRASES = ['"georgeyachts"', '"george yachts"', '"george p. biniaris"'];
// "Cape George" is a US sailboat builder, so '"george yachts"' matches
// every "Cape George yachts for sale" listing. Snippet-level filter.
const NOISE = ["georgeyachts.com", "yachtr.com", "yachtworld", "boats.com", "boattrader"];

export async function GET() {
  const snap = await getSetting(SNAP_KEY);
  return NextResponse.json({ latest: snap ? JSON.parse(snap) : null });
}

export async function POST() {
  let totalCost = 0;
  const byUrl = new Map();
  const errors = [];
  for (const phrase of PHRASES) {
    try {
      const { result, cost } = await dfsFetch("content_analysis/search/live", {
        keyword: phrase,
        search_mode: "as_is",
        limit: 60,
      });
      totalCost += cost;
      for (const i of result?.items ?? []) {
        const dom = (i.domain || "").toLowerCase();
        if (!i.url || NOISE.some((n) => dom.includes(n))) continue;
        const blob = `${i.content_info?.title ?? ""} ${i.content_info?.snippet ?? ""} ${i.url}`.toLowerCase();
        if (blob.includes("cape george") || blob.includes("cape-george")) continue;
        const prev = byUrl.get(i.url);
        const entry = prev ?? {
          url: i.url,
          domain: i.domain,
          title: i.content_info?.title ?? null,
          snippet: (i.content_info?.snippet ?? "").slice(0, 240),
          fetched: i.fetch_time ?? null,
          matched: [],
        };
        if (!entry.matched.includes(phrase)) entry.matched.push(phrase);
        byUrl.set(i.url, entry);
      }
    } catch (e) {
      errors.push(`${phrase}: ${String(e?.message ?? e)}`);
    }
  }

  const mentions = [...byUrl.values()].slice(0, 100);
  const snapshot = {
    generated_at: new Date().toISOString(),
    cost_usd: Math.round(totalCost * 1000) / 1000,
    phrases: PHRASES,
    total: mentions.length,
    errors,
    mentions,
  };
  await setSetting(SNAP_KEY, JSON.stringify(snapshot));
  return NextResponse.json({ ok: true, ...snapshot });
}
