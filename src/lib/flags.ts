/**
 * Convert an ISO 3166-1 alpha-2 country code to its emoji flag.
 * Falls back to a globe emoji for unknown codes.
 */
export function getFlag(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return "\u{1F30D}";
  const code = countryCode.toUpperCase();
  const offset = 0x1f1e6 - 65; // 'A' = 65
  const first = code.charCodeAt(0) + offset;
  const second = code.charCodeAt(1) + offset;
  return String.fromCodePoint(first, second);
}

/**
 * Common country name → ISO code lookup (for display purposes).
 */
const COUNTRY_CODES: Record<string, string> = {
  "Monaco": "MC",
  "United Kingdom": "GB",
  "Norway": "NO",
  "Italy": "IT",
  "Singapore": "SG",
  "France": "FR",
  "Greece": "GR",
  "United States": "US",
  "Spain": "ES",
  "Croatia": "HR",
  "Turkey": "TR",
  "Germany": "DE",
  "Netherlands": "NL",
  "Switzerland": "CH",
  "United Arab Emirates": "AE",
  "Australia": "AU",
  "Canada": "CA",
  "Brazil": "BR",
  "Japan": "JP",
  "South Korea": "KR",
  "China": "CN",
  "Russia": "RU",
  "India": "IN",
  "Mexico": "MX",
  "Portugal": "PT",
  "Sweden": "SE",
  "Denmark": "DK",
  "Belgium": "BE",
  "Austria": "AT",
  "Poland": "PL",
  "Czech Republic": "CZ",
  "Ireland": "IE",
  "Finland": "FI",
  "Thailand": "TH",
  "Malaysia": "MY",
  "Indonesia": "ID",
  "Philippines": "PH",
  "Vietnam": "VN",
  "Saudi Arabia": "SA",
  "Qatar": "QA",
  "Bahrain": "BH",
  "Kuwait": "KW",
  "Oman": "OM",
  "Egypt": "EG",
  "South Africa": "ZA",
  "New Zealand": "NZ",
  "Argentina": "AR",
  "Chile": "CL",
  "Colombia": "CO",
  "Peru": "PE",
  "Israel": "IL",
  "Lebanon": "LB",
  "Cyprus": "CY",
  "Malta": "MT",
  "Luxembourg": "LU",
  "Montenegro": "ME",
  "Albania": "AL",
};

/**
 * Get flag emoji from a country name or ISO code.
 * Tries ISO code first, then looks up the name.
 */
export function getFlagFromCountry(country: string | null | undefined): string {
  if (!country) return "\u{1F30D}";
  // If it's already a 2-letter code
  if (country.length === 2) return getFlag(country);
  // Look up from name
  const code = COUNTRY_CODES[country];
  return code ? getFlag(code) : "\u{1F30D}";
}
