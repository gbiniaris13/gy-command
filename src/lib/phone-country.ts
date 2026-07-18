// Country from a phone number's international prefix (2026-07-17, George:
// "το κινητό που βάζω μέσα να ξέρω από πού είναι ο πελάτης"). Longest-prefix
// match over the markets a Greek charter desk actually sees; unknown prefixes
// return null and the UI simply shows nothing. Derived display only — never
// stored. Not a full E.164 table on purpose: only real charter-client origins.

const MAP: [string, string, string][] = [
  // [prefix, flag, country]
  // NANP first: the yachting territories get their own flag, the rest of +1
  // falls through to USA/Canada.
  ["1242", "🇧🇸", "Bahamas"],
  ["1284", "🇻🇬", "British Virgin Islands"],
  ["1345", "🇰🇾", "Cayman Islands"],
  ["1441", "🇧🇲", "Bermuda"],
  ["1", "🇺🇸", "USA/Canada"],
  // +7: 6/7 after the 7 is Kazakhstan, everything else Russia.
  ["76", "🇰🇿", "Kazakhstan"],
  ["77", "🇰🇿", "Kazakhstan"],
  ["7", "🇷🇺", "Russia"],
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
  ["54", "🇦🇷", "Argentina"],
  ["55", "🇧🇷", "Brazil"],
  ["56", "🇨🇱", "Chile"],
  ["57", "🇨🇴", "Colombia"],
  ["60", "🇲🇾", "Malaysia"],
  ["61", "🇦🇺", "Australia"],
  ["62", "🇮🇩", "Indonesia"],
  ["63", "🇵🇭", "Philippines"],
  ["64", "🇳🇿", "New Zealand"],
  ["65", "🇸🇬", "Singapore"],
  ["66", "🇹🇭", "Thailand"],
  ["81", "🇯🇵", "Japan"],
  ["82", "🇰🇷", "South Korea"],
  ["84", "🇻🇳", "Vietnam"],
  ["86", "🇨🇳", "China"],
  ["90", "🇹🇷", "Turkey"],
  ["91", "🇮🇳", "India"],
  ["92", "🇵🇰", "Pakistan"],
  ["212", "🇲🇦", "Morocco"],
  ["216", "🇹🇳", "Tunisia"],
  ["234", "🇳🇬", "Nigeria"],
  ["254", "🇰🇪", "Kenya"],
  ["350", "🇬🇮", "Gibraltar"],
  ["351", "🇵🇹", "Portugal"],
  ["352", "🇱🇺", "Luxembourg"],
  ["353", "🇮🇪", "Ireland"],
  ["354", "🇮🇸", "Iceland"],
  ["355", "🇦🇱", "Albania"],
  ["356", "🇲🇹", "Malta"],
  ["357", "🇨🇾", "Cyprus"],
  ["358", "🇫🇮", "Finland"],
  ["359", "🇧🇬", "Bulgaria"],
  ["370", "🇱🇹", "Lithuania"],
  ["371", "🇱🇻", "Latvia"],
  ["372", "🇪🇪", "Estonia"],
  ["373", "🇲🇩", "Moldova"],
  ["375", "🇧🇾", "Belarus"],
  ["376", "🇦🇩", "Andorra"],
  ["377", "🇲🇨", "Monaco"],
  ["378", "🇸🇲", "San Marino"],
  ["380", "🇺🇦", "Ukraine"],
  ["381", "🇷🇸", "Serbia"],
  ["382", "🇲🇪", "Montenegro"],
  ["385", "🇭🇷", "Croatia"],
  ["386", "🇸🇮", "Slovenia"],
  ["387", "🇧🇦", "Bosnia & Herzegovina"],
  ["389", "🇲🇰", "North Macedonia"],
  ["420", "🇨🇿", "Czechia"],
  ["421", "🇸🇰", "Slovakia"],
  ["423", "🇱🇮", "Liechtenstein"],
  ["852", "🇭🇰", "Hong Kong"],
  ["886", "🇹🇼", "Taiwan"],
  ["961", "🇱🇧", "Lebanon"],
  ["962", "🇯🇴", "Jordan"],
  ["965", "🇰🇼", "Kuwait"],
  ["966", "🇸🇦", "Saudi Arabia"],
  ["968", "🇴🇲", "Oman"],
  ["971", "🇦🇪", "UAE"],
  ["972", "🇮🇱", "Israel"],
  ["973", "🇧🇭", "Bahrain"],
  ["974", "🇶🇦", "Qatar"],
  ["994", "🇦🇿", "Azerbaijan"],
  ["995", "🇬🇪", "Georgia"],
];

// Sort once: longest prefixes first so "1242" wins over "1" and "76" over "7".
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
