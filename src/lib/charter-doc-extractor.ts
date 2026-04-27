// v3 Pillar 8 — Document-Driven Charter Setup.
//
// AI-driven structured extraction from uploaded charter documents:
//   - contract  → vessel + dates + fee + payment + parties
//   - passport  → guest identity + nationality + DOB + expiry
//   - guest_list → multi-guest CSV/text → Pillar 9 contact creation
//   - pif       → preferences + dietary + special occasions
//
// Each extractor returns:
//   { ok: true, data: <typed>, confidence: 0..1, ai_model_used, raw_response }
//   { ok: false, error: string, raw_response }
//
// Confidence threshold for auto-activation = 0.80 by default.
// Below threshold → manual_review queue (Pillar 8 §11.4).

import { aiChat } from "@/lib/ai";
import { MODEL } from "@/lib/ai";

// ─── Types ─────────────────────────────────────────────────────────

export interface ContractExtraction {
  client_full_name: string | null;
  client_country: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_residency: string | null;
  vessel_name: string | null;
  vessel_builder_model: string | null;
  vessel_length_m: number | null;
  charter_start_date: string | null;       // YYYY-MM-DD
  charter_end_date: string | null;         // YYYY-MM-DD
  embark_port: string | null;
  disembark_port: string | null;
  guest_count: number | null;
  charter_fee_eur: number | null;
  apa_eur: number | null;
  vat_rate: number | null;
  vat_eur: number | null;
  total_eur: number | null;
  payment_terms: {
    first_installment_pct: number | null;
    first_installment_due: string | null;
    balance_due: string | null;
    balance_pct: number | null;
  };
  special_clauses: string[];
}

export interface PassportExtraction {
  passenger_full_name: string | null;
  passport_number_last_4: string | null;   // never persist full
  issuing_country: string | null;
  nationality: string | null;
  date_of_birth: string | null;            // YYYY-MM-DD
  expiry_date: string | null;
  is_minor: boolean;
  passport_valid_for_charter: boolean | null;
  guest_role_inferred:
    | "primary"
    | "spouse"
    | "child"
    | "family"
    | "friend"
    | "colleague"
    | "unknown";
}

export interface GuestListExtraction {
  guests: Array<{
    full_name: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
    notes: string | null;
  }>;
}

export interface PifExtraction {
  guest_count: number | null;
  guests: Array<{
    name: string | null;
    role: string | null;
    dietary_restrictions: string[];
    allergies: string[];
    alcohol_preferences: string[];
    music_preferences: string[];
    special_occasions: Array<{
      date: string | null;
      occasion: string | null;
      involves: string | null;
    }>;
  }>;
  kids_onboard: boolean;
  pets_onboard: boolean;
  special_requests: string[];
  preferred_destinations: string[];
  captain_briefing_notes: string | null;
}

interface ExtractResult<T> {
  ok: boolean;
  data?: T;
  confidence: number;
  ai_model_used: string;
  raw_response: string;
  error?: string;
}

// ─── Generic AI extraction helper ──────────────────────────────────

async function extractWithAI<T>(
  systemPrompt: string,
  textInput: string,
  hint: string,
): Promise<ExtractResult<T>> {
  let raw: string;
  try {
    raw = await aiChat(systemPrompt, textInput, {
      maxTokens: 4000,
      temperature: 0.0,
    });
  } catch (err) {
    return {
      ok: false,
      confidence: 0,
      ai_model_used: MODEL,
      raw_response: "",
      error: err instanceof Error ? err.message : "ai call failed",
    };
  }
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) {
    return {
      ok: false,
      confidence: 0,
      ai_model_used: MODEL,
      raw_response: raw,
      error: `no JSON object found (hint: ${hint})`,
    };
  }
  try {
    const parsed = JSON.parse(m[0]) as T & { confidence?: number };
    const conf = parsed.confidence ?? 0.7;
    return {
      ok: true,
      data: parsed,
      confidence: Math.max(0, Math.min(1, conf)),
      ai_model_used: MODEL,
      raw_response: raw,
    };
  } catch (err) {
    return {
      ok: false,
      confidence: 0,
      ai_model_used: MODEL,
      raw_response: raw,
      error: err instanceof Error ? err.message : "json parse failed",
    };
  }
}

// ─── Contract extractor ────────────────────────────────────────────

const CONTRACT_SYSTEM = `You are a yacht-charter contract extractor for George Yachts (Greek charter brokerage).

Extract all critical fields from the MYBA / bareboat / private charter contract text supplied.

CRITICAL OUTPUT RULES:
- Output ONLY a raw JSON object. NO markdown fences. NO prose.
- Start with { end with }.
- Use null for fields you cannot find. Never guess.
- Dates in ISO format: YYYY-MM-DD.
- Money values as plain numbers in EUR (no currency symbols, no commas).
- Add a "confidence" field 0..1 reflecting how sure you are about the OVERALL extraction.

Schema:
{
  "client_full_name": string|null,
  "client_country": string|null,
  "client_email": string|null,
  "client_phone": string|null,
  "client_residency": string|null,
  "vessel_name": string|null,
  "vessel_builder_model": string|null,
  "vessel_length_m": number|null,
  "charter_start_date": "YYYY-MM-DD"|null,
  "charter_end_date": "YYYY-MM-DD"|null,
  "embark_port": string|null,
  "disembark_port": string|null,
  "guest_count": int|null,
  "charter_fee_eur": number|null,
  "apa_eur": number|null,
  "vat_rate": number|null,
  "vat_eur": number|null,
  "total_eur": number|null,
  "payment_terms": {
    "first_installment_pct": number|null,
    "first_installment_due": "YYYY-MM-DD"|null,
    "balance_due": "YYYY-MM-DD"|null,
    "balance_pct": number|null
  },
  "special_clauses": [string],
  "confidence": 0..1
}

Critical fields (auto-activation requires ≥0.80 confidence on all):
charter_start_date, charter_end_date, vessel_name, client_full_name,
charter_fee_eur, payment_terms.balance_due.

If any critical field is null, lower confidence below 0.80.`;

