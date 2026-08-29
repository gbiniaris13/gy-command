// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { loadPeople, kindsForPerson, holidayDatesForYear, draftFor, markSent, HOLIDAY_LABELS } from "@/lib/lighthouse";

// Mass holiday send — the ONE place The Lighthouse sends to clients,
// and only after George presses approve in the dashboard (design
// decision 29/8: personal = his hands, mass = one approval). Each
// recipient still gets an individually addressed email in George's
// voice, one by one, never CC.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function raw(to, subject, body) {
  const lines = [
    `From: George Yachts <george@georgeyachts.com>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function POST(request) {
  const { kind, date, confirm } = await request.json();
  if (!kind || !date || confirm !== true) {
    return NextResponse.json({ error: "kind, date και confirm: true απαιτούνται" }, { status: 400 });
  }
  const year = date.slice(0, 4);
  const valid = holidayDatesForYear(Number(year));
  if (valid[kind] !== date) {
    return NextResponse.json({ error: `το ${kind} δεν πέφτει ${date}` }, { status: 400 });
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
  const { getSetting } = await import("@/lib/google-api");
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
    const d = draftFor({ kind, person: p, date });
    try {
      const res = await gmailFetch("/messages/send", {
        method: "POST",
        body: JSON.stringify({ raw: raw(p.email, d.subject, d.body) }),
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
