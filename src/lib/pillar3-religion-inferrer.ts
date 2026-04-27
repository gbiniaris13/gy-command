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

// Sprint 2.1 Bug 8 — religion inferrer prompt rewrite.
// Old behaviour defaulted "unknown country" to "protestant" by way of
// the Western country list, producing 73% protestant on a Greek
// broker's network (impossible). New behaviour:
//   - Only assign a religion when there's STRONG evidence
//     (country code, .gr domain, distinctively religious name)
//   - Default "unknown" otherwise — much higher coverage
//   - Greek-name pattern alone now triggers orthodox even without
//     country (Greek names abroad are still mostly Orthodox)

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

// Greek surname / first-name endings strongly indicate Orthodox even
// when country is unknown or set to a Western diaspora location.
// Regex matches name-final substrings.
const GREEK_NAME_RE =
  /(opoulos|opoulou|akis|akos|aki|idis|iadis|adis|antis|adou|opouli|atos|aki|atos|iotis|iotou|antos|antou|enos|enou|inos|inou|atou|akou|ikis|ouli|aris|aros|orou|orous|elis|elas|elos|elou|edou|edos|i?dakis|i?nidis|antaras|aki?s|alis|alas|alos|alou|odimas|odimou|sotirios|panagiot|pavlos|nikolaos|theofan|charal|stylian|polych|emmanou|geor[g][i]|spyros|spyridon|christ[oi]|despoin|grigoriou)$/i;

// Distinctly Greek given names (Latin transliteration).
const GREEK_FIRST_NAMES = new Set([
  "george", "yorgos", "giorgos", "yorgo", "giorgo",
  "nikos", "nikolaos", "nick", "niko",
  "kostas", "konstantinos", "constantine",
  "yannis", "ioannis", "giannis",
  "panos", "panagiotis", "panayotis",
  "spyros", "spyridon", "spiros",
  "stelios", "stylianos",
  "vasilis", "basil", "vasileios",
  "manolis", "emmanouil", "manos",
  "thanos", "athanasios", "sakis",
  "christos", "chris",
  "dimitris", "dimitri", "demetri", "dimitrios", "mimis",
  "lefteris", "eleftherios",
  "harris", "haralampos", "charalampos",
  "petros", "peter",
  "andreas", "andrew",
  "alexandros", "alex",
  "michalis", "michail", "michael",
  "filippos", "philip", "philippos",
  "iordanis", "jordan",
  "antonis", "antonios",
  "elias", "ilias",
  "ioanna", "ianna", "joanna",
  "maria", "marya",
  "eleni", "helen", "elena",
  "katerina", "ekaterini", "catherine",
  "dimitra", "demetra",
  "christina", "christiana",
  "anastasia", "tasia",
  "evangelia", "evangelina",
  "despina", "despoina",
  "athina", "athena",
  "fotini", "photini",
  "olympia", "olga",
  "vasiliki", "vicky",
  "marina", "myrto",
  "magda", "magdalena",
  "smaragda",
  "vivi", "viviana",
  "iro", "irene", "irini",
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
  last_name?: string | null;
  email?: string | null;
}): Religion {
  const country = opts.country?.trim();
  const first = opts.first_name?.trim().toLowerCase() ?? "";
  const last = opts.last_name?.trim().toLowerCase() ?? "";
  const emailDomain =
    opts.email?.split("@")[1]?.toLowerCase().trim() ?? "";

  // STRONGEST: Greek name pattern → orthodox (regardless of country —
  // Greek diaspora is overwhelmingly Orthodox even in US/UK/AU)
  if (first && GREEK_FIRST_NAMES.has(first)) return "orthodox";
  if (last && GREEK_NAME_RE.test(last)) return "orthodox";

  // Greek email domain → orthodox
  if (emailDomain.endsWith(".gr") || emailDomain.endsWith(".cy")) {
    return "orthodox";
  }

  // STRONG: name signals override Western country defaults for
  // Muslim / Hindu names
  if (first) {
    if (MUSLIM_NAME_PREFIXES.some((p) => first.startsWith(p))) return "muslim";
    if (HINDU_NAME_PREFIXES.some((p) => first.startsWith(p))) return "hindu";
  }

  // Country-based — but ONLY for explicit signals. The old behaviour
  // assigned protestant to anyone in US/UK/etc which inflated the
  // protestant count to 73% (impossible for a Greek broker). Now
  // country gives religion ONLY when the country is explicitly set.
  if (!country) return "unknown";
  if (ORTHODOX_COUNTRIES.has(country)) return "orthodox";
  if (MUSLIM_COUNTRIES.has(country)) return "muslim";
  if (HINDU_COUNTRIES.has(country)) return "hindu";
  if (JEWISH_COUNTRIES.has(country)) return "jewish";
  // Catholic / Protestant — only when there's no Greek-name evidence
  // (already checked above).
  if (CATHOLIC_COUNTRIES.has(country)) return "catholic";
  if (PROTESTANT_COUNTRIES.has(country)) return "protestant";
  return "unknown";
}
