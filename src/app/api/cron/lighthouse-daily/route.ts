// @ts-nocheck
import { tagSiteLinks } from "@/lib/utm";
import { NextResponse } from "next/server";
import { gmailFetch, getSetting, setSetting } from "@/lib/google-api";
import { observeCron } from "@/lib/cron-observer";
import { loadPeople } from "@/lib/lighthouse";
import { buildCalendar } from "@/lib/aftersales/plan";
import { baseText } from "@/lib/aftersales/templates";
import { addDays } from "@/lib/aftersales/dates";
import { createServiceClient } from "@/lib/supabase-server";
import { createSeasonEdition } from "@/lib/helm/season-edition";

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
  textBody = tagSiteLinks(textBody, { source: "lighthouse", campaign: "lighthouse-daily" });
  htmlBody = tagSiteLinks(htmlBody, { source: "lighthouse", campaign: "lighthouse-daily" });
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

async function handler() {
  // 2026-11-25: ONE SYSTEM. The morning page now reads the After sales
  // calendar (the research of 25/11/2026), the same list the Lighthouse
  // shows: what is due today with the text it starts from, what comes
  // tomorrow, a charter waiting on "Λύθηκε", and on Sundays the week ahead.
  // The old per-occasion drafts and mass holidays are retired.
  const cal = await buildCalendar({ horizonDays: 8 });
  const todayIso = cal.today;
  const tomorrowIso = addDays(todayIso, 1);
  const athens = new Date(new Date().toLocaleDateString("en-US", { timeZone: "Europe/Athens" }));
  const byKey = new Map([...cal.charters, ...cal.lost].map((c) => [c.key, c]));
  const textOf = (t) => {
    if (t.state?.body) return { subject: t.state.subject ?? "", body: t.state.body };
    const c = byKey.get(t.charter_key);
    if (!c) return null;
    const variant = Math.max(0, c.people.findIndex((x) => x.email === t.person.email));
    return baseText(t.kind, c, t.person, { problem_note: c.problem.note, variant, due: t.due });
  };
  const isLost = (t) => t.kind.startsWith("lost_");
  const todayT = cal.touches.filter((t) => (t.status === "due" || t.status === "generated") && t.due <= todayIso);
  const waitingT = cal.touches.filter((t) => (t.status === "waiting" || t.status === "held") && t.due <= todayIso);
  const tomorrowT = cal.touches.filter((t) => t.status === "upcoming" && t.due === tomorrowIso);
  const weekIso = addDays(todayIso, 7);
  const headsUpT = cal.touches.filter((t) => t.status === "upcoming" && t.due === weekIso && t.kind === "birthday");
  const isSunday = athens.getDay() === 0;
  const weekT = cal.touches.filter((t) => t.status === "upcoming" && t.due > todayIso && t.due <= weekIso);
  const overdue = cal.charters.filter((c) => c.problem.overdue);

  // January, Mondays (George, 2 October 2026): the annual edition for every
  // client who sailed with us. One tap per card in the Lighthouse prepares
  // the draft; this is the reminder that the season has opened.
  const isJanuary = athens.getMonth() === 0;
  const isMonday = athens.getDay() === 1;
  let seasonClients = [];
  // The first Monday of January the drafts are CREATED here, one per past
  // client, so the morning email carries links to editions already written;
  // the later Mondays only remind. Idempotent: a draft that exists for the
  // year is not made twice.
  let seasonDrafts = [];
  if (isJanuary && isMonday) {
    try {
      const { people } = await loadPeople();
      seasonClients = people.filter((p) => p.won && p.email && p.charter_vessel);
      if (athens.getDate() <= 7 && seasonClients.length) {
        const year = athens.getFullYear();
        const sb = createServiceClient();
        for (const p of seasonClients) {
          try {
            const { data: exists } = await sb
              .from("helm_requests")
              .select("id")
              .ilike("client_email", p.email)
              .eq("extraction->>source", "season_edition")
              .eq("extraction->>season_year", String(year))
              .limit(1)
              .maybeSingle();
            if (exists) { seasonDrafts.push({ name: p.name, id: exists.id, fresh: false }); continue; }
            const made = await createSeasonEdition({ email: p.email, year, actorEmail: "lighthouse-daily" });
            seasonDrafts.push({ name: p.name, id: made.id, fresh: true });
          } catch {}
        }
      }
    } catch {}
  }

  const total = todayT.length + tomorrowT.length + waitingT.length + headsUpT.length + overdue.length + seasonClients.length;
  if (total === 0 && !(isSunday && weekT.length)) {
    return NextResponse.json({ skipped: "nothing today or tomorrow" });
  }

  const LINK = "https://command.georgeyachts.com/dashboard/lighthouse";
  const touchCard = (t, when) => {
    const d = textOf(t);
    return `
  <div style="background:#ffffff;border:1px solid ${G.line};border-left:3px solid ${G.gold};border-radius:6px;padding:14px 16px;margin:0 0 12px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:${G.navy};"><strong>${esc(t.person.full_name || t.person.first_name)}</strong> · ${esc(t.kind_el)} ${when === "today" ? "ΣΗΜΕΡΑ" : "αύριο"}${t.vessel ? ` · ${esc(t.vessel)}` : ""}</p>
    <p style="margin:4px 0 8px;font-size:12px;color:${G.soft};">${esc(t.person.email)}</p>
    ${d ? `<div style="background:${G.bg};border-radius:5px;padding:10px 12px;">
      <p style="margin:0 0 4px;font-size:12px;color:${G.soft};">Θέμα: <strong style="color:${G.ink};">${esc(d.subject)}</strong></p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:${G.ink};white-space:pre-wrap;">${esc(d.body)}</p>
    </div>` : ""}
    <p style="margin:8px 0 0;font-size:12px;"><a href="${LINK}" style="color:${G.gold};font-weight:bold;text-decoration:none;">${when === "today" ? "Generate και Send στο Lighthouse" : "Δες το στο Lighthouse"} &rarr;</a></p>
  </div>`;
  };
  const waveCard = (items, when) => `
  <div style="background:${G.navy};border-radius:6px;padding:14px 16px;margin:0 0 12px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:15px;color:#ffffff;"><strong style="color:${G.gold};">Οι χαμένοι</strong> ${when === "today" ? "ΣΗΜΕΡΑ" : "αύριο"} · ${items.length} προσωπικά σημειώματα</p>
    <p style="margin:4px 0 8px;font-size:12px;color:#97A5B2;">${esc(items.slice(0, 6).map((t) => t.person.first_name).join(", "))}${items.length > 6 ? "…" : ""}</p>
    <p style="margin:0;font-size:12px;"><a href="${LINK}" style="color:${G.gold};font-weight:bold;text-decoration:none;">Άνοιξε το Lighthouse &rarr;</a></p>
  </div>`;
  const line = (html) => `
  <div style="background:#ffffff;border:1px solid ${G.line};border-radius:6px;padding:10px 16px;margin:0 0 8px;">
    <p style="margin:0;font-size:13px;color:${G.ink};">${html}</p>
  </div>`;

  const htmlParts = [];
  const textParts = [];
  const sec = (title, items) => {
    if (!items.length) return;
    htmlParts.push(`<p style="font-family:Georgia,serif;font-size:12px;letter-spacing:2px;color:${G.soft};text-transform:uppercase;margin:18px 0 8px;">${esc(title)}</p>`);
    htmlParts.push(...items);
  };
  const cards = (list, when) => {
    const lost = list.filter(isLost);
    return [...list.filter((t) => !isLost(t)).map((t) => touchCard(t, when)), ...(lost.length ? [waveCard(lost, when)] : [])];
  };
  sec("Σήμερα", cards(todayT, "today"));
  sec("Περιμένουν", [
    ...waitingT.map((t) => line(`<strong style="color:${G.navy};">${esc(t.person.first_name)}</strong> · ${esc(t.kind_el)} · ${esc(t.reason_el)}`)),
    ...overdue.map((c) => line(`<strong style="color:${G.navy};">${esc(c.vessel)}</strong>: «Κάτι πήγε στραβά» περιμένει πάνω από 10 μέρες. Όταν λυθεί, πάτα «Λύθηκε» στο <a href="${LINK}" style="color:${G.gold};">Lighthouse</a>.`)),
  ]);
  sec("Αύριο, για να προλάβεις", cards(tomorrowT, "tomorrow"));
  sec("Σε μία εβδομάδα, για να προλάβεις κάτι καλό", headsUpT.map((t) => line(`<strong style="color:${G.navy};">${esc(t.person.full_name || t.person.first_name)}</strong> · ${esc(t.kind_el)} στις ${esc(t.due)}${t.vessel ? ` · ${esc(t.vessel)}` : ""}`)));
  sec(
    "Ετήσιες εκδόσεις: η σεζόν άνοιξε",
    seasonClients.map((p) => {
      const d = seasonDrafts.find((x) => x.name === p.name);
      const link = d ? `https://command.georgeyachts.com/dashboard/helm/${d.id}` : LINK;
      const verb = d ? (d.fresh ? "το πρόχειρο γράφτηκε, άνοιξέ το και στείλ' το" : "το πρόχειρο υπάρχει στο Helm") : "ετοίμασε την έκδοση";
      return `
  <div style="background:#ffffff;border:1px solid ${G.line};border-left:3px solid ${G.gold};border-radius:6px;padding:12px 16px;margin:0 0 10px;">
    <p style="margin:0;font-family:Georgia,serif;font-size:14px;color:${G.navy};"><strong>${esc(p.name)}</strong> · ${esc(p.charter_vessel)}${p.travel_from ? ` · ${esc(String(p.travel_from).slice(0, 10))}` : ""} · <a href="${link}" style="color:${G.gold};font-weight:bold;text-decoration:none;">${verb} &rarr;</a></p>
  </div>`;
    }),
  );
  if (isSunday && weekT.length) {
    const lostWeek = weekT.filter(isLost);
    sec("Η εβδομάδα μπροστά σου", [
      ...weekT.filter((t) => !isLost(t)).map((t) => line(`<strong style="color:${G.navy};">${esc(t.due.slice(5))}</strong> · ${esc(t.person.first_name)} · ${esc(t.kind_el)}`)),
      ...(lostWeek.length ? [line(`Οι χαμένοι: ${lostWeek.length} σημειώματα αυτή την εβδομάδα`)] : []),
    ]);
  }

  for (const t of todayT.filter((x) => !isLost(x))) {
    const d = textOf(t);
    textParts.push(`ΣΗΜΕΡΑ: ${t.person.first_name}, ${t.kind_el}.${d ? ` Θέμα: ${d.subject}\n${d.body}` : ""}`);
  }
  if (todayT.some(isLost)) textParts.push(`ΣΗΜΕΡΑ: οι χαμένοι, ${todayT.filter(isLost).length} σημειώματα.`);
  for (const t of tomorrowT.filter((x) => !isLost(x))) textParts.push(`Αύριο: ${t.person.first_name}, ${t.kind_el}.`);

  const subject = todayT.length
    ? `Lighthouse: ${todayT.length} σήμερα`
    : tomorrowT.length
      ? `Lighthouse: ετοιμάσου για αύριο (${tomorrowT.length})`
      : isSunday
        ? `Lighthouse: η εβδομάδα μπροστά σου (${weekT.length})`
        : `Lighthouse: ενημέρωση`;

  // 2026-09-11: leave a snapshot for the engines digest, which reports
  // "τελευταία εκτέλεση" from each engine's own record. Best-effort.
  try {
    await setSetting(
      "lighthouse_daily_latest",
      JSON.stringify({
        generated_at: new Date().toISOString(),
        today: todayT.length,
        tomorrow: tomorrowT.length,
        week: weekT.length,
        subject,
        // 2026-10-03: the morning brief folds this page in whole.
        html_inner: htmlParts.join(""),
        text: textParts.join("\n\n"),
      }),
    );
  } catch {}

  const html = `
  <div style="background:${G.bg};padding:28px 12px;">
    <div style="max-width:640px;margin:0 auto;">
      <p style="font-family:Georgia,serif;font-size:13px;letter-spacing:3px;color:${G.gold};text-transform:uppercase;margin:0 0 2px;">The Lighthouse</p>
      <h1 style="font-family:Georgia,serif;font-size:22px;color:${G.navy};margin:0 0 16px;">Οι άνθρωποί σου σήμερα</h1>
      ${htmlParts.join("")}
      <p style="font-size:12px;color:${G.soft};margin:16px 0 0;">Στο <a href="${LINK}" style="color:${G.gold};">Lighthouse</a> πατάς Generate, διαβάζεις, και Send. Τίποτα δεν φεύγει μόνο του.</p>
    </div>
  </div>`;

  // 2026-10-03: ONE morning email. When the morning brief is on (default),
  // this page travels inside it (snapshot above) and is not sent on its own.
  const briefOn = ((await getSetting("morning_brief_enabled")) ?? "1").trim() !== "0";
  if (briefOn) {
    return NextResponse.json({ ok: true, folded_into_morning_brief: true, today: todayT.length, tomorrow: tomorrowT.length });
  }
  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail(GEORGE, subject, textParts.join("\n\n"), html) }),
  });
  if (!res.ok) return NextResponse.json({ error: `gmail ${res.status}` });
  return NextResponse.json({ ok: true, today: todayT.length, tomorrow: tomorrowT.length });
}

export async function GET() {
  return observeCron("lighthouse-daily", handler);
}
