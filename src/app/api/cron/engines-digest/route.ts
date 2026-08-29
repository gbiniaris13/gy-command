// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch, getSetting } from "@/lib/google-api";
import { observeCron } from "@/lib/cron-observer";

// ENGINES DIGEST v2 — George's daily analysis email, 11:45 Athens.
//
// v1 (morning of 29/8) reported only the day's slate, so a Saturday
// mail arrived empty and George said exactly what was wrong with it:
// "θέλω ανάλυση: τι έτρεξε, τι έκανε, πού να το δω, ποια είναι τα
// αποτελέσματα". So v2 reports EVERY engine EVERY day: when it last
// ran, what it produced (real numbers from its own snapshot), where
// to see it — and flags today's scheduled ones that failed or left
// no trace. It also opens with the fixed-cohort Google position from
// the truth endpoint, the one number that is comparable day to day.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const GEORGE = "george@georgeyachts.com";
const RADAR = "command.georgeyachts.com -> Brand Radar";

// Mirrors vercel.json — change them TOGETHER. days: 0=Sunday…6=Saturday.
const ENGINES = [
  { cron: "serp-snapshot", label: "SERP tracker (θέσεις + αντίπαλοι, ΗΠΑ)", days: [1, 2, 3, 4, 5], where: `${RADAR} -> Google -> LIVE SERP` },
  { cron: "backlink-send", label: "Backlink pitch (cloud αποστολέας)", days: [1, 2, 3, 4, 5], where: "Gmail -> Απεσταλμένα" },
  { cron: "llm-mentions-weekly", label: "LLM Mentions (ποιον παραθέτουν τα AI)", days: [0], where: `${RADAR} -> Mentions` },
  { cron: "backlink-gap-weekly", label: "Backlink gap (στόχοι συνδέσμων)", days: [1], where: `${RADAR} -> Authority` },
  { cron: "web-mentions-weekly", label: "Web mentions (ποιος μας γράφει)", days: [3], where: `${RADAR} -> Authority` },
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
    `<div style="font-family:monospace;white-space:pre-wrap;">${body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</div>`,
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

function ago(iso, now) {
  if (!iso) return "ποτέ";
  const h = Math.round((now - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "πριν από λίγο";
  if (h < 24) return `πριν ${h} ώρες`;
  const d = Math.round(h / 24);
  return d === 1 ? "χθες" : `πριν ${d} μέρες`;
}

// Per-engine analysis lines, from each tool's own stored snapshot.
async function engineReport(cron, now) {
  try {
    if (cron === "serp-snapshot") {
      const s = JSON.parse((await getSetting("serp_tracker_latest")) || "null");
      if (!s) return { at: null, lines: ["καμία σάρωση αποθηκευμένη ακόμα"] };
      const best = (s.results || []).filter((r) => r.position !== null).slice(0, 3);
      const lines = [
        `${s.found_in_top30}/${s.queries} ερωτήματα στο top 30 της αμερικανικής Google, μέση θέση όπου υπάρχουμε ${s.avg_position_when_found ?? "-"}`,
      ];
      for (const r of best) {
        const delta =
          r.prev_position != null && r.prev_position !== r.position
            ? ` (ήταν ${r.prev_position})`
            : "";
        lines.push(`  #${r.position}${delta} «${r.query}», μπροστά μας: ${(r.above || []).slice(0, 2).join(", ") || "κανείς"}`);
      }
      return { at: s.generated_at, lines };
    }
    if (cron === "backlink-send") {
      const q = JSON.parse((await getSetting("backlink_pitch_queue")) || "[]");
      const sent = q
        .filter((i) => i.status === "sent" && i.sent_at)
        .sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1));
      const last = sent[0];
      const ready = q.filter((i) => i.status === "ready").length;
      const week = sent.filter((i) => now - new Date(i.sent_at).getTime() < 7 * 86400000).length;
      const lines = last
        ? [
            `τελευταίο pitch στο ${last.to} («${String(last.subject).slice(0, 55)}»)`,
            `  ${week} αποστολές το 7ήμερο, ${ready} έτοιμα στη θήκη, ${q.filter((i) => i.status === "held").length} στην ουρά`,
          ]
        : ["καμία αποστολή καταγεγραμμένη"];
      return { at: last?.sent_at ?? null, lines };
    }
    if (cron === "llm-mentions-weekly") {
      const s = JSON.parse((await getSetting("llm_mentions_latest")) || "null");
      if (!s) return { at: null, lines: ["καμία σάρωση ακόμα"] };
      const tot = Object.fromEntries((s.domains || []).map((d) => [d.domain, d.total]));
      const topOpp = (s.opportunities || [])[0];
      const lines = [
        `τα AI μάς παραθέτουν σε ${tot["georgeyachts.com"] ?? "?"} prompts (mygreekcharter ${tot["mygreekcharter.com"] ?? "?"}, ionian-charter ${tot["ionian-charter.com"] ?? "?"}, istion ${tot["istionluxuryyachts.com"] ?? "?"}, 12knots ${tot["12knots.com"] ?? "?"})`,
        `  ${(s.opportunities || []).length} prompts στη GEO λίστα (αυτοί ναι, εμείς όχι)${topOpp ? `, κορυφαίο: «${topOpp.question}»` : ""}`,
      ];
      return { at: s.generated_at, lines };
    }
    if (cron === "backlink-gap-weekly") {
      const s = JSON.parse((await getSetting("backlink_gap_latest")) || "null");
      if (!s) return { at: null, lines: ["καμία σάρωση ακόμα"] };
      const top = (s.candidates || []).slice(0, 3).map((c) => c.domain).join(", ");
      return {
        at: s.generated_at,
        lines: [
          `εμείς ${s.ours?.referring_domains} referring domains, ${(s.candidates || []).length} καθαροί στόχοι στη λίστα`,
          `  κορυφαίοι: ${top || "-"} (ταΐζουν τον συγγραφέα των pitches)`,
        ],
      };
    }
    if (cron === "web-mentions-weekly") {
      const s = JSON.parse((await getSetting("web_mentions_latest")) || "null");
      if (!s) return { at: null, lines: ["καμία σάρωση ακόμα"] };
      const doms = [...new Set((s.mentions || []).map((m) => m.domain))].slice(0, 4);
      return {
        at: s.generated_at,
        lines: [`${s.total} σελίδες στο web μάς αναφέρουν${doms.length ? `: ${doms.join(", ")}` : ""}`],
      };
    }
  } catch (e) {
    return { at: null, lines: [`σφάλμα ανάγνωσης: ${String(e?.message ?? e).slice(0, 80)}`] };
  }
  return { at: null, lines: [] };
}

// The blog is on Sanity's public dataset — readable with a plain GET,
// so the digest can verify article days without any secret.
async function latestArticle() {
  try {
    const q = encodeURIComponent(
      '*[_type == "post"] | order(publishedAt desc)[0]{title, publishedAt, "slug": slug.current}',
    );
    const res = await fetch(
      `https://ecqr94ey.api.sanity.io/v2024-01-01/data/query/production?query=${q}`,
      { cache: "no-store" },
    );
    const d = await res.json();
    return d.result ?? null;
  } catch {
    return null;
  }
}

async function cohort() {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://command.georgeyachts.com";
    const res = await fetch(`${base}/api/brand-radar/truth`, { cache: "no-store" });
    const d = await res.json();
    return d?.connected ? d : null;
  } catch {
    return null;
  }
}

