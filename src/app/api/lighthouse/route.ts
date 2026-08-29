// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";
import { upcomingOccasions, loadPeople, markSent, draftFor } from "@/lib/lighthouse";

// The Lighthouse API. GET = everything the dashboard needs. POST =
// George's actions: save a date, add a custom occasion, mark a
// greeting as sent (which also writes the CRM timeline).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const days = Math.min(90, Number(url.searchParams.get("days")) || 30);
  const [occ, ppl] = await Promise.all([upcomingOccasions(days), loadPeople()]);
  const withDrafts = {
    ...occ,
    personal: occ.personal.map((o) => ({
      ...o,
      draft: draftFor(o),
      person: {
        key: o.person.key,
        contact_id: o.person.contact_id,
        name: o.person.name,
        email: o.person.email,
        country: o.person.country,
        vessel: o.person.charter_vessel,
        won: o.person.won,
        vip: o.person.vip,
        source: o.person.source,
      },
    })),
  };
  return NextResponse.json({
    ...withDrafts,
    people: ppl.people.map((p) => ({
      key: p.key,
      contact_id: p.contact_id,
      name: p.name,
      email: p.email,
      country: p.country,
      birthday: p.birthday,
      anniversary: p.anniversary,
      charter_date: p.charter_date,
      charter_vessel: p.charter_vessel,
      discussed: p.discussed ?? [],
      helm_status: p.helm_status ?? null,
      won: p.won,
      vip: p.vip,
      source: p.source,
      custom: p.custom ?? [],
    })),
  });
}

export async function POST(request) {
  const body = await request.json();
  const sb = createServiceClient();

  if (body.action === "save_person") {
    // Update the contact's own fields — birthday, country, anniversary.
    const { contact_id, fields } = body;
    if (!contact_id) return NextResponse.json({ error: "no contact_id" }, { status: 400 });
    const allowed = {};
    for (const k of ["birthday", "country", "anniversary_date", "religion", "religion_overridden"]) {
      if (k in (fields ?? {})) allowed[k] = fields[k];
    }
    const { error } = await sb.from("contacts").update(allowed).eq("id", contact_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "add_date") {
    // Custom occasion for anyone, or a date for a cabin guest who has
    // no contact row. Lives in settings JSON, no migration needed.
    const raw = await getSetting("lighthouse_manual_dates");
    const list = raw ? JSON.parse(raw) : [];
    list.push({
      person_key: body.person_key,
      kind: body.kind || "custom",
      label: (body.label || "").slice(0, 80),
      date: body.date,
      note: (body.note || "").slice(0, 300),
      added_at: new Date().toISOString(),
    });
    await setSetting("lighthouse_manual_dates", JSON.stringify(list));
    return NextResponse.json({ ok: true, count: list.length });
  }

  if (body.action === "remove_date") {
    const raw = await getSetting("lighthouse_manual_dates");
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter(
      (m) => !(m.person_key === body.person_key && m.date === body.date && m.kind === body.kind),
    );
    await setSetting("lighthouse_manual_dates", JSON.stringify(next));
    return NextResponse.json({ ok: true, count: next.length });
  }

  if (body.action === "mark_sent") {
    await markSent(body.key);
    // CRM timeline so next year we know what was said this year.
    if (body.contact_id) {
      await sb.from("activities").insert({
        contact_id: body.contact_id,
        type: "note",
        description: `Lighthouse: έστειλε ${body.label ?? "ευχές"} (${body.kind})`.slice(0, 500),
        metadata: { lighthouse: true, kind: body.kind, occasion_key: body.key },
      });
      await sb.from("contacts").update({ last_activity_at: new Date().toISOString() }).eq("id", body.contact_id);
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "scan_notes") {
    // George 29/8: "να διαβάζει και τα στοιχεία που έχει το Helm, εκεί
    // υπάρχουν υποσημειώσεις". One AI pass over every contact's notes
    // looking for personal dates; returns SUGGESTIONS. Nothing is
    // saved until George confirms each one in the dashboard.
    const { aiChat } = await import("@/lib/ai");
    const { data: rows } = await sb
      .from("contacts")
      .select("id, first_name, last_name, notes, charter_notes")
      .or("notes.not.is.null,charter_notes.not.is.null")
      .limit(400);
    const withNotes = (rows ?? []).filter(
      (r) => (r.notes || "").trim().length > 10 || (r.charter_notes || "").trim().length > 10,
    );
    const suggestions = [];
    // Batch 20 contacts per AI call to keep it to a handful of calls.
    for (let i = 0; i < withNotes.length; i += 20) {
      const chunk = withNotes.slice(i, i + 20);
      const payload = chunk
        .map((r) => `#${r.id}: ${[r.notes, r.charter_notes].filter(Boolean).join(" | ")}`.slice(0, 600))
        .join("\n");
      try {
        const out = await aiChat(
          "You extract personal dates from CRM notes. Return STRICT JSON array, no prose: " +
            '[{"id":"<contact id after #>","kind":"birthday|anniversary|custom","date":"MM-DD or YYYY-MM-DD","label":"short english label","evidence":"the exact phrase"}]. ' +
            "Only include dates that are clearly personal occasions (birthdays, wedding anniversaries, kids birthdays). Ignore charter dates, deadlines, follow-ups. Empty array if none.",
          payload,
          { temperature: 0, maxTokens: 1500 },
        );
        const m = out.match(/\[[\s\S]*\]/);
        if (m) {
          for (const sug of JSON.parse(m[0])) {
            const c = chunk.find((r) => r.id === sug.id);
            if (c && sug.date) {
              suggestions.push({
                contact_id: c.id,
                person_key: `contact:${c.id}`,
                name: [c.first_name, c.last_name].filter(Boolean).join(" "),
                kind: sug.kind,
                date: sug.date,
                label: sug.label,
                evidence: sug.evidence,
              });
            }
          }
        }
      } catch {}
    }
    return NextResponse.json({ ok: true, scanned: withNotes.length, suggestions });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
