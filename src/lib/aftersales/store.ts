// src/lib/aftersales/store.ts
// 2026-11-25 — After sales state, kept in ONE settings row (no migration).
// George is the only writer; every write is read-modify-write of this row.
//
//   touches   one entry per message that was generated, sent, skipped or held
//   charters  the "Κάτι πήγε στραβά" switch and its note, per charter
//   people    the first name George prefers for a person, and "never again"
//   mode      "test" (default): every Send goes to george@ with [ΔΟΚΙΜΗ];
//             "live": Send goes to the guest. Only George flips it.

import { getSetting, setSetting } from "@/lib/google-api";

export const STATE_KEY = "aftersales_state_v1";
export const TEST_INBOX = "george@georgeyachts.com";

export type TouchStatus = "generated" | "sent" | "skipped";
export type TouchState = {
  status: TouchStatus;
  at: string;
  subject?: string;
  body?: string;
  generated_at?: string;
  warnings?: string[];
  message_id?: string;
  sent_to?: string;
  test?: boolean;
  test_sent_at?: string; // a test copy went to george@; the real send is still open
  skip_reason?: string;
};
export type CharterState = {
  problem?: boolean;
  problem_note?: string;
  problem_at?: string;
  resolved_at?: string;
  reminded_at?: string;
  // People George adds to a charter for the Lighthouse only (26/11/2026:
  // Megan, Matthew Colford's wife, was in copy on every email but is not in
  // any guest list). Never written to the Cabin or the port manifest.
  extra_people?: { email: string; name: string; country?: string; dob?: string; added_at: string }[];
};
export type PersonState = { first_name?: string; never?: boolean; never_at?: string };
export type LostState = { category: string; reason_el?: string; at: string };
export type AfterSalesState = {
  touches: Record<string, TouchState>;
  // Why each request was lost, read from the conversation (25/11/2026 analysis).
  lost: Record<string, LostState>;
  charters: Record<string, CharterState>;
  people: Record<string, PersonState>;
  mode: "test" | "live";
};

const EMPTY: AfterSalesState = { touches: {}, lost: {}, charters: {}, people: {}, mode: "test" };

export async function readState(): Promise<AfterSalesState> {
  const raw = await getSetting(STATE_KEY);
  if (!raw) return structuredClone(EMPTY);
  try {
    const s = JSON.parse(raw) as Partial<AfterSalesState>;
    return {
      touches: s.touches ?? {},
      lost: s.lost ?? {},
      charters: s.charters ?? {},
      people: s.people ?? {},
      mode: s.mode === "live" ? "live" : "test",
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function writeState(s: AfterSalesState): Promise<void> {
  await setSetting(STATE_KEY, JSON.stringify(s));
}

/** Read, change, write. Returns the new state. */
export async function updateState(fn: (s: AfterSalesState) => void): Promise<AfterSalesState> {
  const s = await readState();
  fn(s);
  await writeState(s);
  return s;
}

export const emailKey = (e: string) => e.trim().toLowerCase();
