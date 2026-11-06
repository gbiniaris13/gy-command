// GET /api/t/o?t=TOKEN — the open pixel.
// Returns a 1x1 transparent GIF always (even on bad tokens). Every hit is
// LOGGED to email_tracking_hits with a verdict (human / prefetch / bot /
// apple-mpp — see classifyOpen); only a HUMAN open updates the counters and
// notifies George. HubSpot-grade filtering, per hit, because our volume
// affords the full audit trail.
//
// v3 (2026-11-05): every reading session alerts, not only the first (a new
// session = no other human open in the 30 minutes before it), in one Gmail
// thread per email with the whole timeline. Two more ways an open is
// George's own and stays silent: his Chrome sends x-gy-self (GY Track), or
// his Gmail reported the email on his screen a moment ago ("seen"). The
// verdict is re-read a few seconds later before anything counts, so a
// "seen" that arrives just after the pixel still wins.
//
// 2026-11-06: an unsent draft's pixel never counts (see knownSent), and after
// the client has replied only Gmail-proxy opens are silenced, so a re-open
// from the client's own mail program still reaches George.

import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  athensTime,
  classifyOpen,
  selfFooter,
  isExtRequest,
  seenRecently,
  timelineFor,
  hasReplied,
  sendThreadedAlert,
  alertSubject,
  placeFromHeaders,
  ipWithPlace,
  sleep,
  knownSent,
  viaGoogleProxy,
  DELIVERY_GRACE_MS,
  SCANNER_WINDOW_MS,
  ownCopyGone,
} from "@/lib/email-tracking";
import { findAndClean } from "@/lib/sent-copy";
import { isHouseIp } from "@/lib/house-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

// A reader who opens the email twice in ten minutes is one reading, not two.
const SESSION_GAP_MS = 30 * 60_000;

