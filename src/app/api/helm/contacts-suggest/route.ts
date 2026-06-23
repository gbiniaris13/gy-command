// GET /api/helm/contacts-suggest — recent distinct contacts from past Helm
// requests, to autocomplete the new-request form (address book). Admin-gated,
// read-only. Returns the most recent unique contact per email.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function GET() {
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("helm_requests")
      .select("client_email, client_name, client_surname, client_title, client_whatsapp, request_type, last_activity_at")
      .not("client_email", "is", null)
      .order("last_activity_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    // Dedupe by lowercased email, keep the most recent occurrence.
    const seen = new Set<string>();
    const contacts: Array<{
      email: string; name: string | null; surname: string | null;
      title: string | null; whatsapp: string | null; request_type: string | null;
    }> = [];
    for (const r of data ?? []) {
      const key = String(r.client_email || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      contacts.push({
        email: r.client_email,
        name: r.client_name ?? null,
        surname: r.client_surname ?? null,
        title: r.client_title ?? null,
        whatsapp: r.client_whatsapp ?? null,
        request_type: r.request_type ?? null,
      });
      if (contacts.length >= 250) break;
    }
    return NextResponse.json({ contacts });
  } catch (e) {
    // Non-fatal: the form just shows no suggestions.
    return NextResponse.json({ contacts: [], error: (e as Error).message });
  }
}
