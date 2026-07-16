// GET/POST /api/helm/supplier-book — George's saved central-agency addresses.
// GET returns the book (seeding it from history on first use). POST
// {action:"add"|"remove", email} edits it. Admin-gated like every Helm route;
// touches ONE settings row, never any request.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  getSupplierBook,
  addToSupplierBook,
  removeFromSupplierBook,
  isValidSupplierEmail,
} from "@/lib/helm/supplier-book";

export const runtime = "nodejs";

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
    return NextResponse.json({ ok: true, emails: await getSupplierBook() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const email = await adminEmail();
  if (!email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const target = String(body?.email ?? "").trim().toLowerCase();
  if (!isValidSupplierEmail(target)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }
  try {
    if (body?.action === "add") {
      return NextResponse.json({ ok: true, emails: await addToSupplierBook([target]) });
    }
    if (body?.action === "remove") {
      return NextResponse.json({ ok: true, emails: await removeFromSupplierBook(target) });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
