// Daily Pinterest publish cron — pins a yacht, a destination, or
// a blog post to Pinterest with deep-link UTM tracking.
//
// Pinterest is one of the top free SEO surfaces for luxury travel
// (NYT, Forbes, Conde Nast all run Pinterest pipelines). Each pin
// indexes in Google Image Search + Pinterest's own search, drives
// long-tail traffic to georgeyachts.com for months after publish.
//
// Rotation:
//   • Monday / Thursday        → yacht (pulls next slug from the
//                                shared story_yacht_rotation_v1
//                                cycle so all 63 yachts loop)
//   • Tuesday / Friday         → destination (Cyclades/Ionian/
//                                Saronic + island-specific)
//   • Wednesday / Saturday     → blog post (newest by publishedAt)
//   • Sunday                   → rest day (skipped silently)
//
// Free forever. Pinterest API quota: 1 000 calls/day. We use ~3.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";
import { createPin, pinterestStatus } from "@/lib/pinterest-client";
import { fetchFleetForStories } from "@/lib/sanity-fleet";

export const runtime = "nodejs";
export const maxDuration = 60;

const UTM = "?utm_source=pinterest&utm_medium=social&utm_campaign=auto_pin";
const SITE = "https://georgeyachts.com";

// Greek destinations to rotate through.
const DESTINATIONS: Array<{ slug: string; name: string; description: string }> = [
  {
    slug: "destinations/cyclades",
    name: "Cyclades — Mykonos, Santorini, Paros",
    description:
      "The white-and-blue heart of the Aegean. Mykonos, Santorini, Paros, Naxos, Antiparos and Milos in one charter — anchorages, mooring tips, and itinerary planning from a working Greek broker.",
  },
  {
    slug: "destinations/ionian",
    name: "Ionian — Corfu, Paxos, Lefkada, Kefalonia",
    description:
      "Calmer waters, lush green coastlines, and the best charter region for first-time guests. Corfu through Ithaca with anchorage notes from George Yachts.",
  },
  {
    slug: "destinations/saronic",
    name: "Saronic — Hydra, Spetses, Poros",
    description:
      "A long-weekend escape from Athens through Hydra, Spetses, Poros and Aegina. Short distances, easy anchorages, and timeless Greek island atmosphere.",
  },
  {
    slug: "yacht-charter-mykonos-anchorages",
    name: "Mykonos Yacht Anchorages — Complete Guide",
    description:
      "Every Mykonos anchorage — depth, holding, shelter, ashore access. Verified by a working Greek charter broker.",
  },
  {
    slug: "yacht-charter-santorini-anchorages",
    name: "Santorini Yacht Anchorages — Complete Guide",
    description:
      "The caldera anchorages of Santorini, with realistic notes on wind, depth, and time-of-day for the iconic sunset view.",
  },
  {
    slug: "yacht-charter-paros-anchorages",
    name: "Paros Yacht Anchorages — Complete Guide",
    description:
      "Paros anchorages broker-tested — Kolymbithres, Naoussa Bay, Lageri — with realistic depth and shelter notes.",
  },
  {
    slug: "yacht-charter-hydra-anchorages",
    name: "Hydra Yacht Anchorages — Complete Guide",
    description:
      "Hydra anchorages and town-quay mooring tips from a working Greek broker.",
  },
  {
    slug: "yacht-charter-corfu-anchorages",
    name: "Corfu Yacht Anchorages — Complete Guide",
    description:
      "Corfu's bays, town-side mooring, and Northern Ionian anchorage strategy for first-time visitors.",
  },
];

const YACHT_ROT_KEY = "pinterest_yacht_rotation_v1";
const PUBLISH_LOG_KEY = "pinterest_recent_pins";

type RotKind = "yacht" | "destination" | "blog" | "rest";

