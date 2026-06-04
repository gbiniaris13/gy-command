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

// Bound a narrative to N sentences / M chars so a combined yacht card always
// fits one page (full hero image + pricing + brochure) without overflow. Cuts
// on a sentence boundary; falls back to a clean char cut. Premium = concise.
const firstSentences = (s: string, maxSentences: number, maxChars: number): string => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?]+[.!?]+/g);
  let out = parts && parts.length ? parts.slice(0, maxSentences).map((p) => p.trim()).join(" ") : t;
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).replace(/\s+\S*$/, "").replace(/[,;:]\s*$/, "");
    if (!/[.!?]$/.test(out)) out += ".";
  }
  return out.replace(/\s+/g, " ").trim();
};

// The charter dates appear deterministically in the proposal (voyage line +
// footer), so narrative prose must NOT restate them. Critically, supplier text
// often contains OTHER date windows (a discount period, a seasonal boundary);
// the model used to lift those and present them as the guest's charter dates
// (e.g. "your dates of July 1 to 7" when the charter was 23 June - 1 July).
const NO_DATES =
  `- NEVER write any specific calendar date or date range in the prose (no "July 1 to 7", no "23 June to 1 July", no "your dates of ..."). The charter dates are shown elsewhere in the document. If the supplier facts mention a date window (a discount period or seasonal boundary), do NOT repeat it and NEVER present it as the guest's charter dates.`;

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
- Vary sentence length. No travel-brochure cliche. No AI tells. No em dash.
${NO_DATES}
Output JSON only.`;
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
    ? `"inside_info":"<EXACTLY 2 to 3 short sentences, IMPERSONAL (no 'I', no names): why this boat, who it is right for, the one reason to pick it over the others, value/urgency>"`
    : `"inside_info":"<EXACTLY 2 to 3 short sentences, first-person George: why this boat, who it is right for, the one reason to pick it over the others, value/urgency>"`;
  const sys = `${f.anonymous ? VOICE_ANON : VOICE_BASE}

TASK: For ONE yacht in a multi-yacht shortlist, return JSON: {"description":"<ONE short supplier-true sentence, max ~25 words>",${insideSpec}}.
This card must fit one page with a large photo, so be CONCISE: the description is ONE sentence; the inside_info is 2 to 3 short sentences where the selling lives - distinct and specific, not a feature dump. No em dash.
${NO_DATES}
Output JSON only.`;
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
  // Hard length cap (safety net) so the card always fits one page even if the
  // model runs long: description ~1 sentence, inside_info ~3 short sentences.
  return {
    description: deDash(firstSentences(out.description || "", 2, 180)),
    inside_info: deDash(firstSentences(out.inside_info || "", 3, 340)),
  };
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
- No first person "I", no sign-off, no name, no broker identity. No em dash. No hype.
${NO_DATES}
Output JSON only.`
    : `${VOICE_BASE}

TASK: Write the short "A Note From Your Broker" letter that opens a multi-yacht shortlist proposal PDF. Return JSON: {"intro_letter":"<3 to 4 short paragraphs separated by single newlines>"}.
- Begin with the EXACT salutation provided. First-person George: what you did (you went back through what is genuinely available and set these few aside for them), one line acknowledging the spread (from the most sensible value to the statement option, only if the shortlist supports it), and a warm close with gentle, real urgency.
- Do NOT add a sign-off or your name; the PDF signs you as George Biniaris automatically. No em dash. No hype.
${NO_DATES}
Output JSON only.`;
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
  /** Travel-agent cover note: George writes TO the agent (B2B, first person as
   *  George). Tells the agent the attached proposal PDF is white-label - they can
   *  review it and forward it to their own client exactly as is, with no reference
   *  to us - and that their commission terms are in the attached partnership
   *  program. The white-label artifact is the PDF; this email is agent-facing. */
  agent?: boolean;
};

