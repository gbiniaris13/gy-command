// Pillar 3 — greeting templates per holiday/culture.
//
// Pure data. The cron picks the right template based on the holiday
// kind and the contact's inferred culture, fills {first_name}, and
// hands the result to the Gmail draft API. Auto-drafts only — never
// sends.
//
// Tone rules (per refocus brief & George's broker style):
//   - Greek name day:    warm, personal, in Greek
//   - Greek Christmas:   warm, in Greek
//   - Other Christmas:   warm but professional, mention the year ahead
//   - Eid:               respectful, do not assume practice level
//   - Diwali:            warm, mention "light of the season"
//   - Hanukkah:          respectful, "warm wishes for the festival"
//   - Birthday:          short, never use "happy birthday!" alone —
//                        mention the relationship if known
//   - US/GR Independence Day: light touch, no politics

export interface GreetingTemplate {
  subject: string;
  body: string;
}

type Locale = "en" | "el";

function detectLocale(country?: string | null): Locale {
  if (!country) return "en";
  if (country === "GR" || country.toLowerCase().includes("greece")) return "el";
  return "en";
}

function fillTemplate(
  tpl: GreetingTemplate,
  vars: Record<string, string>,
): GreetingTemplate {
  const fill = (s: string) =>
    s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  return { subject: fill(tpl.subject), body: fill(tpl.body) };
}

// ─── Templates ──────────────────────────────────────────────────────

export function templateFor(args: {
  holiday_kind: string;
  first_name: string | null;
  country: string | null;
}): GreetingTemplate | null {
  const name = args.first_name?.trim() || "";
  const locale = detectLocale(args.country);
  const tpl = TEMPLATES[args.holiday_kind]?.[locale] ?? TEMPLATES[args.holiday_kind]?.["en"];
  if (!tpl) return null;
  return fillTemplate(tpl, { first_name: name, name });
}

