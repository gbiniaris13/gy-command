// Run: npx tsx --test scripts/aftersales-tests/
// Pure checks of the After sales calendar maths, base texts and the validator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { thanksgiving, sameDayInYear, ageOn, addDays, daysBetween } from "../../src/lib/aftersales/dates";
import { baseText, greetingFor } from "../../src/lib/aftersales/templates";
import { checkAfterSales } from "../../src/lib/aftersales/validate";
import { firstNameOf, GOOGLE_REVIEW_LINK, type Charter, type Kind, type Person } from "../../src/lib/aftersales/plan";

const charter: Charter = {
  key: "c1", cabin_id: "c1", request_id: "r1", vessel: "EFFIE STAR", vessel_type: "Lagoon 51",
  from: "2026-06-27", to: "2026-07-04", port_from: "Athens", port_to: "Athens", area: "the Saronic Gulf",
  lead_email: "lead@example.com", lead_first_name: "Tricia", via_advisor: false, white_label: false, people: [],
  problem: { on: true, note: "the shower drain in one cabin", at: null, resolved_at: "2026-07-07", overdue: false },
};
const lead: Person = { email: "lead@example.com", first_name: "Tricia", name_source: "george", full_name: "Patricia Rhodes Stevens", role: "lead", dob: "1970-10-02", country: "US" };
const guest: Person = { ...lead, email: "g@example.com", first_name: "Jack", full_name: "Jack Garvey", role: "guest" };
const greek: Person = { ...guest, country: "GR" };
const advisor: Person = { ...lead, email: "a@example.com", first_name: "Nicole", full_name: "Nicole Smith", role: "advisor" };

test("dates", () => {
  assert.equal(thanksgiving(2026), "2026-11-26");
  assert.equal(thanksgiving(2027), "2027-11-25");
  assert.equal(sameDayInYear("1992-02-29", 2027), "2027-02-28");
  assert.equal(ageOn("2010-08-01", "2026-07-04"), 15);
  assert.equal(addDays("2026-07-04", 3), "2026-07-07");
  assert.equal(daysBetween("2026-07-04", "2026-07-18"), 14);
});

test("first names: never the passport name", () => {
  assert.equal(firstNameOf("STEVENS, PATRICIA RHODES"), "Patricia");
  assert.equal(firstNameOf("Mr. John Smith"), "John");
  assert.equal(firstNameOf("tricia"), "Tricia");
});

test("greetings: Hey for thank-you, review, birthday; Dear for the rest", () => {
  assert.equal(greetingFor("thank_you", lead), "Hey Tricia,");
  assert.equal(greetingFor("review", lead), "Hey Tricia,");
  assert.equal(greetingFor("anniversary", lead), "Dear Tricia,");
  assert.equal(greetingFor("holiday", lead), "Dear Tricia,");
});

test("every base text passes the rules (advisor note keeps its blanks for George)", () => {
  const cases: [Kind, Person][] = [
    ["thank_you", lead], ["thank_you", guest], ["review", lead], ["review", guest], ["review_after_problem", guest],
    ["birthday", lead], ["holiday", lead], ["holiday", greek], ["anniversary", lead], ["next_season", lead], ["advisor_report", advisor],
  ];
  for (const [k, p] of cases) {
    const d = baseText(k, charter, p, { problem_note: charter.problem.note });
    const probs = checkAfterSales(k, d, { greeting: greetingFor(k, p), fullName: p.full_name });
    if (k === "advisor_report") assert.deepEqual(probs, ["has [brackets] left to fill in"], `${k}: ${probs.join("; ")}`);
    else assert.deepEqual(probs, [], `${k}/${p.role}: ${probs.join("; ")}`);
  }
});

test("the validator catches the 2026 mistakes", () => {
  const bad = (k: Kind, body: string, subject = "Thank you for the week") => checkAfterSales(k, { subject, body }, { greeting: "Hey Tricia,", fullName: "Patricia Rhodes Stevens" });
  const ok = `Hey Tricia,\n\nThank you for trusting me with your week aboard EFFIE STAR. It was a real pleasure to look after your family in the Saronic, and I keep thinking of the evening in Hydra harbour.\n\nIf there is anything at all I can do, I am one message away.\n\nGeorge`;
  assert.ok(bad("thank_you", ok.replace("Hey Tricia,", "Dear Patricia Rhodes Stevens,")).some((p) => p.includes("first line")));
  assert.ok(bad("review", ok + "\n\nhttps://g.page/r/George-Yachts/review").some((p) => p.includes("review link")));
  assert.ok(bad("review", ok + `\n\n${GOOGLE_REVIEW_LINK}\n\nhttps://www.trustpilot.com/evaluate/georgeyachts.com`).some((p) => /Trustpilot|only the Google/.test(p)));
  assert.ok(bad("next_season", ok + "\n\nThe best yachts book up early.").some((p) => p.includes("urgency")));
  assert.ok(bad("thank_you", ok + "\n\nWould you leave us a review?").some((p) => p.includes("no review ask")));
  assert.ok(bad("thank_you", ok.replace("pleasure", "pleasure — truly")).some((p) => p.includes("long dash")));
  assert.ok(bad("thank_you", ok, "A small ask Ã¢Â€Â” would you share a review?").length > 0);
});

