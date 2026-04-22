// Tue + Thu 11:00 Athens — Company Page amplify.
//
// ~2h after the personal-profile digest fires, this cron takes the
// article staged by linkedin-blog-digest and publishes a brokerage-voice
// version on the George Yachts Company Page via the LinkedIn API.
// Different framing from the personal post so the algorithm doesn't
// flag duplicate content — personal = George's first-person insight,
// Company = third-person agent-facing commercial angle.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { fetchArticle } from "@/lib/blog-fetcher";
import { generateCompanyDraft } from "@/lib/linkedin-caption";
import { publishAsOrganization } from "@/lib/linkedin-client";

export const runtime = "nodejs";
export const maxDuration = 120;

type StagedArticle = {
  url: string;
  slug: string;
  stagedAt: string;
};

async function getStaged(): Promise<StagedArticle | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", "linkedin_amplify_pending")
    .maybeSingle();
  if (!data?.value) return null;
  try {
    return typeof data.value === "string"
      ? (JSON.parse(data.value) as StagedArticle)
      : (data.value as StagedArticle);
  } catch {
    return null;
  }
}

async function clearStaged(): Promise<void> {
  const sb = createServiceClient();
  await sb.from("settings").delete().eq("key", "linkedin_amplify_pending");
}

export async function GET() {
  try {
    const staged = await getStaged();
    if (!staged) {
      return NextResponse.json({ skipped: "no_staged_article" });
    }

    // Freshness check — only amplify if staged within the last 6 hours.
    // Anything older is stale (George probably didn't post manually).
    const ageHours =
      (Date.now() - new Date(staged.stagedAt).getTime()) / (3600 * 1000);
    if (ageHours > 6) {
      await clearStaged();
      return NextResponse.json({
        skipped: "staged_too_old",
        ageHours: Number(ageHours.toFixed(1)),
      });
    }

    const article = await fetchArticle(staged.url);
    const draft = await generateCompanyDraft(article);

    // Compose final post: body + blank line + hashtags. Company Page
    // posts can link directly in the body (unlike personal profile
    // best practice), so the link should already be in draft.mainPost.
    const hashtagLine = draft.hashtags
      .map((h) => `#${h.replace(/^#/, "")}`)
      .join(" ");
    const commentary = `${draft.mainPost}\n\n${hashtagLine}`.trim();

    const result = await publishAsOrganization({
      commentary,
      mediaUrl: article.coverImageUrl ?? undefined,
    });

    if (!result.ok) {
      await sendTelegram(
        `⚠️ <b>LinkedIn Company amplify failed</b>\n<code>${escapeHtml(result.error)}</code>\nArticle: ${article.url}`,
      ).catch(() => {});
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await clearStaged();
    await sendTelegram(
      [
        `💼 <b>LinkedIn Company Page post live</b>`,
        `Article: ${escapeHtml(article.title)}`,
        `Post URN: <code>${result.urn}</code>`,
      ].join("\n"),
    ).catch(() => {});

    return NextResponse.json({ ok: true, urn: result.urn, article: article.url });
  } catch (e: any) {
    await sendTelegram(
      `⚠️ <b>LinkedIn Company amplify crashed</b>\n<code>${escapeHtml(e.message ?? "unknown")}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
