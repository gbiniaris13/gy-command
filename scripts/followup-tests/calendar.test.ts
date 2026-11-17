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

import { rescheduleFromConversation } from "../../src/lib/helm/followup/calendar.ts";

const step = (due: string, extra: Record<string, unknown> = {}) => ({ due, done_at: null, how: null, kind: "nudge" as const, v: 2 as const, ...extra });

test("George talked on WhatsApp last night → tomorrow's follow-up moves, and so do the rest", () => {
  const fu = [step("2026-11-17"), step("2026-11-24"), step("2027-01-06"), step("2027-05-28", { kind: "bye" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-16T20:00:00Z", tz: "America/New_York", charterFrom: "2027-07-03", sentAtIso: "2026-10-21T10:00:00Z",
    lastInboundAt: "2026-11-16T01:00:00Z", lastOutboundAt: "2026-11-16T18:00:00Z", hadInboundAfterFirstOut: true, ball: "client_owes", clientFollowupDate: null,
  });
  assert.ok(r.changed);
  assert.ok(r.fu[0].due >= "2026-11-18", r.fu.map((s) => s.due).join(","));
  for (let i = 1; i < r.fu.length; i++) assert.ok(r.fu[i].due > r.fu[i - 1].due);
});

test("client said wait (back on the 28th) → nothing before that day", () => {
  const fu = [step("2026-11-17"), step("2026-11-20"), step("2026-12-10", { kind: "bye" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-16T20:00:00Z", tz: "Australia/Sydney", charterFrom: "2027-09-04", sentAtIso: "2026-10-21T10:00:00Z",
    lastInboundAt: "2026-11-15T02:00:00Z", lastOutboundAt: "2026-11-15T03:00:00Z", hadInboundAfterFirstOut: true, ball: "client_owes", clientFollowupDate: "2026-11-30",
  });
  assert.equal(r.fu[0].due, "2026-11-30");
  assert.ok(r.fu.every((s) => s.due >= "2026-11-30"));
});

test("client wrote last → the answer is due today", () => {
  const r = rescheduleFromConversation([step("2026-11-25")], {
    todayIso: "2026-11-16T12:00:00Z", tz: "America/New_York", charterFrom: "2027-07-03", sentAtIso: "2026-10-21T10:00:00Z",
    lastInboundAt: "2026-11-16T11:00:00Z", lastOutboundAt: "2026-11-10T10:00:00Z", hadInboundAfterFirstOut: true, ball: "we_owe", clientFollowupDate: null,
  });
  assert.equal(r.fu[0].due, "2026-11-16");
});

test("never replied: a hand-written touch yesterday pushes today's step out, market anchors stay", () => {
  const fu = [step("2026-11-16"), step("2027-01-06", { anchor: "US planning window opens" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-16T12:00:00Z", tz: "America/New_York", charterFrom: "2027-07-03", sentAtIso: "2026-11-01T10:00:00Z",
    lastInboundAt: null, lastOutboundAt: "2026-11-15T15:00:00Z", hadInboundAfterFirstOut: false, ball: "client_owes", clientFollowupDate: null,
  });
  assert.equal(r.fu[0].due, "2026-11-20");
  assert.equal(r.fu[1].due, "2027-01-06");
});

test("George's own hand-set date is never moved", () => {
  const fu = [step("2026-11-18", { manual: true }), step("2026-11-17")];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-16T12:00:00Z", tz: "America/New_York", charterFrom: "2027-07-03", sentAtIso: "2026-11-01T10:00:00Z",
    lastInboundAt: null, lastOutboundAt: "2026-11-15T15:00:00Z", hadInboundAfterFirstOut: false, ball: "client_owes", clientFollowupDate: null,
  });
  assert.ok(r.fu.some((s) => s.due === "2026-11-18" && (s as { manual?: boolean }).manual));
});

test("went quiet months ago → keep the research plan, no mass close of the file", () => {
  const fu = [step("2026-11-16"), step("2027-01-06", { anchor: "US planning window opens" }), step("2027-05-28", { kind: "bye" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-16T12:00:00Z", tz: "America/New_York", charterFrom: "2027-07-10", sentAtIso: "2026-07-15T10:00:00Z",
    lastInboundAt: "2026-07-13T10:00:00Z", lastOutboundAt: "2026-08-15T10:00:00Z", hadInboundAfterFirstOut: true, ball: "client_owes", clientFollowupDate: null,
  });
  assert.equal(r.fu.length, 3);
  assert.equal(r.fu[1].due, "2027-01-06");
  assert.equal(r.fu.at(-1)!.kind, "bye");
  assert.equal(r.fu.at(-1)!.due, "2027-05-28");
});

test("a plan never ends up with two closes", () => {
  const fu = [step("2026-11-24"), step("2027-04-05", { kind: "bye" }), step("2027-04-08", { kind: "bye" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-16T12:00:00Z", tz: "America/New_York", charterFrom: "2027-06-01", sentAtIso: "2026-10-01T10:00:00Z",
    lastInboundAt: null, lastOutboundAt: "2026-10-15T10:00:00Z", hadInboundAfterFirstOut: false, ball: "client_owes", clientFollowupDate: null,
  });
  assert.equal(r.fu.filter((s) => s.kind === "bye").length, 1);
});

test("17/11 Sean: 'Thank you. Let me look at the email.' → no chasing, one touch a week later, no December close", () => {
  const fu = [step("2026-11-17", { anchor: "ο πελάτης έγραψε: χρωστάς απάντηση" }), step("2026-11-18"), step("2026-11-23"), step("2027-01-06", { anchor: "US planning window opens" }), step("2027-06-26", { kind: "bye" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-17T14:00:00Z", tz: "America/Chicago", charterFrom: "2027-08-01", sentAtIso: "2026-09-22T11:06:00Z",
    lastInboundAt: "2026-11-16T22:53:00Z", lastOutboundAt: "2026-11-16T18:08:00Z", hadInboundAfterFirstOut: true, ball: "we_owe",
    clientFollowupDate: null, lastInboundNeedsReply: false,
  });
  assert.equal(r.fu[0].due, "2026-11-23", r.fu.map((s) => s.due).join(","));
  assert.ok(!r.fu.some((s) => s.due === "2026-11-17" || s.due === "2026-11-18"));
  assert.ok(r.fu.some((s) => s.due === "2027-01-06"));
});

test("long lead that went quiet recently: the ladder does not close the file a year early", () => {
  const fu = [step("2027-01-06", { anchor: "US planning window opens" }), step("2027-06-26", { kind: "bye" })];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-17T14:00:00Z", tz: "America/New_York", charterFrom: "2027-08-01", sentAtIso: "2026-09-22T11:06:00Z",
    lastInboundAt: "2026-11-10T15:00:00Z", lastOutboundAt: "2026-11-11T15:00:00Z", hadInboundAfterFirstOut: true, ball: "client_owes", clientFollowupDate: null,
  });
  const byes = r.fu.filter((s) => s.kind === "bye");
  assert.equal(byes.length, 1);
  assert.equal(byes[0].due, "2027-06-26");
  assert.ok(r.fu.some((s) => s.due === "2027-01-06"));
});

test("17/11 Erika: client answered our question → reply today, nothing stacked tomorrow", () => {
  const fu = [step("2026-11-17"), step("2026-11-18"), step("2026-11-23")];
  const r = rescheduleFromConversation(fu, {
    todayIso: "2026-11-17T14:00:00Z", tz: "Pacific/Honolulu", charterFrom: "2027-07-10", sentAtIso: "2026-11-13T15:41:00Z",
    lastInboundAt: "2026-11-16T19:21:00Z", lastOutboundAt: "2026-11-16T18:11:00Z", hadInboundAfterFirstOut: true, ball: "we_owe",
    clientFollowupDate: null, lastInboundNeedsReply: true,
  });
  assert.equal(r.fu[0].due, "2026-11-17");
  assert.ok(r.fu[1].due >= "2026-11-25", r.fu.map((s) => s.due).join(","));
});

test("agreed day: the next touch is not the day after", () => {
  const r = rescheduleFromConversation([step("2027-04-19"), step("2027-04-20")], {
    todayIso: "2026-11-17T14:00:00Z", tz: "America/New_York", charterFrom: "2028-07-01", sentAtIso: "2026-10-01T10:00:00Z",
    lastInboundAt: "2026-10-16T10:00:00Z", lastOutboundAt: "2026-10-17T10:00:00Z", hadInboundAfterFirstOut: true, ball: "client_owes", clientFollowupDate: "2027-04-19",
  });
  assert.equal(r.fu[0].due, "2027-04-19");
  assert.ok(r.fu[1].due >= "2027-04-26", r.fu.map((s) => s.due).join(","));
});

test("George's own date wins over an automatic one next to it", () => {
  const r = rescheduleFromConversation([step("2026-12-02", { manual: true })], {
    todayIso: "2026-11-17T14:00:00Z", tz: "America/New_York", charterFrom: "2028-07-01", sentAtIso: "2026-10-01T10:00:00Z",
    lastInboundAt: "2026-11-01T10:00:00Z", lastOutboundAt: "2026-11-02T10:00:00Z", hadInboundAfterFirstOut: true, ball: "client_owes", clientFollowupDate: "2026-12-01",
  });
  assert.equal(r.fu[0].due, "2026-12-02");
  assert.ok(!r.fu.some((s) => s.due === "2026-12-01"));
});
