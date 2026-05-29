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
  opts?: { no_myba?: boolean; show_ghost_credit?: boolean },
): SingleProposal {
  return {
    mode: "single",
    no_myba: opts?.no_myba ?? false,
    show_ghost_credit: opts?.show_ghost_credit ?? true,
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
  opts?: { no_myba?: boolean; show_ghost_credit?: boolean },
): CombinedProposal {
  // Caller MUST sort yachts cheapest -> most expensive before calling.
  return {
    mode: "combined",
    no_myba: opts?.no_myba ?? false,
    show_ghost_credit: opts?.show_ghost_credit ?? true,
    client_name: meta.coverName ?? undefined,
    period: meta.period,
    guests: meta.guests,
    area: meta.area,
    intro_letter: meta.intro_letter,
    images: meta.images,
    yachts,
  };
}
