// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";
import { createNotification } from "@/lib/notifications";

// CORS — this endpoint is called by the popup on georgeyachts.com which
// lives on a different origin than gy-command. Lock allowed origins to
// the public site + its preview deployments to avoid being an open
// relay for anyone to spam the CRM.
const ALLOWED_ORIGINS = new Set([
  "https://georgeyachts.com",
  "https://www.georgeyachts.com",
]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed =
    ALLOWED_ORIGINS.has(origin) ||
    /^https:\/\/.*\.vercel\.app$/.test(origin); // preview deployments
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://georgeyachts.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// POST /api/webhooks/hot-lead
// Body: {
//   igHandle: string,        // required — e.g. "@jane" or "jane"
//   email?: string,
//   interest?: string,       // "summer_charter" | "specific_yacht" | "browsing"
//   pagesViewed?: string[],  // paths like "/yachts/my-alafia", "/charter-yacht-greece"
//   name?: string,
//   visitorId?: string,      // persistent id from VisitorTracker
//   country?: string,
// }
//
// Triggered by the popup on georgeyachts.com when a visitor on a
// premium page (50m+, luxury fleet, yacht detail) leaves their IG
// handle. Fires three actions in parallel:
//   1. Log the lead as a contact row in GY Command CRM
//   2. Send a Telegram alert so George sees it instantly
//   3. POST to ManyChat to schedule the personalized DM
//
// All three are best-effort — if any fails the others still run.

function categorizeFleet(pagesViewed: string[]): string {
  const joined = (pagesViewed ?? []).join(" ").toLowerCase();
  if (/50m|superyacht|fleet\/luxury|fleet\/50m/.test(joined)) {
    return "50m+ superyacht";
  }
  if (/\/yachts?\//.test(joined)) {
    return "luxury yacht";
  }
  return "Greek charter";
}

function normalizeHandle(raw: string | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h)) return null;
  return h;
}

function buildDM(fleetCategory: string, name?: string): string {
  const greeting = name ? `Hey ${name}! 👋` : "Hey! 👋";
  return `${greeting}

Noticed you were exploring our ${fleetCategory} fleet — that's exactly what I specialize in.

I'm George, founder of George Yachts. If you're thinking about a charter in Greece this summer, I'd love to help personally.

Quick question: are you looking at specific dates, or still in the dreaming phase?

Either way, here's my direct calendar if you want to chat:
https://calendly.com/george-georgeyachts/30min`;
}

// Best-effort ManyChat send. If MANYCHAT_API_KEY is not set we log a
// notice in the response but don't fail the webhook — the CRM + Telegram
// still fire.
async function sendViaManyChat(igHandle: string, message: string) {
  const key = process.env.MANYCHAT_API_KEY;
  if (!key) return { ok: false, reason: "MANYCHAT_API_KEY not configured" };

  try {
    // ManyChat requires a subscriber_id, not a raw handle. We first
    // look up / create the subscriber by IG username via their public
    // API, then send content. If the subscriber doesn't exist yet
    // (user hasn't opened a conversation) the sendContent call will
    // be queued until they DO.
    const lookupRes = await fetch(
      `https://api.manychat.com/fb/subscriber/findByCustomField?field_id=ig_username&field_value=${encodeURIComponent(igHandle)}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const lookup = await lookupRes.json();
    const subscriberId = lookup?.data?.[0]?.id;

    if (!subscriberId) {
      return { ok: false, reason: "subscriber not found — will send when they DM us first" };
    }

    const sendRes = await fetch(
      "https://api.manychat.com/fb/sending/sendContent",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriber_id: subscriberId,
          data: {
            version: "v2",
            content: { messages: [{ type: "text", text: message }] },
          },
        }),
      }
    );
    const sendJson = await sendRes.json();
    return { ok: sendRes.ok, detail: sendJson };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "manychat fetch failed" };
  }
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
  }

  const handle = normalizeHandle(body.igHandle);
  if (!handle) {
    return NextResponse.json(
      { error: "igHandle required (alphanumeric, underscore, dot, 1-30 chars)" },
      { status: 400, headers: cors }
    );
  }

  const fleetCategory = categorizeFleet(body.pagesViewed ?? []);
  const dmText = buildDM(fleetCategory, body.name);
  const sb = createServiceClient();

  // 1. CRM log — contact + activity
  let contactId: string | null = null;
  try {
    const { data: existing } = await sb
      .from("contacts")
      .select("id")
      .eq("source", "website_lead")
      .ilike("company", `%@${handle}%`)
      .maybeSingle();

    if (existing?.id) {
      contactId = existing.id;
      await sb
        .from("contacts")
        .update({
          last_activity_at: new Date().toISOString(),
          charter_notes: `IG: @${handle} · interest: ${body.interest ?? "unknown"} · pages: ${(body.pagesViewed ?? []).join(", ")}`,
        })
        .eq("id", existing.id);
    } else {
      const { data: hotStage } = await sb
        .from("pipeline_stages")
        .select("id")
        .eq("name", "Hot")
        .maybeSingle();

      const { data: inserted } = await sb
        .from("contacts")
        .insert({
          first_name: body.name ?? `@${handle}`,
          last_name: null,
          email: body.email ?? null,
          company: `Instagram @${handle}`,
          country: body.country ?? null,
          source: "website_lead",
          pipeline_stage_id: hotStage?.id ?? null,
          charter_notes: [
            `Instagram handle: @${handle}`,
            `Interest: ${body.interest ?? "not specified"}`,
            `Fleet category: ${fleetCategory}`,
            `Pages viewed: ${(body.pagesViewed ?? []).join(", ")}`,
            `Visitor id: ${body.visitorId ?? "-"}`,
            `Source: georgeyachts.com popup`,
          ].join("\n"),
          last_activity_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      contactId = inserted?.id ?? null;

      if (contactId) {
        await sb.from("activities").insert({
          contact_id: contactId,
          type: "lead_captured",
          description: `Hot lead via popup — IG @${handle}, ${fleetCategory}`,
          metadata: {
            source: "website_popup",
            ig_handle: handle,
            interest: body.interest,
            pages_viewed: body.pagesViewed,
            visitor_id: body.visitorId,
          },
        });
      }
    }
  } catch (err) {
    console.error("[hot-lead] CRM log failed", err);
  }

  // 2. Telegram + in-app bell
  const telegramMsg = `🔥 <b>Hot lead via popup</b>\nIG: @${handle}\nFleet: ${fleetCategory}\nInterest: ${body.interest ?? "—"}\nPages: ${(body.pagesViewed ?? []).slice(0, 3).join(", ")}\n${body.email ? `Email: ${body.email}` : ""}`;

  const [telegramResult, notifResult] = await Promise.allSettled([
    sendTelegram(telegramMsg),
    contactId
      ? createNotification(sb, {
          type: "hot_lead",
          title: `🔥 Hot lead: @${handle}`,
          description: `${fleetCategory} · ${body.interest ?? "browsing"}`,
          link: `/dashboard/contacts/${contactId}`,
          contact_id: contactId,
        })
      : Promise.resolve(null),
  ]);

  // 3. ManyChat DM
  const manychatResult = await sendViaManyChat(handle, dmText);

  return NextResponse.json(
    {
      ok: true,
      handle,
      fleet_category: fleetCategory,
      crm_contact_id: contactId,
      telegram: telegramResult.status === "fulfilled",
      manychat: manychatResult,
    },
    { headers: cors }
  );
}
