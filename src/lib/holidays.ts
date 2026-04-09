/**
 * Holiday detection by country.
 * Returns holiday names that fall on today's date for the given country.
 */

interface Holiday {
  name: string;
  /** Month (1-12) */
  month: number;
  /** Day (1-31) */
  day: number;
  /** ISO 3166-1 country codes or "ALL" */
  countries: string[];
}

const FIXED_HOLIDAYS: Holiday[] = [
  // Christmas Eve
  {
    name: "Christmas Eve",
    month: 12,
    day: 24,
    countries: ["US", "GB", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "CH", "SE", "DK", "NO", "FI", "AU", "GR", "PT", "IE", "PL", "CZ"],
  },
  // Christmas Day
  {
    name: "Christmas",
    month: 12,
    day: 25,
    countries: ["US", "GB", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "CH", "SE", "DK", "NO", "FI", "AU", "GR", "PT", "IE", "PL", "CZ", "CA", "NZ", "BR", "MX"],
  },
  // New Year's Eve
  {
    name: "New Year's Eve",
    month: 12,
    day: 31,
    countries: ["ALL"],
  },
  // New Year's Day
  {
    name: "New Year",
    month: 1,
    day: 1,
    countries: ["ALL"],
  },
];

/**
 * Country name to ISO code mapping for flexible lookups.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "United States": "US",
  "United Kingdom": "GB",
  "Germany": "DE",
  "France": "FR",
  "Italy": "IT",
  "Spain": "ES",
  "Greece": "GR",
  "Australia": "AU",
  "Canada": "CA",
  "Netherlands": "NL",
  "Belgium": "BE",
  "Austria": "AT",
  "Switzerland": "CH",
  "Sweden": "SE",
  "Denmark": "DK",
  "Norway": "NO",
  "Finland": "FI",
  "Portugal": "PT",
  "Ireland": "IE",
  "Poland": "PL",
  "Czech Republic": "CZ",
  "New Zealand": "NZ",
  "Brazil": "BR",
  "Mexico": "MX",
  "Monaco": "MC",
  "Croatia": "HR",
  "Turkey": "TR",
  "Cyprus": "CY",
  "Malta": "MT",
};

function normalizeCountry(country: string): string {
  if (country.length === 2) return country.toUpperCase();
  return COUNTRY_NAME_TO_CODE[country] ?? country.toUpperCase().slice(0, 2);
}

/**
 * Returns holiday names for today based on the contact's country.
 * @param country - Country name or ISO 3166-1 alpha-2 code
 * @param date - Optional date override (defaults to today)
 */
export function getHolidaysToday(country: string, date?: Date): string[] {
  const now = date ?? new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const code = normalizeCountry(country);

  return FIXED_HOLIDAYS
    .filter(
      (h) =>
        h.month === month &&
        h.day === day &&
        (h.countries.includes("ALL") || h.countries.includes(code))
    )
    .map((h) => h.name);
}
