// THE FLEET BOOK (George, 2 October 2026): a yacht is built ONCE and reused.
//
// One folder per yacht, kept in our own `settings` table under
// `helm_dossier:<key>` (no migration, no subscription, nothing to pay). The
// folder holds everything about the yacht that does not change from one
// client to the next: type, spec line, the one-sentence description, George's
// Inside Info, the crew line, highlights, water toys, accommodation,
// distinctions, photographs, brochure, video. Price, dates and ports always
// come from the supplier's email for THAT request, never from here.
//
// Three ways a folder is born: "Fill from the site" (the Sanity yacht page),
// "Save to the Fleet Book" on a request's yacht card, or typed by hand,
// roughly or carefully. The newest save wins; nothing is ever deleted by code.
//
// Where it is read: applyDossiers() on every extraction (the review panel
// opens pre-filled), the generate route (photos, copy, Salon extras) and the
// season edition. George's own typed words on the card still beat the folder;
// the folder beats the AI; the AI only writes where both are silent.

import { createServiceClient } from "@/lib/supabase-server";
import { yachtKey } from "@/lib/helm/supplier-parse";

export const DOSSIER_PREFIX = "helm_dossier:";

export type YachtDossier = {
  v: 1;
  key: string;
  name: string;
  type?: string;
  spec_line?: string;
  description?: string;
  inside_info?: string;
  crew_line?: string;
  highlights?: string[];
  water_toys?: string[];
  accommodation?: [string, string][];
  distinctions?: string[];
  main_url?: string;
  extra_urls?: string[];
  brochure_url?: string;
  video_url?: string;
  /** George's private notes: owner, central agent, quirks. Never rendered. */
  notes?: string;
  sanity_slug?: string;
  source?: "site" | "request" | "manual";
  updated_at?: string;
  updated_by?: string;
};

/** Type prefixes a supplier or the site may put before the name. "S/CAT" and
 *  friends are listed explicitly: the extractor's own regex stops at "S/C"
 *  and then fails the word boundary, so "S/CAT EFFIE STAR" kept its prefix. */
const TYPE_PREFIX = /^(m\/?cat|s\/?cat|p\/?cat|m\/?y|s\/?y|m\/?s|m\/?c|s\/?c|p\/?c|motor\s+yacht|sailing\s+yacht|motor\s+catamaran|sailing\s+catamaran|power\s+catamaran|catamaran|cruise\s+ship)\b[\s.:-]*/i;

/** The display name without the type prefix ("S/CAT ALMA" → "ALMA"). */
export function plainYachtName(name: string): string {
  return String(name || "").trim().replace(TYPE_PREFIX, "").trim();
}

/** One key for "S/CAT EFFIE STAR", "M/Y Effie Star" and "EFFIE STAR". */
export function dossierKey(name?: string | null): string {
  return yachtKey(plainYachtName(String(name ?? "")));
}

const str = (x: unknown, max = 2000) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const list = (x: unknown, max = 24) =>
  Array.isArray(x) ? x.map((s) => str(s, 240)).filter(Boolean).slice(0, max) : [];
const pairs = (x: unknown, max = 12): [string, string][] =>
  Array.isArray(x)
    ? x
        .map((p): [string, string] | null =>
          Array.isArray(p) && p.length >= 1 ? [str(p[0], 120), str(p[1] ?? "", 240)] : null,
        )
        .filter((p): p is [string, string] => !!p && !!p[0])
        .slice(0, max)
    : [];
const urls = (x: unknown, max = 24) =>
  Array.isArray(x) ? x.map((u) => str(u, 1000)).filter((u) => /^https?:\/\//.test(u)).slice(0, max) : [];

/** Accepts anything shaped like a folder and returns a clean one, or null. */
export function normalizeDossier(raw: unknown): YachtDossier | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = plainYachtName(str(r.name, 120));
  if (!name) return null;
  const key = str(r.key, 80) || dossierKey(name);
  const d: YachtDossier = { v: 1, key, name };
  const t = str(r.type, 60); if (t) d.type = t;
  const s = str(r.spec_line, 240); if (s) d.spec_line = s;
  const de = str(r.description, 400); if (de) d.description = de;
  const ii = str(r.inside_info, 240); if (ii) d.inside_info = ii;
  const cl = str(r.crew_line, 240); if (cl) d.crew_line = cl;
  const hl = list(r.highlights, 12); if (hl.length) d.highlights = hl;
  const wt = list(r.water_toys, 16); if (wt.length) d.water_toys = wt;
  const ac = pairs(r.accommodation, 12); if (ac.length) d.accommodation = ac;
  const di = list(r.distinctions, 8); if (di.length) d.distinctions = di;
  const mu = urls([r.main_url])[0]; if (mu) d.main_url = mu;
  const eu = urls(r.extra_urls, 24).filter((u) => u !== mu); if (eu.length) d.extra_urls = eu;
  const bu = urls([r.brochure_url])[0]; if (bu) d.brochure_url = bu;
  const vu = urls([r.video_url])[0]; if (vu) d.video_url = vu;
  const no = str(r.notes, 4000); if (no) d.notes = no;
  const sl = str(r.sanity_slug, 120); if (sl) d.sanity_slug = sl;
  const so = str(r.source, 20); if (so === "site" || so === "request" || so === "manual") d.source = so;
  const ua = str(r.updated_at, 40); if (ua) d.updated_at = ua;
  const ub = str(r.updated_by, 120); if (ub) d.updated_by = ub;
  return d;
}

