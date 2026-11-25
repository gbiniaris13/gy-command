// src/lib/aftersales/templates.ts
// The base text of every After sales message, in George's voice (research
// texts 5.1-5.12 of 25/11/2026, adapted to his decisions: "Hey" for the
// thank-you, the reviews and the birthday; "Dear" for the anniversary, the
// holiday letter and the next-season note). The model personalises these;
// when it cannot, George gets exactly this text.

import type { Charter, Kind, Person } from "./plan";
import { GOOGLE_REVIEW_LINK } from "./plan";

export function greetingFor(kind: Kind, p: Person): string {
  const warm: Kind[] = ["thank_you", "review", "review_after_problem", "birthday", "advisor_report"];
  return `${warm.includes(kind) ? "Hey" : "Dear"} ${p.first_name},`;
}

const REGIONS: [RegExp, string][] = [
  [/saronic/i, "the Saronic"], [/cyclad/i, "the Cyclades"], [/ionian/i, "the Ionian"],
  [/sporad/i, "the Sporades"], [/dodecan/i, "the Dodecanese"], [/argolic/i, "the Argolic Gulf"],
  [/mykonos/i, "Mykonos"], [/santorini/i, "Santorini"], [/hydra/i, "Hydra"], [/corfu/i, "Corfu"], [/lefkada/i, "Lefkada"],
];
/** A real region named in the charter's area, or null. Free text ("Athens to
 *  Athens, Syros to be included...", "Greek & International Waters") never
 *  goes into an email as a place. */
export function regionOf(c: Charter): string | null {
  const a = c.area || "";
  for (const [re, name] of REGIONS) if (re.test(a)) return name;
  return null;
}

/** Pick one of several wordings: people of the same charter get different
 *  letters (26/11/2026: six identical Thanksgiving letters to one family). */
// k shifts the choice for the 2nd and 3rd sentence, so with three wordings
// per sentence even six people of one charter share at most one sentence.
const pick = <T,>(arr: T[], n: number, k = 0): T => arr[(n + k * Math.floor(n / arr.length)) % arr.length];