export async function extractContract(
  text: string,
): Promise<ExtractResult<ContractExtraction>> {
  return extractWithAI<ContractExtraction>(
    CONTRACT_SYSTEM,
    text.slice(0, 50_000), // contract bodies can be long; cap at 50K chars
    "contract",
  );
}

// ─── Passport extractor ────────────────────────────────────────────

const PASSPORT_SYSTEM = `You are a passport-data extractor for George Yachts.

Extract identity fields from passport scan text (OCR'd or pasted).

CRITICAL OUTPUT RULES:
- Output ONLY raw JSON. NO fences.
- NEVER include the full passport number. Only the last 4 digits in passport_number_last_4.
- Dates in ISO format YYYY-MM-DD.
- is_minor: true if date_of_birth indicates the passenger is under 18 today.
- passport_valid_for_charter: requires expiry > charter_end + 6 months. If charter dates not given, return null.
- guest_role_inferred: from clues in the text or default 'unknown'.

Schema:
{
  "passenger_full_name": string|null,
  "passport_number_last_4": string|null,
  "issuing_country": string|null,
  "nationality": string|null,
  "date_of_birth": "YYYY-MM-DD"|null,
  "expiry_date": "YYYY-MM-DD"|null,
  "is_minor": boolean,
  "passport_valid_for_charter": boolean|null,
  "guest_role_inferred": "primary"|"spouse"|"child"|"family"|"friend"|"colleague"|"unknown",
  "confidence": 0..1
}`;

export async function extractPassport(
  text: string,
  charterEndDate?: string | null,
): Promise<ExtractResult<PassportExtraction>> {
  const annotated = charterEndDate
    ? `Charter end date for validity check: ${charterEndDate}\n\n${text}`
    : text;
  return extractWithAI<PassportExtraction>(
    PASSPORT_SYSTEM,
    annotated.slice(0, 8_000),
    "passport",
  );
}

// ─── Guest list extractor (CSV / Excel / pasted text) ──────────────

const GUEST_LIST_SYSTEM = `Extract a guest list from CSV / TSV / pasted-text input. Output raw JSON only.

Schema:
{
  "guests": [
    {"full_name": string|null, "email": string|null, "phone": string|null, "role": string|null, "notes": string|null}
  ],
  "confidence": 0..1
}

Treat columns flexibly: 'name'/'guest'/'passenger', 'email', 'phone'/'mobile', 'role'/'relationship'.`;

export async function extractGuestList(
  text: string,
): Promise<ExtractResult<GuestListExtraction>> {
  return extractWithAI<GuestListExtraction>(
    GUEST_LIST_SYSTEM,
    text.slice(0, 20_000),
    "guest_list",
  );
}

// ─── PIF (Preference & Information Form) extractor ─────────────────

const PIF_SYSTEM = `Extract preferences from a Charter PIF (Preference & Information Form). Output raw JSON only.

Capture every detail that affects onboard service: dietary, allergies, alcohol, music, special occasions
(birthdays, anniversaries during the charter), kids onboard, pets, preferred destinations.

Schema:
{
  "guest_count": int|null,
  "guests": [
    {
      "name": string|null,
      "role": string|null,
      "dietary_restrictions": [string],
      "allergies": [string],
      "alcohol_preferences": [string],
      "music_preferences": [string],
      "special_occasions": [{"date": "YYYY-MM-DD"|null, "occasion": string|null, "involves": string|null}]
    }
  ],
  "kids_onboard": boolean,
  "pets_onboard": boolean,
  "special_requests": [string],
  "preferred_destinations": [string],
  "captain_briefing_notes": string|null,
  "confidence": 0..1
}`;

export async function extractPif(
  text: string,
): Promise<ExtractResult<PifExtraction>> {
  return extractWithAI<PifExtraction>(
    PIF_SYSTEM,
    text.slice(0, 30_000),
    "pif",
  );
}

// ─── Critical-field validator for contract auto-activation ─────────

/**
 * Returns true if the extracted contract has all critical fields
 * present AND overall confidence >= threshold. Below threshold or
 * missing critical fields → manual_review.
 */
export function isContractReadyForActivation(
  extracted: ContractExtraction,
  confidence: number,
  threshold = 0.8,
): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!extracted.charter_start_date) missing.push("charter_start_date");
  if (!extracted.charter_end_date) missing.push("charter_end_date");
  if (!extracted.vessel_name) missing.push("vessel_name");
  if (!extracted.client_full_name) missing.push("client_full_name");
  if (!extracted.charter_fee_eur) missing.push("charter_fee_eur");
  if (!extracted.payment_terms?.balance_due)
    missing.push("payment_terms.balance_due");
  return {
    ready: missing.length === 0 && confidence >= threshold,
    missing,
  };
}
