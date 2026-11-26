// Run: npx tsx --test scripts/aftersales-tests/
// 25/11/2026: the After sales brain inside the Lighthouse. Clients from the
// day they sign, the forward-looking holiday letter, and the card sign-off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rawTouches, type Charter, type Person } from "../../src/lib/aftersales/plan";
import { baseText } from "../../src/lib/aftersales/templates";
import { checkAfterSales } from "../../src/lib/aftersales/validate";
import { splitSignOff } from "../../src/lib/aftersales/card";

const hong: Person = { email: "wilson.hong@gmail.com", first_name: "Wilson", name_source: "record", full_name: "Wilson Hong", role: "lead", dob: "1979-12-01", country: "US" };
const future: Charter = {
  key: "req:1", cabin_id: null, request_id: "1", vessel: "Pi2", vessel_type: "", from: "2027-06-18", to: "2027-06-25",
  port_from: null, port_to: null, area: "Saronic", lead_email: hong.email, lead_first_name: "Wilson", via_advisor: false, white_label: false,
  people: [hong], problem: { on: false, note: "", at: null, resolved_at: null, overdue: false },
};

test("a client with a 2027 contract gets the 2026 birthday and holiday letter", () => {
  const t = rawTouches(future, "2026-11-25");
  assert.ok(t.some((x) => x.kind === "birthday" && x.due === "2026-12-01"));
  assert.ok(t.some((x) => x.kind === "holiday" && x.due === "2026-11-23" && x.expires === "2026-11-26"));
  // nothing about the week before it happens
  assert.ok(!t.some((x) => ["thank_you", "review"].includes(x.kind) && x.due < "2027-06-25"));
  assert.ok(!t.some((x) => x.kind === "anniversary" && x.due < "2028-01-01"));
});

test("no holiday letter in the fortnight around the charter, no birthday on board", () => {
  const onBoard: Charter = { ...future, from: "2026-11-20", to: "2026-11-27", people: [{ ...hong, dob: "1979-11-22" }] };
  const t = rawTouches(onBoard, "2026-11-10");
  assert.ok(!t.some((x) => x.kind === "holiday" && x.due.startsWith("2026")));
  assert.ok(!t.some((x) => x.kind === "birthday" && x.due === "2026-11-22"));
  assert.ok(t.some((x) => x.kind === "birthday" && x.due === "2027-11-22"));
});

test("the forward-looking holiday letter reads right and passes the rules, US and elsewhere", () => {
  for (const country of ["US", "GB"]) {
    for (let v = 0; v < 6; v++) {
      const p = { ...hong, country };
      const d = baseText("holiday", future, p, { variant: v, due: country === "US" ? "2026-11-23" : "2026-12-18" });
      assert.match(d.body, /next June/);
      assert.match(d.body, /the Saronic/);
      assert.doesNotMatch(d.body, /spent aboard|remember the summer/);
      assert.deepEqual(checkAfterSales("holiday", d, { greeting: "Dear Wilson,", fullName: "Wilson Hong" }), [], `${country} v${v}: ${d.body}`);
    }
  }
});

test("a charter that happened still gets the look-back letter", () => {
  const past: Charter = { ...future, from: "2026-06-27", to: "2026-07-04" };
  const d = baseText("holiday", past, hong, { variant: 0, due: "2026-11-23" });
  assert.match(d.body, /your week aboard Pi2 is part of mine/);
});

test("the card signs once: the text's sign-off becomes the card's closing", () => {
  assert.deepEqual(splitSignOff("Hey Jack,\n\nHappy birthday.\n\nWarmly,\nGeorge"), { body: "Hey Jack,\n\nHappy birthday.", closing: "Warmly," });
  assert.deepEqual(splitSignOff("Dear Bruce,\n\nThanks.\n\nGeorge"), { body: "Dear Bruce,\n\nThanks.", closing: "Warmly," });
  assert.equal(splitSignOff("Dear Bruce,\n\nThanks.").body, "Dear Bruce,\n\nThanks.");
});

// 26/11/2026: a card of the house per occasion, George as his signature.
import fs from "node:fs";
import { greetingCard, CARD_ART } from "../../src/lib/lighthouse-card";
test("each occasion has its own print, the signature, no portrait, and every image file exists", () => {
  const seen = new Set<string>();
  for (const kind of ["birthday", "thanksgiving", "western_christmas"]) {
    const html = greetingCard({ kind, subject: "Happy birthday, Jack", body: "Dear Jack,\n\nA happy day to you.", closing: "Warmly," });
    const art = CARD_ART[kind];
    assert.ok(html.includes(art.src), `${kind} shows its print`);
    seen.add(art.src);
    assert.ok(html.includes("george-signature-v2.png"), `${kind} is signed by hand`);
    assert.ok(!html.includes("george-syros-quay"), `${kind} has no portrait`);
    assert.ok(html.includes("light only"), `${kind} keeps its paper in dark mode`);
    assert.equal((html.match(/Warmly,/g) ?? []).length, 1, `${kind} signs once`);
    assert.ok(Buffer.byteLength(html) < 60_000, `${kind} stays far under Gmail's 102 KB clip`);
    assert.ok(!/data:image/.test(html), `${kind} never inlines images`);
    // The inbox preview opens with the wish, not the masthead or the credit.
    const pre = html.match(/<div style="display:none;[^>]*>([^&<]*)/)?.[1] ?? "";
    assert.equal(pre, "A happy day to you.", `${kind} previews the wish in the inbox`);
    assert.ok(html.indexOf("display:none") < html.indexOf("George&nbsp;Yachts"), `${kind} preheader comes first`);
  }
  assert.equal(seen.size, 3, "three different prints");
  for (const f of ["birthday-v1.jpg", "thanksgiving-v1.jpg", "christmas-v1.jpg", "christmas-v2.jpg", "george-signature-v1.png", "george-signature-v2.png"]) {
    assert.ok(fs.existsSync(`public/cards/${f}`), `public/cards/${f} is in the repo`);
  }
});

// 26/11/2026, George: Americans get Thanksgiving AND a Season's Greetings card.
test("Americans also get Season's Greetings on 17/12; everyone else keeps one year-end letter", () => {
  const us = rawTouches(future, "2026-11-26");
  assert.ok(us.some((x) => x.kind === "holiday" && x.due === "2026-11-23"));
  assert.ok(us.some((x) => x.kind === "season" && x.due === "2026-12-17" && x.expires === "2026-12-23"));
  const gb = rawTouches({ ...future, people: [{ ...hong, country: "GB" }] }, "2026-11-26");
  assert.ok(gb.some((x) => x.kind === "holiday" && x.due === "2026-12-18"));
  assert.ok(!gb.some((x) => x.kind === "season"));
  // quiet around a December charter
  const dec = rawTouches({ ...future, from: "2026-12-20", to: "2026-12-27" }, "2026-11-26");
  assert.ok(!dec.some((x) => x.kind === "season" && x.due.startsWith("2026")));
});

test("the Season's Greetings text is a wish only, neutral, and passes the rules", () => {
  for (let v = 0; v < 6; v++) {
    const d = baseText("season", future, hong, { variant: v, due: "2026-12-17" });
    assert.match(d.body, /^Dear Wilson,/);
    assert.match(d.body, /pomegranate/);
    assert.doesNotMatch(d.body, /Christmas|grateful|chose|Pi2/);
    assert.deepEqual(checkAfterSales("season", d, { greeting: "Dear Wilson,", fullName: "Wilson Hong" }), [], `v${v}: ${d.body}`);
  }
});
