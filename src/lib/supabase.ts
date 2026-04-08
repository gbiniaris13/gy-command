import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { cookies } from "next/headers";

// ─── Browser client (used in Client Components) ─────────────────────────────
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    // Replace with your real Supabase URL
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://your-project.supabase.co",
    // Replace with your real Supabase anon key
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "your-anon-key-here"
  );
}

// ─── Server client (used in Server Components, Route Handlers, Middleware) ───
export function createServerSupabaseClient(
  cookieStore: Awaited<ReturnType<typeof cookies>>
) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://your-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "your-anon-key-here",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  );
}