const TEMPLATES: Record<string, Record<Locale, GreetingTemplate>> = {
  // ─── Greek name day (Greek contacts only) ────────────────────────
  name_day: {
    el: {
      subject: "Χρόνια πολλά για τη γιορτή σου, {first_name}!",
      body: `{first_name},

Χρόνια πολλά! Σου εύχομαι από καρδιάς όλα όσα επιθυμείς —
υγεία, χαρά, και πολλούς ακόμα ωραίους πλόες σε ήρεμα νερά.

Με εκτίμηση,
George`,
    },
    en: {
      subject: "Name day wishes, {first_name}",
      body: `{first_name},

Wishing you a wonderful name day — health, happiness, and many
calm seas ahead.

Warmly,
George`,
    },
  },

  // ─── Birthday ───────────────────────────────────────────────────
  birthday: {
    el: {
      subject: "Χρόνια πολλά, {first_name}!",
      body: `{first_name},

Χρόνια πολλά για τα γενέθλιά σου. Σου εύχομαι μια χρονιά γεμάτη
χαρά, υγεία και αξέχαστες στιγμές.

Με εκτίμηση,
George`,
    },
    en: {
      subject: "Wishing you a great year ahead, {first_name}",
      body: `{first_name},

A quick note to wish you a wonderful birthday and a year ahead
full of good health, calm waters, and the kind of moments that
remind us why we work as hard as we do.

Warmly,
George`,
    },
  },

  // ─── Western Christmas ─────────────────────────────────────────
  western_christmas: {
    en: {
      subject: "Wishing you a wonderful holiday season, {first_name}",
      body: `{first_name},

Just a quick note from Athens to wish you and yours a wonderful
holiday season and a peaceful, prosperous new year.

Looking forward to staying in touch in {next_year}.

Warmly,
George`,
    },
    el: {
      subject: "Καλά Χριστούγεννα, {first_name}",
      body: `{first_name},

Καλά Χριστούγεννα και Καλή Χρονιά. Σου εύχομαι και της οικογένειας
σου υγεία, χαρά και γαλήνη.

Με εκτίμηση,
George`,
    },
  },

  // ─── Orthodox Christmas (Jan 7) ────────────────────────────────
  orthodox_christmas: {
    el: {
      subject: "Χρόνια πολλά, {first_name}",
      body: `{first_name},

Καλά Χριστούγεννα! Σου εύχομαι ολόψυχα μια ευτυχισμένη και
δημιουργική χρονιά.

Με εκτίμηση,
George`,
    },
    en: {
      subject: "Orthodox Christmas wishes, {first_name}",
      body: `{first_name},

Wishing you a peaceful Orthodox Christmas and a year ahead
filled with good health and meaningful moments.

Warmly,
George`,
    },
  },

  // ─── Western Easter ────────────────────────────────────────────
  western_easter: {
    en: {
      subject: "Easter wishes, {first_name}",
      body: `{first_name},

Wishing you and your family a peaceful and renewing Easter.

Warmly,
George`,
    },
    el: {
      subject: "Καλό Πάσχα, {first_name}",
      body: `{first_name},

Καλό Πάσχα! Χρόνια πολλά σε εσένα και τους δικούς σου.

George`,
    },
  },

  // ─── Orthodox Easter ───────────────────────────────────────────
  orthodox_easter: {
    el: {
      subject: "Καλή Ανάσταση, {first_name}",
      body: `{first_name},

Καλή Ανάσταση και Χρόνια πολλά! Σου εύχομαι το φως αυτών των
ημερών να σε συνοδεύει σε όλη τη χρονιά.

George`,
    },
    en: {
      subject: "Orthodox Easter wishes, {first_name}",
      body: `{first_name},

Wishing you a beautiful Orthodox Easter — peace, joy, and the
warmth of family around you.

Warmly,
George`,
    },
  },

  // ─── Eid al-Fitr ───────────────────────────────────────────────
  eid_al_fitr: {
    en: {
      subject: "Eid Mubarak, {first_name}",
      body: `{first_name},

Eid Mubarak — wishing you and your family a joyful Eid filled
with peace, blessings, and time with the people you love.

Warmly,
George`,
    },
    el: {
      subject: "Eid Mubarak, {first_name}",
      body: `{first_name},

Eid Mubarak — every joy and blessing to you and your family.

Warmly,
George`,
    },
  },

  // ─── Eid al-Adha ───────────────────────────────────────────────
  eid_al_adha: {
    en: {
      subject: "Eid Mubarak, {first_name}",
      body: `{first_name},

Eid al-Adha Mubarak. Wishing you and your loved ones a blessed
holiday filled with reflection, generosity, and family.

Warmly,
George`,
    },
    el: {
      subject: "Eid Mubarak, {first_name}",
      body: `{first_name},

Eid al-Adha Mubarak — wishing you a blessed and meaningful
holiday with those closest to you.

George`,
    },
  },

  // ─── Diwali ────────────────────────────────────────────────────
  diwali: {
    en: {
      subject: "Happy Diwali, {first_name}",
      body: `{first_name},

Happy Diwali. May the light of the season bring you and your
family health, prosperity, and joy.

Warmly,
George`,
    },
    el: {
      subject: "Happy Diwali, {first_name}",
      body: `{first_name},

Happy Diwali — may the light of the season bring you and your
family health and joy.

George`,
    },
  },

  // ─── Hanukkah ──────────────────────────────────────────────────
  hanukkah_first_night: {
    en: {
      subject: "Warm Hanukkah wishes, {first_name}",
      body: `{first_name},

Warm wishes to you and your family for a meaningful Hanukkah —
eight nights of light, peace, and time with loved ones.

George`,
    },
    el: {
      subject: "Warm Hanukkah wishes, {first_name}",
      body: `{first_name},

Warm wishes for a meaningful Hanukkah — light, peace, and time
with the people who matter most.

George`,
    },
  },

  // ─── US Independence Day ───────────────────────────────────────
  us_independence_day: {
    en: {
      subject: "Happy 4th of July, {first_name}",
      body: `{first_name},

A quick note from Athens to wish you a great Fourth — fireworks,
family, and a long weekend on the water.

Warmly,
George`,
    },
    el: {
      subject: "Happy 4th of July, {first_name}",
      body: `{first_name},

A quick note from Athens — wishing you a great Independence Day.

George`,
    },
  },

  // ─── Greek Independence Day (Mar 25) ──────────────────────────
  greek_independence_day: {
    el: {
      subject: "Χρόνια πολλά για την 25η Μαρτίου, {first_name}",
      body: `{first_name},

Χρόνια πολλά για τη μεγάλη μας γιορτή. Σου εύχομαι ό,τι καλύτερο,
και να συνεχίσουμε να γράφουμε ωραίες ιστορίες σε αυτή τη γη και
τη θάλασσα που τόσο αγαπάμε.

George`,
    },
    en: {
      subject: "Greek Independence Day, {first_name}",
      body: `{first_name},

A note from Athens on our Independence Day — thinking of friends
of Greece around the world, you among them.

George`,
    },
  },
};
