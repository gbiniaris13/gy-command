// The annual edition for a past client (George, 2 October 2026): "the
// cheapest sale you will ever make, because the client knows you". From the
// Lighthouse, one tap creates a DRAFT Helm request that renders as "The
// <Surname> Edition, <year>": the yacht they sailed, if she is still with
// us, beside two of her kind, with a letter that remembers the week. George
// edits it in The Helm like any proposal and sends it when he chooses;
// nothing leaves this file towards a client.
//
// Yachts come from the social-cleared fleet pool only (fetchFleetPool), so a
// website-only hull never enters an outgoing edition, and the rate is the
// yacht's published weekly range: "from EUR X plus APA and VAT at the yacht's
// certified rate", never a computed all-in with a guessed VAT.

import { createServiceClient } from "@/lib/supabase-server";
import { createRequest, updateRequest } from "@/lib/helm-admin";
import { fetchFleetPool, type FleetYacht } from "@/lib/sanity-fleet";
import type { CombinedProposal, CombinedYacht, CustomWeek } from "@/lib/helm/proposal-template";

function norm(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/^(m\/y|s\/y|m\/cat|s\/cat|p\/cat|my|sy)\s+/i, "").replace(/[^a-z0-9]/g, "");
}

function lowRate(y: FleetYacht): number | null {
  const head = String(y.weeklyRatePrice ?? "").split("|")[0];
  const nums = (head.match(/€\s?\d[\d.,]*/g) || []).map((f) => Number(f.replace(/[^\d]/g, ""))).filter((n) => n > 1000);
  return nums.length ? Math.min(...nums) : null;
}

function num(s: string | null | undefined): string | null {
  const m = String(s ?? "").match(/\d+/);
  return m ? m[0] : null;
}

function fmtLong(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d.getUTCDate()} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// "S/CAT SEABARIT LX" -> "SEABARIT LX": the editions name a yacht, not her type.
function plainName(name: string): string {
  return String(name ?? "").replace(/^(m\/y|s\/y|m\/cat|s\/cat|p\/cat|my|sy)\s+/i, "").trim();
}

function yachtCard(y: FleetYacht, tier: string, year: number): CombinedYacht {
  const cls = (y.builder ?? y.subtitle?.split(/[|·,]/)[0] ?? "").trim();
  const spec = [
    cls,
    y.yearBuiltRefit ? `Built ${y.yearBuiltRefit}` : "",
    y.length ?? "",
    num(y.cabins) ? `${num(y.cabins)} cabins` : "",
    num(y.sleeps) ? `${num(y.sleeps)} guests` : "",
    num(y.crew) ? `Crew of ${num(y.crew)}` : "",
  ].filter(Boolean).join(" | ");
  const low = lowRate(y);
  const ideal = (y.idealFor ?? "").trim().replace(/[.!?]$/, "");
  return {
    name: plainName(y.name),
    type: y.category ?? undefined,
    tier_label: tier,
    spec_line: spec,
    voyage_line: `Athens → Athens · ${year} season`,
    description: ideal ? `Built for ${ideal.charAt(0).toLowerCase()}${ideal.slice(1)}.` : undefined,
    inside_info: (y.georgeInsiderTip ?? "").trim() || undefined,
    crew_line: num(y.crew) ? `${plainName(y.name)} operates with a crew of ${num(y.crew)}.` : undefined,
    pricing: low
      ? { mode: "plus_extras", currency: "EUR", charter_fee: low, extras_text: "a week, plus APA and VAT at the yacht's certified rate" }
      : undefined,
    salon_extras: {
      highlights: (y.features ?? []).slice(0, 5),
      water_toys: (y.toys ?? []).slice(0, 8),
      accommodation: [],
    },
    links: {},
  };
}

