// A sketch chart for "A week like this" (George, 2 October 2026): the
// American reader should see what 90 miles are. No tiles, no third party,
// no token: the legs George wrote are placed on paper by latitude and
// longitude, joined in gold, with a scale in nautical miles. A leg whose
// place is not in this list leaves the chart out for that week rather than
// guessing. Positions are the harbours and anchorages the house uses,
// rounded to the hundredth of a degree; the caption says so.

export type Port = { lat: number; lon: number; label: string };

const P: Record<string, Port> = {
  athens: { lat: 37.91, lon: 23.71, label: "Athens" },
  alimos: { lat: 37.91, lon: 23.71, label: "Athens" },
  piraeus: { lat: 37.94, lon: 23.64, label: "Piraeus" },
  flisvos: { lat: 37.93, lon: 23.69, label: "Athens" },
  lavrio: { lat: 37.71, lon: 24.06, label: "Lavrio" },
  sounion: { lat: 37.65, lon: 24.02, label: "Sounion" },
  kea: { lat: 37.67, lon: 24.32, label: "Kea" },
  vourkari: { lat: 37.67, lon: 24.32, label: "Kea" },
  kythnos: { lat: 37.40, lon: 24.40, label: "Kythnos" },
  loutra: { lat: 37.43, lon: 24.43, label: "Kythnos" },
  kolona: { lat: 37.40, lon: 24.38, label: "Kythnos" },
  syros: { lat: 37.44, lon: 24.94, label: "Syros" },
  ermoupoli: { lat: 37.44, lon: 24.94, label: "Syros" },
  tinos: { lat: 37.54, lon: 25.16, label: "Tinos" },
  andros: { lat: 37.84, lon: 24.93, label: "Andros" },
  mykonos: { lat: 37.45, lon: 25.33, label: "Mykonos" },
  delos: { lat: 37.40, lon: 25.27, label: "Delos" },
  rineia: { lat: 37.40, lon: 25.22, label: "Rineia" },
  paros: { lat: 37.09, lon: 25.15, label: "Paros" },
  parikia: { lat: 37.09, lon: 25.15, label: "Paros" },
  naousa: { lat: 37.12, lon: 25.24, label: "Naousa" },
  antiparos: { lat: 37.04, lon: 25.08, label: "Antiparos" },
  despotiko: { lat: 36.97, lon: 25.02, label: "Despotiko" },
  naxos: { lat: 37.10, lon: 25.37, label: "Naxos" },
  iraklia: { lat: 36.84, lon: 25.45, label: "Iraklia" },
  schinoussa: { lat: 36.87, lon: 25.52, label: "Schinoussa" },
  koufonisia: { lat: 36.94, lon: 25.60, label: "Koufonisia" },
  koufonisi: { lat: 36.94, lon: 25.60, label: "Koufonisia" },
  donousa: { lat: 37.10, lon: 25.80, label: "Donousa" },
  amorgos: { lat: 36.83, lon: 25.90, label: "Amorgos" },
  ios: { lat: 36.72, lon: 25.28, label: "Ios" },
  sikinos: { lat: 36.68, lon: 25.11, label: "Sikinos" },
  folegandros: { lat: 36.63, lon: 24.92, label: "Folegandros" },
  santorini: { lat: 36.42, lon: 25.43, label: "Santorini" },
  thira: { lat: 36.42, lon: 25.43, label: "Santorini" },
  anafi: { lat: 36.36, lon: 25.77, label: "Anafi" },
  sifnos: { lat: 36.97, lon: 24.72, label: "Sifnos" },
  kamares: { lat: 36.99, lon: 24.67, label: "Sifnos" },
  serifos: { lat: 37.14, lon: 24.50, label: "Serifos" },
  milos: { lat: 36.73, lon: 24.45, label: "Milos" },
  adamas: { lat: 36.73, lon: 24.44, label: "Milos" },
  kimolos: { lat: 36.80, lon: 24.57, label: "Kimolos" },
  polyaigos: { lat: 36.77, lon: 24.63, label: "Polyaigos" },
  hydra: { lat: 37.35, lon: 23.47, label: "Hydra" },
  spetses: { lat: 37.26, lon: 23.16, label: "Spetses" },
  poros: { lat: 37.50, lon: 23.46, label: "Poros" },
  aegina: { lat: 37.75, lon: 23.43, label: "Aegina" },
  agistri: { lat: 37.70, lon: 23.35, label: "Agistri" },
  // 2026-10-07: the Saronic anchorages George writes into sample weeks. The
  // Morrison edition read "Hydra -> Dokos" and, Dokos being absent, the chart
  // restarted at day 5 and showed three stops of a seven-day week.
  dokos: { lat: 37.33, lon: 23.32, label: "Dokos" },
  moni: { lat: 37.72, lon: 23.43, label: "Moni" },
  perdika: { lat: 37.69, lon: 23.45, label: "Perdika" },
  methana: { lat: 37.58, lon: 23.39, label: "Methana" },
  epidavros: { lat: 37.63, lon: 23.16, label: "Epidavros" },
  "palaia epidavros": { lat: 37.63, lon: 23.16, label: "Epidavros" },
  "porto cheli": { lat: 37.33, lon: 23.14, label: "Porto Heli" },
  portocheli: { lat: 37.33, lon: 23.14, label: "Porto Heli" },
  koilada: { lat: 37.41, lon: 23.13, label: "Koilada" },
  kiparissi: { lat: 36.97, lon: 22.99, label: "Kiparissi" },
  leonidio: { lat: 37.16, lon: 22.90, label: "Leonidio" },
  plaka: { lat: 37.16, lon: 22.90, label: "Leonidio" },
  mandraki: { lat: 37.35, lon: 23.47, label: "Hydra" },
  "russian bay": { lat: 37.49, lon: 23.43, label: "Poros" },
  vathi: { lat: 37.59, lon: 23.33, label: "Vathi" },
  // Cyclades anchorages that appear in the house routes.
  rhenia: { lat: 37.40, lon: 25.22, label: "Rineia" },
  ornos: { lat: 37.42, lon: 25.32, label: "Mykonos" },
  kalafati: { lat: 37.43, lon: 25.42, label: "Mykonos" },
  "agios georgios": { lat: 37.10, lon: 25.37, label: "Naxos" },
  // Ionian anchorages.
  sivota: { lat: 39.41, lon: 20.24, label: "Sivota" },
  syvota: { lat: 39.41, lon: 20.24, label: "Sivota" },
  parga: { lat: 39.28, lon: 20.40, label: "Parga" },
  vlicho: { lat: 38.70, lon: 20.71, label: "Vlicho" },
  spartochori: { lat: 38.66, lon: 20.76, label: "Meganisi" },
  atokos: { lat: 38.47, lon: 20.81, label: "Atokos" },
  assos: { lat: 38.38, lon: 20.54, label: "Assos" },
  "one house bay": { lat: 38.47, lon: 20.81, label: "Atokos" },
  ermioni: { lat: 37.39, lon: 23.25, label: "Ermioni" },
  "porto heli": { lat: 37.33, lon: 23.14, label: "Porto Heli" },
  nafplio: { lat: 37.57, lon: 22.80, label: "Nafplio" },
  monemvasia: { lat: 36.69, lon: 23.05, label: "Monemvasia" },
  corfu: { lat: 39.62, lon: 19.92, label: "Corfu" },
  gouvia: { lat: 39.65, lon: 19.85, label: "Corfu" },
  paxos: { lat: 39.20, lon: 20.19, label: "Paxos" },
  gaios: { lat: 39.20, lon: 20.19, label: "Paxos" },
  lakka: { lat: 39.24, lon: 20.13, label: "Lakka" },
  antipaxos: { lat: 39.15, lon: 20.23, label: "Antipaxos" },
  preveza: { lat: 38.96, lon: 20.75, label: "Preveza" },
  lefkada: { lat: 38.83, lon: 20.71, label: "Lefkada" },
  nydri: { lat: 38.71, lon: 20.71, label: "Nydri" },
  meganisi: { lat: 38.66, lon: 20.78, label: "Meganisi" },
  kalamos: { lat: 38.62, lon: 20.93, label: "Kalamos" },
  kastos: { lat: 38.57, lon: 20.91, label: "Kastos" },
  ithaca: { lat: 38.37, lon: 20.72, label: "Ithaca" },
  ithaki: { lat: 38.37, lon: 20.72, label: "Ithaca" },
  vathy: { lat: 38.37, lon: 20.72, label: "Ithaca" },
  kioni: { lat: 38.44, lon: 20.69, label: "Kioni" },
  frikes: { lat: 38.46, lon: 20.66, label: "Frikes" },
  kefalonia: { lat: 38.18, lon: 20.49, label: "Kefalonia" },
  argostoli: { lat: 38.18, lon: 20.49, label: "Argostoli" },
  fiskardo: { lat: 38.46, lon: 20.58, label: "Fiskardo" },
  "agia efimia": { lat: 38.30, lon: 20.60, label: "Agia Efimia" },
  zakynthos: { lat: 37.79, lon: 20.90, label: "Zakynthos" },
  patmos: { lat: 37.32, lon: 26.55, label: "Patmos" },
  leros: { lat: 37.15, lon: 26.85, label: "Leros" },
  lipsi: { lat: 37.30, lon: 26.77, label: "Lipsi" },
  arki: { lat: 37.37, lon: 26.73, label: "Arki" },
  kalymnos: { lat: 36.95, lon: 26.98, label: "Kalymnos" },
  kos: { lat: 36.89, lon: 27.29, label: "Kos" },
  symi: { lat: 36.62, lon: 27.84, label: "Symi" },
  rhodes: { lat: 36.44, lon: 28.22, label: "Rhodes" },
  astypalaia: { lat: 36.55, lon: 26.35, label: "Astypalaia" },
  skiathos: { lat: 39.16, lon: 23.49, label: "Skiathos" },
  skopelos: { lat: 39.12, lon: 23.73, label: "Skopelos" },
  alonissos: { lat: 39.15, lon: 23.87, label: "Alonissos" },
  chania: { lat: 35.52, lon: 24.02, label: "Chania" },
  heraklion: { lat: 35.34, lon: 25.13, label: "Heraklion" },
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(marina|port|town|island|bay|harbour|harbor|anchorage|the|of)\b/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The port a leg fragment names, or null. "Athens (Marina Alimos)" -> Athens. */
export function findPort(fragment: string): Port | null {
  const n = norm(fragment);
  if (!n) return null;
  if (P[n]) return P[n];
  // Longest key contained in the fragment wins ("porto heli" over "poros").
  const keys = Object.keys(P).sort((a, b) => b.length - a.length);
  for (const k of keys) if (new RegExp(`\\b${k}\\b`).test(n)) return P[k];
  return null;
}

export type ChartPoint = { x: number; y: number; label: string; day: number };
export type Chart = {
  w: number;
  h: number;
  points: ChartPoint[];
  path: string;
  scale: { x1: number; x2: number; y: number; label: string };
};

/**
 * Lay the week's legs on paper. Each leg is "A → B"; the chain of stops is
 * projected (longitude scaled by the cosine of the mean latitude, so a mile
 * east is as long as a mile north), fitted into the box with a margin, and
 * a 10 or 20 nautical mile bar is drawn from the latitude scale.
 * Returns null when any stop is unknown: a wrong chart is worse than none.
 */
export function chartForWeek(legs: string[], w = 680, h = 420): Chart | null {
  const stops: { port: Port; day: number }[] = [];
  let unknown = false;
  legs.forEach((leg, i) => {
    const parts = String(leg).split(/\s*(?:->|→|–|-)\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const a = findPort(parts[0]);
    const b = findPort(parts[parts.length - 1]);
    // An unknown stop drops the chart for the week, as the header promises.
    // Until 2026-10-07 this reset the chain and drew the days AFTER the
    // unknown stop as if they were the whole week: a wrong chart, worse than none.
    if (!a || !b) { unknown = true; return; }
    if (stops.length === 0) stops.push({ port: a, day: i + 1 });
    stops.push({ port: b, day: i + 1 });
  });
  if (unknown || stops.length < 2) return null;

  const lats = stops.map((s) => s.port.lat);
  const lons = stops.map((s) => s.port.lon);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xs = lons.map((l) => l * k);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const spanX = Math.max(maxX - minX, 0.3);
  const spanY = Math.max(maxY - minY, 0.3);
  const margin = 70;
  const scale = Math.min((w - 2 * margin) / spanX, (h - 2 * margin) / spanY);
  const ox = (w - spanX * scale) / 2, oy = (h - spanY * scale) / 2;
  const toX = (lon: number) => ox + (lon * k - minX) * scale;
  const toY = (lat: number) => h - (oy + (lat - minY) * scale);

  // Collapse repeated stops at the same place (e.g. two nights) into one dot.
  const points: ChartPoint[] = [];
  for (const s of stops) {
    const x = toX(s.port.lon), y = toY(s.port.lat);
    const last = points[points.length - 1];
    if (last && Math.abs(last.x - x) < 1 && Math.abs(last.y - y) < 1) continue;
    const dup = points.find((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1);
    points.push({ x, y, label: dup ? "" : s.port.label, day: s.day });
  }
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  // One minute of latitude is one nautical mile: 10 NM = 10/60 degrees.
  const nm = spanY * 60 > 60 ? 20 : 10;
  const barPx = (nm / 60) * scale;
  return {
    w, h, points, path,
    scale: { x1: margin / 2, x2: margin / 2 + barPx, y: h - 22, label: `${nm} nautical miles` },
  };
}
