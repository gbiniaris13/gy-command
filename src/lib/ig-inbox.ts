// What the account does, by itself, when someone writes to it.
// Pure functions only: `node --test scripts/ig-tests/ig-inbox.test.ts`.
//
// 2026-11-19 (George, after the Instagram research). Until now three
// things answered people on their own: a model wrote replies to comments
// in a brand voice, direct messages got one of three canned texts with a
// booking link "with our team", and a story mention got a thank-you with
// emoji. All three pretended to be someone. The research is plain: people
// who find out they were talking to a bot buy less and trust less, luxury
// clients expect a person, and several US states require a bot to say it
// is one. George's decision: he answers every message himself. The
// account may do exactly two things on its own, and both say what they
// are:
//
//   1. At night in Athens (00:00 to 08:00, which is the American
//      afternoon and evening) one note, once per person per week: this is
//      automatic, I am George, I reply by 09:00, here is what helps me
//      answer well. Never during his day: then he answers.
//   2. When someone comments one of the words a post asked for ("COST",
//      "TEN", a yacht's name is not one of them), one private message
//      with what the post promised. Instagram allows one such message
//      per comment.
//
// Everything else is told to George on Telegram and logged, and nothing
// is said for him.

/** 00:00 to 07:59 in Athens. */
export function isAthensNight(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hour12: false }).format(now),
  );
  return hour % 24 < 8;
}

/** The moment of the next 09:00 in Athens, at or after `now`. */
export function nextNineAthens(now: Date): Date {
  // Step forward a minute at a time is wasteful; step by quarter hours.
  // Every Athens offset is a whole number of hours, so 09:00 is always hit.
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hour12: false });
  const start = Math.ceil(now.getTime() / 900_000) * 900_000;
  for (let i = 0; i < 4 * 30; i++) {
    const t = new Date(start + i * 900_000);
    if (fmt.format(t) === "09:00") return t;
  }
  return new Date(start);
}

/** "2:00 AM" in New York for a moment, for the note's promise in the reader's own time. */
function newYorkClock(t: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true }).format(t);
}

/** The night note. Openly automatic, signed, one promise of time, three questions at most. */
export function awayNote(now: Date): string {
  const nine = nextNineAthens(now);
  return (
    "Thank you for your message. This is an automatic note, because it is night in Athens. " +
    `I am George, and I will reply to you personally by 09:00 Athens time (${newYorkClock(nine)} in New York). ` +
    "If you tell me your dates, the number of guests and a rough budget, I can come back with real yachts straight away.\n\n" +
    "George P. Biniaris"
  );
}

/** The words the posts ask for, and the site page that goes with each. */
export const KEYWORDS: Record<string, { about: string; page: string }> = {
  COST: { about: "what a crewed week costs, line by line", page: "georgeyachts.com/cost-calculator" },
  APA: { about: "how the APA works", page: "georgeyachts.com/advance-provisioning-allowance-apa-greek-yacht-charter-explained" },
  DATES: { about: "how booking works", page: "georgeyachts.com/how-it-works" },
  WHERE: { about: "the three cruising grounds", page: "georgeyachts.com/cyclades-vs-ionian-yacht-charter" },
  WHEN: { about: "the best month for your week", page: "georgeyachts.com/best-time-charter-yacht-greece-month-by-month-2026" },
  SIX: { about: "crewed yachts for six guests", page: "georgeyachts.com/charter-yacht-greece" },
  EIGHT: { about: "crewed yachts for eight guests", page: "georgeyachts.com/charter-yacht-greece" },
  TEN: { about: "crewed yachts for ten guests", page: "georgeyachts.com/charter-yacht-greece" },
  TWELVE: { about: "crewed yachts for twelve guests", page: "georgeyachts.com/charter-yacht-greece" },
  CAT: { about: "crewed sailing catamarans", page: "georgeyachts.com/charter-yacht-greece" },
  POWER: { about: "crewed power catamarans", page: "georgeyachts.com/charter-yacht-greece" },
  MOTOR: { about: "crewed motor yachts", page: "georgeyachts.com/charter-yacht-greece" },
};

/**
 * The keyword a comment is asking with, or null. Only a comment that is
 * little more than the word itself counts ("COST", "cost please",
 * "TEN!"): a sentence that happens to contain "cost" or "ten" is a
 * person talking, and George answers it.
 */
export function keywordIn(comment: string): string | null {
  const words = String(comment ?? "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  const filler = new Set(["PLEASE", "PLS", "ME", "DM", "SEND", "INFO", "THE", "A"]);
  const hits = words.filter((w) => w in KEYWORDS);
  if (hits.length !== 1) return null;
  if (!words.every((w) => w in KEYWORDS || filler.has(w))) return null;
  return hits[0];
}

/** The one private message a keyword comment gets. Openly automatic, signed. */
export function privateReply(keyword: string): string | null {
  const k = KEYWORDS[keyword];
  if (!k) return null;
  return (
    `Thank you for your comment. This is an automatic note with what the post promised: ${k.about}, in full, at ${k.page}\n\n` +
    "I am George, and I answer every message here myself. Tell me your dates, the number of guests and a rough budget, and I will come back with real yachts and their numbers.\n\n" +
    "George P. Biniaris"
  );
}

/** A comment with words in it is worth telling George about; emoji alone is not. */
export function hasWords(text: string): boolean {
  return (String(text ?? "").match(/\p{L}{2,}/gu) ?? []).length >= 1;
}