export function baseText(kind: Kind, c: Charter, p: Person, extra: { problem_note?: string; variant?: number } = {}): { subject: string; body: string } {
  const g = greetingFor(kind, p);
  const v = c.vessel;
  const n = extra.variant ?? 0;
  switch (kind) {
    case "thank_you":
      return {
        subject: "Thank you for the week",
        body: [
          g,
          pick([
            `Thank you for trusting me with your week aboard ${v}. It was a real pleasure to look after you.`,
            `Thank you for the week aboard ${v}. Looking after you was a real pleasure.`,
            `Your week aboard ${v} has just ended, and I wanted to thank you for it myself.`,
          ], n),
          pick([
            `I am from the Cyclades, and every charter feels a little like showing a guest my home. I truly hope the week was everything you dreamed of, and that you took some of the islands' energy home with you.`,
            `I am from the Cyclades, so every week on these waters feels a little like welcoming someone into my home. I truly hope it was the holiday you dreamed of, and that some of the islands' energy travels home with you.`,
            `I grew up in the Cyclades, and for me every charter is a little like sharing my home with a guest. My wish is that the week felt like a dream, and that you carry some of the islands' energy with you.`,
          ], n, 1),
          pick([`If there is anything at all I can do for you, now or later, I am one message away.`, `Whatever you need, now or in the months ahead, I am one message away.`, `If I can ever help with anything, now or later, just write to me.`], n, 2),
          `With warm regards from Athens,\nGeorge`,
        ].join("\n\n"),
      };
    case "review":
      return p.role === "lead"
        ? {
            subject: "Thank you, and one small favor",
            body: [
              g,
              `Welcome home. It was a privilege to look after you and your party aboard ${v}.`,
              `If you have a few minutes, I would be grateful if you would share your experience of George Yachts on Google. Whatever you choose to write helps the next family decide, and it helps me do better.`,
              GOOGLE_REVIEW_LINK,
              `With warm regards from Athens,\nGeorge`,
            ].join("\n\n"),
          }
        : {
            subject: "From George, after your week in Greece",
            body: [
              g,
              pick([
                `You came aboard ${v} as ${c.lead_first_name || "your host"}'s guest, but the week was yours too, and I wanted to thank you myself.`,
                `${c.lead_first_name || "Your host"} booked the week aboard ${v}, but it was every bit your week too, and I wanted to thank you personally.`,
                `The week aboard ${v} belonged to everyone on board, you included, and I wanted to thank you myself.`,
              ], n),
              pick([
                `If you would like to share your experience of George Yachts, a few words on Google would mean a great deal to me, and to the people who come after you.`,
                `If you have a moment to share your experience of George Yachts on Google, it would mean a great deal to me, and it helps the next guests decide.`,
                `Should you feel like sharing your experience of George Yachts, a few words on Google would be a real kindness, to me and to those who come next.`,
              ], n, 1),
              GOOGLE_REVIEW_LINK,
              `Warmly,\nGeorge`,
            ].join("\n\n"),
          };
    case "review_after_problem":
      return {
        subject: "Thank you, and I have not forgotten",
        body: [
          g,
          `Thank you again for telling me plainly about ${extra.problem_note ? extra.problem_note.replace(/[.\s]+$/, "") : "what went wrong during the week"}. You were right to, and it has been dealt with.`,
          `I ask every guest for their view of us, and I would not want yours to be the exception. If you are willing, you can share your experience of George Yachts here, in whatever words feel fair to you.`,
          GOOGLE_REVIEW_LINK,
          `With my thanks,\nGeorge`,
        ].join("\n\n"),
      };
    case "birthday":
      return {
        subject: "Happy birthday",
        body: [g, pick([
          `Happy birthday from Athens. Wishing you a wonderful day with the people you love, and a year as bright as a morning on the water.`,
          `A very happy birthday to you from Athens. May the day be full of the people you love, and the year ahead as calm as a quiet anchorage.`,
          `Happy birthday. I hope today brings you the people you love around one table, and a year ahead with plenty of sun in it.`,
          `Many happy returns from Athens. I hope the day is full of good company and that the year ahead treats you kindly.`,
          `Wishing you the happiest of birthdays from Greece, a day of good company and a year that feels like a long summer.`,
          `Happy birthday from all the way across the Aegean. May today be a joyful one, and the year ahead calm and bright.`,
        ], n), `Warmly,\nGeorge`].join("\n\n"),
      };
    case "holiday":
      return !p.country || p.country === "US"
        ? {
            subject: "A note of thanks",
            body: [
              g,
              `Thanksgiving is not a holiday we keep in Greece, but I have come to love the idea of a day set aside simply for gratitude. ${pick([`This year, your week aboard ${v} is part of mine.`, `This year, the week you spent aboard ${v} is part of mine.`, `This year, the week aboard ${v} with all of you is part of mine.`], n)}`,
              pick([
                `The islands are quiet now, the harbours have emptied, the tavernas have closed their shutters and the light has turned soft and low, my favourite time to remember the summer.`,
                `The islands have gone quiet for the winter and the light over the sea has turned soft and low, my favourite time to look back on the summer.`,
                `Here the season has closed, the boats are back in their winter berths and the light has turned soft and low, the moment I like best for remembering the summer.`,
              ], n, 1),
              pick([`Wishing you and everyone at your table a warm Thanksgiving, and a peaceful end to the year.`, `Wishing you a warm Thanksgiving with the people you love, and a peaceful end to the year.`, `Wishing you and everyone around your table a warm Thanksgiving, and a peaceful end to the year.`], n, 2),
              `George`,
            ].join("\n\n"),
          }
        : {
            subject: "Season's greetings from Athens",
            body: [
              g,
              pick([`As the year closes, your week aboard ${v} is one of the memories I am most grateful for.`, `As the year ends, I find myself grateful for the week you spent aboard ${v}.`, `Looking back on this year, the week aboard ${v} with you is one I am truly grateful for.`], n),
              pick([`The islands are quiet now. The harbours have emptied, and the light has turned soft and low, my favourite time to remember the summer.`, `The islands have gone quiet for the winter, and the light over the sea has turned soft and low.`, `Here the season has closed, the boats are in their winter berths, and the light has turned soft and low.`], n, 1),
              `Wishing you and your family a peaceful Christmas and a very happy new year.`,
              `George`,
            ].join("\n\n"),
          };
    case "anniversary":
      return {
        subject: "One year ago this week",
        body: [g, regionOf(c) ? `A year ago this week you were in ${regionOf(c)}, aboard ${v}, and you came to mind this morning.` : `A year ago this week you were aboard ${v}, and you came to mind this morning.`, `I hope the year since has been kind to all of you. No reason for writing beyond that.`, `With warm regards,\nGeorge`].join("\n\n"),
      };
    case "next_season":
      return {
        subject: "Next summer, whenever you are ready",
        body: [
          g,
          `The season here is closing gently, and owners are beginning to share their calendars for next summer. If Greece is in your thoughts again, I would be glad to begin quietly, with no commitment, and keep an eye on the weeks and the yachts that would suit you.`,
          `If next summer belongs elsewhere, I understand completely. And if you would rather I did not write about this, a word is enough.`,
          `Warmly,\nGeorge`,
        ].join("\n\n"),
      };
    case "advisor_report":
      return {
        subject: `Your clients, after their week aboard ${v}`,
        body: [
          g,
          `Thank you for trusting me with your clients. They disembarked${c.port_to ? ` in ${c.port_to}` : ""} on ${c.to}, and here is a short report for your files.`,
          `Route: ${regionOf(c) ?? "[fill in]"}.\nWhat they mentioned most: [fill in].\nWhat did not go to plan, and how it was handled: [nothing to report, or the details].`,
          `If you would like a short note to forward to them, here is one, to use or not as you prefer. I will not contact them directly.`,
          `"It was a pleasure to have you aboard ${v}. I hope Greece stays with you for a long time. With warm regards, George"`,
          `With thanks,\nGeorge`,
        ].join("\n\n"),
      };
  }
}
