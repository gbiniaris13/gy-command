// /api/command-center/voice-brief — 30-second TTS audio briefing.
//
// Composes a short scripted voice-over from the live snapshot (no
// LLM — pure template, deterministic, cost-bounded) and streams it
// back as MP3 via OpenAI's TTS endpoint.
//
// Why OpenAI TTS specifically: lib/ai.ts is pointed at the Gemini
// OpenAI-compat shim by default, which doesn't expose audio.speech.
// TTS needs the real OpenAI base URL + a separate key. We fall back
// to a clear 503 if it's not configured rather than silently fail.
//
// Usage from the client:
//   const audio = new Audio("/api/command-center/voice-brief");
//   audio.play();
//
// The browser handles the streaming MP3 itself.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase-server";
import {
  buildCommandCenterSnapshot,
  type CommandCenterSnapshot,
} from "@/lib/command-center-snapshot";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Hard cap so a runaway snapshot never sends a 5-minute audio request.
const MAX_BRIEF_CHARS = 900;
const DEFAULT_VOICE = "onyx"; // mature male — fits the broker/captain tone

function fmtEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million euros`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} thousand euros`;
  return `${n} euros`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// Pure-template briefing — no LLM. Deterministic, fast, cheap.
function composeBrief(snapshot: CommandCenterSnapshot): string {
  const parts: string[] = [];

  // Greeting
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = `${ordinal(now.getDate())} of ${now.toLocaleString("en-US", { month: "long" })}`;
  parts.push(`${greeting}, George. ${date}, ${String(hour).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}.`);

  // Pipeline KPIs
  const m = snapshot.metrics;
  const activeDeals = m.find((x) => x.id === "active_deals")?.value ?? 0;
  const pipelineK = m.find((x) => x.id === "pipeline_value")?.value ?? 0;
  if (activeDeals > 0 || pipelineK > 0) {
    const pipeEur = pipelineK * 1000;
    parts.push(
      `Pipeline today: ${activeDeals} active deal${activeDeals === 1 ? "" : "s"}, ${fmtEur(pipeEur)} total.`,
    );
  }

  // Top action
  const top = snapshot.priorities.actions[0];
  if (top) {
    const eur = top.expected_commission_eur > 0
      ? `, ${fmtEur(top.expected_commission_eur)} on the line`
      : "";
    parts.push(`Top action: ${top.title}${eur}.`);
  }
  const more = Math.max(0, snapshot.priorities.actions.length - 1);
  if (more > 0) {
    parts.push(`${more} other priorit${more === 1 ? "y" : "ies"} in the queue.`);
  }

  // Counters
  const c = snapshot.priorities.counters;
  const overdue = c.find((x) => x.id === "overdue")?.value ?? 0;
  const owed = c.find((x) => x.id === "owed_reply")?.value ?? 0;
  const dueToday = c.find((x) => x.id === "due_today")?.value ?? 0;
  const hot = c.find((x) => x.id === "hot_leads")?.value ?? 0;

  const flags: string[] = [];
  if (overdue > 0) flags.push(`${overdue} overdue promise${overdue === 1 ? "" : "s"}`);
  if (dueToday > 0) flags.push(`${dueToday} charter milestone${dueToday === 1 ? "" : "s"} due today`);
  if (owed > 0) flags.push(`inbox owes ${owed} repl${owed === 1 ? "y" : "ies"}`);
  if (hot > 0) flags.push(`${hot} hot lead${hot === 1 ? "" : "s"} in play`);

  if (flags.length > 0) {
    parts.push(`Heads-up: ${flags.join(", ")}.`);
  } else {
    parts.push("Inbox is clean and no broken promises.");
  }

  // Sign-off
  parts.push("That's your snapshot. Go close something.");

  let brief = parts.join(" ");
  if (brief.length > MAX_BRIEF_CHARS) {
    brief = brief.slice(0, MAX_BRIEF_CHARS - 3) + "...";
  }
  return brief;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY not set. Voice briefing needs the real OpenAI key (the AI_API_KEY used for chat is pointed at Gemini and doesn't expose TTS).",
      },
      { status: 503 },
    );
  }

  try {
    const sb = createServiceClient();
    const snapshot = await buildCommandCenterSnapshot(sb);
    const brief = composeBrief(snapshot);

    // Allow voice override via query param: ?voice=onyx|alloy|echo|fable|nova|shimmer
    const voiceParam = (request.nextUrl.searchParams.get("voice") || "").toLowerCase();
    const voice = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(voiceParam)
      ? voiceParam
      : DEFAULT_VOICE;

    const oa = new OpenAI({ apiKey });
    const speech = await oa.audio.speech.create({
      model: "tts-1",       // tts-1-hd is higher quality but 2x cost; tts-1 is plenty for 30s
      voice: voice as any,
      input: brief,
      response_format: "mp3",
    });

    const buf = Buffer.from(await speech.arrayBuffer());

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "private, max-age=180", // 3-min reuse on rapid replays
        "X-Brief-Chars": String(brief.length),
      },
    });
  } catch (e: any) {
    console.error("[voice-brief] failed:", e);
    return NextResponse.json(
      { error: e?.message ?? "voice brief failed" },
      { status: 500 },
    );
  }
}
