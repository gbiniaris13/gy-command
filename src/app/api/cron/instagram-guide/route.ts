// @ts-nocheck
import { NextResponse } from "next/server";

// Drawing up to ten slides, storing them, and Instagram's own processing
// of a carousel take a minute or more.
export const maxDuration = 300;

import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { publishPersonalStory, personalStoryLine } from "@/lib/personal-story";
import { applyPublishJitter, checkRateLimitHealth, logRateLimitAction } from "@/lib/rate-limit-guard";
import { assertPublishAllowed } from "@/lib/ig-window-guard";
import { observeCron } from "@/lib/cron-observer";
import { getIgTokenOptional } from "@/lib/ig-token";
import { GUIDE_DECKS, buildGuideDeck, pickDeck, guideCaption, guideAlt, type BuiltDeck } from "@/lib/guide-decks";
import { loadGuidePool } from "@/lib/guide-pool";
import { renderGuideSlideToUrl } from "@/lib/guide-render";

// Cron: Monday and Saturday, 16:05 UTC (18:05 Athens in winter, 19:05 in
// summer: inside the 18:00 to 19:30 window either way).
//
// Publishes one guide carousel: what a week costs, how a charter works,
// where and when to go, who answers, or a live shortlist of cleared yachts
// for one kind of group. The words are written in src/lib/guide-decks.ts
// from what the public site already says; nothing is generated here. This
// replaces the generated "lifestyle" captions that used to fill Monday and
// Saturday (instagram-generate-weekly, retired 2026-11-19).
//
// No approval step (George, 2026-11-19: everything runs on its own). The
// switch is settings.guide_posts_enabled: anything but "false" means on.

const FLAG_KEY = "guide_posts_enabled";
const TURN_KEY = "guide_turn_v1";
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

/** Draw and store every slide of a deck. All or nothing: a guide with a step missing is not a guide. */
async function renderDeck(deck: BuiltDeck): Promise<Array<{ url: string; alt: string }> | null> {
  const base = appBase();
  const n = deck.slides.length;
  const out: Array<{ url: string; alt: string }> = [];
  for (let i = 0; i < n; i++) {
    const slide = deck.slides[i];
    let url = await renderGuideSlideToUrl(base, slide, i + 1, n, deck.id);
    if (!url) url = await renderGuideSlideToUrl(base, slide, i + 1, n, deck.id);
    if (!url) return null;
    out.push({ url, alt: guideAlt(slide) });
  }
  return out;
}

