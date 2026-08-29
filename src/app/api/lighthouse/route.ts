// @ts-nocheck
import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getSetting, setSetting } from "@/lib/google-api";
import { upcomingOccasions, loadPeople, markSent, draftFor } from "@/lib/lighthouse";

// The Lighthouse API. GET = everything the dashboard needs. POST =
// George's actions: save a date, add a custom occasion, mark a
// greeting as sent (which also writes the CRM timeline).
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// The Helm opens instantly because it renders plain rows; the first
// Lighthouse recomputed four tables and every draft on every load and
// George felt it ("αργεί πάρα πολύ"). Snapshot cache in settings:
// fresh within 10 minutes serves in one read; any POST action busts
// it; a new Helm request therefore appears within 10 minutes on its
// own, or instantly after any action.
const CACHE_KEY = "lighthouse_cache_v1";
const CACHE_TTL_MS = 10 * 60 * 1000;

async function computePayload(days) {
  const [occ, ppl] = await Promise.all([upcomingOccasions(days), loadPeople()]);
  return { occ, ppl };
}

export async function GET(request) {
  const url = new URL(request.url);
  // The calendar shows the whole year ahead (George 29/8: "ημερολόγιο
  // όλου του έτους, με σειρά χρόνου"), so the window is fixed at 365.
  const days = 365;
  const fresh = url.searchParams.get("fresh") === "1";
  // George's law of speed (29/8): "τα τραβάει ΜΙΑ φορά, τα έχει και
  // έτοιμα". Whatever snapshot exists is served instantly - even a
  // stale or action-busted one - and the recompute runs AFTER the
  // response (next/server after()), storing a fresh snapshot for the
  // next request. Nobody ever stares at a skeleton while Supabase
  // thinks. A 60s refreshing_at latch stops polling clients from
  // stacking duplicate recomputes (his cost worry).
  if (!fresh) {
    try {
      const raw = await getSetting(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.payload) {
          const isFresh = !cached.stale && Date.now() - cached.at < CACHE_TTL_MS;
          if (isFresh) {
            return NextResponse.json({ ...cached.payload, cached_at: new Date(cached.at).toISOString() });
          }
          const refreshing = cached.refreshing_at && Date.now() - cached.refreshing_at < 60 * 1000;
          if (!refreshing) {
            try {
              await setSetting(CACHE_KEY, JSON.stringify({ ...cached, refreshing_at: Date.now() }));
            } catch {}
            after(async () => {
              try {
                await recomputeCache();
              } catch {}
            });
          }
          return NextResponse.json({ ...cached.payload, stale: true, cached_at: new Date(cached.at).toISOString() });
        }
      }
    } catch {}
  }
  const { occ, ppl } = await computePayload(days);
  const responseBody = buildResponseBody(occ, ppl);
  try {
    await setSetting(CACHE_KEY, JSON.stringify({ at: Date.now(), days, payload: responseBody }));
  } catch {}
  return NextResponse.json(responseBody);
}

function buildResponseBody(occ, ppl) {
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
  return {
    ...withDrafts,
    source_errors: ppl.errors ?? null,
    no_country: ppl.people.filter((p) => p.email && !p.country).length,
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
      travel_from: p.travel_from ?? null,
      travel_to: p.travel_to ?? null,
      area: p.area ?? null,
      discussed: p.discussed ?? [],
      helm_status: p.helm_status ?? null,
      won: p.won,
      vip: p.vip,
      source: p.source,
      custom: p.custom ?? [],
    })),
  };
}

async function recomputeCache() {
  const { occ, ppl } = await computePayload(365);
  const body = buildResponseBody(occ, ppl);
  await setSetting(CACHE_KEY, JSON.stringify({ at: Date.now(), days: 365, payload: body }));
  return body;
}

