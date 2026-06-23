// src/lib/helm/build.ts
// =============================================================
// Formal client addressing + proposal-json assembly.
//
// ADDRESSING RULE (decided after the render-kit): NEVER a bare first
// name. Always title + surname ("Mrs. Reynolds") or "the <Surname>
// Family". If no surname is known, formalAddress returns nulls and the
// caller must ASK for it rather than fall back to a first name.
// =============================================================

import type {
  SingleProposal,
  CombinedProposal,
  SingleYacht,
  CombinedYacht,
  CharterType,
  Terms,
} from "./proposal-template";

export function formalAddress(opts: {
  title?: string | null;
  surname?: string | null;
  isFamily?: boolean | null;
}): { coverName: string | null; salutation: string | null } {
  const surname = (opts.surname || "").trim();
  if (!surname) return { coverName: null, salutation: null }; // caller must ask
  if (opts.isFamily) {
    return { coverName: `the ${surname} Family`, salutation: `Dear ${surname} Family,` };
  }
  const title = (opts.title || "").trim().replace(/\.+$/, "");
  const name = title ? `${title}. ${surname}` : surname; // "Mrs. Reynolds"
  return { coverName: name, salutation: `Dear ${name},` };
}

export function buildSingleProposal(
  yacht: SingleYacht,
  opts?: { no_myba?: boolean; show_ghost_credit?: boolean; white_label?: boolean; charter_type?: CharterType; crew_note?: string; terms?: Terms },
): SingleProposal {
  return {
    mode: "single",
    no_myba: opts?.no_myba ?? false,
    show_ghost_credit: opts?.show_ghost_credit ?? true,
    white_label: opts?.white_label ?? false,
    // Default weekly so old/blank proposals render exactly as before.
    charter_type: opts?.charter_type ?? "weekly",
    crew_note: opts?.crew_note || undefined,
    // Owner-selectable last-page terms (undefined => existing default text).
    terms: opts?.terms,
    yacht,
  };
}

export function buildCombinedProposal(
  meta: {
    coverName?: string | null;
    period?: string;
    guests?: string;
    area?: string;
    intro_letter?: string;
    images?: Record<string, string | null>;
  },
  yachts: CombinedYacht[],
  opts?: { no_myba?: boolean; show_ghost_credit?: boolean; white_label?: boolean; charter_type?: CharterType; crew_note?: string; terms?: Terms },
): CombinedProposal {
  // Caller MUST sort yachts cheapest -> most expensive before calling.
  return {
    mode: "combined",
    no_myba: opts?.no_myba ?? false,
    show_ghost_credit: opts?.show_ghost_credit ?? true,
    white_label: opts?.white_label ?? false,
    // Default weekly so old/blank proposals render exactly as before.
    charter_type: opts?.charter_type ?? "weekly",
    crew_note: opts?.crew_note || undefined,
    // Owner-selectable last-page terms (undefined => existing default text).
    terms: opts?.terms,
    client_name: meta.coverName ?? undefined,
    period: meta.period,
    guests: meta.guests,
    area: meta.area,
    intro_letter: meta.intro_letter,
    images: meta.images,
    yachts,
  };
}