async function _observedImpl() {
  const igToken = getIgTokenOptional();
  const igId = process.env.IG_BUSINESS_ID;
  if (!igToken || !igId) {
    return NextResponse.json({ error: "IG not configured" });
  }
  const sb = createServiceClient();

  if ((await readSetting(sb, FLAG_KEY)) === "false") {
    return NextResponse.json({ skipped: "guide_posts_disabled" });
  }

  // Monday and Saturday only, inside the Athens window, one feed post a day.
  const gate = await assertPublishAllowed({ postType: "carousel" });
  if (!gate.allowed) {
    return NextResponse.json({ skipped: "window_guard", reason: gate.reason, detail: gate.detail });
  }
  if (!(await checkRateLimitHealth("post_publish"))) {
    return NextResponse.json({ skipped: "rate_limit" });
  }
  await applyPublishJitter();

  const turn = Math.max(0, parseInt((await readSetting(sb, TURN_KEY)) ?? "0", 10) || 0);

  // The cleared fleet, for the cover photograph, the worked example and
  // the shortlists. An unreadable fleet is not a reason for silence: the
  // written guides stand without it.
  let pool: any[] = [];
  try {
    pool = await loadGuidePool();
  } catch {}

  let deck = pickDeck(turn, pool);
  let items = await renderDeck(deck);
  let fellBack = false;
  if (!items) {
    // Most likely a photograph that would not load. A written guide with
    // no photograph at all can always be drawn.
    fellBack = true;
    deck = buildGuideDeck(GUIDE_DECKS[turn % GUIDE_DECKS.length], [], turn);
    items = await renderDeck(deck);
  }
  if (!items) {
    await sendTelegram(`❌ Guide post: the slides could not be drawn (turn ${turn}, deck ${deck.id}). Nothing was published.`);
    return NextResponse.json({ error: "slides could not be drawn", deck: deck.id });
  }

  const caption = guideCaption(deck);

  try {
    // Step 1: one container per slide. Alt text is the slide's own words;
    // if Meta refuses a slide with it, the slide is tried without, then
    // once more after a pause. Every slide is needed.
    const childIds: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const { url, alt } = items[i];
      const create = async (withAlt: boolean) => {
        const res = await fetch(`${GRAPH}/${igId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: url,
            is_carousel_item: true,
            ...(withAlt ? { alt_text: alt } : {}),
            access_token: igToken,
          }),
        });
        return { res, data: await res.json() };
      };
      let { res, data } = await create(true);
      if (!data.id) ({ res, data } = await create(false));
      if (!data.id) {
        await new Promise((r) => setTimeout(r, 4000));
        ({ res, data } = await create(false));
      }
      if (!data.id) {
        const err = data?.error?.message || `HTTP ${res.status}`;
        await sendTelegram(`❌ Guide post: Instagram refused slide ${i + 1} of ${items.length} (${deck.id}): ${err}. Nothing was published.`);
        return NextResponse.json({ error: "slide refused", slide: i + 1, detail: err });
      }
      childIds.push(data.id);
      await new Promise((r) => setTimeout(r, 800));
    }

    // Step 2: the carousel.
    const carouselRes = await fetch(`${GRAPH}/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "CAROUSEL", children: childIds, caption, access_token: igToken }),
    });
    const carouselData = await carouselRes.json();
    if (!carouselData.id) {
      const err = carouselData.error?.message || "carousel container failed";
      await sendTelegram(`❌ Guide carousel container failed (${deck.id}): ${err}`);
      return NextResponse.json({ error: err });
    }

    // Step 3: wait for Instagram to process it.
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await fetch(`${GRAPH}/${carouselData.id}?fields=status_code&access_token=${encodeURIComponent(igToken)}`);
      const statusData = await statusRes.json();
      if (statusData.status_code === "FINISHED") {
        ready = true;
        break;
      }
      if (statusData.status_code === "ERROR") break;
    }
    if (!ready) {
      await sendTelegram(`❌ Guide carousel was not processed in time (${deck.id}). Nothing was published.`);
      return NextResponse.json({ error: "carousel processing timeout" });
    }

    // Step 4: publish.
    const publishRes = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: carouselData.id, access_token: igToken }),
    });
    const publishData = await publishRes.json();
    if (!publishData.id) {
      const err = publishData.error?.message || "publish failed";
      await sendTelegram(`❌ Guide carousel publish failed (${deck.id}): ${err}`);
      return NextResponse.json({ error: err });
    }

    // The turn advances first: whatever else fails below, the same guide
    // must not go out twice.
    try {
      await sb
        .from("settings")
        .upsert({ key: TURN_KEY, value: String(turn + 1), updated_at: new Date().toISOString() }, { onConflict: "key" });
    } catch {}

    // First comment: the page on the site that says the same at length.
    // Instagram does not link it, but it can be copied, and it is where a
    // reader (or a search engine) finds the full version.
    let firstCommentOk = false;
    try {
      const commentRes = await fetch(`${GRAPH}/${publishData.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `The same, at length: ${deck.page}`, access_token: igToken }),
      });
      firstCommentOk = Boolean((await commentRes.json())?.id);
    } catch {}

    try {
      await sb.from("ig_posts").insert({
        image_url: items[0].url,
        caption,
        status: "published",
        ig_media_id: publishData.id,
        published_at: new Date().toISOString(),
        schedule_time: new Date().toISOString(),
        metadata: {
          kind: "guide",
          deck: deck.id,
          deck_kind: deck.kind,
          turn,
          slides: items.length,
          yachts: deck.yachts,
          fell_back: fellBack,
        },
      });
    } catch {}

    await logRateLimitAction("post_publish", { media_id: publishData.id, kind: "guide", deck: deck.id });

    // One story on George's own profile (dormant until it is connected).
    // It needs a photograph: a guide drawn without one gets no story.
    const cover: any = (deck.slides ?? []).find((s: any) => s?.kind === "cover");
    const personal = personalStoryLine(
      await publishPersonalStory({ photoUrl: cover?.photo ?? null, title: cover?.title || "A short guide", subtitle: "A short guide, on our page today" }),
    );

    await sendTelegram(
      [
        `✅ <b>Guide carousel live:</b> ${deck.id} (${deck.kind}, turn ${turn})`,
        `${items.length} slides${deck.yachts.length ? ` · yachts shown: ${deck.yachts.join(", ")}` : ""}${fellBack ? " · the planned deck could not be drawn, a written guide went instead" : ""}`,
        `Caption: "${caption.slice(0, 160).replace(/\n/g, " ")}..."`,
        `Link: https://instagram.com/p/${publishData.id}`,
        `First comment (site page): ${firstCommentOk ? "✅ posted" : "⚠ failed"}`,
        ...(personal ? [personal] : []),
      ].join("\n"),
    );

    return NextResponse.json({ ok: true, media_id: publishData.id, deck: deck.id, kind: deck.kind, turn, slides: items.length });
  } catch (err: any) {
    await sendTelegram(`❌ Guide post exception (${deck.id}): ${err?.message ?? err}`);
    return NextResponse.json({ error: err?.message ?? "unknown" });
  }
}

// Observability wrapper: records the outcome for the health reports.
export async function GET(...args: any[]) {
  return observeCron("instagram-guide", () => (_observedImpl as any)(...args));
}
