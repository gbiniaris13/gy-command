// Run: node --test scripts/followup-tests/
// Writing guardrails (acceptance tests 5, 8, 10 in the build brief) and the
// scenario reader (3, 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDraft, scenarioHint, featureClaims, type CheckContext } from "../../src/lib/helm/followup/validate.ts";

const ctx: CheckContext = {
  realUrgency: false, availabilityKnown: false, knownAmounts: ["38500", "42000"],
  forbiddenTouchTypes: ["itinerary_idea"], allowedChannels: ["email", "whatsapp"], isAgent: false,
};
const good = "Hi Michael, a small idea for your July week: on a Paros and Antiparos route I would have the captain anchor off Despotiko the first evening. Quiet water, a sunset swim, dinner on deck while the island goes gold. It suits a family who wants long lunches ashore more than a different harbour every night. Would a draft day by day help you and Anna picture it, or is it a little early for that? Warmly,";

test("8. a clean email passes", () => {
  assert.deepEqual(checkDraft({ channel: "email", subject: "Despotiko at sunset", body: good, touch_type: "crew_bio" }, ctx), []);
});

test("8. banned phrases, length and dashes are caught", () => {
  const p = checkDraft({ channel: "email", subject: "Following up", body: "Just checking in — thoughts?", touch_type: "crew_bio" }, ctx);
  assert.ok(p.some((x) => x.includes("just checking in")));
  assert.ok(p.some((x) => x.includes("thoughts?")));
  assert.ok(p.some((x) => x.includes("dash")));
  assert.ok(p.some((x) => x.includes("words")));
  assert.ok(checkDraft({ channel: "whatsapp", body: "word ".repeat(60) }, ctx).some((x) => x.includes("max 45")));
});

test("no urgency, no availability claim, no invented price without data", () => {
  const p = checkDraft({ channel: "email", subject: "Your July week", body: good.replace("Would a draft", "The option expires Friday and ARIELA is still available at €31,000. Would a draft") }, ctx);
  assert.ok(p.some((x) => x.startsWith("urgency")));
  assert.ok(p.some((x) => x.startsWith("claims availability")));
  assert.ok(p.some((x) => x.includes("€31,000")));
  const ok = checkDraft({ channel: "email", subject: "Your July week", body: good.replace("Would a draft", "The week comes in at €38,500 all in. Would a draft") }, ctx);
  assert.deepEqual(ok, []);
  const urg = checkDraft({ channel: "email", subject: "Your July week", body: good.replace("Would a draft", "The option expires Friday. Would a draft") }, { ...ctx, realUrgency: true });
  assert.deepEqual(urg, []);
});

test("10. the touch type used last time is refused", () => {
  assert.ok(checkDraft({ channel: "email", subject: "Despotiko at sunset", body: good, touch_type: "itinerary_idea" }, ctx).some((x) => x.includes("used last time")));
});

const base = { status: "sent", hasOutbound: true, ball: "client_owes" as const, lastInboundText: "", lastInboundAt: null, hadInbound: false, consecutiveUnanswered: 2, clientFollowupDate: null, nowIso: "2026-11-16T10:00:00Z" };

test("3. seven unanswered → breakup (POST_7)", () => {
  assert.equal(scenarioHint({ ...base, consecutiveUnanswered: 7 }).code, "S9");
});
test("4. replied, then three+ days of silence → GHOSTED", () => {
  assert.equal(scenarioHint({ ...base, hadInbound: true, lastInboundAt: "2026-11-10T10:00:00Z" }).code, "S7");
  assert.equal(scenarioHint({ ...base, hadInbound: true, lastInboundAt: "2026-11-15T10:00:00Z" }).code, "S3");
});
test("5. a discount ask with the ball in our court → DISCOUNT", () => {
  assert.equal(scenarioHint({ ...base, ball: "we_owe", lastInboundText: "Could you do 20% off? It is a bit high for us." }).code, "S4");
});
test("opt-out stops everything", () => {
  assert.equal(scenarioHint({ ...base, ball: "we_owe", lastInboundText: "Please remove me from your list" }).code, "S0");
});
test("6. client asked for a date → CLIENT_SCHEDULED", () => {
  assert.equal(scenarioHint({ ...base, clientFollowupDate: "2027-01-04" }).code, "S6");
});

test("client text: no Greek, no 'I hope this finds you', no 'circle back'", () => {
  const p = checkDraft({ channel: "email", subject: "Μια νέα ματιά", body: good.replace("Hi Michael, a small idea", "Hi Michael, I hope this finds you well. I will circle back. A small idea") }, ctx);
  assert.ok(p.some((x) => x.includes("Greek")));
  assert.ok(p.some((x) => x.includes("i hope this finds you")));
  assert.ok(p.some((x) => x.includes("circle back")));
});

test("yacht feature claims must be in that yacht's data (the FREEDOM stabiliser case)", () => {
  const yachts = [
    { name: "RED ROSE", text: JSON.stringify({ highlights: ["Stabilizers underway & zero speed"] }).toLowerCase() },
    { name: "FREEDOM", text: JSON.stringify({ highlights: ["Jacuzzi on deck"] }).toLowerCase() },
  ];
  const bad = featureClaims("RED ROSE and FREEDOM both have stabilisers for comfort.", yachts);
  assert.equal(bad.length, 1);
  assert.ok(bad[0].includes("FREEDOM"));
  assert.deepEqual(featureClaims("For FREEDOM I am confirming the stabilisers with her captain.", yachts), []);
  assert.deepEqual(featureClaims("FREEDOM has a jacuzzi on deck.", yachts), []);
});

test("soft scarcity and 'my team' are refused", () => {
  const p = checkDraft({ channel: "email", subject: "Looking ahead to 2027", body: good.replace("Would a draft", "Calendars fill up early and my team can secure your yacht now. Would a draft") }, ctx);
  assert.ok(p.some((x) => x.startsWith("soft scarcity")));
  assert.ok(p.some((x) => x.includes("works alone")));
});

test("George's own breakup is not an opt-out: it moves the lead to nurture", () => {
  const h = scenarioHint({ ...base, hadInbound: true, lastInboundAt: "2026-09-14T10:00:00Z", lastOutboundText: "Have you set the Greece plan aside for this year? Totally fine if so. I'll close the file on my side." });
  assert.equal(h.code, "S10");
});
