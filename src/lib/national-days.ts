// National days per nationality — powers the morning occasions digest
// (George 2026-07-21: "βάσει του nationality να τους στέλνουμε και σε εθνικές
// γιορτές της χώρας τους ευχές"). Guests' nationalities come from The Cabin
// passport manifests as free text ("American", "USA", "US"...), so this file
// first normalizes to ISO-2 and then maps to a curated ONE-per-country national
// day (plus Thanksgiving for US/CA — the family holiday Americans actually
// celebrate). Curated, not exhaustive: a wrong or spammy wish is worse than
// none, so only well-known, uncontroversial dates are included. Israel's
// national day follows the Hebrew calendar and is intentionally left out
// (George can wish it by hand rather than us guessing a date).

export type NationalDay = {
  mmdd: string; // "07-04"
  name: string; // "Independence Day"
  line: string; // ready phrase for the draft, George's voice
};

// ─── Nationality normalization ──────────────────────────────────────────────

const NATIONALITY_TO_ISO: Record<string, string> = {
  // United States
  us: "US", usa: "US", "united states": "US", "united states of america": "US", american: "US",
  // United Kingdom (no single national day — normalized but no entry below)
  uk: "GB", gb: "GB", "united kingdom": "GB", british: "GB", england: "GB", english: "GB",
  scottish: "GB", welsh: "GB", "great britain": "GB",
  // Europe
  fr: "FR", france: "FR", french: "FR",
  de: "DE", germany: "DE", german: "DE", deutschland: "DE",
  it: "IT", italy: "IT", italian: "IT",
  es: "ES", spain: "ES", spanish: "ES",
  nl: "NL", netherlands: "NL", dutch: "NL", holland: "NL",
  ch: "CH", switzerland: "CH", swiss: "CH",
  at: "AT", austria: "AT", austrian: "AT",
  be: "BE", belgium: "BE", belgian: "BE",
  se: "SE", sweden: "SE", swedish: "SE",
  no: "NO", norway: "NO", norwegian: "NO",
  dk: "DK", denmark: "DK", danish: "DK",
  fi: "FI", finland: "FI", finnish: "FI",
  pt: "PT", portugal: "PT", portuguese: "PT",
  ie: "IE", ireland: "IE", irish: "IE",
  pl: "PL", poland: "PL", polish: "PL",
  cz: "CZ", czech: "CZ", czechia: "CZ", "czech republic": "CZ",
  ro: "RO", romania: "RO", romanian: "RO",
  hu: "HU", hungary: "HU", hungarian: "HU",
  gr: "GR", greece: "GR", greek: "GR", hellenic: "GR", ελλαδα: "GR", ελληνας: "GR", ελληνιδα: "GR",
  cy: "CY", cyprus: "CY", cypriot: "CY",
  tr: "TR", turkey: "TR", turkish: "TR", turkiye: "TR",
  // Americas
  ca: "CA", canada: "CA", canadian: "CA",
  br: "BR", brazil: "BR", brazilian: "BR",
  mx: "MX", mexico: "MX", mexican: "MX",
  ar: "AR", argentina: "AR", argentine: "AR", argentinian: "AR",
  // Oceania / Asia / Middle East / Africa
  au: "AU", australia: "AU", australian: "AU",
  nz: "NZ", "new zealand": "NZ", "new zealander": "NZ", kiwi: "NZ",
  ae: "AE", uae: "AE", "united arab emirates": "AE", emirati: "AE",
  sa: "SA", "saudi arabia": "SA", saudi: "SA",
  za: "ZA", "south africa": "ZA", "south african": "ZA",
  in: "IN", india: "IN", indian: "IN",
  sg: "SG", singapore: "SG", singaporean: "SG",
  kr: "KR", "south korea": "KR", korea: "KR", korean: "KR",
  jp: "JP", japan: "JP", japanese: "JP",
  il: "IL", israel: "IL", israeli: "IL",
};

export function normalizeNationality(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return NATIONALITY_TO_ISO[k] ?? null;
}

// ─── The curated calendar ───────────────────────────────────────────────────

