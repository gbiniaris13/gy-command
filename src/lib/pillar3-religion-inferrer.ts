// Pillar 3 — religion inference for greeting personalization.
//
// Pure heuristic, no AI. Rules:
//   - Country alone is the strongest signal.
//   - Name + country combo refines edge cases (e.g. Mohamed in France
//     → muslim; Dimitris in Australia → orthodox).
//   - When in doubt: "unknown" (gets the universal/Western Christmas
//     greeting in December — never sent Eid/Diwali blindly).
//
// Manually overridden via contacts.religion_overridden — never call
// this for those rows.

export type Religion =
  | "orthodox"
  | "catholic"
  | "protestant"
  | "muslim"
  | "jewish"
  | "hindu"
  | "buddhist"
  | "unknown";

const ORTHODOX_COUNTRIES = new Set([
  "GR", "Greece",
  "CY", "Cyprus",
  "RU", "Russia",
  "RS", "Serbia",
  "BG", "Bulgaria",
  "RO", "Romania",
  "UA", "Ukraine",
  "BY", "Belarus",
  "GE", "Georgia",
  "MK", "North Macedonia",
  "ME", "Montenegro",
  "AM", "Armenia",
  "MD", "Moldova",
]);

const CATHOLIC_COUNTRIES = new Set([
  "IT", "Italy",
  "ES", "Spain",
  "FR", "France",
  "PT", "Portugal",
  "PL", "Poland",
  "IE", "Ireland",
  "BR", "Brazil",
  "MX", "Mexico",
  "AR", "Argentina",
  "PH", "Philippines",
  "AT", "Austria",
  "BE", "Belgium",
  "HR", "Croatia",
  "SK", "Slovakia",
  "LT", "Lithuania",
]);

const PROTESTANT_COUNTRIES = new Set([
  "US", "United States",
  "GB", "United Kingdom",
  "DE", "Germany",
  "NL", "Netherlands",
  "DK", "Denmark",
  "SE", "Sweden",
  "NO", "Norway",
  "FI", "Finland",
  "AU", "Australia",
  "NZ", "New Zealand",
  "CA", "Canada",
  "ZA", "South Africa",
]);

const MUSLIM_COUNTRIES = new Set([
  "TR", "Turkey",
  "AE", "United Arab Emirates",
  "SA", "Saudi Arabia",
  "EG", "Egypt",
  "MA", "Morocco",
  "QA", "Qatar",
  "KW", "Kuwait",
  "BH", "Bahrain",
  "OM", "Oman",
  "JO", "Jordan",
  "LB", "Lebanon",
  "PK", "Pakistan",
  "BD", "Bangladesh",
  "ID", "Indonesia",
  "MY", "Malaysia",
  "DZ", "Algeria",
  "TN", "Tunisia",
]);

const HINDU_COUNTRIES = new Set([
  "IN", "India",
  "NP", "Nepal",
  "MU", "Mauritius",
]);

const JEWISH_COUNTRIES = new Set([
  "IL", "Israel",
]);

const MUSLIM_NAME_PREFIXES = [
  "mohammed", "mohamed", "muhammad", "ahmad", "ahmed", "ali",
  "hassan", "hussein", "omar", "youssef", "yusuf", "khalid",
  "fatima", "aisha", "khadija", "abdul", "abu",
];

const HINDU_NAME_PREFIXES = [
  "raj", "rahul", "amit", "anil", "rakesh", "vijay", "vikram",
  "priya", "anjali", "deepika", "kavya", "neha",
];

export function inferReligion(opts: {
  country?: string | null;
  first_name?: string | null;
}): Religion {
  const country = opts.country?.trim();
  const first = opts.first_name?.trim().toLowerCase();

  // Strong: name signals override Western country defaults
  if (first) {
    if (MUSLIM_NAME_PREFIXES.some((p) => first.startsWith(p))) return "muslim";
    if (HINDU_NAME_PREFIXES.some((p) => first.startsWith(p))) return "hindu";
  }

  if (!country) return "unknown";
  if (ORTHODOX_COUNTRIES.has(country)) return "orthodox";
  if (CATHOLIC_COUNTRIES.has(country)) return "catholic";
  if (PROTESTANT_COUNTRIES.has(country)) return "protestant";
  if (MUSLIM_COUNTRIES.has(country)) return "muslim";
  if (HINDU_COUNTRIES.has(country)) return "hindu";
  if (JEWISH_COUNTRIES.has(country)) return "jewish";
  return "unknown";
}
