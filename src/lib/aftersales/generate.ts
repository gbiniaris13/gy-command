// src/lib/aftersales/generate.ts
// "Generate" for one After sales message: read the conversation with that
// person, start from the base text, let the model personalise it within the
// playbook, check it in code, retry once, else hand George the base text.
// Sending is never here.

import fs from "node:fs";
import path from "node:path";
import { aiChat } from "@/lib/ai";
import { parseLooseJson } from "@/lib/helm/json";
import { deDash } from "@/lib/helm/followup/validate";
import { readGmailByAddress } from "@/lib/helm/followup/context";
import type { Charter, Kind, Person } from "./plan";
import { GOOGLE_REVIEW_LINK } from "./plan";
import { baseText, greetingFor } from "./templates";
import { checkAfterSales } from "./validate";
import { addDays, athensToday, daysBetween } from "./dates";
import { ungrounded, tooSimilar } from "./grounding";

const PLAYBOOK_PATH = path.join(process.cwd(), ".claude", "skills", "after-sales", "SKILL.md");
let cache: { mtime: number; text: string } | null = null;
function playbook(): string {
  const st = fs.statSync(PLAYBOOK_PATH);
  if (!cache || cache.mtime !== st.mtimeMs) cache = { mtime: st.mtimeMs, text: fs.readFileSync(PLAYBOOK_PATH, "utf8") };
  return cache.text;
}

export type Generated = {
  subject: string;
  body: string;
  generated_at: string;
  model: string;
  personalised: boolean;
  warnings: string[]; // shown to George in Greek-friendly English; empty = clean
  recent_inbound: { at: string; snippet: string } | null; // the person wrote recently
};

export type Sibling = { name: string; body: string };

export async function generateTouch(kind: Kind, c: Charter, p: Person, opts: { siblings?: Sibling[] } = {}): Promise<Generated> {
  // A different wording per person of the charter, so a family never gets
  // six copies of one letter (26/11/2026).
  const variant = Math.max(0, c.people.findIndex((x) => x.email === p.email));
  const base = baseText(kind, c, p, { problem_note: c.problem.note, variant });
  const siblings = (opts.siblings ?? []).filter((s) => s.body);
  const greeting = greetingFor(kind, p);
  const model = process.env.AFTERSALES_AI_MODEL || process.env.FOLLOWUP_AI_MODEL || process.env.AI_MODEL || "gemini-2.5-flash";
  const now = new Date().toISOString();

  // What this person said to George around the charter (never invent the rest).
  let conversation: { at: string; dir: string; subject?: string; text: string }[] = [];
  let recent: Generated["recent_inbound"] = null;
  try {
    const since = addDays(c.from ?? c.to, -120);
    const gm = await readGmailByAddress([p.email], `${since}T00:00:00Z`, 25);
    conversation = gm.items
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-10)
      .map((i) => ({ at: i.ts.slice(0, 10), dir: i.direction === "in" ? "guest wrote" : "George wrote", subject: i.subject, text: i.text.slice(0, 900) }));
    const lastIn = [...gm.items].filter((i) => i.direction === "in").sort((a, b) => b.ts.localeCompare(a.ts))[0];
    if (lastIn && daysBetween(lastIn.ts.slice(0, 10), athensToday()) <= 14) recent = { at: lastIn.ts.slice(0, 10), snippet: lastIn.text.slice(0, 220) };
  } catch {
    conversation = [];
  }

  const ctx = {
    kind,
    greeting,
    review_link: kind === "review" || kind === "review_after_problem" ? GOOGLE_REVIEW_LINK : null,
    person: { first_name: p.first_name, role: p.role, country: p.country },
    charter: { vessel: c.vessel, vessel_type: c.vessel_type, from: c.from, to: c.to, embarkation: c.port_from, disembarkation: c.port_to, area: c.area, lead_first_name: c.lead_first_name },
    problem_note: kind === "review_after_problem" ? c.problem.note : null,
    conversation,
    base_text: base,
    // Letters already written for other people of this charter: yours must read differently.
    other_letters_this_charter: siblings.map((s) => s.body),
  };
  const system = `${playbook()}\n\nYou personalise the base text for this one person. Keep its shape and length. Add at most ONE specific detail, and ONLY if the guest or George said it in the conversation: use their own words for it. Never add a detail about food, the crew, a place, weather or an activity that is not written in the conversation; the code rejects every word you add that is not in the conversation, the charter facts or the base text. If the conversation has nothing usable, return the base text unchanged. If other_letters_this_charter is not empty, your sentences must not repeat theirs. Return JSON only.`;
  const user = JSON.stringify(ctx, null, 1);

  const clean = (d: { subject?: string; body?: string }) => ({ subject: deDash(String(d.subject ?? "")).trim(), body: deDash(String(d.body ?? "")).trim() });
  const expect = { greeting, fullName: p.full_name };
  const sources = [
    ...conversation.map((m) => `${m.subject ?? ""} ${m.text}`),
    c.vessel, c.vessel_type, c.area ?? "", c.port_from ?? "", c.port_to ?? "", c.lead_first_name, p.first_name,
    kind === "review_after_problem" ? c.problem.note : "",
  ].join("\n");
  const names = c.people.map((x) => x.first_name);
  const extraChecks = (d: { body: string }) => {
    const out: string[] = [];
    const added = ungrounded(d.body, base.body, sources);
    if (added.length) out.push(`adds words that are not in the conversation or the facts: ${added.slice(0, 6).join(", ")}`);
    const twin = tooSimilar(d.body, siblings, names);
    if (twin) out.push(`reads like the letter already written for ${twin}; use different sentences`);
    return out;
  };
  let draft = base;
  let personalised = false;
  let problems: string[] = [];
  // Nothing was ever said with this person: there is nothing true to add, so
  // the hand-written wording goes as it is (26/11/2026: rewording for its own
  // sake made one letter choppy). The model writes only when it has material.
  const said = conversation.some((m) => m.dir === "guest wrote" && m.text.trim().length > 40);
  if (said) try {
    const raw = await aiChat(system, user, { maxTokens: 8192, temperature: 0.5, model });
    let d = clean(parseLooseJson(raw) as { subject?: string; body?: string });
    problems = [...checkAfterSales(kind, d, expect), ...extraChecks(d)];
    if (problems.length) {
      const raw2 = await aiChat(system, `${user}\n\nYOUR LAST DRAFT:\n${JSON.stringify(d)}\n\nFIX THESE PROBLEMS:\n- ${problems.join("\n- ")}`, { maxTokens: 8192, temperature: 0.3, model });
      d = clean(parseLooseJson(raw2) as { subject?: string; body?: string });
      problems = [...checkAfterSales(kind, d, expect), ...extraChecks(d)];
    }
    if (!problems.length && d.body) { draft = d; personalised = true; }
  } catch {
    problems = ["the model did not answer"];
  }
  const twinOfBase = personalised ? null : tooSimilar(draft.body, siblings, names);
  const warnings = personalised ? [] : [...checkAfterSales(kind, draft, expect), ...(twinOfBase ? [`similar to the letter for ${twinOfBase}: change a sentence before Send`] : [])];
  return {
    subject: draft.subject,
    body: draft.body,
    generated_at: now,
    model: personalised ? model : "base text",
    personalised,
    // Only what George must act on; a skipped personal touch is not his problem.
    warnings,
    recent_inbound: recent,
  };
}