async function handler() {
  const sb = createServiceClient();
  const now = Date.now();
  const since = new Date(now - 12 * 3600000).toISOString();
  const { data: rows } = await sb
    .from("settings")
    .select("key,value")
    .like("key", "cron_end_%")
    .gte("updated_at", since)
    .limit(500);

  const todayRuns = new Map();
  for (const r of rows ?? []) {
    try {
      const v = JSON.parse(r.value);
      const list = todayRuns.get(v.name) ?? [];
      list.push(v);
      todayRuns.set(v.name, list);
    } catch {}
  }

  const athensNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Athens" }));
  const todayDow = athensNow.getDay();
  const GRDAYS = ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];

  let problems = 0;
  const sections = [];

  // ── Opening: the comparable Google number, live ──
  const t = await cohort();
  if (t?.cohort) {
    const c = t.cohort;
    const delta = Math.round((c.position - c.prev_position) * 10) / 10;
    const arrow = delta < 0 ? `ανεβαίνουμε ${Math.abs(delta)}` : delta > 0 ? `υποχωρούμε ${delta}` : "σταθεροί";
    sections.push(
      [
        "Η GOOGLE ΣΗΜΕΡΑ (ίδια ερωτήματα, εβδομάδα προς εβδομάδα):",
        `  σταθμισμένη θέση ${c.position} (ήταν ${c.prev_position}), ${arrow} · ${c.up} ερωτήματα πάνω, ${c.down} κάτω`,
        ...(t.cluster_alerts?.length
          ? [`  ΠΡΟΣΟΧΗ, θέματα που έπεσαν μαζί: ${t.cluster_alerts.map((a) => a.token).join(", ")}`]
          : []),
        ...(t.cluster_winners?.length
          ? [`  ανεβαίνουν: ${t.cluster_winners.slice(0, 4).map((a) => `${a.token} (${a.prev_position}->${a.position})`).join(", ")}`]
          : []),
        `  -> δες το: ${RADAR} -> Google -> TRUTH CHECK`,
      ].join("\n"),
    );
  }

  // ── Per-engine sections ──
  for (const e of ENGINES) {
    const rep = await engineReport(e.cron, now);
    const scheduledToday = e.days.includes(todayDow);
    let status = "";
    if (scheduledToday) {
      const runs = todayRuns.get(e.cron) ?? [];
      if (runs.some((r) => r.outcome === "success")) status = "ΕΤΡΕΞΕ ΣΗΜΕΡΑ";
      else if (runs.some((r) => r.outcome === "skipped")) status = "ΣΗΜΕΡΑ: παραλείφθηκε με λόγο";
      else if (runs.some((r) => r.outcome === "error")) {
        status = `ΣΦΑΛΜΑ ΣΗΜΕΡΑ: ${runs.find((r) => r.outcome === "error")?.detail ?? "-"}`;
        problems++;
      } else {
        status = "ΔΕΝ ΕΤΡΕΞΕ ΣΗΜΕΡΑ ενώ ήταν προγραμματισμένο";
        problems++;
      }
    } else {
      status = `εκτός προγράμματος σήμερα (τρέχει: ${e.days.map((d) => GRDAYS[d].slice(0, 3)).join("/")})`;
    }
    sections.push(
      [
        `${e.label.toUpperCase()}`,
        `  ${status} · τελευταία εκτέλεση: ${ago(rep.at, now)}`,
        ...rep.lines.map((l) => `  ${l}`),
        `  -> δες το: ${e.where}`,
      ].join("\n"),
    );
  }

  // ── Articles (local engine, verified from the live blog itself) ──
  const post = await latestArticle();
  const isArticleDay = [2, 4, 6].includes(todayDow);
  if (post) {
    const postDate = String(post.publishedAt).slice(0, 10);
    const todayStr = athensNow.toISOString().slice(0, 10);
    const publishedToday = postDate === todayStr;
    let artStatus = `τελευταίο άρθρο ${postDate}: «${post.title}»`;
    if (isArticleDay && !publishedToday) {
      artStatus += " — ΣΗΜΕΡΑ ΕΙΝΑΙ ΜΕΡΑ ΑΡΘΡΟΥ ΚΑΙ ΔΕΝ ΕΧΕΙ ΒΓΕΙ ΑΚΟΜΑ (ο φύλακας ελέγχει 13:00)";
      problems++;
    } else if (publishedToday) {
      artStatus = `ΒΓΗΚΕ ΣΗΜΕΡΑ: «${post.title}»`;
    }
    sections.push(
      [
        "ΜΗΧΑΝΗ ΑΡΘΡΩΝ (τοπική, Τρ/Πεμ/Σαβ 10:00)",
        `  ${artStatus}`,
        `  -> δες το: georgeyachts.com/blog/${post.slug}`,
      ].join("\n"),
    );
  }

  const dstr = `${GRDAYS[todayDow]} ${athensNow.getDate()}/${athensNow.getMonth() + 1}`;
  const subject = problems
    ? `Μηχανές GY: ${problems} πρόβλημα(τα) — ${dstr}`
    : `Μηχανές GY: αναφορά ημέρας — ${dstr}`;

  const body = [
    `Ημερήσια ανάλυση μηχανών, ${dstr}, 11:45 ώρα Αθήνας.`,
    "",
    sections.join("\n\n"),
    "",
    "Κάθε panel στο Brand Radar έχει κουμπί REFRESH για φρέσκια εικόνα όποτε τη θες.",
  ].join("\n");

  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail(GEORGE, subject, body) }),
  });
  if (!res.ok) return NextResponse.json({ error: `gmail ${res.status}` });
  return NextResponse.json({ ok: true, problems, sections: sections.length });
}

export async function GET() {
  return observeCron("engines-digest", handler);
}
