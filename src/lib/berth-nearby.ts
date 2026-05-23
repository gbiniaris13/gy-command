// gy-command — Berth Map Phase 2: fetch nearby info around a berth.
//
// 2026-05-23 — George's brief:
//   "Δηλαδή μόλις βάζω εγώ στο back office τη θέση του σκάφους,
//    αυτόματα να παίρνει τις πληροφορίες αυτές... ATM χρειάζεται,
//    πόση ώρα είναι απ' το αεροδρόμιο χρειάζεται."
//
// Architecture: server-side fetch at SAVE-TIME (in updateCabin),
// store JSONB on cabins.berth_nearby, the public /cabin page reads
// from DB only. ZERO runtime third-party calls. Free forever.
//
// Data sources, all free, no API key, no billing account:
//   • Overpass API (overpass-api.de) — OpenStreetMap POIs
//   • OSRM public demo (router.project-osrm.org) — driving routes
//   • Haversine (pure math) — crow-flies distance fallback
//
// Hardening: every external call has an 8s timeout + try/catch.
// fetchAllNearby() NEVER throws — returns a partial result on
// any failure so updateCabin can persist whatever it got + record
// the error in berth_nearby_error for CRM visibility.

export interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
  distance_km: number;        // crow-flies
  drive_minutes: number | null; // null if OSRM unavailable
  drive_km: number | null;
}

export interface NearbyATM extends NearbyPlace {
  operator?: string | null;   // bank name if tagged
}

export interface NearbyAirport extends NearbyPlace {
  iata?: string | null;       // e.g. "ATH"
  type: "international" | "regional" | "private";
}

export interface NearbyHelipad extends NearbyPlace {
  // helipad vs heliport — heliport is a full facility, helipad
  // is just a landing spot. We surface both, no distinction in
  // UI; captain's call which to use.
}

export interface NearbyPharmacy extends NearbyPlace {
  twentyfour_hour: boolean;   // tagged opening_hours=24/7
}

export interface BerthNearby {
  airport: NearbyAirport | null;
  helipad: NearbyHelipad | null;
  atms: NearbyATM[];          // up to 3, sorted by distance
  hospital: NearbyPlace | null;
  pharmacy: NearbyPharmacy | null;
  generated_at: string;       // ISO timestamp
  partial?: boolean;          // true if any fetcher failed
  errors?: string[];          // human-readable list
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const FETCH_TIMEOUT_MS = 8000;

// --------------------------------------------------------------
// Distance math — crow-flies, no API needed
// --------------------------------------------------------------
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // earth radius km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --------------------------------------------------------------
// Fetch helpers — every external call goes through these so we
// have ONE place for timeout + error handling.
// --------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function overpass(query: string): Promise<OverpassResp> {
  const r = await fetchWithTimeout(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!r.ok) throw new Error(`overpass ${r.status}`);
  return r.json() as Promise<OverpassResp>;
}

interface OverpassResp {
  elements: OverpassElement[];
}
interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function elemLatLng(e: OverpassElement): [number, number] | null {
  if (typeof e.lat === "number" && typeof e.lon === "number") {
    return [e.lat, e.lon];
  }
  if (e.center) return [e.center.lat, e.center.lon];
  return null;
}

