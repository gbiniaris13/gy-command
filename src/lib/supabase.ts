import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { cookies } from "next/headers";

const SUPABASE_URL = "https://ojpcmnnqohxlfsudvxcz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__yNJKcssEsLPHv0Xuh-f7A_HW447VM0";

export function createBrowserSupabaseClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function createServerSupabaseClient(
  cookieStore: Awaited<ReturnType<typeof cookies>>
) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
          // Ignored in Server Components
        }
      },
    },
  });
}
