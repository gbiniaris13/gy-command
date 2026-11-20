// @ts-nocheck
import { NextResponse } from "next/server";

export const maxDuration = 300;

import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { publishPersonalStory, personalStoryLine } from "@/lib/personal-story";
import { applyPublishJitter, checkRateLimitHealth, logRateLimitAction } from "@/lib/rate-limit-guard";
import { assertPublishAllowed } from "@/lib/ig-window-guard";
import { observeCron } from "@/lib/cron-observer";
import { getIgTokenOptional } from "@/lib/ig-token";
import { loadReelState, saveReelState, cleanupReel, readReady, writeReady } from "@/lib/reel-build";

// Cron: Tuesday and Thursday, 16:00 UTC (18:00 Athens in winter, 19:00 in
// summer: inside the window either way).
//
// Publishes the walkthrough reel that /api/cron/instagram-reel-prepare
// left ready. If none is waiting, it hands the evening to the yacht
// carousel (/api/cron/instagram-fleet-post) so the day is not silent.
//
// Thursday's reel is published as a Trial Reel when
// settings.reel_trial_thursday is not "false": Instagram shows it to
// people who do not follow the account first, and moves it to the profile
// by itself if it does well (graduation_strategy SS_PERFORMANCE). If
// Instagram refuses the trial settings, the reel goes out as a normal one.
//
// No approval step. Switch: settings.reel_posts_enabled ("false" = off,
// and Tuesday and Thursday fall back to the carousel).

const FLAG_KEY = "reel_posts_enabled";
const TRIAL_KEY = "reel_trial_thursday";
const GRAPH = "https://graph.facebook.com/v21.0";

async function readSetting(sb: any, key: string): Promise<string | null> {
  const { data } = await sb.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

function appBase(): string {
  const host =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "https://command.georgeyachts.com";
  return host.startsWith("http") ? host : `https://${host}`;
}

/** Hand the evening to the yacht carousel. It applies its own guards. */
async function carouselInstead(why: string) {
  try {
    const res = await fetch(`${appBase()}/api/cron/instagram-fleet-post`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ fell_back_to: "fleet-post", why, result: body });
  } catch (e) {
    await sendTelegram(`❌ Reel: no reel (${why}) and the carousel could not be started either: ${String((e as any)?.message ?? e).slice(0, 160)}`);
    return NextResponse.json({ error: "fallback failed", why });
  }
}

