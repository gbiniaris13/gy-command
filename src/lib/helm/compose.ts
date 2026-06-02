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

// WHITE-LABEL voice (travel-agent proposals). The PDF is presented to the
// client by an intermediary, so it must carry NO George / George Yachts
// identity and no first-person "I". Same persuasive quality, fully impersonal.
// Used ONLY for the PDF copy of travel_agent proposals; the agent email stays
// George-voice (direct B2B correspondence).
const VOICE_ANON = `${VOICE_GUARDRAILS}

WHITE-LABEL OVERRIDE (this proposal is presented to the client by an intermediary, so it MUST be fully anonymous):
- Do NOT use the first person singular ("I", "my"). Write impersonally, or use "we" sparingly. Never sign off, never add a name.
- NEVER mention George, George Yachts, Biniaris, any broker / person / company name, website, email, or phone number. No personal identity of any kind.
- NEVER an em dash. Use a hyphen.
- NEVER name the source agency/broker, never include broker links.
- Connect the client's stated need to a CONCRETE, supplier-true feature. Never promise a feature, toy, or detail the supplier data did not state.
- Keep the refined, persuasive tone, but impersonal throughout. No bare first names.`;

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
// selling close) + a short title. `anonymous` => white-label voice (no George,
// no first person) for travel-agent proposals.
export async function composeSingleNarrative(
  f: NarrativeFacts & { anonymous?: boolean },
): Promise<{ experience_title: string; experience_paras: string[] }> {
  const closeLine = f.anonymous
    ? "Final paragraph: a refined selling close that creates genuine desire, written impersonally (no 'I'); gentle, real urgency if the facts support it."
    : "Final paragraph: the personal selling close (you have looked at this with them in mind; gentle, real urgency if the facts support it).";
  const sys = `${f.anonymous ? VOICE_ANON : VOICE_BASE}

TASK: Write the "experience" narrative for a single-yacht charter proposal PDF.
Return JSON: {"experience_title": "<3-5 word title>", "experience_paras": ["para1","para2","para3"]}.
- 2 to 3 short paragraphs. Paragraphs 1-2: what she is and what life aboard feels like, drawn ONLY from the supplier facts, luxury-fied but true. ${closeLine}
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

// Combined per-yacht: one short supplier-true description + an "inside info"
// note (why this one, for whom, the reason to pick it). `anonymous` => white-
// label voice (no George, no first person) for travel-agent proposals.
export async function composeYachtInsideInfo(
  f: NarrativeFacts & { tier_hint?: string; anonymous?: boolean },
): Promise<{ description: string; inside_info: string }> {
  const insideSpec = f.anonymous
    ? `"inside_info":"<2-4 sentences, IMPERSONAL (no 'I', no names): why this boat, who it is right for, the one reason to pick it over the others, value/urgency>"`
    : `"inside_info":"<2-4 sentences, first-person George: why this boat, who it is right for, the one reason to pick it over the others, value/urgency>"`;
  const sys = `${f.anonymous ? VOICE_ANON : VOICE_BASE}

TASK: For ONE yacht in a multi-yacht shortlist, return JSON: {"description":"<one short supplier-true paragraph>",${insideSpec}}.
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

// Combined shortlist: the short note that opens a multi-yacht proposal.
// Direct-client => "A Note From Your Broker", first-person George, opens with
// the formal salutation, signed in the PDF automatically. `anonymous` =>
// white-label: impersonal, no salutation (the agent's end-client is unknown),
// no George, no sign-off.
export async function composeCombinedIntro(
  f: { salutation: string; occasion?: string; brief?: string; yacht_summary: string; anonymous?: boolean },
): Promise<string> {
  const sys = f.anonymous
    ? `${VOICE_ANON}

TASK: Write the short note that opens a multi-yacht shortlist proposal PDF. Return JSON: {"intro_letter":"<3 to 4 short paragraphs separated by single newlines>"}.
- Do NOT open with a salutation or any name (the reader is unknown). Open impersonally. Describe how this selection was assembled (a genuine availability review, narrowed to these few), acknowledge the spread (from the most sensible value to the statement option, only if the shortlist supports it), and close with gentle, real urgency.
- No first person "I", no sign-off, no name, no broker identity. No em dash. No hype. Output JSON only.`
    : `${VOICE_BASE}

TASK: Write the short "A Note From Your Broker" letter that opens a multi-yacht shortlist proposal PDF. Return JSON: {"intro_letter":"<3 to 4 short paragraphs separated by single newlines>"}.
- Begin with the EXACT salutation provided. First-person George: what you did (you went back through what is genuinely available and set these few aside for them), one line acknowledging the spread (from the most sensible value to the statement option, only if the shortlist supports it), and a warm close with gentle, real urgency.
- Do NOT add a sign-off or your name; the PDF signs you as George Biniaris automatically. No em dash. No hype. Output JSON only.`;
  const user = [
    f.anonymous ? "" : `Salutation to use verbatim: ${f.salutation}`,
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

// Broker-to-supplier INQUIRY (George Yachts -> the central agency). This is NOT
// a client document and NOT white-label: full George Yachts identity, George
// signs personally. The END CLIENT stays anonymous to the supplier (referred to
// only as clientRef, e.g. "my client") - never the client's name or contact.
// The internal brief is deliberately NOT passed in (it may carry client identity).
export async function composeAgencyInquiry(f: {
  clientRef: string;            // anonymized, e.g. "my client"
  yachts: string;               // yacht name(s) + spec, one per line
  dates?: string;
  area?: string;
  party_size?: string;
  occasion?: string;
}): Promise<{ subject: string; body: string }> {
  const sys = `${VOICE_GUARDRAILS}

THE HELM - CENTRAL AGENCY INQUIRY (a private broker-to-supplier email FROM George Yachts TO a central agency; this is NOT a client document and NOT white-label):
- Write in the FIRST PERSON as George, the broker ("I", "my"). Sign "Warmly,\\nGeorge". Normal George Yachts identity is expected here.
- Be professional and direct with a fellow industry supplier.
- KEEP THE END CLIENT ANONYMOUS: refer to the client ONLY as "${f.clientRef}". NEVER include the client's first name, full name, email, phone or any identifying personal detail.
- NEVER an em dash. Use a hyphen.

TASK: Write a concise, professional charter inquiry. Return JSON: {"subject":"<short, specific>","body":"<plain text with line breaks>"}.
Cover naturally: express genuine client interest in the yacht(s) for the dates; ask to confirm current availability; ask whether they can place or hold an option; and request any missing details needed to firm up a proposal (current rate, APA, VAT, what is included, gratuity guidance, the preferred contact for booking). Reference the yacht(s), dates, area, party size and occasion as given. Courteous and specific, no filler. No em dash. Output JSON only.`;
  const user = [
    `Refer to the client only as: ${f.clientRef}`,
    `Yacht(s) of interest:\n${f.yachts}`,
    f.dates ? `Dates: ${f.dates}` : "",
    f.area ? `Area: ${f.area}` : "",
    f.party_size ? `Party size: ${f.party_size}` : "",
    f.occasion ? `Occasion: ${f.occasion}` : "",
  ].filter(Boolean).join("\n");
  const raw = await aiChat(sys, user, { maxTokens: 3000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { subject?: string; body?: string };
  return { subject: deDash(out.subject || "Charter availability inquiry"), body: deDash(out.body || "") };
}