import { yachtName } from "../../src/lib/aftersales/plan";
test("yacht names read like names, not shouting", () => {
  assert.equal(yachtName("S/CAT SUMMER STAR"), "Summer Star");
  assert.equal(yachtName("SEABARIT LX"), "Seabarit LX");
  assert.equal(yachtName("M/CAT ELLY II"), "Elly II");
  assert.equal(yachtName("S/CAT PI 2"), "Pi 2");
  assert.equal(yachtName("EFFIE STAR"), "Effie Star");
});

test("the anniversary names a real region only", () => {
  assert.match(baseText("anniversary", { ...charter, area: "Saronic" }, lead).body, /you were in the Saronic, aboard/);
  assert.match(baseText("anniversary", { ...charter, area: "Athens to Athens, Cyclades. Syros to be included (client has an emotional tie)" }, lead).body, /you were in the Cyclades, aboard/);
  assert.match(baseText("anniversary", { ...charter, area: "Greek & International Waters" }, lead).body, /you were aboard EFFIE STAR, and/);
});

import { ungrounded, tooSimilar } from "../../src/lib/aftersales/grounding";
test("grounding: words the model adds must come from the emails", () => {
  const base = baseText("holiday", { ...charter, vessel: "Seabarit LX" }, lead).body;
  const invented = base.replace("is part of mine.", "with its fresh flavours from the galley, is part of mine.");
  assert.deepEqual(ungrounded(invented, base, "Thank you George, the week was perfect."), ["fresh", "flavours", "galley"]);
  const fromMail = base.replace("is part of mine.", "and that evening in Hydra harbour, is part of mine.");
  assert.deepEqual(ungrounded(fromMail, base, "Hydra was our favourite island, the harbour was so festive"), []);
});

test("one family never gets the same letter, even six people", () => {
  const fam: Person[] = ["Tricia", "Mark", "Caroline", "Grant", "Jack", "Madison"].map((n, i) => ({ ...lead, first_name: n, email: `${i}@x.com`, role: i ? "guest" : "lead" }));
  const c = { ...charter, people: fam };
  for (const k of ["holiday", "thank_you", "birthday"] as Kind[]) {
    const letters = fam.map((p, i) => ({ name: p.first_name, body: baseText(k, c, p, { variant: i }).body }));
    for (let i = 0; i < letters.length; i++) {
      const others = letters.filter((_, j) => j !== i);
      assert.equal(tooSimilar(letters[i].body, others, fam.map((p) => p.first_name)), null, `${k}: ${letters[i].name} reads like another`);
    }
  }
  const guests = fam.slice(1);
  const reviews = guests.map((p, i) => ({ name: p.first_name, body: baseText("review", c, p, { variant: i + 1 }).body }));
  for (let i = 0; i < reviews.length; i++) assert.equal(tooSimilar(reviews[i].body, reviews.filter((_, j) => j !== i), fam.map((p) => p.first_name)), null, `review: ${reviews[i].name}`);
});

test("every wording of every letter passes the rules", () => {
  for (let n = 0; n < 6; n++) {
    for (const [k, p] of [["thank_you", guest], ["review", guest], ["birthday", guest], ["holiday", guest], ["holiday", greek]] as [Kind, Person][]) {
      const d = baseText(k, charter, p, { variant: n });
      assert.deepEqual(checkAfterSales(k, d, { greeting: greetingFor(k, p), fullName: p.full_name }), [], `${k} variant ${n}`);
    }
  }
});

test("a draft cut off mid-sentence never passes", () => {
  const cut = "Hey Madison,\n\nFor your week aboard Effie Star, thank you. It was a real pleasure to look after you.\n\nI grew up in the Cyclades, and every charter is a little like sharing my home with a guest. My hope is that the week felt like";
  const p = checkAfterSales("thank_you", { subject: "Thank you for the week", body: cut }, { greeting: "Hey Madison,", fullName: "" });
  assert.ok(p.some((x) => x.includes('end with "George"')));
  assert.ok(p.some((x) => x.includes("mid-sentence")));
});
