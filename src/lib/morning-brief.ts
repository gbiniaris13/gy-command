// THE MORNING BRIEF (George, 2 October 2026: "ΕΝΑ πρωινό email"). One email
// at 08:20 Athens that gathers what the house did overnight and what the day
// asks of him: the charter timeline, The Helm, The Lighthouse, the Week
// editions, documents that arrived, the newsletter. Each engine leaves a
// snapshot in `settings` (<engine>_latest); the brief reads the snapshots
// and the live Helm numbers, and sends once. Nothing here acts; it reports.

import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting, gmailFetch } from "@/lib/google-api";
import { MOMENT_LABEL, athensToday, type Moment } from "@/lib/helm/timeline";

const GEORGE = "george@georgeyachts.com";
const BASE = "https://command.georgeyachts.com";
const G = { navy: "#0D1B2A", gold: "#DAA110", ink: "#26313D", soft: "#5A6874", line: "#E4E0D5", bg: "#FAF8F3" };
const esc = (x: unknown) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Section = { title: string; lines: string[]; html: string; count: number };

async function snapshot<T = Record<string, unknown>>(key: string, maxAgeHours = 20): Promise<T | null> {
  try {
    const raw = await getSetting(key);
    if (!raw) return null;
    const j = JSON.parse(raw) as T & { generated_at?: string };
    if (!j.generated_at) return j;
    const age = (Date.now() - new Date(j.generated_at).getTime()) / 3600000;
    return age <= maxAgeHours ? j : null;
  } catch {
    return null;
  }
}

function sec(title: string, items: { text: string; html?: string }[], hint?: string): Section | null {
  if (!items.length) return null;
  const lis = items.map((i) => `<li style="margin:0 0 7px 0;line-height:1.5">${i.html ?? esc(i.text)}</li>`).join("");
  return {
    title,
    count: items.length,
    lines: [title.toUpperCase(), ...items.map((i) => `• ${i.text}`), ...(hint ? ["", hint] : [])],
    html: `<div style="margin:0 0 22px 0"><div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${G.gold};margin:0 0 8px 0">${esc(title)}</div><ul style="margin:0;padding:0 0 0 18px;color:${G.ink};font-size:14px">${lis}</ul>${hint ? `<div style="font-size:12px;color:${G.soft};margin-top:6px">${esc(hint)}</div>` : ""}</div>`,
  };
}
const link = (href: string, text: string) => `<a href="${href}" style="color:${G.navy};text-decoration:underline">${esc(text)}</a>`;