// After a mutation the snapshot is WRONG but not WORTHLESS: mark it
// stale so the next GET still answers instantly, and refresh it in
// the background right now so the truth is ready in seconds.
async function bustCache() {
  try {
    const raw = await getSetting(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.payload) {
        await setSetting(CACHE_KEY, JSON.stringify({ ...cached, stale: true, refreshing_at: Date.now() }));
        after(async () => {
          try {
            await recomputeCache();
          } catch {}
        });
        return;
      }
    }
    await setSetting(CACHE_KEY, "");
  } catch {}
}

export async function POST(request) {
  const body = await request.json();
  const sb = createServiceClient();

  if (body.action === "apply_document") {
    // A passport or a MYBA contract lands on an EXISTING Helm card
    // ("πάει και το ψάχνει στο Helm... α, να τος"). Writes overrides:
    // birthday/country from a passport, vessel/dates/won from a
    // contract. Never spawns a duplicate card.
    const { person_key, fields } = body;
    if (!person_key) return NextResponse.json({ error: "no person_key" }, { status: 400 });
    const raw = await getSetting("lighthouse_overrides");
    const ov = raw ? JSON.parse(raw) : {};
    const cur = ov[person_key] ?? {};
    for (const k of ["birthday", "anniversary", "country", "vessel", "charter_from", "charter_to", "won", "email"]) {
      if (fields?.[k] !== undefined && fields[k] !== null && fields[k] !== "") cur[k] = fields[k];
    }
    // A passport in George's hands means a contract exists.
    if (fields?.birthday) cur.won = true;
    ov[person_key] = cur;
    await setSetting("lighthouse_overrides", JSON.stringify(ov));
    // Mirror to the CRM row too when one exists.
    if (body.contact_id) {
      const allowed = {};
      if (cur.birthday) allowed.birthday = cur.birthday;
      if (cur.country) allowed.country = cur.country;
      if (cur.anniversary) allowed.anniversary_date = cur.anniversary;
      if (Object.keys(allowed).length) await sb.from("contacts").update(allowed).eq("id", body.contact_id);
    }
    await bustCache();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "add_person") {
    // A NEW client from a passport: the reason the Documents tab
    // exists (George, 29/8: "σε καινούριο πελάτη ανήκει, γι αυτό δεν
    // το κάναμε αυτό;"). Lives in settings until The Helm meets them,
    // then folds into the Helm person by email or name.
    const raw = await getSetting("lighthouse_people");
    const list = raw ? JSON.parse(raw) : [];
    const entry = {
      id: Math.random().toString(36).slice(2, 10),
      name: String(body.name || "").slice(0, 120),
      date_of_birth: body.date_of_birth || null,
      nationality: String(body.nationality || "").slice(0, 60) || null,
      email: String(body.email || "").slice(0, 160) || null,
      phone: String(body.phone || "").slice(0, 40) || null,
      anniversary: body.anniversary || null,
      added_at: new Date().toISOString(),
    };
    if (!entry.name) return NextResponse.json({ error: "χρειάζεται όνομα" }, { status: 400 });
    // One person, one card: an email that already exists means ATTACH,
    // not a twin.
    if (entry.email) {
      const { people } = await (await import("@/lib/lighthouse")).loadPeople();
      const twin = people.find((pp) => (pp.email || "").toLowerCase() === entry.email.toLowerCase());
      if (twin) {
        return NextResponse.json(
          { error: `υπάρχει ήδη καρτέλα: ${twin.name} — διάλεξε «Υπάρχων πελάτης»`, existing_key: twin.key },
          { status: 409 },
        );
      }
    }
    list.push(entry);
    await setSetting("lighthouse_people", JSON.stringify(list));
    await bustCache();
    return NextResponse.json({ ok: true, id: entry.id });
  }

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
    await bustCache();
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
    await bustCache();
    return NextResponse.json({ ok: true, count: list.length });
  }

  if (body.action === "remove_date") {
    const raw = await getSetting("lighthouse_manual_dates");
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter(
      (m) => !(m.person_key === body.person_key && m.date === body.date && m.kind === body.kind),
    );
    await setSetting("lighthouse_manual_dates", JSON.stringify(next));
    await bustCache();
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
    await bustCache();
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