async function _observedImpl() {
  const igToken = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) return NextResponse.json({ error: "IG not configured" });
  const sb = createServiceClient();

  if ((await readSetting(sb, FLAG_KEY)) === "false") return carouselInstead("reels are switched off");

  const reel = await readReady();
  if (!reel) return carouselInstead("no reel was ready");

  // The film must still be there before anything is promised to Instagram.
  try {
    const h = await fetch(reel.videoUrl, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    if (!h.ok) {
      await writeReady(null);
      return carouselInstead(`the prepared reel answers HTTP ${h.status}`);
    }
  } catch {
    return carouselInstead("the prepared reel could not be reached");
  }

  const gate = await assertPublishAllowed({ postType: "reel" });
  if (!gate.allowed) return NextResponse.json({ skipped: "window_guard", reason: gate.reason, detail: gate.detail });
  if (!(await checkRateLimitHealth("post_publish"))) return NextResponse.json({ skipped: "rate_limit" });
  await applyPublishJitter();

  // Thursday (Athens) is the trial reel.
  const athensDay = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Athens", weekday: "short" }).format(new Date());
  const wantTrial = athensDay === "Thu" && (await readSetting(sb, TRIAL_KEY)) !== "false";

  try {
    const create = async (trial: boolean) => {
      const res = await fetch(`${GRAPH}/${igId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: reel.videoUrl,
          caption: reel.caption,
          // The frame one second in: her name, the film, George's note.
          thumb_offset: 1000,
          ...(trial ? { trial_params: { graduation_strategy: "SS_PERFORMANCE" } } : { share_to_feed: true }),
          access_token: igToken,
        }),
      });
      return { res, data: await res.json() };
    };
    let trial = wantTrial;
    let { res, data } = await create(trial);
    if (!data.id && trial) {
      trial = false;
      ({ res, data } = await create(false));
    }
    if (!data.id) {
      const err = data?.error?.message || `HTTP ${res.status}`;
      await sendTelegram(`❌ Reel: Instagram refused the film of ${reel.yachtName}: ${err}. A yacht carousel goes out instead.`);
      return carouselInstead(`Instagram refused the film: ${err}`);
    }

    // Instagram processes a reel for up to a couple of minutes.
    let ready = false;
    let lastStatus = "";
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await fetch(`${GRAPH}/${data.id}?fields=status_code,status&access_token=${encodeURIComponent(igToken)}`);
      const sd = await s.json();
      lastStatus = `${sd.status_code ?? ""} ${sd.status ?? ""}`.trim();
      if (sd.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (sd.status_code === "ERROR") break;
    }
    if (!ready) {
      await sendTelegram(`❌ Reel: Instagram did not finish processing ${reel.yachtName} (${lastStatus || "no status"}). A yacht carousel goes out instead.`);
      return carouselInstead(`processing did not finish: ${lastStatus}`);
    }

    const pub = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: data.id, access_token: igToken }),
    });
    const pubData = await pub.json();
    if (!pubData.id) {
      const err = pubData.error?.message || "publish failed";
      await sendTelegram(`❌ Reel publish failed for ${reel.yachtName}: ${err}`);
      return NextResponse.json({ error: err });
    }

    // From here the reel is out. Nothing below may make it go out twice.
    await writeReady(null);
    const state = await loadReelState();
    state.posted[reel.yachtId] = new Date().toISOString();
    await saveReelState(state);

    let firstCommentOk = false;
    try {
      const c = await fetch(`${GRAPH}/${pubData.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Full specifications, weekly rate and availability: georgeyachts.com/yachts/${reel.slug}`,
          access_token: igToken,
        }),
      });
      firstCommentOk = Boolean((await c.json())?.id);
    } catch {}

    try {
      await sb.from("ig_posts").insert({
        image_url: reel.heroUrl,
        caption: reel.caption,
        status: "published",
        ig_media_id: pubData.id,
        published_at: new Date().toISOString(),
        schedule_time: new Date().toISOString(),
        metadata: {
          kind: "reel_walkthrough",
          sanity_yacht_id: reel.yachtId,
          yacht_name: reel.yachtName,
          window: reel.window,
          frames: reel.frames,
          trial,
        },
      });
    } catch {}

    await logRateLimitAction("post_publish", { media_id: pubData.id, kind: "reel_walkthrough", yacht_id: reel.yachtId });

    // The stored film and frames have done their work.
    await cleanupReel(reel.slug);

    // One story on George's own profile (dormant until it is connected).
    const personal = personalStoryLine(
      await publishPersonalStory({ photoUrl: reel.heroUrl, title: String(reel.yachtName ?? "").replace(/^(M\/Y|S\/Y|M\/S|S\/C|M\/C)\s+/i, ""), subtitle: "Her film, on our page today" }),
    );

    await sendTelegram(
      [
        `✅ <b>Reel live:</b> ${reel.yachtName}${trial ? " (Trial Reel: shown to non-followers first, moves to the profile by itself if it does well)" : ""}`,
        `Seconds ${reel.window.start} to ${reel.window.start + reel.window.length} of her film, frames: ${reel.frames.join(", ")}`,
        `Caption: "${reel.caption.slice(0, 160).replace(/\n/g, " ")}..."`,
        `Media id: ${pubData.id}`,
        `First comment (yacht page): ${firstCommentOk ? "✅ posted" : "⚠ failed"}`,
        ...(personal ? [personal] : []),
      ].join("\n"),
    );
    return NextResponse.json({ ok: true, media_id: pubData.id, yacht: reel.yachtName, trial });
  } catch (err: any) {
    await sendTelegram(`❌ Reel exception (${reel.yachtName}): ${err?.message ?? err}`);
    return NextResponse.json({ error: err?.message ?? "unknown" });
  }
}

export async function GET(...args: any[]) {
  return observeCron("instagram-reel", () => (_observedImpl as any)(...args));
}
