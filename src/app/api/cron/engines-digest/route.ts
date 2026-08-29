// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch, getSetting } from "@/lib/google-api";
import { observeCron } from "@/lib/cron-observer";

// ENGINES DIGEST — George's daily proof-of-life email (order 29/8:
// "θέλω να ειδοποιούμαι αν λειτούργησε, τι έκανε, ή δεν λειτούργησε").
//
// The article engine once died silently and George found out from the
// blog three hours later. This mail exists so no engine can ever fail
// quietly again: every morning it lists what ran in the last 24h with
// its real output, and — the important half — what was SCHEDULED and
// left no trace at all.
//
// Reads the cron-observer records (settings cron_end_*) plus each
// tool's own snapshot for the human numbers. One email, in Greek,
// from George's own Gmail to George.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const GEORGE = "george@georgeyachts.com";

// Which engine is EXPECTED on which weekday (0=Sunday … 6=Saturday),
// mirrored from vercel.json. If a schedule changes there, change it
// here too — the digest's whole value is knowing what SHOULD have run.
const EXPECTED = [
  { cron: "serp-snapshot", label: "SERP snapshot (θέσεις + αντίπαλοι)", days: [1, 2, 3, 4, 5] },
  { cron: "backlink-send", label: "Backlink pitch (cloud αποστολέας)", days: [1, 2, 3, 4, 5] },
  { cron: "llm-mentions-weekly", label: "LLM Mentions σάρωση", days: [0] },
  { cron: "backlink-gap-weekly", label: "Backlink gap", days: [1] },
  { cron: "web-mentions-weekly", label: "Web mentions", days: [3] },
];

function rawEmail(to, subject, body) {
  const boundary = "boundary_" + Date.now();
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    body.replace(/\n/g, "<br>"),
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// The tool snapshots carry the human-readable numbers; the observer
// records only prove the run happened.
async function engineDetail(cron) {
  try {
    if (cron === "serp-snapshot") {
      const s = JSON.parse((await getSetting("serp_tracker_latest")) || "null");
      if (!s) return null;
      return `${s.found_in_top30}/${s.queries} στο top 30, μέση θέση όπου υπάρχουμε ${s.avg_position_when_found ?? "-"}`;
    }
    if (cron === "backlink-send") {
      const q = JSON.parse((await getSetting("backlink_pitch_queue")) || "[]");
      const today = new Date().toISOString().slice(0, 10);
      const sent = q.find(
        (i) => i.status === "sent" && String(i.sent_at ?? "").slice(0, 10) === today,
      );
      const ready = q.filter((i) => i.status === "ready").length;
      return sent
        ? `εστάλη στο ${sent.to} («${String(sent.subject).slice(0, 60)}»), ${ready} έτοιμα στη θήκη`
        : `καμία αποστολή σήμερα, ${ready} έτοιμα στη θήκη`;
    }
    if (cron === "llm-mentions-weekly") {
      const s = JSON.parse((await getSetting("llm_mentions_latest")) || "null");
      if (!s) return null;
      const us = (s.domains || []).find((d) => d.domain === "georgeyachts.com");
      return `εμείς σε ${us?.total ?? "?"} prompts, ${(s.opportunities || []).length} ευκαιρίες στη GEO λίστα`;
    }
    if (cron === "backlink-gap-weekly") {
      const s = JSON.parse((await getSetting("backlink_gap_latest")) || "null");
      if (!s) return null;
      return `${(s.candidates || []).length} καθαροί στόχοι, εμείς ${s.ours?.referring_domains} ref domains`;
    }
    if (cron === "web-mentions-weekly") {
      const s = JSON.parse((await getSetting("web_mentions_latest")) || "null");
      if (!s) return null;
      return `${s.total} αναφορές μας στο web`;
    }
  } catch {}
  return null;
}

async function handler() {
  const sb = createServiceClient();
  // 12h window: the digest fires at 08:45 UTC, after every one of the
  // day's cloud slots (05:00-08:15 UTC) has had its chance.
  const since = new Date(Date.now() - 12 * 3600000).toISOString();
  const { data: rows } = await sb
    .from("settings")
    .select("key,value")
    .like("key", "cron_end_%")
    .gte("updated_at", since)
    .limit(500);

  const runsByName = new Map();
  for (const r of rows ?? []) {
    try {
      const v = JSON.parse(r.value);
      const list = runsByName.get(v.name) ?? [];
      list.push(v);
      runsByName.set(v.name, list);
    } catch {}
  }

  const athensNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Athens" }));
  const todayDow = athensNow.getDay();

  const ok = [];
  const failed = [];
  const missing = [];
  for (const e of EXPECTED) {
    if (!e.days.includes(todayDow)) continue;
    const runs = runsByName.get(e.cron) ?? [];
    const success = runs.find((r) => r.outcome === "success");
    const skippedRun = runs.find((r) => r.outcome === "skipped");
    const errorRun = runs.find((r) => r.outcome === "error");
    const detail = await engineDetail(e.cron);
    if (success || skippedRun) {
      ok.push(`OK  ${e.label}${detail ? ` — ${detail}` : ""}${skippedRun && !success ? " (παραλείφθηκε με λόγο: " + (skippedRun.detail ?? "-") + ")" : ""}`);
    } else if (errorRun) {
      failed.push(`ΣΦΑΛΜΑ  ${e.label} — ${errorRun.detail ?? "χωρίς λεπτομέρεια"}`);
    } else if (runs.length === 0) {
      missing.push(`ΔΕΝ ΕΤΡΕΞΕ  ${e.label} — ήταν προγραμματισμένο και δεν άφησε ίχνος`);
    }
  }

  const dstr = athensNow.toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" });
  const problems = failed.length + missing.length;
  const subject = problems
    ? `Μηχανές GY: ${problems} πρόβλημα(τα) — ${dstr}`
    : `Μηχανές GY: όλα έτρεξαν — ${dstr}`;

  const body = [
    `Καθημερινή αναφορά μηχανών, ${dstr}, ${athensNow.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })} ώρα Αθήνας.`,
    "",
    ...(failed.length ? ["ΠΡΟΒΛΗΜΑΤΑ:", ...failed, ""] : []),
    ...(missing.length ? ["ΑΓΝΟΟΥΝΤΑΙ:", ...missing, ""] : []),
    ...(ok.length ? ["ΕΤΡΕΞΑΝ:", ...ok, ""] : []),
    "Λεπτομέρειες: command.georgeyachts.com → Brand Radar.",
    "Η μηχανή άρθρων (τοπική, Τρ/Πεμ/Σαβ 10:00) έχει δικό της φύλακα στις 13:00.",
  ].join("\n");

  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail(GEORGE, subject, body) }),
  });
  if (!res.ok) return NextResponse.json({ error: `gmail ${res.status}` });
  return NextResponse.json({ ok: true, problems, ran: ok.length });
}

export async function GET() {
  return observeCron("engines-digest", handler);
}
