// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { loadPeople, kindsForPerson, holidayDatesForYear, draftFor, markSent, HOLIDAY_LABELS, HOLIDAY_OVERRIDES_KEY } from "@/lib/lighthouse";

const GEORGE = "george@georgeyachts.com";
import { greetingCard } from "@/lib/lighthouse-card";
import { requireUser } from "@/lib/require-user";

// Mass holiday send — the ONE place The Lighthouse sends to clients,
// and only after George presses approve in the dashboard (design
// decision 29/8: personal = his hands, mass = one approval). Each
// recipient still gets an individually addressed email in George's
// voice, one by one, never CC.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function raw(to, subject, body, html) {
  const boundary = "boundary_gy_" + Math.abs(subject.length * 7919 + to.length);
  const lines = [
    `From: George Yachts <george@georgeyachts.com>`,
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
    html,
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function POST(request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { kind, date, confirm, test } = await request.json();
  if (!kind || !date || confirm !== true) {
    return NextResponse.json({ error: "kind, date και confirm: true απαιτούνται" }, { status: 400 });
  }
  const year = date.slice(0, 4);
  const valid = holidayDatesForYear(Number(year));
  if (valid[kind] !== date) {
    return NextResponse.json({ error: `το ${kind} δεν πέφτει ${date}` }, { status: 400 });
  }

  const { getSetting } = await import("@/lib/google-api");
  // 2026-09-06 (George: "θα ήθελα να δω τι στέλνει"): the greeting
  // line and subject he saved on the preview page, if any.
  let override = null;
  try {
    const ovRaw = await getSetting(HOLIDAY_OVERRIDES_KEY);
    override = ovRaw ? JSON.parse(ovRaw)?.[kind] ?? null : null;
  } catch {}

  // Test send: the exact card, addressed to George alone, with the
  // first recipient's name in the salutation. No window, no sent mark,
  // no CRM activity. This is how he sees what the button sends.
  if (test === true) {
    const { people: ppl } = await loadPeople();
    const sample = ppl.find((p) => !p.opt_out && !p.is_minor && p.email && kindsForPerson(p).includes(kind)) || { name: "George" };
    const d = draftFor({ kind, person: sample, date, override });
    const html = greetingCard({ kind, subject: d.subject, body: d.body });
    const res = await gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: raw(GEORGE, `[ΔΟΚΙΜΗ] ${d.subject}`, d.body, html) }),
    });
    if (!res.ok) return NextResponse.json({ error: `gmail ${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true, test: true, sent_to: GEORGE, as: sample.name });
  }

  // Wishes leave near the day they belong to, never in August for
  // Christmas: the button unlocks 3 days before and locks 2 after.
  const today = new Date(new Date().toLocaleDateString("en-US", { timeZone: "Europe/Athens" }));
  const target = new Date(date + "T00:00:00");
  const diff = Math.round((target - today) / 86400000);
  if (diff > 3 || diff < -2) {
    return NextResponse.json(
      { error: `το κουμπί ανοίγει 3 μέρες πριν τη γιορτή (απέχει ${diff} μέρες)` },
      { status: 400 },
    );
  }

  const sb = createServiceClient();
  const { people } = await loadPeople();
  const batchKey = `all:${kind}:${year}`;

  // Double-send guard: the whole batch runs once per holiday per year.
  const sentRaw = await getSetting("lighthouse_sent");
  const sentMap = sentRaw ? JSON.parse(sentRaw) : {};
  if (sentMap[batchKey]) {
    return NextResponse.json({ error: `ήδη εστάλη (${sentMap[batchKey]})` }, { status: 409 });
  }

  const audience = people.filter(
    (p) => !p.opt_out && !p.is_minor && p.email && kindsForPerson(p).includes(kind),
  );
  // Dedupe by email — a contact and his cabin-guest twin get ONE wish.
  const seen = new Set();
  const finalList = audience.filter((p) => {
    const e = p.email.toLowerCase();
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  });

  let sent = 0;
  const failures = [];
  for (const p of finalList) {
    const d = draftFor({ kind, person: p, date, override });
    // Η κάρτα The Edition (George 29/8): κάθε ευχή φεύγει ντυμένη
    // στο ύφος του house - navy, χρυσό, Georgia serif.
    const html = greetingCard({ kind, subject: d.subject, body: d.body });
    try {
      const res = await gmailFetch("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: raw(p.email, d.subject, d.body, html) }),
      });
      if (!res.ok) throw new Error(`gmail ${res.status}`);
      sent++;
      if (p.contact_id) {
        await sb.from("activities").insert({
          contact_id: p.contact_id,
          type: "email_sent",
          description: `Lighthouse ${HOLIDAY_LABELS[kind] ?? kind}: ${d.subject}`.slice(0, 500),
          metadata: { lighthouse: true, kind, batch: batchKey },
        });
      }
    } catch (e) {
      failures.push(`${p.email}: ${String(e?.message ?? e).slice(0, 60)}`);
    }
    // Gentle pacing for Gmail.
    await new Promise((r) => setTimeout(r, 400));
  }

  await markSent(batchKey);
  return NextResponse.json({ ok: true, sent, of: finalList.length, failures });
}
