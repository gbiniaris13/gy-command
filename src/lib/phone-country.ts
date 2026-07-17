// Country from a phone number's international prefix (2026-07-17, George:
// "το κινητό που βάζω μέσα να ξέρω από πού είναι ο πελάτης"). Longest-prefix
// match over the common charter markets; unknown prefixes return null and the
// UI simply shows nothing. Derived display only — never stored.

const MAP: [string, string, string][] = [
  // [prefix, flag, country]
  ["1", "🇺🇸", "USA/Canada"],
  ["7", "🇷🇺", "Russia/Kazakhstan"],
  ["20", "🇪🇬", "Egypt"],
  ["27", "🇿🇦", "South Africa"],
  ["30", "🇬🇷", "Greece"],
  ["31", "🇳🇱", "Netherlands"],
  ["32", "🇧🇪", "Belgium"],
  ["33", "🇫🇷", "France"],
  ["34", "🇪🇸", "Spain"],
  ["36", "🇭🇺", "Hungary"],
  ["39", "🇮🇹", "Italy"],
  ["40", "🇷🇴", "Romania"],
  ["41", "🇨🇭", "Switzerland"],
  ["43", "🇦🇹", "Austria"],
  ["44", "🇬🇧", "United Kingdom"],
  ["45", "🇩🇰", "Denmark"],
  ["46", "🇸🇪", "Sweden"],
  ["47", "🇳🇴", "Norway"],
  ["48", "🇵🇱", "Poland"],
  ["49", "🇩🇪", "Germany"],
  ["52", "🇲🇽", "Mexico"],
  ["55", "🇧🇷", "Brazil"],
  ["61", "🇦🇺", "Australia"],
  ["64", "🇳🇿", "New Zealand"],
  ["65", "🇸🇬", "Singapore"],
  ["81", "🇯🇵", "Japan"],
  ["82", "🇰🇷", "South Korea"],
  ["86", "🇨🇳", "China"],
  ["90", "🇹🇷", "Turkey"],
  ["91", "🇮🇳", "India"],
  ["351", "🇵🇹", "Portugal"],
  ["352", "🇱🇺", "Luxembourg"],
  ["353", "🇮🇪", "Ireland"],
  ["358", "🇫🇮", "Finland"],
  ["359", "🇧🇬", "Bulgaria"],
  ["380", "🇺🇦", "Ukraine"],
  ["385", "🇭🇷", "Croatia"],
  ["420", "🇨🇿", "Czechia"],
  ["421", "🇸🇰", "Slovakia"],
  ["971", "🇦🇪", "UAE"],
  ["972", "🇮🇱", "Israel"],
  ["974", "🇶🇦", "Qatar"],
  ["966", "🇸🇦", "Saudi Arabia"],
  ["965", "🇰🇼", "Kuwait"],
  ["961", "🇱🇧", "Lebanon"],
  ["357", "🇨🇾", "Cyprus"],
  ["377", "🇲🇨", "Monaco"],
  ["41", "🇨🇭", "Switzerland"],
  ["852", "🇭🇰", "Hong Kong"],
];

// Sort once: longest prefixes first so "351" wins over "35"-style overlaps.
const SORTED = [...MAP].sort((a, b) => b[0].length - a[0].length);

export function phoneCountry(phone: string | null | undefined): { flag: string; country: string } | null {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  const intl = digits.startsWith("+") ? digits.slice(1) : digits.startsWith("00") ? digits.slice(2) : null;
  if (!intl) return null;
  for (const [prefix, flag, country] of SORTED) {
    if (intl.startsWith(prefix)) return { flag, country };
  }
  return null;
}