// The email body (does the selling; George pastes/sends it, PDF attached).
export async function composeEmail(
  f: EmailFacts,
): Promise<{ subject: string; body: string }> {
  const sys = f.agent
    ? `${VOICE_BASE}

TASK: Write the cover email George sends to a TRAVEL ADVISOR / AGENT (B2B, first person as George). A white-label proposal PDF (no George Yachts branding anywhere) and a partnership program PDF are attached. Return JSON: {"subject":"<short, specific>","body":"<plain text with line breaks>"}.
- Begin the body with the EXACT salutation provided. This addresses the AGENT, NOT the end client.
- FIRST short paragraph, at the very top before anything else: tell the agent plainly that the attached proposal is fully white-labeled; that they are welcome to review it; that it is prepared so they can forward it to their own client EXACTLY AS IS, with no reference to us appearing anywhere; and that their commission terms are set out in the attached partnership program. This MUST come first so the agent grasps it immediately without reading the rest.
- THEN one or two short lines summarising the shortlist (yacht name + price, cheapest to most expensive) for the agent's own reference.
- Close warmly and sign "Warmly,\\nGeorge".
- This email is for the agent only and is NOT the client-facing document, so naming George / George Yachts here is correct and expected. No em dash, no hype, no exclamation marks. Output JSON only.`
    : `${VOICE_BASE}

TASK: Write the email that accompanies the proposal PDF. Return JSON: {"subject":"<short, warm, specific>","body":"<the email body as plain text with line breaks>"}.
Structure: warm one-line open referencing the conversation/brief; one short paragraph on what you did; one or two lines per yacht tying a real feature to their need WITH the price (cheapest to most expensive); a close with gentle urgency + an easy next step; sign "Warmly,\\nGeorge".
- Begin the body with the EXACT salutation provided. First person. No em dash. No hype, no exclamation marks. Output JSON only.`;
  const user = [
    `Salutation to use verbatim: ${f.salutation}`,
    f.occasion ? `Occasion: ${f.occasion}` : "",
    f.brief ? `Charter context (use ONLY the requirements - guests, children, area, style; NEVER a person's name): ${f.brief}` : "",
    `Selection (cheapest first):\n${f.selection_summary}`,
  ].filter(Boolean).join("\n");
  const raw = await aiChat(sys, user, { maxTokens: 4000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { subject?: string; body?: string };
  return { subject: deDash(out.subject || "Your Greek charter"), body: deDash(out.body || "") };
}

// Broker-to-supplier AVAILABILITY INQUIRY (George Yachts -> the central agency).
// NOT a client document and NOT white-label: full George Yachts identity, George
// signs personally. ABSOLUTE: the end client is NEVER named to the supplier (the
// agency learns the client's identity only AFTER the client signs the contract).
// Same format for direct-client and travel-agent requests. Presented as a clean
// request spec the supplier can match, asking what they have available. The
// internal brief is NOT passed in (it may carry client identity); only the
// supplier-safe structured fields + special_requests are used.
export async function composeAgencyInquiry(f: {
  area?: string;             // area / embarkation-disembarkation, e.g. "Mykonos to Mykonos"
  party_size?: string;       // guests (and children), e.g. "6 guests + 2 children"
  budget?: string;           // e.g. "EUR 50,000"
  dates?: string;
  occasion?: string;
  special_requests?: string;
  details?: string;          // free-text brief/notes; requirements are used, names/contacts are NOT
}): Promise<{ subject: string; body: string }> {
  const sys = `${VOICE_GUARDRAILS}

THE HELM - CENTRAL AGENCY AVAILABILITY INQUIRY (a private broker-to-supplier email FROM George Yachts TO a central agency; NOT a client document, NOT white-label).

Write it in George's house format: short and scannable, each specification on its OWN line with NO field labels, so the agency desk reads it at a glance. Match this format EXACTLY (this is the gold standard - keep the skeleton, adapt only the data to the request given):
---
Dear team,

I hope you are well!

I have a request for a charter

Athens - Athens
2 guests
from July 3rd to July 10th, 2027. (Flexible early July)
Honeymoon
Motor Yacht or a Sailing Catamaran.
The budget for the net charter fee is between 15,000 and 25,000 EUR.

Please let me know what you have available for these dates and specifications.

Warmly,
---

RULES:
- Same skeleton every time: "Dear team," / blank / "I hope you are well!" / blank / "I have a request for a charter" / blank / one short UNLABELED line per specification (route, guests, dates with any flexibility note in parentheses, occasion, yacht-type preference, then the budget sentence) / blank / "Please let me know what you have available for these dates and specifications." / blank / "Warmly,".
- Render the route as "<embarkation> - <disembarkation>" (or the area exactly as given). Guests as "<n> guests" (add children if stated). Dates as a natural phrase like "from July 3rd to July 10th, 2027." and add "(Flexible ...)" in parentheses ONLY if the notes mention flexibility. Budget as the sentence "The budget for the net charter fee is between <low> and <high> EUR." (or "...is up to <X> EUR." for a single figure).
- Include ONLY the lines you have data for; OMIT any line with no data. No labels like "Guests:" / "Dates:" / "Budget:". Keep every line short and punchy.
- END the body at "Warmly," with NOTHING after it - never write George's name or any sign-off block; the email signature is appended automatically.
- ABSOLUTE: NEVER reveal the end client - no name, surname, "the X Family", villa name, company, email, or phone. From any free-text notes use ONLY the charter requirements (route, guests/children, dates + flexibility, occasion, yacht-type preference, budget); never copy a name or contact.
- NEVER an em dash. Output JSON {"subject":"<short, specific, e.g. 'Availability Inquiry: Athens, 3-10 July 2027, 2 Guests'>","body":"<plain text with the blank lines exactly as above>"} only.`;
  const user = [
    f.area ? `Area / embarkation-disembarkation: ${f.area}` : "",
    f.party_size ? `Guests: ${f.party_size}` : "",
    f.dates ? `Dates: ${f.dates}` : "",
    f.budget ? `Budget: ${f.budget}` : "",
    f.occasion ? `Occasion: ${f.occasion}` : "",
    f.special_requests ? `Special requests: ${f.special_requests}` : "",
    f.details ? `Request notes (use the charter requirements ONLY - budget, embark/disembark, guests, children, preferences; NEVER include any name, villa name or contact):\n${f.details}` : "",
  ].filter(Boolean).join("\n") || "A charter request - details to follow.";
  const raw = await aiChat(sys, user, { maxTokens: 3000, temperature: 0.6 });
  const out = parseLooseJson(raw) as { subject?: string; body?: string };
  return { subject: deDash(out.subject || "Charter availability inquiry"), body: deDash(out.body || "") };
}
