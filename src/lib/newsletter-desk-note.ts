// THE DESK NOTE FROM THE POT (George, 2 October 2026, step 7): every Monday
// the house drafts the Bridge letter's opening paragraph from the Helm's
// own numbers (never an invented figure), parks it, and the morning brief
// carries it with ONE link: "Approve for the next Bridge". The approval
// writes the note to the site's desk-note store (lib/newsletter/desk-note),
// which the Tuesday auto-send reads and retires once the letter goes out.
// No approval, no note, no paragraph: the letter is the yacht and the
// article, as before.

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";
import { loadCharters, fmtLong } from "@/lib/helm/timeline";

const PUBLIC_BASE = process.env.NEWSLETTER_PUBLIC_BASE_URL || "https://georgeyachts.com";
const BASE = "https://command.georgeyachts.com";

function key(): string {
  const s = process.env.NEWSLETTER_PROXY_SECRET;
  if (!s) throw new Error("NEWSLETTER_PROXY_SECRET not configured");
  return s;
}

export async function siteDeskNote(stream: "bridge" | "wake"): Promise<{ text: string; approved_at: string } | null> {
  const u = new URL(`${PUBLIC_BASE}/api/admin/newsletter-desk-note`);
  u.searchParams.set("key", key()); u.searchParams.set("stream", stream);
  const r = await fetch(u, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { note?: { text: string; approved_at: string } | null };
  return r.ok && j.note?.text ? j.note : null;
}

export async function siteWriteDeskNote(stream: "bridge" | "wake", text: string): Promise<{ ok: boolean; error?: string; violations?: unknown }> {
  const u = new URL(`${PUBLIC_BASE}/api/admin/newsletter-desk-note`);
  u.searchParams.set("key", key());
  const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stream, text }), cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; violations?: unknown };
  return r.ok && j.ok ? { ok: true } : { ok: false, error: j.error || `HTTP ${r.status}`, violations: j.violations };
}

// ─── the numbers, from the pot ──────────────────────────────────────────────

export type HelmNumbers = {
  requests30: number;
  wonSeason: number;        // charters booked for the coming season (year of next summer)
  nextEmbark: { client: string; vessel: string; from: string } | null;
  editionsOpened7: number;
  season: number;
};

export async function helmNumbers(): Promise<HelmNumbers> {
  const db = createServiceClient();
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86400000).toISOString();
  const season = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  // Requests written by people: not travel agents, not the house's own
  // season-edition drafts, not test rows.
  const { data: recent } = await db.from("helm_requests").select("id, client_name, client_surname, request_type, src:extraction->>source").gte("created_at", since30).limit(500);
  const requests30 = (recent ?? []).filter((r) => r.request_type !== "travel_agent" && r.src !== "season_edition" && !/\(test\)|^test\b/i.test(`${r.client_name ?? ""} ${r.client_surname ?? ""}`)).length;
  const charters = await loadCharters();
  const wonSeason = charters.filter((c) => c.from.startsWith(String(season))).length;
  // The next embarkation AFTER the letter goes out (the Bridge sends on
  // Tuesdays), so the note never names a week that has already begun.
  const horizon = new Date(now.getTime() + 4 * 86400000).toISOString().slice(0, 10);
  const next = charters.filter((c) => c.from >= horizon).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
  const { data: opened } = await db.from("helm_requests").select("id, salon:extraction->salon").gte("last_activity_at", new Date(now.getTime() - 60 * 86400000).toISOString()).limit(400);
  const editionsOpened7 = (opened ?? []).filter((r) => { const s = r.salon as { last_at?: string } | null; return s?.last_at && s.last_at >= since7; }).length;
  return { requests30: requests30 ?? 0, wonSeason, nextEmbark: next ? { client: next.client, vessel: next.vessel, from: next.from } : null, editionsOpened7, season };
}

/** George's voice, only what the numbers say. Two or three sentences. */
export function composeDeskNote(n: HelmNumbers): string {
  const parts: string[] = [];
  const month = new Date().toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/Athens" });
  if (n.wonSeason >= 2) parts.push(`A short word from the desk this ${month}: ${n.wonSeason} weeks of the ${n.season} season are already signed, and the calendar is filling from the peak outwards.`);
  else if (n.wonSeason === 1) parts.push(`A short word from the desk this ${month}: the first week of the ${n.season} season is signed, and the calendar has started to fill from the peak outwards.`);
  else parts.push(`A short word from the desk this ${month}: the ${n.season} calendar is open, and the best weeks are the first to go.`);
  if (n.requests30 >= 5) parts.push(`${n.requests30} families wrote to me in the last thirty days, and I answered each one myself.`);
  if (n.nextEmbark) parts.push(`Our next embarkation is on ${fmtLong(n.nextEmbark.from)}; if your own dates are near it, write to me this week.`);
  else parts.push("If you are weighing two weeks against each other, write to me this week and I will tell you plainly which one I would take.");
  return parts.join(" ").replace(/\s*[—–]\s*/g, ", ");
}

