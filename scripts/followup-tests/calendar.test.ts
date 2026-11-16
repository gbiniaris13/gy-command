// Run: node --test scripts/followup-tests/
// Acceptance tests from docs/followup/HELM_FOLLOWUP_BUILD_PROMPT.md that live
// in code (dates, buckets, blackouts, zones). The writing tests live in
// validate.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planFollowUps, planGhosted, leadFacts, nextSendSlot, nextSendDay, usBlackout,
  thanksgiving, clientTimezone, addDays,
} from "../../src/lib/helm/followup/calendar.ts";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

test("blackouts: Thanksgiving 2026 is Thu 26 Nov, Wed-Sun blocked", () => {
  assert.equal(thanksgiving(2026), "2026-11-26");
  for (const d of ["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]) assert.ok(usBlackout(d), d);
  assert.equal(usBlackout("2026-11-24"), null);
  assert.ok(usBlackout("2026-12-23") && usBlackout("2027-01-01"));
  assert.equal(usBlackout("2027-01-18"), "MLK Day");
  assert.equal(usBlackout("2027-02-15"), "Presidents Day");
  assert.equal(usBlackout("2027-05-31"), "Memorial Day");
  assert.equal(usBlackout("2027-09-06"), "Labor Day");
});

test("1. Request 16/11/2026 for mid-January 2027: SHORT, nothing 25-29/11, capped at the deadline", () => {
  const sent = "2026-11-16T10:00:00Z";
  const f = leadFacts(sent, "2027-01-15", NY);
  assert.equal(f.bucket, "SHORT");
  assert.equal(f.dd, "2026-12-11");
  const plan = planFollowUps({ sentAtIso: sent, charterFrom: "2027-01-15", tz: NY });
  assert.ok(plan.length >= 6 && plan.length <= 9, `steps ${plan.length}`);
  for (const s of plan) {
    assert.ok(!(s.due >= "2026-11-25" && s.due <= "2026-11-29"), `Thanksgiving: ${s.due}`);
    assert.ok(s.due <= "2026-12-11", `after deadline: ${s.due}`);
    assert.ok(![0, 6].includes(new Date(`${s.due}T12:00:00Z`).getUTCDay()), `weekend: ${s.due}`);
  }
  assert.equal(plan.at(-1)!.kind, "bye");
  assert.equal(plan.at(-1)!.touch, "permission_to_close");
});

test("2. Request 15/9/2026 for 11-18/9/2027: LONG, anchored to market events, early-booking only when set", () => {
  const sent = "2026-09-15T10:00:00Z";
  assert.equal(leadFacts(sent, "2027-09-11", NY).bucket, "LONG");
  const plan = planFollowUps({ sentAtIso: sent, charterFrom: "2027-09-11", tz: NY });
  const dues = plan.map((s) => s.due);
  assert.ok(dues.includes("2026-10-06"), "rate cards, first Tuesday of October");
  assert.ok(dues.includes("2027-01-06"), "first business Wednesday of January");
  assert.ok(!plan.some((s) => s.touch === "early_booking_deadline"));
  // never two in one month after the first three
  const later = plan.slice(3).filter((s) => s.kind !== "bye").map((s) => s.due.slice(0, 7));
  assert.equal(new Set(later).size, later.length, later.join(","));
  assert.equal(plan.at(-1)!.kind, "bye");
  assert.ok(plan.at(-1)!.due <= "2027-08-09");

  const withEb = planFollowUps({ sentAtIso: sent, charterFrom: "2027-09-11", tz: NY, earlyBookingDeadline: "2026-12-31" });
  assert.ok(withEb.some((s) => s.touch === "early_booking_deadline"));
});

test("4. Replied, then silent: +2, +5, +10, +20, +35 (moved off weekends)", () => {
  const plan = planGhosted("2026-11-02T15:00:00Z", NY, "2026-11-03T09:00:00Z");
  assert.deepEqual(plan.map((s) => s.due), ["2026-11-04", "2026-11-09", "2026-11-12", "2026-11-23", "2026-12-07"]);
  assert.equal(plan.at(-1)!.kind, "bye");
});

test("6. 'Let's talk in January': the first US business day after 1 January, 10:00 client time", () => {
  assert.equal(nextSendDay("2027-01-02"), "2027-01-04");
  const slot = nextSendSlot("2027-01-04", "call", NY, Date.parse("2026-12-01T00:00:00Z"));
  // calls are Tue-Thu, so the email window is the right first touch for a Monday:
  const email = nextSendSlot("2027-01-04", "email", NY, Date.parse("2026-12-01T00:00:00Z"));
  assert.equal(email.client_local, "2027-01-04 08:30");
  assert.equal(slot.client_local.slice(0, 10), "2027-01-05");
});

test("9. Los Angeles client: email 08:30-11:00 PT, Athens time right in the DST mismatch week", () => {
  const before = Date.parse("2027-03-01T00:00:00Z");
  const mismatch = nextSendSlot("2027-03-16", "email", LA, before);
  assert.equal(mismatch.client_local, "2027-03-16 08:30");
  assert.equal(mismatch.athens, "2027-03-16 17:30"); // US on summer time, Greece not yet
  const normal = nextSendSlot("2027-04-06", "email", LA, before);
  assert.equal(normal.athens, "2027-04-06 18:30");
  assert.equal(normal.window_client, "08:30–11:00");
});

test("ULTRA_SHORT: weekends allowed, stops 3 days before the charter", () => {
  const plan = planFollowUps({ sentAtIso: "2027-06-07T09:00:00Z", charterFrom: "2027-06-26", tz: NY });
  assert.equal(leadFacts("2027-06-07T09:00:00Z", "2027-06-26", NY).bucket, "ULTRA_SHORT");
  for (const s of plan) assert.ok(s.due <= addDays("2027-06-26", -3));
  assert.equal(plan[0].due, "2027-06-07");
});

test("time zone from the phone", () => {
  assert.deepEqual(clientTimezone(null, "+1 (415) 555-0100"), { tz: LA, source: "phone" });
  assert.deepEqual(clientTimezone(null, "+44 7700 900123"), { tz: "Europe/London", source: "phone" });
  assert.deepEqual(clientTimezone(null, null), { tz: NY, source: "default" });
  assert.deepEqual(clientTimezone("America/Chicago", "+1 415 555 0100"), { tz: "America/Chicago", source: "stored" });
});