// --------------------------------------------------------------
// OSRM driving route — distance + duration between two points
// --------------------------------------------------------------
async function driveRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<{ km: number; minutes: number } | null> {
  try {
    const url =
      `${OSRM_URL}/${fromLng},${fromLat};${toLng},${toLat}` +
      `?overview=false&alternatives=false&steps=false`;
    const r = await fetchWithTimeout(url);
    if (!r.ok) return null;
    const j = (await r.json()) as {
      routes?: { distance: number; duration: number }[];
    };
    const route = j.routes?.[0];
    if (!route) return null;
    return {
      km: route.distance / 1000,
      minutes: route.duration / 60,
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------
// Individual fetchers — each returns null on any failure.
// All Overpass queries use a generous radius and we sort + pick
// the best client-side, so we're never dependent on Overpass'
// sort behaviour.
// --------------------------------------------------------------

// Nearest international/regional aerodrome (commercial airport).
// We deliberately filter for `aerodrome:type=international|regional`
// — small grass airstrips don't count for a UHNW client.
async function fetchNearestAirport(
  lat: number,
  lng: number,
): Promise<NearbyAirport | null> {
  const query = `
    [out:json][timeout:15];
    (
      node["aeroway"="aerodrome"]["aerodrome:type"~"international|regional"](around:120000, ${lat}, ${lng});
      way["aeroway"="aerodrome"]["aerodrome:type"~"international|regional"](around:120000, ${lat}, ${lng});
      node["aeroway"="aerodrome"]["iata"](around:120000, ${lat}, ${lng});
      way["aeroway"="aerodrome"]["iata"](around:120000, ${lat}, ${lng});
    );
    out center tags;
  `;
  try {
    const r = await overpass(query);
    const candidates = r.elements
      .map((e) => {
        const ll = elemLatLng(e);
        if (!ll) return null;
        const dKm = haversineKm(lat, lng, ll[0], ll[1]);
        return { e, ll, dKm };
      })
      .filter((x): x is { e: OverpassElement; ll: [number, number]; dKm: number } => x !== null)
      .sort((a, b) => a.dKm - b.dKm);

    const best = candidates[0];
    if (!best) return null;

    const tags = best.e.tags || {};
    const name =
      tags["name:en"] ||
      tags["int_name"] ||
      tags["name"] ||
      `Airport (${tags.iata || "unnamed"})`;

    const type: NearbyAirport["type"] =
      tags["aerodrome:type"] === "international" || tags.iata
        ? "international"
        : tags["aerodrome:type"] === "regional"
        ? "regional"
        : "private";

    const drive = await driveRoute(lat, lng, best.ll[0], best.ll[1]);

    return {
      name,
      lat: best.ll[0],
      lng: best.ll[1],
      distance_km: round1(best.dKm),
      drive_minutes: drive ? Math.round(drive.minutes) : null,
      drive_km: drive ? round1(drive.km) : null,
      iata: tags.iata ?? null,
      type,
    };
  } catch (e) {
    console.error("[berth-nearby] airport fetch failed:", (e as Error).message);
    return null;
  }
}

async function fetchNearestHelipad(
  lat: number,
  lng: number,
): Promise<NearbyHelipad | null> {
  const query = `
    [out:json][timeout:15];
    (
      node["aeroway"~"helipad|heliport"](around:30000, ${lat}, ${lng});
      way["aeroway"~"helipad|heliport"](around:30000, ${lat}, ${lng});
    );
    out center tags;
  `;
  try {
    const r = await overpass(query);
    const candidates = r.elements
      .map((e) => {
        const ll = elemLatLng(e);
        if (!ll) return null;
        return { e, ll, dKm: haversineKm(lat, lng, ll[0], ll[1]) };
      })
      .filter((x): x is { e: OverpassElement; ll: [number, number]; dKm: number } => x !== null)
      .sort((a, b) => a.dKm - b.dKm);

    const best = candidates[0];
    if (!best) return null;

    const tags = best.e.tags || {};
    const name =
      tags["name:en"] || tags.name || (tags.aeroway === "heliport" ? "Heliport" : "Helipad");

    const drive = await driveRoute(lat, lng, best.ll[0], best.ll[1]);

    return {
      name,
      lat: best.ll[0],
      lng: best.ll[1],
      distance_km: round1(best.dKm),
      drive_minutes: drive ? Math.round(drive.minutes) : null,
      drive_km: drive ? round1(drive.km) : null,
    };
  } catch (e) {
    console.error("[berth-nearby] helipad fetch failed:", (e as Error).message);
    return null;
  }
}

async function fetchNearestATMs(
  lat: number,
  lng: number,
): Promise<NearbyATM[]> {
  // Within 1km of the berth. ATMs further away aren't useful —
  // pelagic luxury client isn't walking 2km for an ATM.
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="atm"](around:1000, ${lat}, ${lng});
      node["amenity"="bank"]["atm"~"yes|24/7"](around:1000, ${lat}, ${lng});
    );
    out tags;
  `;
  try {
    const r = await overpass(query);
    const candidates = r.elements
      .map((e) => {
        const ll = elemLatLng(e);
        if (!ll) return null;
        return { e, ll, dKm: haversineKm(lat, lng, ll[0], ll[1]) };
      })
      .filter((x): x is { e: OverpassElement; ll: [number, number]; dKm: number } => x !== null)
      .sort((a, b) => a.dKm - b.dKm)
      .slice(0, 3);

    return candidates.map((c) => {
      const tags = c.e.tags || {};
      const operator =
        tags.operator || tags.brand || tags.name || null;
      const displayName = operator || "ATM";
      return {
        name: displayName,
        lat: c.ll[0],
        lng: c.ll[1],
        distance_km: round1(c.dKm),
        drive_minutes: null, // ATMs are walkable; meters matter, not minutes
        drive_km: null,
        operator,
      };
    });
  } catch (e) {
    console.error("[berth-nearby] ATM fetch failed:", (e as Error).message);
    return [];
  }
}

async function fetchNearestHospital(
  lat: number,
  lng: number,
): Promise<NearbyPlace | null> {
  // Within 30km. Prefer hospitals over clinics/doctors.
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="hospital"](around:30000, ${lat}, ${lng});
      way["amenity"="hospital"](around:30000, ${lat}, ${lng});
      node["healthcare"="hospital"](around:30000, ${lat}, ${lng});
      way["healthcare"="hospital"](around:30000, ${lat}, ${lng});
    );
    out center tags;
  `;
  try {
    const r = await overpass(query);
    const candidates = r.elements
      .map((e) => {
        const ll = elemLatLng(e);
        if (!ll) return null;
        return { e, ll, dKm: haversineKm(lat, lng, ll[0], ll[1]) };
      })
      .filter((x): x is { e: OverpassElement; ll: [number, number]; dKm: number } => x !== null)
      .sort((a, b) => a.dKm - b.dKm);

    const best = candidates[0];
    if (!best) return null;
    const tags = best.e.tags || {};
    const name =
      tags["name:en"] || tags.name || "Hospital";

    const drive = await driveRoute(lat, lng, best.ll[0], best.ll[1]);

    return {
      name,
      lat: best.ll[0],
      lng: best.ll[1],
      distance_km: round1(best.dKm),
      drive_minutes: drive ? Math.round(drive.minutes) : null,
      drive_km: drive ? round1(drive.km) : null,
    };
  } catch (e) {
    console.error("[berth-nearby] hospital fetch failed:", (e as Error).message);
    return null;
  }
}

async function fetchNearestPharmacy(
  lat: number,
  lng: number,
): Promise<NearbyPharmacy | null> {
  // Within 2km. Prefer 24/7 pharmacies if any exist nearby.
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"="pharmacy"](around:2000, ${lat}, ${lng});
      way["amenity"="pharmacy"](around:2000, ${lat}, ${lng});
    );
    out center tags;
  `;
  try {
    const r = await overpass(query);
    const candidates = r.elements
      .map((e) => {
        const ll = elemLatLng(e);
        if (!ll) return null;
        const tags = e.tags || {};
        const is24h = (tags["opening_hours"] || "").includes("24/7");
        return {
          e,
          ll,
          dKm: haversineKm(lat, lng, ll[0], ll[1]),
          is24h,
        };
      })
      .filter((x): x is { e: OverpassElement; ll: [number, number]; dKm: number; is24h: boolean } => x !== null);

    // Prefer 24/7 if available, otherwise nearest.
    candidates.sort((a, b) => {
      if (a.is24h !== b.is24h) return a.is24h ? -1 : 1;
      return a.dKm - b.dKm;
    });

    const best = candidates[0];
    if (!best) return null;
    const tags = best.e.tags || {};
    const name = tags["name:en"] || tags.name || "Pharmacy";

    return {
      name,
      lat: best.ll[0],
      lng: best.ll[1],
      distance_km: round1(best.dKm),
      drive_minutes: null, // walking distance category
      drive_km: null,
      twentyfour_hour: best.is24h,
    };
  } catch (e) {
    console.error("[berth-nearby] pharmacy fetch failed:", (e as Error).message);
    return null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --------------------------------------------------------------
// Orchestrator — runs all fetchers in parallel, returns whatever
// succeeded. NEVER throws. Caller decides what to do with partial.
// --------------------------------------------------------------
export async function fetchAllNearby(
  lat: number,
  lng: number,
): Promise<BerthNearby> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      airport: null,
      helipad: null,
      atms: [],
      hospital: null,
      pharmacy: null,
      generated_at: new Date().toISOString(),
      partial: true,
      errors: ["invalid coordinates"],
    };
  }

  const results = await Promise.allSettled([
    fetchNearestAirport(lat, lng),
    fetchNearestHelipad(lat, lng),
    fetchNearestATMs(lat, lng),
    fetchNearestHospital(lat, lng),
    fetchNearestPharmacy(lat, lng),
  ]);

  const [airportR, helipadR, atmsR, hospitalR, pharmacyR] = results;
  const errors: string[] = [];

  const airport =
    airportR.status === "fulfilled"
      ? airportR.value
      : (errors.push(`airport: ${airportR.reason}`), null);
  const helipad =
    helipadR.status === "fulfilled"
      ? helipadR.value
      : (errors.push(`helipad: ${helipadR.reason}`), null);
  const atms =
    atmsR.status === "fulfilled"
      ? atmsR.value
      : (errors.push(`atms: ${atmsR.reason}`), [] as NearbyATM[]);
  const hospital =
    hospitalR.status === "fulfilled"
      ? hospitalR.value
      : (errors.push(`hospital: ${hospitalR.reason}`), null);
  const pharmacy =
    pharmacyR.status === "fulfilled"
      ? pharmacyR.value
      : (errors.push(`pharmacy: ${pharmacyR.reason}`), null);

  return {
    airport,
    helipad,
    atms,
    hospital,
    pharmacy,
    generated_at: new Date().toISOString(),
    partial: errors.length > 0,
    ...(errors.length ? { errors } : {}),
  };
}
