// GET /api/t/c?t=TOKEN&u=BASE64URL&s=HMAC — click logger + redirect.
// The HMAC (keyed on CRON_SECRET) binds token+URL so this cannot be used
// as an open redirect. Every hit is LOGGED with a verdict (human /
// prefetch / bot — see classifyClick, incl. the 8s burst rule that catches
// scanners walking every link); only a HUMAN click counts and notifies.
// The redirect is always served — filtering never breaks the reader's link.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { verifyClick, emailGeorgeReport, athensTime, classifyClick } from "@/lib/email-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = p.get("t") || "";
  const u = p.get("u") || "";
  const sig = p.get("s") || "";

  let url = "";
  try {
    url = Buffer.from(u, "base64url").toString("utf8");
  } catch {
    /* fallthrough */
  }

  const valid =
    token &&
    url.startsWith("http") &&
    sig &&
    (() => {
      try {
        return verifyClick(token, url, sig);
      } catch {
        return false;
      }
    })();

  if (!valid) {
    // Never strand a client on a broken link — send them home.
    return NextResponse.redirect("https://georgeyachts.com", 302);
  }

  try {
    const sb = createServiceClient();
    const { data: row } = await sb
      .from("email_tracking")
      .select("id, click_count, first_click_at, click_notified, subject, recipient, source, sent_at")
      .eq("token", token)
      .maybeSingle();

    if (row) {
      const now = Date.now();
      const userAgent = req.headers.get("user-agent");
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null;
      const sentMs = Date.parse(row.sent_at);

      // Burst rule needs the most recent prior click on this token.
      const { data: prev } = await sb
        .from("email_tracking_hits")
        .select("at, url")
        .eq("token", token)
        .eq("kind", "click")
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const verdict = classifyClick({
        userAgent,
        sentAtMs: Number.isFinite(sentMs) ? sentMs : null,
        nowMs: now,
        prevClick: prev
          ? { atMs: Date.parse(prev.at), url: prev.url ?? null }
          : null,
        url,
      });

      await sb.from("email_tracking_hits").insert({
        token,
        kind: "click",
        user_agent: (userAgent || "").slice(0, 400),
        ip,
        url: url.slice(0, 800),
        verdict,
      });

      if (verdict === "human") {
        const nowIso = new Date(now).toISOString();
        const isFirst = !row.first_click_at;
        await sb
          .from("email_tracking")
          .update({
            click_count: (row.click_count || 0) + 1,
            last_click_at: nowIso,
            last_click_url: url.slice(0, 800),
            ...(isFirst ? { first_click_at: nowIso, click_notified: true } : {}),
          })
          .eq("id", row.id);

        if (isFirst && !row.click_notified) {
          const body = [
            `A link in your email was just clicked.`,
            ``,
            `To:      ${row.recipient || "unknown"}`,
            `Subject: ${row.subject || "(no subject)"}`,
            `Clicked: ${url}`,
            `At:      ${athensTime(nowIso)} (Athens)`,
            `Via:     ${row.source}`,
            ``,
            `Scanner and prefetch clicks are filtered out - this one classified as a real reader.`,
          ].join("\n");
          await emailGeorgeReport(
            `\u{1F517} Clicked: ${(row.subject || "(no subject)").slice(0, 60)} - ${row.recipient || ""}`,
            body,
          );
        }
      }
    }
  } catch (err) {
    console.error("[tracking/click] failed:", err);
  }

  return NextResponse.redirect(url, 302);
}
