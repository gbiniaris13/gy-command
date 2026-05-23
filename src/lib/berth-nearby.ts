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

// 2026-05-23 — primary + fallback Overpass mirrors. The community
// runs several for redundancy; if the primary 429s or times out
// we retry on the mirror once.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
// 2026-05-23 — bumped from 8s → 25s. Overpass [timeout:15] queries
// in dense areas like Athens commonly return at 10-14s. 8s caused
// silent client-side aborts (caught internally → empty results,
// no error visibility). 25s = Overpass server budget (15s) +
// network headroom (10s).
const FETCH_TIMEOUT_MS = 25000;

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

// Try each Overpass mirror in order; if one returns 429/503/timeout,
// fall back to the next. Throws the LAST error if all mirrors fail
// — that way the partial flag in fetchAllNearby captures the
// failure correctly instead of silently returning null.
async function overpass(query: string): Promise<OverpassResp> {
  let lastErr: Error | null = null;
  for (const url of OVERPASS_URLS) {
    try {
      const r = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!r.ok) {
        lastErr = new Error(`overpass ${url} returned ${r.status}`);
        continue; // try next mirror
      }
      return (await r.json()) as OverpassResp;
    } catch (e) {
      lastErr = e as Error;
      // try next mirror
    }
  }
  throw lastErr ?? new Error("overpass: all mirrors failed");
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --------------------------------------------------------------
// Orchestrator — ONE Overpass call for all 5 categories.
//
// 2026-05-23 — First production test hit 429 from BOTH Overpass
// mirrors because we fired 5 parallel queries simultaneously and
// got rate-limited as a perceived abuse pattern. Fix: union-query
// everything into a SINGLE request, bucket the results client-side.
// One Overpass call instead of five. Then 0-3 sequential OSRM calls
// (only for categories that show driving time: airport, helipad,
// hospital — never for walkable ATMs/pharmacy).
//
// Total external calls per refresh: 1 Overpass + ≤3 OSRM = 4.
// Down from 5 + ≤3 = 8 before, and far gentler on the mirrors.
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

  const errors: string[] = [];

  // ONE unified Overpass query for all 5 categories. Each element
  // carries enough tag info to identify its category client-side.
  const unionQuery = `
    [out:json][timeout:25];
    (
      node["aeroway"="aerodrome"](around:150000, ${lat}, ${lng});
      way["aeroway"="aerodrome"](around:150000, ${lat}, ${lng});
      node["aeroway"~"helipad|heliport"](around:40000, ${lat}, ${lng});
      way["aeroway"~"helipad|heliport"](around:40000, ${lat}, ${lng});
      node["amenity"="atm"](around:1500, ${lat}, ${lng});
      node["amenity"="bank"]["atm"!="no"](around:1500, ${lat}, ${lng});
      way["amenity"="bank"]["atm"!="no"](around:1500, ${lat}, ${lng});
      node["amenity"="hospital"](around:30000, ${lat}, ${lng});
      way["amenity"="hospital"](around:30000, ${lat}, ${lng});
      node["healthcare"="hospital"](around:30000, ${lat}, ${lng});
      way["healthcare"="hospital"](around:30000, ${lat}, ${lng});
      node["amenity"="pharmacy"](around:2000, ${lat}, ${lng});
      way["amenity"="pharmacy"](around:2000, ${lat}, ${lng});
    );
    out center tags;
  `;

  let elements: OverpassElement[] = [];
  try {
    const r = await overpass(unionQuery);
    elements = r.elements;
  } catch (e) {
    errors.push(`overpass: ${(e as Error).message}`);
    return {
      airport: null,
      helipad: null,
      atms: [],
      hospital: null,
      pharmacy: null,
      generated_at: new Date().toISOString(),
      partial: true,
      errors,
    };
  }

  // Bucket elements by category using their tags. One pass.
  const aerodromes: { e: OverpassElement; ll: [number, number]; dKm: number }[] = [];
  const helipads: { e: OverpassElement; ll: [number, number]; dKm: number }[] = [];
  const atms: { e: OverpassElement; ll: [number, number]; dKm: number }[] = [];
  const hospitals: { e: OverpassElement; ll: [number, number]; dKm: number }[] = [];
  const pharmacies: { e: OverpassElement; ll: [number, number]; dKm: number; is24h: boolean }[] = [];

  for (const e of elements) {
    const ll = elemLatLng(e);
    if (!ll) continue;
    const dKm = haversineKm(lat, lng, ll[0], ll[1]);
    const tags = e.tags || {};
    if (tags.aeroway === "aerodrome") {
      aerodromes.push({ e, ll, dKm });
    } else if (tags.aeroway === "helipad" || tags.aeroway === "heliport") {
      helipads.push({ e, ll, dKm });
    } else if (tags.amenity === "atm" || tags.amenity === "bank") {
      // Distance gate — only within 1.5km (already filtered by query
      // but defence-in-depth).
      if (dKm <= 1.6) atms.push({ e, ll, dKm });
    } else if (tags.amenity === "hospital" || tags.healthcare === "hospital") {
      hospitals.push({ e, ll, dKm });
    } else if (tags.amenity === "pharmacy") {
      const is24h = (tags["opening_hours"] || "").includes("24/7");
      pharmacies.push({ e, ll, dKm, is24h });
    }
  }

  // Airport: prefer ones with IATA codes (always commercial).
  aerodromes.sort((a, b) => {
    const aIata = a.e.tags?.iata ? 1 : 0;
    const bIata = b.e.tags?.iata ? 1 : 0;
    if (aIata !== bIata) return bIata - aIata;
    return a.dKm - b.dKm;
  });
  const bestAirport = aerodromes[0] || null;

  helipads.sort((a, b) => a.dKm - b.dKm);
  const bestHelipad = helipads[0] || null;

  atms.sort((a, b) => a.dKm - b.dKm);

  hospitals.sort((a, b) => a.dKm - b.dKm);
  const bestHospital = hospitals[0] || null;

  // Pharmacy: prefer 24/7 if any, otherwise nearest.
  pharmacies.sort((a, b) => {
    if (a.is24h !== b.is24h) return a.is24h ? -1 : 1;
    return a.dKm - b.dKm;
  });
  const bestPharmacy = pharmacies[0] || null;

  // OSRM driving routes for the 3 categories that show drive time.
  // Done SEQUENTIALLY with small delays so we don't get rate-limited
  // on the public demo server.
  let airportDrive: { km: number; minutes: number } | null = null;
  let helipadDrive: { km: number; minutes: number } | null = null;
  let hospitalDrive: { km: number; minutes: number } | null = null;

  if (bestAirport) {
    airportDrive = await driveRoute(lat, lng, bestAirport.ll[0], bestAirport.ll[1]);
    await sleep(300);
  }
  if (bestHelipad) {
    helipadDrive = await driveRoute(lat, lng, bestHelipad.ll[0], bestHelipad.ll[1]);
    await sleep(300);
  }
  if (bestHospital) {
    hospitalDrive = await driveRoute(lat, lng, bestHospital.ll[0], bestHospital.ll[1]);
  }

  // Build the result objects.
  const airport: NearbyAirport | null = bestAirport
    ? (() => {
        const tags = bestAirport.e.tags || {};
        const type: NearbyAirport["type"] =
          tags["aerodrome:type"] === "international" || tags.iata
            ? "international"
            : tags["aerodrome:type"] === "regional"
            ? "regional"
            : "private";
        return {
          name:
            tags["name:en"] ||
            tags["int_name"] ||
            tags["name"] ||
            `Airport (${tags.iata || "unnamed"})`,
          lat: bestAirport.ll[0],
          lng: bestAirport.ll[1],
          distance_km: round1(bestAirport.dKm),
          drive_minutes: airportDrive ? Math.round(airportDrive.minutes) : null,
          drive_km: airportDrive ? round1(airportDrive.km) : null,
          iata: tags.iata ?? null,
          type,
        };
      })()
    : null;

  const helipad: NearbyHelipad | null = bestHelipad
    ? (() => {
        const tags = bestHelipad.e.tags || {};
        return {
          name:
            tags["name:en"] ||
            tags.name ||
            (tags.aeroway === "heliport" ? "Heliport" : "Helipad"),
          lat: bestHelipad.ll[0],
          lng: bestHelipad.ll[1],
          distance_km: round1(bestHelipad.dKm),
          drive_minutes: helipadDrive ? Math.round(helipadDrive.minutes) : null,
          drive_km: helipadDrive ? round1(helipadDrive.km) : null,
        };
      })()
    : null;

  const atmsOut: NearbyATM[] = atms.slice(0, 3).map((c) => {
    const tags = c.e.tags || {};
    const operator = tags.operator || tags.brand || tags.name || null;
    return {
      name: operator || "ATM",
      lat: c.ll[0],
      lng: c.ll[1],
      distance_km: round1(c.dKm),
      drive_minutes: null,
      drive_km: null,
      operator,
    };
  });

  const hospital: NearbyPlace | null = bestHospital
    ? {
        name:
          (bestHospital.e.tags || {})["name:en"] ||
          (bestHospital.e.tags || {}).name ||
          "Hospital",
        lat: bestHospital.ll[0],
        lng: bestHospital.ll[1],
        distance_km: round1(bestHospital.dKm),
        drive_minutes: hospitalDrive ? Math.round(hospitalDrive.minutes) : null,
        drive_km: hospitalDrive ? round1(hospitalDrive.km) : null,
      }
    : null;

  const pharmacy: NearbyPharmacy | null = bestPharmacy
    ? {
        name:
          (bestPharmacy.e.tags || {})["name:en"] ||
          (bestPharmacy.e.tags || {}).name ||
          "Pharmacy",
        lat: bestPharmacy.ll[0],
        lng: bestPharmacy.ll[1],
        distance_km: round1(bestPharmacy.dKm),
        drive_minutes: null,
        drive_km: null,
        twentyfour_hour: bestPharmacy.is24h,
      }
    : null;

  return {
    airport,
    helipad,
    atms: atmsOut,
    hospital,
    pharmacy,
    generated_at: new Date().toISOString(),
    partial: errors.length > 0,
    ...(errors.length ? { errors } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
