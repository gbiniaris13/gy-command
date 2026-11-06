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
//
// 2026-11-06: the two-minute silence after a send is gone (it hid George's
// own test click at 38 seconds). Only the first 15 seconds are a machine;
// scanners are caught by what they do instead: they walk the links, so a
// click is counted nine seconds later, once no other link was touched.

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
  sleep,
  BURST_MS,
} from "@/lib/email-tracking";

import { isHouseIp } from "@/lib/house-ip";

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
      // His own network (the iPhone on the home wifi, another browser).
      if (verdict === "human" && (await isHouseIp(ip))) verdict = "self";

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
        const device = deviceFromUa(userAgent);
        after(async () => {
          try {
            // A scanner walks every link of the email within seconds. Wait
            // out that window and look both ways: a DIFFERENT link clicked
            // just before or just after this one means machine, and neither
            // click is counted or reported.
            await sleep(BURST_MS + 1_000);
            const { data: around } = await sb
              .from("email_tracking_hits")
              .select("id, url")
              .eq("token", token)
              .eq("kind", "click")
              .neq("id", hit.id)
              .gte("at", new Date(now - BURST_MS).toISOString())
              .lte("at", new Date(now + BURST_MS).toISOString());
            const walked = (around || []).filter((h) => (h.url || "") !== url.slice(0, 800));
            if (walked.length) {
              await sb
                .from("email_tracking_hits")
                .update({ verdict: "bot" })
                .in("id", [hit.id, ...walked.map((h) => h.id)]);
              return;
            }
            const { data: still } = await sb.from("email_tracking_hits").select("verdict").eq("id", hit.id).maybeSingle();
            if (still?.verdict !== "human") return;

            const { data: cur } = await sb
              .from("email_tracking")
              .select("click_count, first_click_at")
              .eq("id", row.id)
              .maybeSingle();
            const isFirst = !cur?.first_click_at;
            await sb
              .from("email_tracking")
              .update({
                click_count: (cur?.click_count || 0) + 1,
                last_click_at: nowIso,
                last_click_url: url.slice(0, 800),
                ...(isFirst ? { first_click_at: nowIso, click_notified: true } : {}),
              })
              .eq("id", row.id);

            const { data: again } = await sb
              .from("email_tracking_hits")
              .select("id")
              .eq("token", token)
              .eq("kind", "click")
              .eq("verdict", "human")
              .eq("url", url.slice(0, 800))
              .neq("id", hit.id)
              .gte("at", new Date(now - SAME_LINK_GAP_MS).toISOString())
              .lt("at", nowIso)
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

// Link checkers probe with HEAD. Never a reader: the destination is given
// and nothing is logged.
export async function HEAD(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = p.get("t") || "";
  const sig = p.get("s") || "";
  let url = "";
  try {
    url = Buffer.from(p.get("u") || "", "base64url").toString("utf8");
  } catch {
    /* fallthrough */
  }
  let ok = false;
  try {
    ok = !!token && url.startsWith("http") && !!sig && verifyClick(token, url, sig);
  } catch {
    ok = false;
  }
  return NextResponse.redirect(ok ? url : "https://georgeyachts.com", 302);
}