function parse(value: unknown): YachtDossier | null {
  if (typeof value !== "string") return null;
  try { return normalizeDossier(JSON.parse(value)); } catch { return null; }
}

export async function getDossier(keyOrName: string): Promise<YachtDossier | null> {
  const key = dossierKey(keyOrName) || keyOrName;
  if (!key) return null;
  const db = createServiceClient();
  const { data } = await db.from("settings").select("value").eq("key", DOSSIER_PREFIX + key).maybeSingle();
  return parse(data?.value);
}

export async function listDossiers(): Promise<YachtDossier[]> {
  const db = createServiceClient();
  const { data } = await db.from("settings").select("key, value").like("key", `${DOSSIER_PREFIX}%`);
  const out: YachtDossier[] = [];
  for (const row of data ?? []) {
    const d = parse(row.value);
    if (d) out.push(d);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Folders for a list of names, keyed by the normalised yacht key. One query. */
export async function dossiersForNames(names: (string | null | undefined)[]): Promise<Record<string, YachtDossier>> {
  const keys = Array.from(new Set(names.map((n) => dossierKey(n)).filter(Boolean)));
  if (keys.length === 0) return {};
  const db = createServiceClient();
  const { data } = await db.from("settings").select("key, value").in("key", keys.map((k) => DOSSIER_PREFIX + k));
  const out: Record<string, YachtDossier> = {};
  for (const row of data ?? []) {
    const d = parse(row.value);
    if (d) out[d.key] = d;
  }
  return out;
}

export async function saveDossier(input: unknown, by?: string): Promise<YachtDossier> {
  const d = normalizeDossier(input);
  if (!d) throw new Error("A yacht needs at least a name.");
  d.updated_at = new Date().toISOString();
  if (by) d.updated_by = by;
  const db = createServiceClient();
  const { error } = await db.from("settings").upsert({ key: DOSSIER_PREFIX + d.key, value: JSON.stringify(d), updated_at: d.updated_at });
  if (error) throw new Error(error.message);
  return d;
}

/** Removal is George's explicit act in the Fleet Book only (confirm dialog). */
export async function removeDossier(key: string): Promise<void> {
  const k = dossierKey(key) || key;
  if (!k) return;
  const db = createServiceClient();
  await db.from("settings").delete().eq("key", DOSSIER_PREFIX + k);
}

// ─── From the site (Sanity) ──────────────────────────────────────────────────
// A sibling of sanity-fleet.ts on purpose: that fetcher feeds Instagram and is
// gated by the social allowlist and a six-photo floor. The Fleet Book is a
// private library for proposals, so every yacht on the site qualifies, website-
// only licences included. Retired yachts are left out (they are not offered).

const SANITY_PROJECT = "ecqr94ey";
const SANITY_DATASET = "production";
const SANITY_API = "2024-01-01";

export type SiteYacht = {
  _id: string;
  name: string;
  slug: string;
  subtitle?: string | null;
  category?: string | null;
  builder?: string | null;
  length?: string | null;
  sleeps?: string | null;
  cabins?: string | null;
  crew?: string | null;
  cruiseSpeed?: string | null;
  maxSpeed?: string | null;
  homePort?: string | null;
  yearBuiltRefit?: string | null;
  weeklyRatePrice?: string | null;
  descriptionText?: string | null;
  georgeInsiderTip?: string | null;
  idealFor?: string | null;
  features?: string[];
  toys?: string[];
  waterToys?: string[];
  images?: { url: string; alt?: string | null }[];
  brochureUrl?: string | null;
  videoUrl?: string | null;
};

const SITE_FIELDS = `{
  _id, name, "slug": slug.current, subtitle, category, builder, length, sleeps, cabins, crew,
  cruiseSpeed, maxSpeed, homePort, yearBuiltRefit, weeklyRatePrice,
  "descriptionText": pt::text(description),
  georgeInsiderTip, idealFor,
  "features": coalesce(features, []), "toys": coalesce(toys, []), "waterToys": coalesce(waterToys, []),
  "images": images[]{ "url": asset->url, alt },
  "brochureUrl": brochure.asset->url,
  "videoUrl": video.url
}`;

async function groq<T>(query: string, params: Record<string, string> = {}): Promise<T | null> {
  const qs = new URLSearchParams({ query });
  for (const [k, v] of Object.entries(params)) qs.set(`$${k}`, JSON.stringify(v));
  const url = `https://${SANITY_PROJECT}.apicdn.sanity.io/v${SANITY_API}/data/query/${SANITY_DATASET}?${qs}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: T };
    return j.result ?? null;
  } catch {
    return null;
  }
}

/** Every yacht on the site, light fields, for the "not yet in the book" list. */
export async function listSiteYachts(): Promise<Pick<SiteYacht, "_id" | "name" | "slug" | "category" | "subtitle" | "images">[]> {
  const r = await groq<SiteYacht[]>(
    `*[_type == "yacht" && defined(slug.current) && !(_id in path("drafts.**"))] | order(name asc) { _id, name, "slug": slug.current, category, subtitle, "images": images[0..0]{ "url": asset->url, alt } }`,
  );
  return r ?? [];
}

export async function fetchSiteYacht(slugOrName: string): Promise<SiteYacht | null> {
  const s = String(slugOrName || "").trim();
  if (!s) return null;
  const bySlug = await groq<SiteYacht[]>(`*[_type == "yacht" && slug.current == $slug && !(_id in path("drafts.**"))][0..0] ${SITE_FIELDS}`, { slug: s });
  if (bySlug && bySlug[0]) return bySlug[0];
  const all = await groq<SiteYacht[]>(`*[_type == "yacht" && defined(slug.current) && !(_id in path("drafts.**"))] ${SITE_FIELDS}`);
  const k = dossierKey(s);
  return (all ?? []).find((y) => dossierKey(y.name) === k) ?? null;
}

const num = (s?: string | null) => (String(s ?? "").match(/\d+/) || [""])[0];

const CATEGORY_LABEL: Record<string, string> = {
  "motor-yachts": "MOTOR YACHT",
  "sailing-catamarans": "SAILING CATAMARAN",
  "power-catamarans": "POWER CATAMARAN",
  "sailing-monohulls": "SAILING YACHT",
};

/** Builds the folder from the site. Nothing is invented: every line is a field
 *  George already published on georgeyachts.com. */
export function dossierFromSite(y: SiteYacht, by?: string): YachtDossier {
  const name = plainYachtName(y.name);
  const cls = (y.builder ?? y.subtitle?.split(/[|·,]/)[0] ?? "").trim();
  const spec = [
    cls,
    y.yearBuiltRefit ? `Built ${y.yearBuiltRefit}` : "",
    y.length ?? "",
    num(y.cabins) ? `${num(y.cabins)} cabins` : "",
    num(y.sleeps) ? `${num(y.sleeps)} guests` : "",
    num(y.crew) ? `Crew of ${num(y.crew)}` : "",
  ].filter(Boolean).join(" | ");
  const ideal = (y.idealFor ?? "").trim().replace(/[.!?]$/, "");
  // The site's editorial copy opens with a heading line; the first real
  // sentence is the first one that ends in a full stop.
  const firstSentence = (y.descriptionText ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /[.!?]$/.test(l))
    .map((l) => l.split(/(?<=[.!?])\s+/)[0] ?? "")
    .find((sen) => sen.length >= 30 && sen.length <= 220) ?? "";
  const description = firstSentence
    ? firstSentence
    : ideal ? `Built for ${ideal.charAt(0).toLowerCase()}${ideal.slice(1)}.` : "";
  const toys = Array.from(new Set([...(y.toys ?? []), ...(y.waterToys ?? []).map(labelToy)])).filter(Boolean);
  const imgs = (y.images ?? []).map((i) => i.url).filter(Boolean);
  return normalizeDossier({
    key: dossierKey(name),
    name,
    type: y.category ? CATEGORY_LABEL[y.category] ?? y.category.toUpperCase() : "",
    spec_line: spec,
    description,
    inside_info: clampSentences((y.georgeInsiderTip ?? "").trim().replace(/\s*[—–]\s*/g, ", "), 240),
    crew_line: num(y.crew) ? `${name} operates with a crew of ${num(y.crew)}.` : "",
    highlights: (y.features ?? []).slice(0, 8),
    water_toys: toys.slice(0, 12),
    main_url: imgs[0] ?? "",
    extra_urls: imgs.slice(1, 24),
    brochure_url: y.brochureUrl ?? "",
    video_url: y.videoUrl ?? "",
    sanity_slug: y.slug,
    source: "site",
    updated_by: by,
  }) as YachtDossier;
}

/** Cuts at the last full sentence that fits, so a 240-char budget never
 *  ends mid-word. Falls back to the last whole word when no sentence fits. */
export function clampSentences(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.endsWith(".") ? head.length - 1 : -1);
  if (lastStop >= 60) return head.slice(0, lastStop + 1).trim();
  const lastSpace = head.lastIndexOf(" ");
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trim();
}

function labelToy(v: string): string {
  const m: Record<string, string> = {
    jet_ski: "Jet ski", seabob: "SeaBob", efoil: "e-Foil", wakeboard: "Wakeboard", paddleboard: "Paddleboard",
    inflatable_slide: "Inflatable slide", diving_equipment: "Diving equipment", tender_jet: "Jet-drive tender", snorkeling: "Snorkelling gear",
  };
  return m[v] ?? v.replace(/_/g, " ");
}

// ─── Into an extraction (the review panel opens pre-filled) ──────────────────

type Fieldish = { value?: unknown; confidence?: string; snippet?: string };
type YachtLike = {
  vessel_name?: Fieldish;
  vessel_type?: Fieldish;
  spec_line?: Fieldish;
  content?: unknown;
  dossier_key?: string;
  [k: string]: unknown;
};

/** Fills type, spec line, crew line and the Salon lists from each yacht's
 *  folder where the folder has them. The email keeps every number. Marks the
 *  yacht with dossier_key so the panel can say where the facts came from. */
export async function applyDossiers<T extends { yachts?: unknown[] }>(extraction: T): Promise<T> {
  const ys = (Array.isArray(extraction?.yachts) ? extraction.yachts : []) as YachtLike[];
  if (ys.length === 0) return extraction;
  const nameOf = (y: YachtLike) => (typeof y.vessel_name?.value === "string" ? y.vessel_name.value : "");
  const found = await dossiersForNames(ys.map(nameOf));
  if (Object.keys(found).length === 0) return extraction;
  const FROM = "From the Fleet Book";
  for (const y of ys) {
    const d = found[dossierKey(nameOf(y))];
    if (!d) { delete y.dossier_key; continue; }
    y.dossier_key = d.key;
    if (d.type) y.vessel_type = { value: d.type, confidence: "high", snippet: FROM };
    if (d.spec_line) y.spec_line = { value: d.spec_line, confidence: "high", snippet: FROM };
    const c = (y.content && typeof y.content === "object" ? y.content : {}) as Record<string, unknown>;
    if (d.crew_line) c.crew_line = d.crew_line;
    if (d.highlights?.length) c.highlights = d.highlights;
    if (d.water_toys?.length) c.water_toys = d.water_toys;
    if (d.accommodation?.length) c.accommodation = d.accommodation;
    if (d.distinctions?.length) c.distinctions = d.distinctions;
    y.content = c;
  }
  return extraction;
}

// ─── From a request's yacht card ("Save to the Fleet Book") ──────────────────

export function dossierFromRequestYacht(args: {
  name: string;
  type?: string;
  spec_line?: string;
  manual_note?: string;
  content?: Record<string, unknown>;
  media?: { main_url?: string | null; extra_urls?: string[] | null; brochure_url?: string | null };
  existing?: YachtDossier | null;
  by?: string;
}): YachtDossier {
  const c = args.content ?? {};
  const base = args.existing ?? {};
  return normalizeDossier({
    ...base,
    key: dossierKey(args.name),
    name: plainYachtName(args.name),
    type: args.type || (base as YachtDossier).type,
    spec_line: args.spec_line || (base as YachtDossier).spec_line,
    inside_info: args.manual_note || (base as YachtDossier).inside_info,
    crew_line: (c.crew_line as string) || (base as YachtDossier).crew_line,
    highlights: (c.highlights as string[])?.length ? c.highlights : (base as YachtDossier).highlights,
    water_toys: (c.water_toys as string[])?.length ? c.water_toys : (base as YachtDossier).water_toys,
    accommodation: (c.accommodation as unknown[])?.length ? c.accommodation : (base as YachtDossier).accommodation,
    distinctions: (c.distinctions as string[])?.length ? c.distinctions : (base as YachtDossier).distinctions,
    main_url: args.media?.main_url || (base as YachtDossier).main_url,
    extra_urls: args.media?.extra_urls?.length ? args.media.extra_urls : (base as YachtDossier).extra_urls,
    brochure_url: args.media?.brochure_url || (base as YachtDossier).brochure_url,
    source: "request",
    updated_by: args.by,
  }) as YachtDossier;
}
