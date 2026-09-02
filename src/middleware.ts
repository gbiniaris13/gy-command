import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = "https://ojpcmnnqohxlfsudvxcz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__yNJKcssEsLPHv0Xuh-f7A_HW447VM0";

export async function middleware(request: NextRequest) {
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
    supabaseResponse.cookies.set("gy_staff", "1", {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
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
  matcher: ["/dashboard/:path*", "/login"],
  // Note: /api/* and /auth/* are NOT matched — they bypass middleware
};
