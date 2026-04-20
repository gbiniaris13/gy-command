// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { fetchFleetPool } from "@/lib/sanity-fleet";
import {
  FLEET_ANGLES,
  angleEligibleForYacht,
  eligibleAnglesForYacht,
} from "@/lib/fleet-rotation";
import { generateFleetCaption, fleetHashtagBlock } from "@/lib/fleet-caption";
import { detectBannedPhrases, detectEmojiViolations } from "@/lib/ai-voice-guardrails";

// GET /api/admin/fleet-dryrun-all
//
// Runs one dryrun per angle (6 total) against real Sanity yachts, runs
// the same voice audit the live cron runs, and sends a compact Telegram
// summary to George. No publishing, no state writes.
//
// Also: if any angle's caption fails the banned-phrase or emoji check,
// this endpoint auto-flips fleet_posts_enabled=false as a safety gate
// (George's explicit request — never let a regression hit the feed).
//
// Returns JSON for the caller with full captions + pass/fail detail.

const BANNED_FILLER_FOR_AUDIT = [
  "exceptional",
  "unparalleled",
  "renowned",
  "pedigree",
  "stunning",
  "incredible",
  "iconic",
  "unforgettable",
  "elevated",
  "high standards",
  "primed",
];

function pickYachtForAngle(pool: any[], angle: string): any | null {
  // Prefer yachts with many eligible angles so we reuse the same boat
  // where we can, but always require the specific angle to pass.
  const ranked = pool
    .filter((y) => angleEligibleForYacht(y, angle).eligible)
    .sort(
      (a, b) =>
        eligibleAnglesForYacht(b).length - eligibleAnglesForYacht(a).length,
    );
  return ranked[0] ?? null;
}

export async function GET() {
  const sb = createServiceClient();
  const pool = await fetchFleetPool();
  if (pool.length === 0) {
    return NextResponse.json({ error: "empty pool" }, { status: 500 });
  }

  const results: any[] = [];
  for (const angle of FLEET_ANGLES) {
    const yacht = pickYachtForAngle(pool, angle);
    if (!yacht) {
      results.push({
        angle,
        pass: false,
        error: `no eligible yacht for ${angle}`,
      });
      continue;
    }
    let body = "";
    try {
      body = await generateFleetCaption(yacht, angle);
    } catch (err: any) {
      results.push({
        angle,
        yacht: yacht.name,
        pass: false,
        error: `AI error: ${err?.message ?? err}`,
      });
      continue;
    }
    const caption = `${body}\n\n${fleetHashtagBlock(yacht)}`;
    const bannedPhrases = detectBannedPhrases(body);
    const emojiViolations = detectEmojiViolations(body);
    const pass = bannedPhrases.length === 0 && emojiViolations.length === 0;
    results.push({
      angle,
      yacht: yacht.name,
      pass,
      preview: body.slice(0, 80).replace(/\s+/g, " ").trim() + "...",
      body,
      caption,
      bannedPhrases,
      emojiViolations,
    });
  }

  const fails = results.filter((r) => !r.pass);
  const allPass = fails.length === 0;

  // Safety gate: if any angle fails the voice audit, flip the master
  // flag off. Better to pause Wednesday's auto-post than let a bad
  // voice regression hit the feed overnight.
  if (!allPass) {
    try {
      await sb.from("settings").upsert(
        {
          key: "fleet_posts_enabled",
          value: "false",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    } catch {}
  }

  // Telegram summary — compact, phone-friendly.
  const lines: string[] = [
    allPass
      ? `✅ <b>Fleet dryrun verification — ALL 6 ANGLES PASS</b>`
      : `🚨 <b>Fleet dryrun verification — ${fails.length}/${results.length} FAILED</b>`,
    ``,
  ];
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    lines.push(`${icon} <b>${r.angle}</b> (${r.yacht ?? "—"})`);
    if (r.preview) lines.push(`   <i>${escapeHtml(r.preview)}</i>`);
    if (!r.pass) {
      if (r.error) lines.push(`   └ ${r.error}`);
      if (r.bannedPhrases?.length)
        lines.push(`   └ filler: ${r.bannedPhrases.join(", ")}`);
      if (r.emojiViolations?.length)
        lines.push(`   └ emoji: ${r.emojiViolations.join(" ")}`);
    }
    lines.push(``);
  }
  if (!allPass) {
    lines.push(
      `🛑 <b>Auto-paused fleet_posts_enabled</b> — fix and flip back to true before Wednesday 09:00 Athens.`,
    );
  } else {
    lines.push(
      `🟢 Wednesday 09:00 Athens auto-post remains GREEN. fleet_posts_enabled stays true.`,
    );
  }

  await sendTelegram(lines.join("\n"));

  return NextResponse.json({
    allPass,
    failsCount: fails.length,
    results: results.map((r) => ({
      angle: r.angle,
      yacht: r.yacht,
      pass: r.pass,
      bannedPhrases: r.bannedPhrases ?? [],
      emojiViolations: r.emojiViolations ?? [],
      preview: r.preview,
    })),
  });
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
