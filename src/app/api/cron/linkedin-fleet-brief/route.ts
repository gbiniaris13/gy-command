// Friday 10:00 Athens — Fleet Intel Brief for Company Page.
//
// Fully automated. Pulls a yacht from the Sanity fleet (same rotation
// logic as instagram-fleet-post — 14-day cooldown, LRU ordering),
// generates a LinkedIn B2B-tone caption with specs + availability, and
// auto-publishes to the George Yachts Company Page.
//
// This is the "3rd weekly post" per the agreed cadence:
//   Tue/Thu  — blog article (personal + Company amplify)
//   Fri      — fleet brief (Company only, no personal)

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { aiChat } from "@/lib/ai";
import { publishAsOrganization } from "@/lib/linkedin-client";
import { fetchFleetPool } from "@/lib/sanity-fleet";
import {
  loadRotationState,
  selectNextYacht,
  updateStateAfterPost,
  persistRotationState,
} from "@/lib/fleet-rotation";

export const runtime = "nodejs";
export const maxDuration = 180;

const LINKEDIN_FLEET_SYSTEM = `
You write LinkedIn Company Page posts for George Yachts Brokerage
House LLC — a MYBA yacht charter brokerage in Athens, Greece.
Audience: charter agents and family office travel advisors booking
Mediterranean charters for clients.

Task: adapt a single yacht's spec sheet into a 150-220 word LinkedIn
post that's useful to an agent pricing an itinerary THIS WEEK.

Required content, in this order:
1. One opening line: "[YACHT NAME] — [builder/model], [year], Greek-flagged" or similar fact-dense identifier.
2. Commercial line for agents: who it suits, what makes it bookable this summer.
3. Bulleted specs AGENTS care about (not consumer fluff):
   - guests / cabins / crew size
   - base weekly rate + APA guidance (% of fee)
   - key included toys/tenders (e-foil, seabob, tender HP)
   - known availability gaps (if provided)
4. One concrete advantage grounded in the spec (e.g. power-cat fuel economy = more islands per APA euro; flybridge shade = family-friendly charter days).
5. Close with MYBA framework + inquiry email: charters@georgeyachts.com

Voice rules:
- Third-person brokerage: "At George Yachts we keep…"
- NO emojis. NO consumer hashtags. NO "stunning", "iconic", "unparalleled".
- Include the website URL https://georgeyachts.com in the body (Company Page posts can link directly).
- Hashtags separately: 4-5, industry only.

OUTPUT JSON:
{
  "mainPost": "full post body with URL",
  "hashtags": ["YachtCharter", "MYBACharter", ...]
}
`.trim();

async function generateFleetBrief(yacht: any): Promise<{
  mainPost: string;
  hashtags: string[];
  coverImage: string | null;
}> {
  const photosList = Array.isArray(yacht?.photos) ? yacht.photos : [];
  const coverImage = photosList[0] ?? null;

  const spec = [
    `Name: ${yacht.name}`,
    `Type: ${yacht.yachtType ?? "unknown"}`,
    `Builder/Model: ${yacht.builder ?? "n/a"} ${yacht.model ?? ""}`.trim(),
    `Year: ${yacht.buildYear ?? "n/a"}`,
    `Length: ${yacht.length ?? "n/a"}`,
    `Guests: ${yacht.maxGuests ?? "n/a"} in ${yacht.cabins ?? "n/a"} cabins`,
    `Crew: ${yacht.crew ?? "n/a"}`,
    `Base rate (low): ${yacht.baseRateLow ?? "n/a"}`,
    `Base rate (high): ${yacht.baseRateHigh ?? "n/a"}`,
    `APA: ${yacht.apaPercent ?? 30}%`,
    `Flag: ${yacht.flag ?? "Greek"}`,
    `Home port: ${yacht.homePort ?? "Athens"}`,
    `Toys/tenders: ${yacht.toys ?? "standard charter kit"}`,
  ].join("\n");

  const userPrompt = `YACHT SPEC SHEET:\n\n${spec}\n\nNOW WRITE THE LINKEDIN COMPANY PAGE POST.`;

  const response = await aiChat(LINKEDIN_FLEET_SYSTEM, userPrompt, {
    temperature: 0.5,
    maxTokens: 1200,
  });

  let raw = response.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  const parsed = JSON.parse(raw);
  return {
    mainPost: parsed.mainPost,
    hashtags: parsed.hashtags ?? ["YachtCharter", "MYBACharter"],
    coverImage,
  };
}

export async function GET() {
  try {
    const sb = createServiceClient();

    // Flag gate — let George flip this off without a redeploy if needed.
    const { data: flag } = await sb
      .from("settings")
      .select("value")
      .eq("key", "linkedin_fleet_brief_enabled")
      .maybeSingle();
    if (flag?.value !== "true") {
      return NextResponse.json({
        skipped: "flag_off",
        hint: "set settings.linkedin_fleet_brief_enabled = 'true' to enable",
      });
    }

    // Reuse the IG fleet rotation library — same 14-day cooldown logic.
    const pool = await fetchFleetPool();
    if (pool.length === 0) {
      return NextResponse.json({ skipped: "empty_pool" });
    }
    const state = await loadRotationState();
    const yacht = selectNextYacht(pool, state);
    if (!yacht) {
      return NextResponse.json({ skipped: "no_yacht_eligible" });
    }

    const { mainPost, hashtags, coverImage } = await generateFleetBrief(yacht);
    const commentary =
      `${mainPost}\n\n${hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`.trim();

    const result = await publishAsOrganization({
      commentary,
      mediaUrl: coverImage ?? undefined,
    });

    if (!result.ok) {
      await sendTelegram(
        `⚠️ <b>LinkedIn fleet brief failed</b>\n<code>${escapeHtml(result.error)}</code>`,
      ).catch(() => {});
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Persist cooldown (14-day) so the same yacht won't be re-picked too soon.
    try {
      await persistRotationState(
        updateStateAfterPost(state, yacht._id, "commercial_snapshot" as any),
      );
    } catch (e) {
      console.error("[linkedin-fleet-brief] state persist failed", e);
    }

    await sendTelegram(
      [
        `💼 <b>LinkedIn fleet brief live</b>`,
        `Yacht: ${yacht.name}`,
        `URN: <code>${result.urn}</code>`,
      ].join("\n"),
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      yacht: yacht.name,
      urn: result.urn,
    });
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>LinkedIn fleet brief crashed</b>\n<code>${escapeHtml(e.message ?? "unknown")}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
