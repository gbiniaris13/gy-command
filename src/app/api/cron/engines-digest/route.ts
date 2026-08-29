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

function rawEmail(to, subject, textBody, htmlBody) {
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
    textBody,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// ── HTML rendering, George's brief 29/8: "όχι σημείωμα φαρμακοποιού,
// να το διαβάζω με όρεξη". House palette: navy, ivory, the true gold.
const G = { navy: "#0D1B2A", gold: "#DAA110", ink: "#26313D", soft: "#5A6874", line: "#E4E0D5", bg: "#FAF8F3" };
const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function pill(text, tone) {
  const c = tone === "bad" ? "#A33526" : tone === "good" ? "#1F6B4F" : G.soft;
  const bgc = tone === "bad" ? "#FBEDEB" : tone === "good" ? "#EAF4EF" : "#EFECE4";
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:bold;letter-spacing:.4px;color:${c};background:${bgc};">${esc(text)}</span>`;
}

function card(sec) {
  const rows = sec.lines
    .map((l) => `<p style="margin:5px 0;font-size:14px;line-height:1.55;color:${G.ink};">${esc(l)}</p>`)
    .join("");
  return `
  <div style="background:#ffffff;border:1px solid ${G.line};border-left:3px solid ${sec.accent || G.gold};border-radius:6px;padding:16px 18px;margin:0 0 14px;">
    <div style="margin:0 0 8px;">
      <span style="font-family:Georgia,serif;font-size:16px;color:${G.navy};font-weight:bold;">${esc(sec.title)}</span>
      ${sec.status ? `&nbsp;&nbsp;${pill(sec.status, sec.tone)}` : ""}
    </div>
    ${sec.meta ? `<p style="margin:0 0 8px;font-size:12px;color:${G.soft};">${esc(sec.meta)}</p>` : ""}
    ${rows}
    ${sec.link ? `<p style="margin:10px 0 0;font-size:12px;"><a href="${sec.href || "https://command.georgeyachts.com/dashboard/brand-radar"}" style="color:${G.gold};text-decoration:none;font-weight:bold;">${esc(sec.link)} &rarr;</a></p>` : ""}
  </div>`;
}

function renderHtml(dstr, headline, cards) {
  return `
  <div style="background:${G.bg};padding:28px 12px;">
    <div style="max-width:640px;margin:0 auto;">
      <p style="font-family:Georgia,serif;font-size:13px;letter-spacing:3px;color:${G.gold};text-transform:uppercase;margin:0 0 2px;">George Yachts</p>
      <h1 style="font-family:Georgia,serif;font-size:24px;color:${G.navy};margin:0 0 4px;">Οι μηχανές σήμερα</h1>
      <p style="font-size:13px;color:${G.soft};margin:0 0 20px;">${esc(dstr)} &middot; 11:45 ώρα Αθήνας</p>
      ${headline}
      ${cards.map(card).join("")}
      <p style="font-size:12px;color:${G.soft};margin:16px 0 0;">Κάθε panel στο Brand Radar έχει κουμπί REFRESH για φρέσκια εικόνα όποτε τη θελήσεις.</p>
    </div>
  </div>`;
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
  const cards = [];
  const textParts = [];

  // ── Opening headline: BOTH Google numbers (George 29/8: "θέλω να
  // ξέρω και στην Google τι γίνεται, το αληθινό νούμερο").
  //   1. Ο επίσημος μέσος όρος του Search Console (7 ημέρες) — το
  //      νούμερο που αλλάζει και με το μείγμα ερωτημάτων.
  //   2. Η σταθμισμένη θέση στα ΙΔΙΑ ερωτήματα — το συγκρίσιμο.
  const t = await cohort();
  let headlineHtml = "";
  if (t?.cohort) {
    const c = t.cohort;
    const delta = Math.round((c.position - c.prev_position) * 10) / 10;
    const arrow = delta < 0 ? `ανεβαίνουμε ${Math.abs(delta)} θέσεις` : delta > 0 ? `υποχωρούμε ${delta} θέσεις` : "σταθεροί";
    const off = t.totals?.current?.position;
    const offPrev = t.totals?.previous?.position;
    const clicks = t.totals?.current?.clicks;
    headlineHtml = `
    <div style="background:${G.navy};border-radius:8px;padding:20px 22px;margin:0 0 18px;">
      <p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;color:${G.gold};text-transform:uppercase;font-weight:bold;">Η Google σημερα</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top;padding-right:16px;">
            <p style="margin:0;font-family:Georgia,serif;font-size:34px;color:#ffffff;line-height:1;">${off ?? "-"}</p>
            <p style="margin:6px 0 0;font-size:12px;color:#97A5B2;line-height:1.5;">Μέσος όρος Search Console, 7 ημέρες (ήταν ${offPrev ?? "-"}). Αλλάζει και όταν μπαίνουμε σε νέα ερωτήματα, μην τον κρίνεις μόνο του.</p>
          </td>
          <td style="vertical-align:top;">
            <p style="margin:0;font-family:Georgia,serif;font-size:34px;color:${G.gold};line-height:1;">${c.position}</p>
            <p style="margin:6px 0 0;font-size:12px;color:#97A5B2;line-height:1.5;">Ίδια ερωτήματα με πέρσι την εβδομάδα (ήταν ${c.prev_position}): <strong style="color:#ffffff;">${arrow}</strong>. ${c.up} πάνω, ${c.down} κάτω. Κλικ 7ημέρου: ${clicks ?? "-"}.</p>
          </td>
        </tr>
      </table>
      ${t.cluster_alerts?.length ? `<p style="margin:12px 0 0;font-size:12px;color:#E8836F;">Θέματα που έπεσαν μαζί: ${esc(t.cluster_alerts.map((a) => `${a.token} (${a.prev_position}→${a.position})`).join(", "))}</p>` : ""}
      ${t.cluster_winners?.length ? `<p style="margin:6px 0 0;font-size:12px;color:#63B792;">Ανεβαίνουν: ${esc(t.cluster_winners.slice(0, 4).map((a) => `${a.token} (${a.prev_position}→${a.position})`).join(", "))}</p>` : ""}
    </div>`;
    textParts.push(`Η GOOGLE ΣΗΜΕΡΑ: επίσημος μέσος όρος ${off} (ήταν ${offPrev}) · ίδια ερωτήματα ${c.position} (ήταν ${c.prev_position}), ${arrow}, ${c.up} πάνω / ${c.down} κάτω.`);
  }

  const GRDAYS2 = GRDAYS;
  for (const e of ENGINES) {
    const rep = await engineReport(e.cron, now);
    const scheduledToday = e.days.includes(todayDow);
    let status, tone;
    if (scheduledToday) {
      const runs = todayRuns.get(e.cron) ?? [];
      if (runs.some((r) => r.outcome === "success")) { status = "έτρεξε σήμερα"; tone = "good"; }
      else if (runs.some((r) => r.outcome === "skipped")) { status = "παραλείφθηκε με λόγο"; tone = "neutral"; }
      else if (runs.some((r) => r.outcome === "error")) { status = "σφάλμα σήμερα"; tone = "bad"; problems++; }
      else { status = "ΔΕΝ έτρεξε ενώ έπρεπε"; tone = "bad"; problems++; }
    } else {
      status = `τρέχει ${e.days.map((d) => GRDAYS2[d].slice(0, 3)).join("/")}`;
      tone = "neutral";
    }
    cards.push({
      title: e.label,
      status,
      tone,
      meta: `τελευταία εκτέλεση: ${ago(rep.at, now)}`,
      lines: rep.lines.map((l) => l.trim()),
      link: e.where.replace("command.georgeyachts.com -> ", ""),
    });
    textParts.push(`${e.label}: ${status} · ${rep.lines.join(" · ")}`);
  }

  const post = await latestArticle();
  const isArticleDay = [2, 4, 6].includes(todayDow);
  if (post) {
    const postDate = String(post.publishedAt).slice(0, 10);
    const todayStr = athensNow.toISOString().slice(0, 10);
    const publishedToday = postDate === todayStr;
    let status, tone, line;
    if (publishedToday) {
      status = "βγήκε σήμερα"; tone = "good";
      line = `«${post.title}»`;
    } else if (isArticleDay) {
      status = "δεν έχει βγει ακόμα"; tone = "bad"; problems++;
      line = `Σήμερα είναι μέρα άρθρου. Τελευταίο: «${post.title}» (${postDate}). Ο φύλακας των 13:00 θα το γράψει αν δεν προλάβει το πρωινό.`;
    } else {
      status = "εκτός προγράμματος σήμερα"; tone = "neutral";
      line = `Τελευταίο: «${post.title}» (${postDate})`;
    }
    cards.push({
      title: "Μηχανή άρθρων (Τρίτη / Πέμπτη / Σάββατο, 10:00)",
      status,
      tone,
      lines: [line],
      link: "Διάβασέ το στο blog",
      href: `https://georgeyachts.com/blog/${post.slug}`,
    });
    textParts.push(`ΑΡΘΡΑ: ${status} · ${line}`);
  }

  const dstr = `${GRDAYS[todayDow]} ${athensNow.getDate()}/${athensNow.getMonth() + 1}`;
  const subject = problems
    ? `Μηχανές GY: ${problems} πρόβλημα(τα) — ${dstr}`
    : `Μηχανές GY: αναφορά ημέρας — ${dstr}`;

  const textBody = [`Ημερήσια ανάλυση μηχανών, ${dstr}.`, "", ...textParts].join("\n\n");
  const htmlBody = renderHtml(dstr, headlineHtml, cards);

  const res = await gmailFetch("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: rawEmail(GEORGE, subject, textBody, htmlBody) }),
  });
  if (!res.ok) return NextResponse.json({ error: `gmail ${res.status}` });
  return NextResponse.json({ ok: true, problems, sections: cards.length, v: 3 });
}

export async function GET() {
  return observeCron("engines-digest", handler);
}
