// The client's address for their edition (George, 2 October 2026): short,
// on our own name, with theirs in it.
//
//   https://edition.georgeyachts.com/mccrary-k7h3xq
//
// The surname is for the eye; the six characters are the lock (1.6 billion
// combinations per surname, never derived from anything). The code lives
// in extraction.edition_code and is minted the first time a link is needed.
// The old /p/<hmac token> links keep working forever; both resolve to the
// same request through resolveEditionRef().

import { createServiceClient } from "@/lib/supabase-server";
import { getRequest, saveExtraction } from "@/lib/helm-admin";
import { verifyProposalToken } from "@/lib/helm/proposal-token";

export const EDITION_ORIGIN = "https://edition.georgeyachts.com";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

function randomCode(n = 6): string {
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function surnameSlug(r: { client_surname?: string | null; client_name?: string | null }): string {
  const raw = String(r.client_surname || r.client_name || "")
    .replace(/\b(mr|mrs|ms|miss|dr|the|family)\.?\b/gi, " ")
    .trim()
    .split(/\s+/)
    .pop() || "";
  const slug = raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "")
    .slice(0, 24);
  return slug || "edition";
}

/** The request's short code, minted on first use. */
export async function ensureEditionCode(id: string): Promise<string | null> {
  const r = await getRequest(id);
  if (!r) return null;
  const ex = (r.extraction && typeof r.extraction === "object" ? r.extraction : {}) as Record<string, unknown>;
  const existing = typeof ex.edition_code === "string" ? ex.edition_code : "";
  if (existing) return existing;
  const db = createServiceClient();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${surnameSlug(r)}-${randomCode()}`;
    const { data: clash } = await db.from("helm_requests").select("id").eq("extraction->>edition_code", code).limit(1).maybeSingle();
    if (clash) continue;
    await saveExtraction(id, { ...ex, edition_code: code });
    return code;
  }
  return null;
}

/** The pretty link, or the signed /p/ link when a code cannot be minted. */
export async function editionUrl(id: string): Promise<string> {
  const code = await ensureEditionCode(id);
  if (code) return `${EDITION_ORIGIN}/${code}`;
  const { proposalToken } = await import("@/lib/helm/proposal-token");
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://command.georgeyachts.com";
  return `${origin}/p/${proposalToken(id)}`;
}

/** A /p/<ref> segment is either the signed token or a short code. */
export async function resolveEditionRef(ref: string): Promise<string | null> {
  const r = String(ref || "").trim();
  if (!r) return null;
  const byToken = verifyProposalToken(r);
  if (byToken) return byToken;
  if (!/^[a-z0-9]{1,24}-[a-z0-9]{6}$/.test(r)) return null;
  try {
    const db = createServiceClient();
    const { data } = await db.from("helm_requests").select("id").eq("extraction->>edition_code", r).limit(1).maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}
