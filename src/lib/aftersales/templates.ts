// src/lib/aftersales/templates.ts
// The base text of every After sales message, in George's voice (research
// texts 5.1-5.12 of 25/11/2026, adapted to his decisions: "Hey" for the
// thank-you, the reviews and the birthday; "Dear" for the anniversary, the
// holiday letter and the next-season note). The model personalises these;
// when it cannot, George gets exactly this text.

import type { Charter, Kind, Person } from "./plan";
import { GOOGLE_REVIEW_LINK } from "./plan";

export function greetingFor(kind: Kind, p: Person, c?: Charter): string {
  // A request that did not book keeps the greeting George used in that thread.
  if (c?.lost) return c.lost.greeting;
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

export function baseText(kind: Kind, c: Charter, p: Person, extra: { problem_note?: string; variant?: number; due?: string } = {}): { subject: string; body: string } {
  const g = greetingFor(kind, p, c);
  const v = c.vessel;
  const n = extra.variant ?? 0;
  // A note in January speaks of "this summer", one in September of "next summer".
  const summer = extra.due && Number(extra.due.slice(5, 7)) >= 7 ? "next summer" : "this summer";
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
    case "season":
      // A card, not a letter: Thanksgiving already said thank you, so this
      // one only wishes (26/11/2026). The pomegranate on the card is the one
      // Greeks break at the door on New Year's Day.
      return {
        subject: "Season's greetings",
        body: [
          g,
          pick([
            `Warm wishes from Athens to you and your family for the holidays, and for a calm, bright year ahead.`,
            `A short note from Athens to wish you and everyone you love a peaceful holiday season and a happy new year.`,
            `Warmest wishes from Greece for the holidays, and for a new year full of good days with the people you love.`,
          ], n),
          pick([
            `Here, on New Year's Day, we break a pomegranate at the door for luck. I am sending one your way.`,
            `In Greece we greet the new year by breaking a pomegranate at the door for luck, so here is one for you.`,
            `On New Year's Day in Greece, a pomegranate is broken at the door for a lucky year. This one is for you.`,
          ], n, 1),
          `Warmly,\nGeorge`,
        ].join("\n\n"),
      };
    case "holiday": {
      // A client whose charter is still ahead (signed for next summer): the
      // letter looks forward to the week instead of back on it (25/11/2026).
      const today = extra.due ?? new Date().toISOString().slice(0, 10);
      if (c.from && c.from > today) {
        const month = new Date(`${c.from}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
        const when = c.from.slice(0, 4) > today.slice(0, 4) ? `next ${month}` : `this ${month}`;
        const week = regionOf(c) ? `a week in ${regionOf(c)} ${when}` : `a week ${when}`;
        const ahead = pick([
          `The islands are quiet now and the light has turned soft and low, the season when I start looking ahead to the summer. Your week is one I am already looking forward to.`,
          `Here the season has closed and the boats are back in their winter berths. It is the quiet time when the summer ahead starts to take shape, and your week is one I already look forward to.`,
          `The islands have gone quiet for the winter, but the summer ahead is already taking shape, and I am glad your week is part of it.`,
        ], n, 1);
        return !p.country || p.country === "US"
          ? {
              subject: "A note of thanks",
              body: [
                g,
                `Thanksgiving is not a holiday we keep in Greece, but I have come to love the idea of a day set aside simply for gratitude. ${pick([`This year, I am grateful that you chose ${v} for ${week}.`, `This year, I am grateful that ${v} will be yours for ${week}.`, `This year, I am grateful for ${week} aboard ${v}, still to come.`], n)}`,
                ahead,
                pick([`Wishing you and everyone at your table a warm Thanksgiving, and a peaceful end to the year.`, `Wishing you a warm Thanksgiving with the people you love, and a peaceful end to the year.`, `Wishing you and everyone around your table a warm Thanksgiving, and a peaceful end to the year.`], n, 2),
                `George`,
              ].join("\n\n"),
            }
          : {
              subject: "Season's greetings from Athens",
              body: [
                g,
                pick([`As the year closes, I am grateful that you chose ${v} for ${week}.`, `As the year ends, I find myself grateful that ${v} will be yours for ${week}.`, `Looking back on this year, I am grateful for ${week} aboard ${v}, still to come.`], n),
                ahead,
                `Wishing you and your family a peaceful Christmas and a very happy new year.`,
                `George`,
              ].join("\n\n"),
            };
      }
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
    }
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
    case "lost_budget":
      return {
        subject: "Your plans for Greece",
        body: [
          g,
          `When we last spoke, the yachts we looked at did not sit comfortably with what you had in mind, and I appreciated your candour.`,
          `I have kept thinking about it. In June and September the same waters are quieter, weekly rates are usually lower than in high summer, and there are smaller yachts with excellent crews that I would happily stand behind. If it would be useful, I can put together two or three options within your range for ${summer}. If not, there is no need to reply.`,
          `Warm regards,\nGeorge`,
        ].join("\n\n"),
      };
    case "lost_silence":
      return {
        subject: "Your summer in Greece",
        body: [
          g,
          `I sent you a few ideas for Greece a while ago and did not want to leave them unanswered on my side. Perhaps the timing was not right, which is entirely fine.`,
          `If Greece is still on your mind for ${summer}, I am here, and I would be glad to look at the weeks and the yachts again with you, with no commitment.`,
          `Warm regards,\nGeorge`,
        ].join("\n\n"),
      };
    case "lost_dates":
      return {
        subject: "Greece, when the time is right",
        body: [
          g,
          `When we last spoke, the plans for Greece were still taking shape, and I understood completely.`,
          `If ${summer} is beginning to look clearer, I would be glad to start again quietly, with the weeks that suit you and no commitment at all.`,
          `Warm regards,\nGeorge`,
        ].join("\n\n"),
      };
    case "lost_last":
      return {
        subject: "One last note from me",
        body: [
          g,
          `This is my last note about Greece, as I would never want to crowd your inbox.`,
          `If a week on the water ever comes back into your plans, for next summer or another, I would be glad to hear from you. Until then, I will not write again about this.`,
          `Warm regards,\nGeorge`,
        ].join("\n\n"),
      };
    case "lost_broker":
      return {
        subject: "I hope it was a wonderful summer",
        body: [
          g,
          `Your week in Greece must be behind you now, and I truly wish it was everything you hoped for. I mean that sincerely.`,
          `If you ever plan another and would like a second pair of eyes on the islands, I would be glad to help.`,
          `With warm regards,\nGeorge`,
        ].join("\n\n"),
      };
    case "lost_short":
      return {
        subject: "A week in Greece, if it ever fits",
        body: [
          g,
          `You asked about a few days on the water, and I was sorry not to help. I arrange charters only by the week, and I wanted to tell you why: a week is what lets the crew find the quiet anchorages, and lets a family stop counting days.`,
          `If a full week ever fits your plans, I would be very glad to hear from you.`,
          `Warm regards,\nGeorge`,
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
