// src/lib/helm/compose.ts
// =============================================================
// AI selling copy for The Helm — proposal narrative + the email.
// First-person George, brand guardrails, NEVER an em dash, formal
// client addressing, never names the source agency, never invents a
// feature the supplier did not state. NO pricing/numbers logic here
// (that is pricing.ts + the human review screen).
// =============================================================

import { aiChat } from "../ai";
import { VOICE_GUARDRAILS } from "../ai-voice-guardrails";
import { parseLooseJson } from "./json";

const VOICE_BASE = `${VOICE_GUARDRAILS}

THE HELM OVERRIDE (proposals + emails are George speaking personally):
- Write in the FIRST PERSON as George, the broker: "I", "my". This OVERRIDES the 'we / never I' pronoun rule above. Sign emails "Warmly, George".
- NEVER an em dash. Use a hyphen.
- NEVER name the source agency/broker, never include broker links, never write "for references contact...".
- Connect the client's stated need to a CONCRETE, supplier-true feature. Never promise a feature, toy, or detail the supplier data did not state.
- Address the client formally (title + surname, e.g. "Mrs. Reynolds", or "the Reynolds Family"). Never a bare first name.`;

// Hard guarantee on the sacred "never an em dash" rule — strip em/en
// dashes to a hyphen on every AI output, regardless of what the model did.
const deDash = (s: string): string => s.replace(/[—–]/g, "-");

export type NarrativeFacts = {
  vessel_name: string;
  vessel_type?: string;
  spec_line?: string;
  supplier_facts: string;   // confidentiality-filtered supplier text / brochure notes
  brief?: string;
  occasion?: string;
};

// Single-yacht: page-2 experience narrative (2-3 short paras, last is the
// personal selling close) + a short title.
export async function composeSingleNarrative(
  f: NarrativeFacts,
): Promise<{ experience_title: string; experience_paras: string[] }> {
  const sys = `${VOICE_BASE}

TASK: Write the "experience" narrative for a single-yacht charter proposal PDF.
Return JSON: {"experience_title": "<3-5 word title>", "experience_paras": ["para1","para2","para3"]}.
- 2 to 3 short paragraphs. Paragraphs 1-2: what she is and what life aboard feels like, drawn ONLY from the supplier facts, luxury-fied but true. Final paragraph: the personal selling close (you have looked at this with them in mind; gentle, real urgency if the facts support it).
- Vary sentence length. No travel-brochure cliche. No AI tells. No em dash. Output JSON only.`;
  const user = [
    `Vessel: ${f.vessel_name}${f.vessel_type ? ` (${f.vessel_type})` : ""}`,
    f.spec_line ? `Spec: ${f.spec_line}` : "",
    f.brief ? `Client brief: ${f.brief}` : "",
    f.occasion ? `Occasion: ${f.occasion}` : "",
    `Supplier facts (the ONLY features you may reference):\n${f.supplier_facts}`,
  ].filter(Boolean).join("\n");
  const raw = await aiChat(sys, user, { maxTokens: 4000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { experience_title?: string; experience_paras?: string[] };
  return {
    experience_title: deDash(out.experience_title || "The Experience"),
    experience_paras: (Array.isArray(out.experience_paras) ? out.experience_paras : []).map(deDash),
  };
}

// Combined per-yacht: one short supplier-true description + George's
// first-person "inside info" (why this one, for whom, the reason to pick it).
export async function composeYachtInsideInfo(
  f: NarrativeFacts & { tier_hint?: string },
): Promise<{ description: string; inside_info: string }> {
  const sys = `${VOICE_BASE}

TASK: For ONE yacht in a multi-yacht shortlist, return JSON: {"description":"<one short supplier-true paragraph>","inside_info":"<2-4 sentences, first-person George: why this boat, who it is right for, the one reason to pick it over the others, value/urgency>"}.
The inside_info is where the selling lives - make it distinct and specific. No em dash. Output JSON only.`;
  const user = [
    `Yacht: ${f.vessel_name}${f.vessel_type ? ` (${f.vessel_type})` : ""}`,
    f.spec_line ? `Spec: ${f.spec_line}` : "",
    f.tier_hint ? `Role in the shortlist: ${f.tier_hint}` : "",
    f.brief ? `Client brief: ${f.brief}` : "",
    f.occasion ? `Occasion: ${f.occasion}` : "",
    `Supplier facts (only features you may reference):\n${f.supplier_facts}`,
  ].filter(Boolean).join("\n");
  const raw = await aiChat(sys, user, { maxTokens: 3000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { description?: string; inside_info?: string };
  return { description: deDash(out.description || ""), inside_info: deDash(out.inside_info || "") };
}

// Combined shortlist: the short "A Note From Your Broker" letter that opens a
// multi-yacht proposal (first-person George, signed in the PDF automatically).
export async function composeCombinedIntro(
  f: { salutation: string; occasion?: string; brief?: string; yacht_summary: string },
): Promise<string> {
  const sys = `${VOICE_BASE}

TASK: Write the short "A Note From Your Broker" letter that opens a multi-yacht shortlist proposal PDF. Return JSON: {"intro_letter":"<3 to 4 short paragraphs separated by single newlines>"}.
- Begin with the EXACT salutation provided. First-person George: what you did (you went back through what is genuinely available and set these few aside for them), one line acknowledging the spread (from the most sensible value to the statement option, only if the shortlist supports it), and a warm close with gentle, real urgency.
- Do NOT add a sign-off or your name; the PDF signs you as George Biniaris automatically. No em dash. No hype. Output JSON only.`;
  const user = [
    `Salutation to use verbatim: ${f.salutation}`,
    f.occasion ? `Occasion: ${f.occasion}` : "",
    f.brief ? `Client brief: ${f.brief}` : "",
    `The shortlist (cheapest first):\n${f.yacht_summary}`,
  ].filter(Boolean).join("\n");
  const raw = await aiChat(sys, user, { maxTokens: 3000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { intro_letter?: string };
  return deDash(out.intro_letter || "");
}

export type EmailFacts = {
  salutation: string;          // "Dear Mrs. Reynolds," (formal — never bare first name)
  occasion?: string;
  brief?: string;
  selection_summary: string;   // one yacht (name + price) or the shortlist, cheapest first
};

// The email body (does the selling; George pastes/sends it, PDF attached).
export async function composeEmail(
  f: EmailFacts,
): Promise<{ subject: string; body: string }> {
  const sys = `${VOICE_BASE}

TASK: Write the email that accompanies the proposal PDF. Return JSON: {"subject":"<short, warm, specific>","body":"<the email body as plain text with line breaks>"}.
Structure: warm one-line open referencing the conversation/brief; one short paragraph on what you did; one or two lines per yacht tying a real feature to their need WITH the price (cheapest to most expensive); a close with gentle urgency + an easy next step; sign "Warmly,\\nGeorge".
- Begin the body with the EXACT salutation provided. First person. No em dash. No hype, no exclamation marks. Output JSON only.`;
  const user = [
    `Salutation to use verbatim: ${f.salutation}`,
    f.occasion ? `Occasion: ${f.occasion}` : "",
    f.brief ? `Client brief: ${f.brief}` : "",
    `Selection (cheapest first):\n${f.selection_summary}`,
  ].filter(Boolean).join("\n");
  const raw = await aiChat(sys, user, { maxTokens: 4000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { subject?: string; body?: string };
  return { subject: deDash(out.subject || "Your Greek charter"), body: deDash(out.body || "") };
}