export async function createSeasonEdition(opts: { email: string; year?: number; actorEmail?: string }) {
  const email = opts.email.trim().toLowerCase();
  if (!email) throw new Error("email required");
  const db = createServiceClient();
  const { data: won } = await db
    .from("helm_requests")
    .select("id, client_name, client_title, client_surname, client_email, client_whatsapp, party_size, area, proposal_json, extraction, created_at")
    .ilike("client_email", email)
    .eq("status", "won")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!won) throw new Error("no won charter on file for this email");

  const booking = (won.extraction as { booking?: { vessel?: string; cabin_id?: string } } | null)?.booking;
  const vessel = (booking?.vessel ?? "").trim();
  let from: string | null = null, to: string | null = null, port: string | null = null;
  if (booking?.cabin_id) {
    const { data: c } = await db.from("cabins").select("charter_period_from, charter_period_to, port_embarkation").eq("id", booking.cabin_id).maybeSingle();
    from = c?.charter_period_from ?? null; to = c?.charter_period_to ?? null; port = c?.port_embarkation ?? null;
  }
  const now = new Date();
  const year = opts.year ?? (now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());

  const pool = await fetchFleetPool();
  if (pool.length === 0) throw new Error("the fleet pool is empty or the policy could not be read");
  const theirs = vessel ? pool.find((y) => norm(y.name) === norm(vessel)) ?? null : null;
  const cat = theirs?.category ?? null;
  const base = theirs ? lowRate(theirs) : null;
  const byName = [...pool].sort((a, b) => a.name.localeCompare(b.name));
  const near = byName.filter((y) => {
    if (theirs && y._id === theirs._id) return false;
    if (cat && y.category !== cat) return false;
    const r = lowRate(y);
    if (base && r) return r >= base * 0.65 && r <= base * 1.35;
    return true;
  });
  const picks: FleetYacht[] = theirs ? [theirs, ...near.slice(0, 2)] : near.slice(0, 3);
  if (picks.length === 0) throw new Error("no cleared yacht matches");
  const tiers = theirs ? ["The one you know", "A close cousin", "One step up"] : ["Our recommendation", "The considered choice", "The statement"];
  const yachts = picks.map((y, i) => yachtCard(y, tiers[i] ?? "", year));

  const combined_media: Record<string, { main_url?: string; extra_urls: string[] }> = {};
  picks.forEach((y, i) => {
    const urls = (y.images ?? []).map((im) => im.url).filter(Boolean);
    combined_media[String(i)] = { main_url: urls[0], extra_urls: urls.slice(1, 10) };
  });

  const prior = (won.proposal_json ?? null) as CombinedProposal | null;
  const clientName = prior?.client_name || [won.client_title, won.client_name, won.client_surname].filter(Boolean).join(" ").trim() || won.client_email;
  const when = from && to ? ` between ${fmtLong(from)} and ${fmtLong(to)}` : "";
  const letter = [
    `Dear ${clientName},`,
    vessel
      ? `A year ago this summer you were aboard ${vessel}${when}${port ? `, out of ${port}` : ""}, and I have thought about that week more than once since.`
      : "It has been a year since your week with us, and I have thought about it more than once since.",
    theirs
      ? `For ${year} I have set out three yachts: ${plainName(theirs.name)} herself, if you want the same water with the same hands at the wheel, and two I would put beside her.`
      : `For ${year} I have set out three yachts I would put in front of you first.`,
    "Nothing is booked and nothing is owed. If one of them speaks to you, I will confirm her weeks with the owner the same day, and the earlier we talk, the more of the summer is still yours to choose.",
  ].join("\n");

  const proposal: CombinedProposal = {
    mode: "combined",
    charter_type: "weekly",
    client_name: clientName,
    guests: won.party_size ?? prior?.guests ?? undefined,
    area: prior?.area ?? won.area ?? "Greek waters",
    period: `${year} season`,
    cover_line: vessel ? `${year}. A year on from ${vessel}: three yachts for the same water.` : `${year}. Three yachts for the same water.`,
    intro_letter: letter,
    yachts,
    custom_weeks: (prior?.custom_weeks ?? []) as CustomWeek[],
  };

  const created = await createRequest({
    client_name: won.client_name ?? undefined,
    client_title: won.client_title ?? undefined,
    client_surname: won.client_surname ?? undefined,
    client_email: email,
    client_whatsapp: won.client_whatsapp ?? undefined,
    party_size: won.party_size ?? undefined,
    area: proposal.area,
    brief: `Season Edition ${year}: annual edition for a past client, prepared from the Lighthouse. Based on the won charter ${won.id}${vessel ? ` (${vessel})` : ""}.`,
    request_type: "direct_client",
    mode: "combined",
    actorEmail: opts.actorEmail ?? "lighthouse",
  });
  await updateRequest(created.id, {
    status: "drafted",
    mode: "combined",
    proposal_json: proposal,
    combined_media,
    review_draft: { yachts: picks.map((y) => ({ vessel: { name: plainName(y.name) } })) },
    extraction: { source: "season_edition", from_request: won.id, pipeline: {}, yachts: [] },
  });
  return { id: created.id as string, year, yachts: picks.map((y) => plainName(y.name)), url: `/dashboard/helm/${created.id}` };
}
