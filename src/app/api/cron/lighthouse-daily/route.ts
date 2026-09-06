// @ts-nocheck
import { NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";
import { observeCron } from "@/lib/cron-observer";
import { upcomingOccasions, draftFor, occasionKey } from "@/lib/lighthouse";

// The Lighthouse daily reminder — George's brief verbatim (29/8):
// "να με ειδοποιεί με email μία ημέρα πριν από κάθε γεγονός και την
// ίδια μέρα, και να μου έχει και ένα draft".
//
// Runs 04:30 UTC (07:30 Athens) so the reminder is waiting with his
// coffee. Emails ONLY George; personal wishes leave by his hand, mass
// holidays by his approval in the dashboard. Quiet days send nothing:
// no occasions, no email (his explicit preference from the watchdog
// design: όχι καθημερινό "όλα καλά").
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const GEORGE = "george@georgeyachts.com";
const G = { navy: "#0D1B2A", gold: "#DAA110", ink: "#26313D", soft: "#5A6874", line: "#E4E0D5", bg: "#FAF8F3" };
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function rawEmail(to, subject, textBody, htmlBody) {
  const boundary = "boundary_" + Date.now();
  return Buffer.from(
    [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      textBody,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "",
      htmlBody,
      `--${boundary}--`,
    ].join("\r\n"),
  ).toString("base64url");
}

function occasionCard(o, when) {
  const d = o.draft;
  const who = o.person?.name ?? "";
  const detail = o.person?.vessel ? ` · πελάτης ${o.person.vessel}` : "";
  return `
  <div style="background:#ffffff;border:1px solid ${G.line};border-left:3px solid ${G.gold};border-radius:6px;padding:14px 16px;margin:0 0 12px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:${G.navy};"><strong>${esc(who)}</strong> · ${esc(o.label)} ${when === "today" ? "ΣΗΜΕΡΑ" : "αύριο"}${esc(detail)}</p>
    ${o.person?.email ? `<p style="margin:4px 0 8px;font-size:12px;color:${G.soft};">${esc(o.person.email)}</p>` : `<p style="margin:4px 0 8px;font-size:12px;color:#A33526;">χωρίς email, θέλει τηλέφωνο ή μήνυμα</p>`}
    <div style="background:${G.bg};border-radius:5px;padding:10px 12px;">
      <p style="margin:0 0 4px;font-size:12px;color:${G.soft};">Θέμα: <strong style="color:${G.ink};">${esc(d.subject)}</strong></p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:${G.ink};white-space:pre-wrap;">${esc(d.body)}</p>
    </div>
  </div>`;
}

async function handler() {
  // 8-day window: today + tomorrow for action, day 3 for holiday
  // unlocks, day 7 for the birthday heads-up, and the whole week for
  // the Sunday review (George's picks 1, 2 and 7, 29/8).
  const occ = await upcomingOccasions(8);
  const athens = new Date(new Date().toLocaleDateString("en-US", { timeZone: "Europe/Athens" }));
  const todayIso = new Date(Date.UTC(athens.getFullYear(), athens.getMonth(), athens.getDate()))
    .toISOString()
    .slice(0, 10);
  const tomorrowIso = new Date(Date.parse(todayIso) + 86400000).toISOString().slice(0, 10);

  const fresh = (o) => !occ.sent[occasionKey(o)];
  const todayP = occ.personal.filter((o) => o.date === todayIso && fresh(o)).map((o) => ({ ...o, draft: draftFor(o) }));
  const tomorrowP = occ.personal.filter((o) => o.date === tomorrowIso && fresh(o)).map((o) => ({ ...o, draft: draftFor(o) }));
  const todayH = occ.holidays.filter((h) => h.date === todayIso && !occ.sent[`all:${h.kind}:${h.date.slice(0, 4)}`]);
  const tomorrowH = occ.holidays.filter((h) => h.date === tomorrowIso && !occ.sent[`all:${h.kind}:${h.date.slice(0, 4)}`]);

  // Κουμπιά που ξεκλειδώνουν σήμερα (γιορτή σε ακριβώς 3 μέρες)
  const unlockIso = new Date(Date.parse(todayIso) + 3 * 86400000).toISOString().slice(0, 10);
  const unlocksH = occ.holidays.filter((h) => h.date === unlockIso && !occ.sent[`all:${h.kind}:${h.date.slice(0, 4)}`]);
  // Προσωπικά σε ακριβώς 7 μέρες: χρόνος για κάτι παραπάνω από ευχή
  const weekIso = new Date(Date.parse(todayIso) + 7 * 86400000).toISOString().slice(0, 10);
  const headsUpP = occ.personal.filter((o) => o.date === weekIso && fresh(o));
  // Κυριακή: σύνοψη ολόκληρης της εβδομάδας, στέλνεται ακόμα κι αν
  // σήμερα/αύριο είναι ήσυχα
  const isSunday = athens.getDay() === 0;
  const weekAllP = occ.personal.filter((o) => o.date > todayIso && fresh(o));
  const weekAllH = occ.holidays.filter((h) => h.date > todayIso && !occ.sent[`all:${h.kind}:${h.date.slice(0, 4)}`]);

  const total = todayP.length + tomorrowP.length + todayH.length + tomorrowH.length + unlocksH.length + headsUpP.length;
  if (total === 0 && !(isSunday && (weekAllP.length + weekAllH.length))) {
    return NextResponse.json({ skipped: "no occasions today or tomorrow" });
  }

  const holidayCard = (h, when) => `
  <div style="background:${G.navy};border-radius:6px;padding:14px 16px;margin:0 0 12px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#ffffff;"><strong style="color:${G.gold};">${esc(h.label)}</strong> ${when === "today" ? "ΣΗΜΕΡΑ" : "αύριο"} · ${h.recipients} παραλήπτες</p>
    <p style="margin:4px 0 8px;font-size:12px;color:#97A5B2;">${esc((h.sample ?? h.names ?? []).slice(0, 5).join(", "))}${h.recipients > 5 ? "…" : ""}</p>
    <p style="margin:0;font-size:12px;"><a href="https://command.georgeyachts.com/dashboard/lighthouse" style="color:${G.gold};font-weight:bold;text-decoration:none;">Άνοιξε το Lighthouse για έγκριση με ένα κλικ &rarr;</a></p>
  </div>`;

  const htmlParts = [];
  const textParts = [];
  const sec = (title, items, render) => {
    if (!items.length) return;
    htmlParts.push(`<p style="font-family:Georgia,serif;font-size:12px;letter-spacing:2px;color:${G.soft};text-transform:uppercase;margin:18px 0 8px;">${esc(title)}</p>`);
    htmlParts.push(...items.map(render));
  };
  sec("Σήμερα", [...todayP.map((o) => occasionCard(o, "today")), ...todayH.map((h) => holidayCard(h, "today"))], (x) => x);
  sec("Αύριο, για να προλάβεις", [...tomorrowP.map((o) => occasionCard(o, "tomorrow")), ...tomorrowH.map((h) => holidayCard(h, "tomorrow"))], (x) => x);
  sec(
    "Ανοίγει σήμερα το κουμπί",
    unlocksH.map((h) => `
  <div style="background:#ffffff;border:1px solid ${G.line};border-left:3px solid ${G.gold};border-radius:6px;padding:12px 16px;margin:0 0 10px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:${G.navy};"><strong style="color:${G.gold};">${esc(h.label)}</strong> σε 3 μέρες (${esc(h.date)}) · ${h.recipients} άτομα · <a href="https://command.georgeyachts.com/dashboard/lighthouse" style="color:${G.gold};font-weight:bold;text-decoration:none;">έγκριση εδώ &rarr;</a></p>
  </div>`),
    (x) => x,
  );
  sec(
    "Σε μία εβδομάδα, για να προλάβεις κάτι καλό",
    headsUpP.map((o) => `
  <div style="background:#ffffff;border:1px solid ${G.line};border-radius:6px;padding:12px 16px;margin:0 0 10px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:${G.navy};"><strong>${esc(o.person?.name ?? "")}</strong> · ${esc(o.label)} στις ${esc(o.date)}${o.person?.vessel ? ` · πελάτης ${esc(o.person.vessel)}` : ""}</p>
  </div>`),
    (x) => x,
  );
  if (isSunday && (weekAllP.length || weekAllH.length)) {
    sec(
      "Η εβδομάδα μπροστά σου",
      [
        ...weekAllP.map((o) => `
  <div style="background:#ffffff;border:1px solid ${G.line};border-radius:6px;padding:10px 16px;margin:0 0 8px;">
    <p style="margin:0;font-size:13px;color:${G.ink};"><strong style="color:${G.navy};">${esc(o.date.slice(5))}</strong> · ${esc(o.person?.name ?? "")} · ${esc(o.label)}</p>
  </div>`),
        ...weekAllH.map((h) => `
  <div style="background:#ffffff;border:1px solid ${G.line};border-radius:6px;padding:10px 16px;margin:0 0 8px;">
    <p style="margin:0;font-size:13px;color:${G.ink};"><strong style="color:${G.navy};">${esc(h.date.slice(5))}</strong> · ${esc(h.label)} · ${h.recipients} άτομα</p>
  </div>`),
      ],
      (x) => x,
    );
  }

  for (const o of [...todayP, ...tomorrowP]) {
    textParts.push(`${o.date === todayIso ? "ΣΗΜΕΡΑ" : "Αύριο"}: ${o.person.name}, ${o.label}. Θέμα: ${o.draft.subject}\n${o.draft.body}`);
  }
  for (const h of [...todayH, ...tomorrowH]) {
    textParts.push(`${h.date === todayIso ? "ΣΗΜΕΡΑ" : "Αύριο"}: ${h.label}, ${h.recipients} παραλήπτες. Έγκριση στο dashboard/lighthouse.`);
  }

  const subject = todayP.length + todayH.length
    ? `Lighthouse: ${todayP.length + todayH.length} ευχές σήμερα`
    : tomorrowP.length + tomorrowH.length
      ? `Lighthouse: ετοιμάσου για αύριο (${tomorrowP.length + tomorrowH.length})`
      : unlocksH.length
        ? `Lighthouse: άνοιξε το κουμπί για ${unlocksH[0].label}`
        : isSunday
          ? `Lighthouse: η εβδομάδα μπροστά σου (${weekAllP.length + weekAllH.length})`
          : `Lighthouse: σε μία εβδομάδα`;

  const html = `
  <div style="background:${G.bg};padding:28px 12px;">
    <div style="max-width:640px;margin:0 auto;">
      <p style="font-family:Georgia,serif;font-size:13px;letter-spacing:3px;color:${G.gold};text-transform:uppercase;margin:0 0 2px;">The Lighthouse</p>
      <h1 style="font-family:Georgia,serif;font-size:22px;color:${G.navy};margin:0 0 16px;">Οι άνθρωποί σου σήμερα</h1>
      ${htmlParts.join("")}
      <p style="font-size:12px;color:${G.soft};margin:16px 0 0;">Αντιγράφεις το draft, το στέλνεις από το mail σου, και πατάς «Το έστειλα» στο <a href="https://command.georgeyachts.com/dashboard/lighthouse" style="color:${G.gold};">Lighthouse</a> για να γραφτεί στο ιστορικό.</p>
    </div>
  </div>`;

  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail(GEORGE, subject, textParts.join("\n\n"), html) }),
  });
  if (!res.ok) return NextResponse.json({ error: `gmail ${res.status}` });
  return NextResponse.json({ ok: true, today: todayP.length + todayH.length, tomorrow: tomorrowP.length + tomorrowH.length });
}

export async function GET() {
  return observeCron("lighthouse-daily", handler);
}
