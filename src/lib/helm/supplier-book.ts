// The Helm — George's supplier address book (2026-07-16). His 5-10 central
// agencies, kept in ONE settings row (key helm_supplier_book, no migration).
// First read with an empty book SEEDS it from history: every address that ever
// received a central-agency inquiry (the "[Central agency inquiry -> ...]"
// outbound log lines) plus every central_agency_email saved on a request.
// Manually added addresses persist forever; removal only edits the book,
// never any request.

import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";

const KEY = "helm_supplier_book";
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function isValidSupplierEmail(s: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());
}

function normalize(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (!isValidSupplierEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out.sort();
}

async function seedFromHistory(): Promise<string[]> {
  const db = createServiceClient();
  const found: string[] = [];
  const { data: msgs } = await db
    .from("helm_messages")
    .select("body")
    .like("body", "[Central agency inquiry ->%")
    .limit(500);
  for (const m of msgs ?? []) {
    // Addresses live in the first line: "[... -> a@x, b@y - sent individually ...]"
    const firstLine = String(m.body ?? "").split("\n")[0];
    found.push(...(firstLine.match(EMAIL_RE) ?? []));
  }
  const { data: reqs } = await db
    .from("helm_requests")
    .select("central_agency_email")
    .not("central_agency_email", "is", null)
    .limit(500);
  for (const r of reqs ?? []) {
    found.push(...(String(r.central_agency_email ?? "").match(EMAIL_RE) ?? []));
  }
  return normalize(found);
}

export async function getSupplierBook(): Promise<string[]> {
  const raw = await getSetting(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed.map(String));
    } catch { /* corrupted value -> reseed below */ }
  }
  const seeded = await seedFromHistory();
  if (seeded.length) await setSetting(KEY, JSON.stringify(seeded));
  return seeded;
}

export async function addToSupplierBook(emails: string[]): Promise<string[]> {
  const book = await getSupplierBook();
  const next = normalize([...book, ...emails]);
  if (next.length !== book.length) await setSetting(KEY, JSON.stringify(next));
  return next;
}

export async function removeFromSupplierBook(email: string): Promise<string[]> {
  const book = await getSupplierBook();
  const target = email.trim().toLowerCase();
  const next = book.filter((e) => e !== target);
  if (next.length !== book.length) await setSetting(KEY, JSON.stringify(next));
  return next;
}
