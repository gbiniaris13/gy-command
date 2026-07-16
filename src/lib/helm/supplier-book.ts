// The Helm — George's supplier address book (2026-07-16). His regular central
// agencies, kept in ONE settings row (key helm_supplier_book, no migration).
// v2 (same day): each entry carries an `info` line — what fleet that address
// actually covers and the budget seen on their own site — so a non-broker
// employee can pick recipients without knowing the suppliers by heart. Info
// lines come from verified research + George's own edits; never invented.
// First read with an empty book SEEDS the emails from history (inquiry log
// lines + saved agency fields). Manual additions persist forever; removal
// only edits the book, never any request.

import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";

const KEY = "helm_supplier_book";
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const INFO_MAX = 400;
const NAME_MAX = 60;

/** `name` = the company as a human knows it ("Istion Yachting"); `info` =
 *  category lines separated by "|", each "Category: net fee range" — e.g.
 *  "Catamarans: EUR 10-60k/wk | Motor yachts: EUR 30-500k/wk". The UI renders
 *  each segment on its own line so a non-broker matches a request's budget
 *  and boat type at a glance. */
export type SupplierEntry = { email: string; name: string; info: string };

export function isValidSupplierEmail(s: string): boolean {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());
}

/** Accepts EVERY stored shape — v1 plain strings, v2 {email, info}, v3
 *  {email, name, info} — so the book survives its own upgrades with zero
 *  migration. */
function normalize(list: unknown[]): SupplierEntry[] {
  const seen = new Map<string, SupplierEntry>();
  for (const raw of list) {
    let email = "";
    let name = "";
    let info = "";
    if (typeof raw === "string") email = raw;
    else if (raw && typeof raw === "object") {
      email = String((raw as { email?: unknown }).email ?? "");
      name = String((raw as { name?: unknown }).name ?? "");
      info = String((raw as { info?: unknown }).info ?? "");
    }
    email = email.trim().toLowerCase();
    if (!isValidSupplierEmail(email)) continue;
    name = name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    info = info.replace(/\s+/g, " ").trim().slice(0, INFO_MAX);
    const prev = seen.get(email);
    // Keep the richest record when the same address appears twice.
    if (!prev || name.length + info.length > prev.name.length + prev.info.length) {
      seen.set(email, { email, name, info });
    }
  }
  // Sort by display name (email as fallback) — the list reads like a phonebook.
  return Array.from(seen.values()).sort((a, b) =>
    (a.name || a.email).localeCompare(b.name || b.email),
  );
}

async function seedFromHistory(): Promise<SupplierEntry[]> {
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

async function saveBook(entries: SupplierEntry[]): Promise<void> {
  await setSetting(KEY, JSON.stringify(entries));
}

export async function getSupplierBook(): Promise<SupplierEntry[]> {
  const raw = await getSetting(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch { /* corrupted value -> reseed below */ }
  }
  const seeded = await seedFromHistory();
  if (seeded.length) await saveBook(seeded);
  return seeded;
}

export async function addToSupplierBook(emails: string[]): Promise<SupplierEntry[]> {
  const book = await getSupplierBook();
  const next = normalize([...book, ...emails]);
  if (next.length !== book.length) await saveBook(next);
  return next;
}

export async function removeFromSupplierBook(email: string): Promise<SupplierEntry[]> {
  const book = await getSupplierBook();
  const target = email.trim().toLowerCase();
  const next = book.filter((e) => e.email !== target);
  if (next.length !== book.length) await saveBook(next);
  return next;
}

/** George (or his employee) edits a supplier's name/info inline; empty clears. */
export async function setSupplierFields(
  email: string,
  fields: { name?: string; info?: string },
): Promise<SupplierEntry[]> {
  const book = await getSupplierBook();
  const target = email.trim().toLowerCase();
  const next = book.map((e) => {
    if (e.email !== target) return e;
    const out = { ...e };
    if (fields.name !== undefined) out.name = fields.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    if (fields.info !== undefined) out.info = fields.info.replace(/\s+/g, " ").trim().slice(0, INFO_MAX);
    return out;
  });
  await saveBook(next);
  return next;
}