function pickKindForDay(d = new Date()): RotKind {
  // Athens-day-of-week mapping (Sun = 0 ... Sat = 6).
  const athensDow = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", weekday: "short" })
      .formatToParts(d)
      .find((p) => p.type === "weekday")?.value
      ? // Convert short weekday to number ourselves so we don't depend
        // on locale-specific outputs.
        ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<
          string,
          number
        >)[
          new Intl.DateTimeFormat("en-US", {
            timeZone: "Europe/Athens",
            weekday: "short",
          })
            .formatToParts(d)
            .find((p) => p.type === "weekday")?.value || "Sun"
        ]
      : 0,
  );
  if (athensDow === 1 || athensDow === 4) return "yacht";
  if (athensDow === 2 || athensDow === 5) return "destination";
  if (athensDow === 3 || athensDow === 6) return "blog";
  return "rest";
}

interface PinTarget {
  kind: "yacht" | "destination" | "blog";
  imageUrl: string;
  title: string;
  description: string;
  link: string;
  identifier: string; // for de-dup tracking
}

async function pickYachtTarget(sb: any): Promise<PinTarget | null> {
  const fleet = await fetchFleetForStories();
  if (fleet.length === 0) return null;
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", YACHT_ROT_KEY)
    .maybeSingle();
  let used: string[] = [];
  try {
    const v = data?.value ? JSON.parse(data.value) : {};
    used = Array.isArray(v?.usedSlugs) ? v.usedSlugs : [];
  } catch {}
  let pool = fleet.filter((y) => !used.includes(y.slug || ""));
  if (pool.length === 0) {
    used = [];
    pool = fleet.slice();
  }
  const choice = pool[0];
  const slug = choice.slug || "";
  if (!slug || !choice.images?.[0]?.url) return null;
  const nextUsed = [...used, slug];
  await sb
    .from("settings")
    .upsert(
      {
        key: YACHT_ROT_KEY,
        value: JSON.stringify({ usedSlugs: nextUsed, lastSlug: slug }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    )
    .catch(() => {});

  const lengthLine = choice.length ? `${choice.length}` : "";
  const capacityLine = choice.sleeps ? `Sleeps ${choice.sleeps}` : "";
  const subtitleBits = [lengthLine, capacityLine, choice.category]
    .filter(Boolean)
    .join(" · ");
  const desc =
    `${choice.name} — luxury crewed yacht charter in Greek waters. ` +
    (subtitleBits ? `${subtitleBits}. ` : "") +
    `Cruises ${choice.cruisingRegion || "Greek islands"}. ` +
    `Plan your private yacht charter with George Yachts — IYBA Charter Active Member.`;

  return {
    kind: "yacht",
    imageUrl: choice.images[0].url,
    title: `${choice.name} — Crewed Yacht Charter Greece`.slice(0, 100),
    description: desc.slice(0, 800),
    link: `${SITE}/yachts/${slug}${UTM}`,
    identifier: `yacht:${slug}`,
  };
}

function pickDestinationTarget(): PinTarget | null {
  if (DESTINATIONS.length === 0) return null;
  // Pick by day-of-year so we rotate across all destinations.
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const dest = DESTINATIONS[dayOfYear % DESTINATIONS.length];
  // For destination cover image we use the live OG image of the page —
  // it's already 1200x630 (Pinterest-friendly), branded, and updates
  // automatically when the page changes.
  const ogImage = `${SITE}/opengraph-image?path=${encodeURIComponent("/" + dest.slug)}`;
  return {
    kind: "destination",
    imageUrl: ogImage,
    title: dest.name.slice(0, 100),
    description: dest.description,
    link: `${SITE}/${dest.slug}${UTM}`,
    identifier: `dest:${dest.slug}`,
  };
}

async function pickBlogTarget(): Promise<PinTarget | null> {
  // Pull the newest published blog post from Sanity CDN.
  try {
    const query = encodeURIComponent(
      `*[_type == "post" && defined(slug.current) && defined(publishedAt) && publishedAt < now()] | order(publishedAt desc) [0...10] {
        title, "slug": slug.current, excerpt,
        "image": mainImage.asset->url
      }`,
    );
    const url = `https://ecqr94ey.apicdn.sanity.io/v2024-01-01/data/query/production?query=${query}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    const posts: any[] = Array.isArray(body?.result) ? body.result : [];
    if (posts.length === 0) return null;

    // Rotate across last 10 posts using day-of-year so we don't pin
    // the same article every Wednesday + Saturday.
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
    );
    const post = posts[dayOfYear % posts.length];
    if (!post || !post.slug || !post.image) return null;
    return {
      kind: "blog",
      imageUrl: post.image,
      title: post.title.slice(0, 100),
      description:
        (post.excerpt ||
          `${post.title} — read the full article on George Yachts, IYBA-member luxury yacht charter brokerage in Greece.`)
          .slice(0, 800),
      link: `${SITE}/blog/${post.slug}${UTM}`,
      identifier: `blog:${post.slug}`,
    };
  } catch {
    return null;
  }
}

async function _observedImpl() {
  const status = pinterestStatus();
  if (!status.configured) {
    return NextResponse.json({
      skipped: "pinterest_not_configured",
      missing: status.missing,
    });
  }
  const boardId = process.env.PINTEREST_BOARD_ID!;

  const kind = pickKindForDay();
  if (kind === "rest") {
    return NextResponse.json({ skipped: "rest_day" });
  }

  const sb = createServiceClient();

  let target: PinTarget | null = null;
  if (kind === "yacht") target = await pickYachtTarget(sb);
  else if (kind === "destination") target = pickDestinationTarget();
  else if (kind === "blog") target = await pickBlogTarget();

  if (!target) {
    await sendTelegram(`⚠️ <b>Pinterest publish skipped</b> — no eligible ${kind} target`);
    return NextResponse.json({ skipped: "no_target", kind });
  }

  // Dedupe: don't republish the same target twice within 30 days.
  let recent: string[] = [];
  try {
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", PUBLISH_LOG_KEY)
      .maybeSingle();
    recent = data?.value ? JSON.parse(data.value) : [];
    if (!Array.isArray(recent)) recent = [];
  } catch {}
  if (recent.includes(target.identifier)) {
    return NextResponse.json({ skipped: "duplicate_recent", identifier: target.identifier });
  }

  const result = await createPin({
    boardId,
    imageUrl: target.imageUrl,
    title: target.title,
    description: target.description,
    link: target.link,
    altText: target.title,
  });

  if (!result.ok) {
    await sendTelegram(
      `⚠️ <b>Pinterest pin failed</b>\nKind: ${kind}\nTarget: ${target.identifier}\nError: <code>${(result as any).error?.slice?.(0, 200) || "unknown"}</code>`,
    );
    return NextResponse.json({ ok: false, error: (result as any).error });
  }

  // Update the recent-pins log (keep last 60 entries).
  recent.push(target.identifier);
  if (recent.length > 60) recent = recent.slice(-60);
  try {
    await sb.from("settings").upsert(
      {
        key: PUBLISH_LOG_KEY,
        value: JSON.stringify(recent),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {}

  const tg = [
    `📌 <b>Pinterest pin published</b>`,
    ``,
    `<b>Kind:</b> ${kind}`,
    `<b>Target:</b> ${target.identifier}`,
    `<b>Title:</b> ${target.title}`,
    `<b>Link:</b> <code>${target.link}</code>`,
    result.permalink ? `\n<a href="${result.permalink}">View on Pinterest →</a>` : "",
  ].join("\n");
  await sendTelegram(tg).catch(() => {});

  return NextResponse.json({
    ok: true,
    kind,
    pin_id: result.pin_id,
    permalink: result.permalink,
    target: target.identifier,
  });
}

export async function GET(): Promise<Response> {
  return observeCron("pinterest-publish", _observedImpl);
}