const FIXED_DAYS: Record<string, NationalDay[]> = {
  US: [{ mmdd: "07-04", name: "Independence Day", line: "Happy 4th of July" }],
  FR: [{ mmdd: "07-14", name: "Bastille Day", line: "Joyeux 14 juillet" }],
  DE: [{ mmdd: "10-03", name: "Day of German Unity", line: "Happy Unity Day" }],
  IT: [{ mmdd: "06-02", name: "Festa della Repubblica", line: "Buona Festa della Repubblica" }],
  ES: [{ mmdd: "10-12", name: "Fiesta Nacional de España", line: "Feliz Fiesta Nacional" }],
  NL: [{ mmdd: "04-27", name: "King's Day", line: "Happy King's Day" }],
  CH: [{ mmdd: "08-01", name: "Swiss National Day", line: "Happy Swiss National Day" }],
  AT: [{ mmdd: "10-26", name: "Austrian National Day", line: "Happy National Day" }],
  BE: [{ mmdd: "07-21", name: "Belgian National Day", line: "Happy National Day" }],
  SE: [{ mmdd: "06-06", name: "National Day of Sweden", line: "Glad nationaldag" }],
  NO: [{ mmdd: "05-17", name: "Constitution Day", line: "Gratulerer med dagen" }],
  DK: [{ mmdd: "06-05", name: "Constitution Day", line: "Happy Constitution Day" }],
  FI: [{ mmdd: "12-06", name: "Independence Day", line: "Happy Independence Day" }],
  PT: [{ mmdd: "06-10", name: "Portugal Day", line: "Feliz Dia de Portugal" }],
  IE: [{ mmdd: "03-17", name: "St. Patrick's Day", line: "Happy St. Patrick's Day" }],
  PL: [{ mmdd: "11-11", name: "Independence Day", line: "Happy Independence Day" }],
  CZ: [{ mmdd: "10-28", name: "Czech Statehood Day", line: "Happy Statehood Day" }],
  RO: [{ mmdd: "12-01", name: "Great Union Day", line: "La mulți ani, România" }],
  HU: [{ mmdd: "08-20", name: "St. Stephen's Day", line: "Happy National Day" }],
  GR: [
    { mmdd: "03-25", name: "Greek Independence Day", line: "Χρόνια πολλά για την 25η Μαρτίου" },
    { mmdd: "10-28", name: "Ohi Day", line: "Χρόνια πολλά για την 28η Οκτωβρίου" },
  ],
  CY: [{ mmdd: "10-01", name: "Cyprus Independence Day", line: "Χρόνια πολλά για την ανεξαρτησία της Κύπρου" }],
  TR: [{ mmdd: "10-29", name: "Republic Day", line: "Cumhuriyet Bayramınız kutlu olsun" }],
  CA: [{ mmdd: "07-01", name: "Canada Day", line: "Happy Canada Day" }],
  BR: [{ mmdd: "09-07", name: "Independence Day", line: "Feliz Dia da Independência" }],
  MX: [{ mmdd: "09-16", name: "Independence Day", line: "¡Viva México! Happy Independence Day" }],
  AR: [{ mmdd: "07-09", name: "Independence Day", line: "Feliz Día de la Independencia" }],
  AU: [{ mmdd: "01-26", name: "Australia Day", line: "Happy Australia Day" }],
  NZ: [{ mmdd: "02-06", name: "Waitangi Day", line: "Happy Waitangi Day" }],
  AE: [{ mmdd: "12-02", name: "UAE National Day", line: "Happy National Day" }],
  SA: [{ mmdd: "09-23", name: "Saudi National Day", line: "Happy Saudi National Day" }],
  ZA: [{ mmdd: "04-27", name: "Freedom Day", line: "Happy Freedom Day" }],
  IN: [{ mmdd: "08-15", name: "Independence Day", line: "Happy Independence Day" }],
  SG: [{ mmdd: "08-09", name: "National Day", line: "Happy National Day" }],
  KR: [{ mmdd: "10-03", name: "National Foundation Day", line: "Happy National Foundation Day" }],
  JP: [{ mmdd: "02-11", name: "National Foundation Day", line: "Happy National Foundation Day" }],
  // GB: no single national day — intentionally empty.
  // IL: Yom Ha'atzmaut follows the Hebrew calendar — intentionally left manual.
};

// US + CA Thanksgiving are computed (4th Thursday of Nov / 2nd Monday of Oct).
function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return `${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** All national days for one ISO-2 nationality in a given year. */
export function nationalDaysFor(iso2: string, year: number): NationalDay[] {
  const days = [...(FIXED_DAYS[iso2] ?? [])];
  if (iso2 === "US") {
    days.push({ mmdd: nthWeekdayOfMonth(year, 10, 4, 4), name: "Thanksgiving", line: "Happy Thanksgiving" });
  }
  if (iso2 === "CA") {
    days.push({ mmdd: nthWeekdayOfMonth(year, 9, 1, 2), name: "Thanksgiving", line: "Happy Thanksgiving" });
  }
  return days;
}

/** The national days that fall on `mmdd` for a raw (unnormalized) nationality. */
export function nationalDaysToday(rawNationality: string | null | undefined, mmdd: string, year: number): NationalDay[] {
  const iso = normalizeNationality(rawNationality);
  if (!iso) return [];
  return nationalDaysFor(iso, year).filter((d) => d.mmdd === mmdd);
}