export async function buildMorningBrief(): Promise<{ subject: string; text: string; html: string; sections: Section[] }> {
  void athensToday;
  const db = createServiceClient();
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const sections: Section[] = [];

  // 1. The charters: the timeline's work this morning and the next ten days.
  const tl = await snapshot<{ drafted?: { id: string; client: string; vessel: string; moment: Moment; subject: string; draft: boolean }[]; upcoming?: { id: string; client: string; vessel: string; moment: Moment; due: string; days: number }[]; calendar_missing?: boolean }>("charter_timeline_latest");
  const charterItems: { text: string; html?: string }[] = [];
  for (const d of tl?.drafted ?? []) {
    const t = `${d.client}, ${d.vessel}: ${MOMENT_LABEL[d.moment]}. Draft in your Gmail, press Send: "${d.subject}"`;
    charterItems.push({ text: t, html: `${esc(d.client)}, ${esc(d.vessel)}: <b>${esc(MOMENT_LABEL[d.moment])}</b>. Draft in your Gmail, press Send: "${esc(d.subject)}" · ${link(`${BASE}/dashboard/helm/${d.id}`, "The Helm")}` });
  }
  for (const u of (tl?.upcoming ?? []).slice(0, 6)) {
    charterItems.push({ text: `${u.client}, ${u.vessel}: ${MOMENT_LABEL[u.moment]} in ${u.days} day${u.days === 1 ? "" : "s"} (${u.due}).` });
  }
  if (tl?.calendar_missing) charterItems.push({ text: "The calendar could not be written: open GY Command and press Connect Gmail once, so the embarkations land in your calendar.", html: `The calendar could not be written: ${link(`${BASE}/api/auth/gmail`, "press Connect Gmail once")}, so the embarkations land in your calendar.` });
  const s1 = sec("The charters", charterItems);
  if (s1) sections.push(s1);

  // 2. The Helm: what needs you today, who opened, who asked.
  const helm: { text: string; html?: string }[] = [];
  try {
    const { data: rows } = await db
      .from("helm_requests")
      .select("id, status, client_surname, client_name, client_email, follow_up_at, created_at, salon:extraction->salon")
      .in("status", ["new", "drafted", "sent", "in_conversation", "negotiating"])
      .order("created_at", { ascending: false })
      .limit(300);
    const name = (r: { client_surname: string | null; client_name: string | null; client_email: string | null }) => (r.client_surname || r.client_name || r.client_email || "someone").trim();
    for (const r of rows ?? []) {
      const s = (r.salon ?? {}) as { last_at?: string; views?: number; hold?: { yacht: string; at: string }; wa_yachts?: Record<string, number> };
      if (s.hold?.at && s.hold.at >= since) helm.push({ text: `${name(r)} asked you to hold ${s.hold.yacht} for 48 hours.`, html: `<b>${esc(name(r))}</b> asked you to hold <b>${esc(s.hold.yacht)}</b> for 48 hours · ${link(`${BASE}/dashboard/helm/${r.id}`, "open")}` });
      else if (s.last_at && s.last_at >= since) helm.push({ text: `${name(r)} read their edition (${s.views ?? 0} opens so far).`, html: `${esc(name(r))} read their edition (${s.views ?? 0} opens so far) · ${link(`${BASE}/dashboard/helm/${r.id}`, "open")}` });
    }
    for (const r of rows ?? []) {
      if (["sent", "in_conversation", "negotiating"].includes(r.status) && r.follow_up_at && new Date(r.follow_up_at).getTime() <= Date.now() + 3600000 * 15) {
        helm.push({ text: `Follow-up due today: ${name(r)}.`, html: `Follow-up due today: <b>${esc(name(r))}</b> · ${link(`${BASE}/dashboard/helm/${r.id}`, "open")}` });
      }
    }
    for (const r of rows ?? []) {
      if (r.created_at >= since) helm.push({ text: `New request: ${name(r)}.`, html: `New request: <b>${esc(name(r))}</b> · ${link(`${BASE}/dashboard/helm/${r.id}`, "open")}` });
    }
  } catch {}
  const s2 = sec("The Helm", helm.slice(0, 14));
  if (s2) sections.push(s2);

  // 3. Documents that arrived (the GY Inbox engine).
  const docs = await snapshot<{ filed?: { client: string; type: string; name: string; id: string }[]; pending?: { name: string; guess?: string; from?: string }[] }>("inbox_documents_latest", 26);
  const docItems: { text: string; html?: string }[] = [];
  for (const f of docs?.filed ?? []) docItems.push({ text: `${f.name} filed as ${f.type} under ${f.client}.`, html: `${esc(f.name)} filed as <b>${esc(f.type)}</b> under ${esc(f.client)} · ${link(`${BASE}/dashboard/helm/${f.id}`, "open")}` });
  for (const p of docs?.pending ?? []) docItems.push({ text: `${p.name}${p.from ? ` from ${p.from}` : ""}: I could not tell whose it is${p.guess ? ` (my guess: ${p.guess})` : ""}. Decide in the GY Inbox.`, html: `${esc(p.name)}${p.from ? ` from ${esc(p.from)}` : ""}: I could not tell whose it is${p.guess ? ` (my guess: ${esc(p.guess)})` : ""} · ${link(`${BASE}/dashboard/helm/inbox`, "GY Inbox")}` });
  const s3 = sec("Papers", docItems);
  if (s3) sections.push(s3);

  // 4. Week editions dispatched this morning.
  const we = await snapshot<{ done?: { id: string; client: string; mode: string }[]; mode?: string }>("week_edition_latest", 6);
  const weItems = (we?.done ?? []).map((d) => ({ text: `${d.client}: Week edition ${d.mode === "sent" ? "sent" : d.mode === "draft" ? "drafted in Gmail, press Send" : d.mode}.`, html: `${esc(d.client)}: Week edition ${d.mode === "sent" ? "<b>sent</b>" : d.mode === "draft" ? "<b>drafted in Gmail</b>, press Send" : esc(d.mode)} · ${link(`${BASE}/dashboard/helm/${d.id}`, "open")}` }));
  const s4 = sec("Week editions", weItems);
  if (s4) sections.push(s4);

  // 5. The Lighthouse: its own morning page, folded in whole.
  const lh = await snapshot<{ html_inner?: string; text?: string; today?: number; tomorrow?: number; subject?: string }>("lighthouse_daily_latest", 6);
  if (lh?.html_inner) {
    sections.push({ title: "The Lighthouse", count: (lh.today ?? 0) + (lh.tomorrow ?? 0), lines: ["THE LIGHTHOUSE", lh.text ?? lh.subject ?? ""], html: `<div style="margin:0 0 22px 0"><div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${G.gold};margin:0 0 8px 0">The Lighthouse</div>${lh.html_inner}</div>` });
  }

  // 6. The newsletter: the desk note waiting for a word from him.
  const nl = await snapshot<{ lines?: string[]; html?: string }>("newsletter_brief_latest", 24 * 7);
  if (nl?.lines?.length) {
    sections.push({ title: "The newsletter", count: 1, lines: ["THE NEWSLETTER", ...nl.lines], html: `<div style="margin:0 0 22px 0"><div style="font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${G.gold};margin:0 0 8px 0">The newsletter</div>${nl.html ?? nl.lines.map((l) => `<div style="font-size:14px;color:${G.ink};line-height:1.5">${esc(l)}</div>`).join("")}</div>` });
  }

  const dstr = new Date().toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Athens" });
  const total = sections.reduce((n, s) => n + s.count, 0);
  const subject = total === 0 ? `Σήμερα στην Αθήνα, ${dstr}: ήσυχη μέρα` : `Σήμερα στην Αθήνα, ${dstr}: ${total} ${total === 1 ? "πράγμα" : "πράγματα"} για σένα`;
  const text = [`Σήμερα στην Αθήνα, ${dstr}.`, "", ...(sections.length ? sections.flatMap((s) => [...s.lines, ""]) : ["Τίποτα δεν περιμένει. Καλή μέρα."]), `The Helm: ${BASE}/dashboard/helm`].join("\n");
  const html = `
  <div style="background:${G.bg};padding:28px 12px;">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid ${G.line};padding:30px 32px;font-family:Georgia,'Times New Roman',serif;color:${G.ink}">
      <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${G.gold}">George Yachts · Σήμερα στην Αθήνα</div>
      <div style="font-size:24px;font-weight:300;color:${G.navy};margin:8px 0 22px 0">${esc(dstr.charAt(0).toUpperCase() + dstr.slice(1))}</div>
      ${sections.length ? sections.map((s) => s.html).join("") : `<div style="font-size:15px;color:${G.ink}">Τίποτα δεν περιμένει. Καλή μέρα.</div>`}
      <div style="border-top:1px solid ${G.line};margin-top:8px;padding-top:12px;font-size:11px;color:${G.soft}">
        ${link(`${BASE}/dashboard/helm`, "The Helm")} · ${link(`${BASE}/dashboard/lighthouse`, "The Lighthouse")} · ${link(`${BASE}/dashboard/helm/yachts`, "The Fleet Book")}
      </div>
    </div>
  </div>`;
  return { subject, text, html, sections };
}

function rawEmail(to: string, subject: string, textBody: string, htmlBody: string): string {
  const boundary = "boundary_" + Date.now();
  return Buffer.from(
    [
      `From: GY Command <${GEORGE}>`,
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

export async function sendMorningBrief(): Promise<{ sent: boolean; subject: string; sections: number }> {
  const b = await buildMorningBrief();
  const res = await gmailFetch("/messages/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw: rawEmail(GEORGE, b.subject, b.text, b.html) }) });
  try { await setSetting("morning_brief_latest", JSON.stringify({ generated_at: new Date().toISOString(), subject: b.subject, sections: b.sections.map((s) => s.title), sent: res.ok })); } catch {}
  return { sent: res.ok, subject: b.subject, sections: b.sections.length };
}
