// GET /api/t/c?t=TOKEN&u=BASE64URL&s=HMAC — click logger + redirect.
// The HMAC (keyed on CRON_SECRET) binds token+URL so this cannot be used
// as an open redirect. Every hit is LOGGED with a verdict (human /
// prefetch / bot — see classifyClick, incl. the 8s burst rule that catches
// scanners walking every link); only a HUMAN click counts and notifies.
// The redirect is always served — filtering never breaks the reader's link.
//
// v3 (2026-11-05): every human click alerts (the same link again within 10
// minutes is one click), in the email's own alert thread, with the reader's
// device and city and the whole timeline. A click from George's own Chrome
// carries x-gy-self (GY Track) and is filed as "self".

import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  verifyClick,
  athensTime,
  classifyClick,
  selfFooter,
  isExtRequest,
  timelineFor,
  sendThreadedAlert,
  alertSubject,
  deviceFromUa,
  placeFromHeaders,
  ipWithPlace,
} from "@/lib/email-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SAME_LINK_GAP_MS = 10 * 60_000;

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

      let verdict = classifyClick({
        userAgent,
        sentAtMs: Number.isFinite(sentMs) ? sentMs : null,
        nowMs: now,
        prevClick: prev
          ? { atMs: Date.parse(prev.at), url: prev.url ?? null }
          : null,
        url,
      });
      if (isExtRequest(req.headers.get("x-gy-self"))) verdict = "self";

      const place = placeFromHeaders(req.headers);
      const { data: hit } = await sb
        .from("email_tracking_hits")
        .insert({
          token,
          kind: "click",
          user_agent: (userAgent || "").slice(0, 400),
          ip: ipWithPlace(ip, place),
          url: url.slice(0, 800),
          verdict,
        })
        .select("id")
        .single();

      if (verdict === "human" && hit) {
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

        const device = deviceFromUa(userAgent);
        after(async () => {
          try {
            const { data: again } = await sb
              .from("email_tracking_hits")
              .select("id")
              .eq("token", token)
              .eq("kind", "click")
              .eq("verdict", "human")
              .eq("url", url.slice(0, 800))
              .neq("id", hit.id)
              .gte("at", new Date(now - SAME_LINK_GAP_MS).toISOString())
              .limit(1);
            if (again && again.length) return;
            const tl = await timelineFor(token, row.sent_at);
            const where = [device, place].filter(Boolean).join(", ");
            const body = [
              `Clicked: ${url}`,
              ``,
              `To:      ${row.recipient || "unknown"}`,
              `Subject: ${row.subject || "(no subject)"}`,
              `At:      ${athensTime(nowIso)} (Athens)${where ? `, ${where}` : ""}`,
              ``,
              `Timeline (Athens)`,
              ...tl.lines,
              ...selfFooter(token, "click"),
            ].join("\n");
            await sendThreadedAlert(token, alertSubject(row), body);
          } catch (err) {
            console.error("[tracking/click] alert failed:", err);
          }
        });
      }
    }
  } catch (err) {
    console.error("[tracking/click] failed:", err);
  }

  return NextResponse.redirect(url, 302);
}
