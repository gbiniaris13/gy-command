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

export async function generateTouch(kind: Kind, c: Charter, p: Person): Promise<Generated> {
  const base = baseText(kind, c, p, { problem_note: c.problem.note });
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
  };
  const system = `${playbook()}\n\nYou personalise the base text for this one person. Keep its shape and length. Add at most ONE specific, true detail taken from the conversation (a place they loved, something they said), only if it is clearly there. If the conversation has nothing usable, return the base text almost unchanged. Return JSON only.`;
  const user = JSON.stringify(ctx, null, 1);

  const clean = (d: { subject?: string; body?: string }) => ({ subject: deDash(String(d.subject ?? "")).trim(), body: deDash(String(d.body ?? "")).trim() });
  const expect = { greeting, fullName: p.full_name };
  let draft = base;
  let personalised = false;
  let problems: string[] = [];
  try {
    const raw = await aiChat(system, user, { maxTokens: 2048, temperature: 0.5, model });
    let d = clean(parseLooseJson(raw) as { subject?: string; body?: string });
    problems = checkAfterSales(kind, d, expect);
    if (problems.length) {
      const raw2 = await aiChat(system, `${user}\n\nYOUR LAST DRAFT:\n${JSON.stringify(d)}\n\nFIX THESE PROBLEMS:\n- ${problems.join("\n- ")}`, { maxTokens: 2048, temperature: 0.3, model });
      d = clean(parseLooseJson(raw2) as { subject?: string; body?: string });
      problems = checkAfterSales(kind, d, expect);
    }
    if (!problems.length && d.body) { draft = d; personalised = true; }
  } catch {
    problems = ["the model did not answer"];
  }
  const warnings = personalised ? [] : checkAfterSales(kind, draft, expect);
  return {
    subject: draft.subject,
    body: draft.body,
    generated_at: now,
    model: personalised ? model : "base text",
    personalised,
    warnings: warnings.length ? warnings : (problems.length && !personalised ? [`personal touch skipped (${problems[0]}), base text used`] : []),
    recent_inbound: recent,
  };
}
