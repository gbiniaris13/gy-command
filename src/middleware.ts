import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = "https://ojpcmnnqohxlfsudvxcz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__yNJKcssEsLPHv0Xuh-f7A_HW447VM0";

// 2026-11-19: the cron lock. Until today 55 of the 78 routes under
// /api/cron answered anyone who knew the address: a plain GET could fire
// the weekly caption generator (AI calls), the watchdog (Telegram and
// email to George) or any other job. A request now passes only if it
// carries the cron secret (Vercel adds "Authorization: Bearer CRON_SECRET"
// to its own cron calls when the env var is set) or comes from a browser
// signed in to the dashboard, so George can still open a cron address by
// hand. Everything else gets 401 and a log line.
//
// Fails closed: with no CRON_SECRET set, only a signed-in browser passes.
//
// Two routes keep their own door because they accept a credential this
// file cannot check: helm-replan (the Mac's conversation sync token) and
// week-edition (?key=). Both refuse anonymous callers themselves.
const CRON_SELF_GUARDED = new Set(["helm-replan", "week-edition"]);

async function hasDashboardSession(request: NextRequest): Promise<boolean> {
  // No Supabase cookie, no session: skip the network call for strangers.
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return false;
  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

async function guardCron(request: NextRequest): Promise<NextResponse> {
  const name = request.nextUrl.pathname.split("/")[3] ?? "";
  if (CRON_SELF_GUARDED.has(name)) return NextResponse.next({ request });

  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) return NextResponse.next({ request });
  if (await hasDashboardSession(request)) return NextResponse.next({ request });

  console.warn(
    `[cron-lock] denied ${request.nextUrl.pathname} ua=${(request.headers.get("user-agent") || "").slice(0, 60)}`,
  );
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function middleware(request: NextRequest) {
  // Before the host branch below: the lock holds on every hostname.
  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    return guardCron(request);
  }

  // 2026-10-02: edition.georgeyachts.com is the client's address for their
  // edition. "/<surname>-<code>" is served by the Salon page under /p/, same
  // app and same origin, so photographs, fonts and the reading beacons all
  // work unchanged. The bare host goes to the public site.
  const host = request.headers.get("host") || "";
  if (host.startsWith("edition.")) {
    const path = request.nextUrl.pathname;
    if (path === "/" || path === "") {
      return NextResponse.redirect("https://georgeyachts.com", 307);
    }
    const m = path.match(/^\/([a-z0-9]{1,24}-[a-z0-9]{6})\/?$/);
    if (m) {
      const url = request.nextUrl.clone();
      url.pathname = `/p/${m[1]}`;
      return NextResponse.rewrite(url);
    }
    if (!path.startsWith("/p/") && !path.startsWith("/_next") && !path.startsWith("/api")) {
      return NextResponse.redirect("https://georgeyachts.com", 307);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 2026-08-05 — a durable "this browser belongs to the house" marker.
  // The Salon open counter used to ask only "is there a live dashboard
  // session right now?". George opening his own proposal link from his
  // iPhone, or from a second window, or straight out of his email, has no
  // session on that request, so his own previews were counted as client
  // opens and inflated "Opened 14x". Once he has signed in on a device, we
  // stamp a year-long cookie there; the Salon beacon reads it and stays
  // silent. Not a secret, so no httpOnly: it must survive and be readable
  // on any later request from that browser.
  if (user) {
    // Scoped to .georgeyachts.com in production (2026-10-02) so George's own
    // visits to edition.georgeyachts.com never count as client views.
    supabaseResponse.cookies.set("gy_staff", "1", {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      ...(process.env.NODE_ENV === "production" ? { domain: ".georgeyachts.com" } : {}),
    });
  }

  // Local layout preview only: hostname must be localhost AND the
  // env flag set. Harmless if it ever ships: production hostnames
  // never match and the flag is never set there.
  const devLayoutPreview =
    request.nextUrl.hostname === "localhost" &&
    process.env.DEV_LAYOUT_PREVIEW === "1";

  if (!user && !devLayoutPreview && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    // If returning from Gmail OAuth, go to email page
    if (request.nextUrl.searchParams.get("gmail_connected") === "true") {
      url.pathname = "/dashboard/email";
      url.search = "?connected=true";
    } else {
      url.pathname = "/dashboard";
    }
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // The edition host needs the root and the short-code paths; everything
  // else on command.georgeyachts.com is untouched (api/auth still bypass),
  // except /api/cron, which is locked (see guardCron above).
  matcher: ["/dashboard/:path*", "/login", "/", "/:code([a-z0-9]{1,24}-[a-z0-9]{6})", "/api/cron/:path*"],
};
