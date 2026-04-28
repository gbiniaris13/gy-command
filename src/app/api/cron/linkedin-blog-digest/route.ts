// Tue + Thu 08:45 Athens — Blog article digest to Telegram.
//
// This cron fetches the newest blog article George hasn't surfaced to
// LinkedIn yet, generates a personal-profile draft in his voice (using
// the linkedin-caption library and the Meltemi post exemplar), and
// Telegrams it to him as a copy/paste block. The companion
// linkedin-company-amplify cron runs 2 hours later to auto-post the
// brokerage-voice version on the Company Page.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { observeCron } from "@/lib/cron-observer";
import { sendTelegram } from "@/lib/telegram";
import { pickNextArticleForLinkedIn } from "@/lib/blog-fetcher";
import {
  formatDraftForTelegram,
  generatePersonalDraft,
} from "@/lib/linkedin-caption";

export const runtime = "nodejs";
export const maxDuration = 120;

async function getPostedUrls(): Promise<Set<string>> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", "linkedin_posted_urls")
    .maybeSingle();
  try {
    const arr = JSON.parse((data?.value as string) ?? "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function addPostedUrl(url: string): Promise<void> {
  const sb = createServiceClient();
  const current = await getPostedUrls();
  current.add(url);
  await sb
    .from("settings")
    .upsert({ key: "linkedin_posted_urls", value: JSON.stringify([...current]) });
}

async function stageArticleForAmplify(url: string, slug: string): Promise<void> {
  // Store the URL the amplify cron should pick up ~2h later. Overwrites
  // the previous staged article — we only amplify one at a time.
  const sb = createServiceClient();
  await sb.from("settings").upsert({
    key: "linkedin_amplify_pending",
    value: JSON.stringify({
      url,
      slug,
      stagedAt: new Date().toISOString(),
    }),
  });
}

async function _observedImpl() {
  try {
    const posted = await getPostedUrls();
    const article = await pickNextArticleForLinkedIn(posted);
    if (!article) {
      return NextResponse.json({ skipped: "no_new_article", posted: posted.size });
    }

    const draft = await generatePersonalDraft(article);
    const telegramBody = formatDraftForTelegram(draft, article.url);

    await sendTelegram(
      [
        `📝 <b>LinkedIn Tue/Thu — new blog article ready</b>`,
        `<b>Article:</b> ${escapeHtml(article.title)}`,
        `<b>URL:</b> ${article.url}`,
        "",
        telegramBody,
      ].join("\n"),
    );

    // Mark article as surfaced so we don't re-draft the same one.
    await addPostedUrl(article.url);
    // Stage it for the amplify cron (Company Page post ~2h later).
    await stageArticleForAmplify(article.url, article.slug);

    return NextResponse.json({
      ok: true,
      article: article.url,
      mainPostChars: draft.mainPost.length,
    });
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>LinkedIn blog digest failed</b>\n<code>${escapeHtml(e.message ?? "unknown")}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET() {
  return observeCron("linkedin-blog-digest", () => _observedImpl());
}
