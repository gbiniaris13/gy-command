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

export function baseText(kind: Kind, c: Charter, p: Person, extra: { problem_note?: string } = {}): { subject: string; body: string } {
  const g = greetingFor(kind, p);
  const v = c.vessel;
  switch (kind) {
    case "thank_you":
      return {
        subject: "Thank you for the week",
        body: [
          g,
          `Thank you for trusting me with your week aboard ${v}. It was a real pleasure to look after you.`,
          `I am from the Cyclades, and every charter feels a little like showing a guest my home. I truly hope the week was everything you dreamed of, and that you took some of the islands' energy home with you.`,
          `If there is anything at all I can do for you, now or later, I am one message away.`,
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
              `You came aboard ${v} as ${c.lead_first_name || "your host"}'s guest, but the week was yours too, and I wanted to thank you myself.`,
              `If you would like to share your experience of George Yachts, a few words on Google would mean a great deal to me, and to the people who come after you.`,
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
        body: [g, `Happy birthday from Athens. Wishing you a wonderful day with the people you love, and a year as bright as a morning on the water.`, `Warmly,\nGeorge`].join("\n\n"),
      };
    case "holiday":
      return !p.country || p.country === "US"
        ? {
            subject: "A note of thanks",
            body: [
              g,
              `Thanksgiving is not a holiday we keep in Greece, but I have come to love the idea of a day set aside simply for gratitude. This year, your week aboard ${v} is part of mine.`,
              `The islands are quiet now. The harbours have emptied, the tavernas have closed their shutters, and the light has turned soft and low. It is my favourite time to remember the summer.`,
              `Wishing you and everyone at your table a warm Thanksgiving, and a peaceful end to the year.`,
              `George`,
            ].join("\n\n"),
          }
        : {
            subject: "Season's greetings from Athens",
            body: [
              g,
              `As the year closes, your week aboard ${v} is one of the memories I am most grateful for.`,
              `The islands are quiet now. The harbours have emptied, and the light has turned soft and low, my favourite time to remember the summer.`,
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