function gif(): NextResponse {
  return new NextResponse(GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (!token || token.length > 40) return gif();

  try {
    const sb = createServiceClient();
    const { data: row } = await sb
      .from("email_tracking")
      .select("id, sent_at, subject, recipient, source")
      .eq("token", token)
      .maybeSingle();
    if (!row) return gif();

    const now = new Date();
    const userAgent = req.headers.get("user-agent");
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const sentMs = Date.parse(row.sent_at);

    let verdict = classifyOpen({
      userAgent,
      sentAtMs: Number.isFinite(sentMs) ? sentMs : null,
      nowMs: now.getTime(),
    });
    // A Gmail-proxy fetch in the first two minutes is only doubted while
    // George's own copy still carries the pixel. Once that copy is clean,
    // the fetch is the recipient's Gmail: a reader.
    if (
      verdict === "prefetch" &&
      viaGoogleProxy(userAgent) &&
      now.getTime() - sentMs >= SCANNER_WINDOW_MS &&
      (await ownCopyGone(token, now.getTime()))
    ) {
      verdict = "human";
    }
    // A mail program on George's own network fetching the pixel directly
    // (never Gmail's proxy, whose address is Google's) is George.
    if (verdict === "human" && !viaGoogleProxy(userAgent) && (await isHouseIp(ip))) verdict = "self";
    if (verdict === "human" && (isExtRequest(req.headers.get("x-gy-self")) || (await seenRecently(token, now.getTime())))) {
      verdict = "self";
    }

    // Full audit trail — every hit, every verdict. Never blocks the pixel.
    const { data: hit } = await sb
      .from("email_tracking_hits")
      .insert({
        token,
        kind: "open",
        user_agent: (userAgent || "").slice(0, 400),
        ip: ipWithPlace(ip, placeFromHeaders(req.headers)),
        verdict,
      })
      .select("id, at")
      .single();

    if (verdict === "human" && hit) {
      after(() => countAndAlert(token, row, hit.id, now, userAgent));
    }
  } catch (err) {
    console.error("[tracking/open] failed:", err);
  }
  return gif();
}

async function countAndAlert(
  token: string,
  row: { id: string; sent_at: string; subject: string | null; recipient: string | null; source: string },
  hitId: string,
  now: Date,
  userAgent: string | null,
): Promise<void> {
  try {
    // Give a "seen" from George's own Gmail a moment to land and relabel it.
    await sleep(6_000);
    const sb = createServiceClient();
    const { data: still } = await sb.from("email_tracking_hits").select("verdict").eq("id", hitId).maybeSingle();
    if (still?.verdict !== "human") return;

    // Written, not sent: a Helm draft (or a Gmail draft after Undo send)
    // carries its pixel while it waits in George's Drafts, and fires when he
    // opens the conversation it sits in. Only an email found in Sent counts.
    if (row.source === "helm-draft" || row.source === "gmail") {
      if (!(await knownSent(token))) {
        const found = await findAndClean({ token, recipient: row.recipient, sent_at: row.sent_at });
        // "failed" = Gmail did not answer: unknown, so the open is kept
        // (a missed lead costs more than a false alarm).
        if (found !== "failed" && !(await knownSent(token))) {
          await sb.from("email_tracking_hits").update({ verdict: "draft" }).eq("id", hitId);
          return;
        }
      }
      // It did leave. The row's time may have been the draft's until a
      // moment ago, so the delivery rules are applied again to the real
      // send time: machines in the first seconds, and a Gmail-proxy fetch
      // only once George's own copy was already clean.
      const { data: fresh } = await sb.from("email_tracking").select("sent_at").eq("id", row.id).maybeSingle();
      const age = now.getTime() - Date.parse(fresh?.sent_at || row.sent_at);
      const machine =
        Number.isFinite(age) &&
        (age < SCANNER_WINDOW_MS ||
          (age < DELIVERY_GRACE_MS && viaGoogleProxy(userAgent) && !(await ownCopyGone(token, now.getTime()))));
      if (machine) {
        await sb.from("email_tracking_hits").update({ verdict: "prefetch" }).eq("id", hitId);
        return;
      }
    }

    const { data: cur } = await sb
      .from("email_tracking")
      .select("open_count, first_open_at")
      .eq("id", row.id)
      .maybeSingle();
    const isFirst = !cur?.first_open_at;
    await sb
      .from("email_tracking")
      .update({
        open_count: (cur?.open_count || 0) + 1,
        last_open_at: now.toISOString(),
        ...(isFirst ? { first_open_at: now.toISOString(), open_notified: true } : {}),
      })
      .eq("id", row.id);

    // Same reading session as an open a few minutes ago: counted, not alerted.
    const { data: recent } = await sb
      .from("email_tracking_hits")
      .select("id")
      .eq("token", token)
      .eq("kind", "open")
      .eq("verdict", "human")
      .neq("id", hitId)
      .gte("at", new Date(now.getTime() - SESSION_GAP_MS).toISOString())
      .limit(1);
    if (recent && recent.length) return;

    // After the client has answered, a Gmail-proxy open is most often George
    // reading their reply (it quotes his email). Any other reader is theirs.
    if (viaGoogleProxy(userAgent) && (await hasReplied(token, row.sent_at))) return;

    const tl = await timelineFor(token, row.sent_at);
    const n = Math.max(1, tl.humanOpens);
    const headline = n === 1 ? `Opened for the first time.` : `Opened again, the ${ordinalWord(n)} time.`;
    const body = [
      headline,
      ``,
      `To:      ${row.recipient || "unknown"}`,
      `Subject: ${row.subject || "(no subject)"}`,
      `Opened:  ${athensTime(now.toISOString())} (Athens)`,
      ``,
      `Timeline (Athens)`,
      ...tl.lines,
      ...(tl.apple ? [``, `Apple Mail loaded it ${tl.apple}x by itself (Apple does that to every email, so those are not counted).`] : []),
      ...selfFooter(token, "open"),
    ].join("\n");
    await sendThreadedAlert(token, alertSubject(row), body);
  } catch (err) {
    console.error("[tracking/open] alert failed:", err);
  }
}

function ordinalWord(n: number): string {
  const w = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  if (n < w.length) return w[n];
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