// ─── the approval link (signed, single-purpose, no login) ───────────────────

function secret(): string { return process.env.CRON_SECRET || "no-secret"; }
export function approveToken(text: string, week: string): string {
  return createHmac("sha256", secret()).update(`${week}\n${text}`).digest("base64url").slice(0, 40);
}
export function verifyApproveToken(text: string, week: string, t: string): boolean {
  const a = Buffer.from(approveToken(text, week)); const b = Buffer.from(String(t || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
export function weekKey(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return `${x.getUTCFullYear()}-W${String(Math.ceil(((x.getTime() - y0.getTime()) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

export type DeskNoteDraft = { text: string; week: string; created_at: string; numbers: HelmNumbers; approved_at?: string };

/** Monday: draft the note, park it, tell the morning brief. Skips when the
 *  site already holds an approved note (George said yes already). */
export async function draftDeskNote(): Promise<{ action: "drafted" | "already-approved" | "kept"; draft?: DeskNoteDraft }> {
  const week = weekKey();
  const existing = await siteDeskNote("bridge").catch(() => null);
  if (existing) {
    await setSetting("newsletter_brief_latest", JSON.stringify({ generated_at: new Date().toISOString(), lines: [`The Bridge desk note is approved (${existing.approved_at.slice(0, 10)}) and goes out with the next issue: "${existing.text.slice(0, 140)}${existing.text.length > 140 ? "…" : ""}"`] }));
    return { action: "already-approved" };
  }
  const prev = await getSetting("desk_note_draft:bridge").then((r) => (r ? (JSON.parse(r) as DeskNoteDraft) : null)).catch(() => null);
  if (prev && prev.week === week && !prev.approved_at) {
    await publishBriefLines(prev);
    return { action: "kept", draft: prev };
  }
  const numbers = await helmNumbers();
  const draft: DeskNoteDraft = { text: composeDeskNote(numbers), week, created_at: new Date().toISOString(), numbers };
  await setSetting("desk_note_draft:bridge", JSON.stringify(draft));
  await publishBriefLines(draft);
  return { action: "drafted", draft };
}

async function publishBriefLines(d: DeskNoteDraft) {
  const t = approveToken(d.text, d.week);
  const approve = `${BASE}/api/newsletter/desk-note/approve?t=${t}&w=${d.week}`;
  const lines = [
    "A desk note for the next Bridge letter, written from this week's numbers. Approve it with one click, or tell me what to change in the chat.",
    `"${d.text}"`,
    `Approve: ${approve}`,
  ];
  const html = `<div style="font-size:14px;color:#26313D;line-height:1.6">A desk note for the next Bridge letter, written from this week's numbers. Approve it with one click, or tell me what to change in the chat.</div>
  <div style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:#0D1B2A;line-height:1.7;margin:10px 0 12px;padding:12px 14px;border-left:2px solid #DAA110;background:#FAF8F3">${d.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>
  <a href="${approve}" style="display:inline-block;background:#0D1B2A;color:#F8F5F0;border:1px solid #DAA110;padding:9px 16px;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;text-decoration:none">Approve for the next Bridge</a>`;
  await setSetting("newsletter_brief_latest", JSON.stringify({ generated_at: d.created_at, lines, html }));
}

export async function approveDraft(week: string, token: string): Promise<{ ok: boolean; message: string }> {
  const raw = await getSetting("desk_note_draft:bridge");
  const d = raw ? (JSON.parse(raw) as DeskNoteDraft) : null;
  if (!d) return { ok: false, message: "There is no desk note waiting." };
  if (d.week !== week || !verifyApproveToken(d.text, d.week, token)) return { ok: false, message: "This approval link is not for the note that is waiting." };
  if (d.approved_at) return { ok: true, message: "Already approved. It goes out with the next Bridge." };
  const w = await siteWriteDeskNote("bridge", d.text);
  if (!w.ok) return { ok: false, message: `The site did not accept it: ${w.error}` };
  d.approved_at = new Date().toISOString();
  await setSetting("desk_note_draft:bridge", JSON.stringify(d));
  await setSetting("newsletter_brief_latest", JSON.stringify({ generated_at: d.approved_at, lines: [`The Bridge desk note is approved and goes out with the next issue: "${d.text.slice(0, 140)}${d.text.length > 140 ? "…" : ""}"`] }));
  return { ok: true, message: "Approved. It opens the next Bridge letter." };
}
