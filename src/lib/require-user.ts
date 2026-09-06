// @ts-nocheck
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// The dashboard session check, lifted from /api/helm so every route
// that acts for George can use one line. middleware.ts guards only
// /dashboard and /login; /api/* bypasses it by design, which is right
// for the crons (Vercel calls them without cookies) and wrong for the
// routes the dashboard calls, which until 6/9/2026 answered anyone:
// The Lighthouse batch send, for one, would email every client on a
// holiday for whoever posted the right JSON.
//
// Usage inside a handler:
//   const denied = await requireUser(); if (denied) return denied;
//
// A cron secret is accepted too, so a route can be both a dashboard
// action and a cron target (Authorization: Bearer CRON_SECRET, which
// Vercel adds on its own when the env var is set).
export async function requireUser(request?: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = request?.headers?.get?.("authorization") || "";
    if (secret && auth === `Bearer ${secret}`) return null;
  } catch {}
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const jar = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: { getAll: () => jar.getAll(), setAll: () => {} },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) return null;
  } catch {}
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
