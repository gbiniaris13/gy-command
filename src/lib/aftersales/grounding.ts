// src/lib/aftersales/grounding.ts (26/11/2026, after the Thanksgiving letters)
// Two checks the model cannot talk its way past:
//
//   ungrounded()  every word the model ADDED to the base text must exist in
//                 what was really said (the emails with that person) or in the
//                 charter facts. "fresh flavours from the galley" for a guest
//                 who never wrote about food is caught here.
//   tooSimilar()  two people of the same charter (often the same house) must
//                 not receive the same letter. Compared sentence by sentence,
//                 names removed.

// Function words and George's own vocabulary: free to use, never a "fact".
const FREE = new Set(`a about above after again all also always am an and any are as at be been before being below between both but by can could did do does doing down during each even ever every few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just know let like ll made make many may me might more most much must my myself never no nor not now of off often on once one only or other our ours ourselves out over own perhaps quite rather really same say see she should since so some still such than that the their theirs them themselves then there these they this those though through to too under until up upon us very was way we well were what when where which while who whom why will with within without would yet you your yours yourself yourselves
again ahead always another anything back best better bit day days dear each else enough ever everything feel felt find first fond found glad go going good great happy heart hello help here hey home hope hoped hopes hoping indeed keep kind last later least life little long look looking lot love loved lovely many mean meant memory memories mind moment moments morning near next nice night note nothing old part past people place places pleasure quiet real reason remember right said see seem share small soon sorry special still sure take thank thanks thing things think thinking thought time times today together true truly trust trusting turned warm warmly way week weeks welcome whole wish wishes wishing wonderful word words world write writing year years yes
summer season winter spring autumn greece greek athens islands island sea water waters light sun aegean yacht aboard boat boats crew captain charter family families friends guests guest table holiday gratitude thanksgiving christmas birthday anniversary regards george`.split(/\s+/));

const words = (s: string) => (s.toLowerCase().match(/[a-z][a-z'’-]{2,}/g) ?? []).map((w) => w.replace(/['’]s$/, "").replace(/['’-]/g, ""));
const stem = (w: string) => w.replace(/(ies|es|s|ed|ing|ly)$/, "");

/** Words the model added that are not in the base text, the sources or the free list. */
export function ungrounded(body: string, base: string, sources: string): string[] {
  const known = new Set<string>();
  for (const w of words(`${base}\n${sources}`)) { known.add(w); known.add(stem(w)); }
  const out = new Set<string>();
  for (const w of words(body)) {
    if (w.length < 4 || FREE.has(w) || FREE.has(stem(w)) || known.has(w) || known.has(stem(w))) continue;
    out.add(w);
  }
  return [...out];
}

const sentences = (body: string, names: string[]) => {
  let b = body.toLowerCase();
  for (const n of names) if (n) b = b.split(n.toLowerCase()).join("·");
  // Only real sentences count; greeting and sign-off lines ("With warm regards from Athens,") do not.
  return b.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => /[.!?]["”']?$/.test(x)).map((x) => x.replace(/[^a-z·]+/g, " ").trim()).filter((x) => x.split(" ").length >= 5);
};

/** The sibling whose letter shares more than half of its sentences with this one. */
export function tooSimilar(body: string, siblings: { name: string; body: string }[], names: string[]): string | null {
  const mine = sentences(body, names);
  if (!mine.length) return null;
  for (const s of siblings) {
    const theirs = new Set(sentences(s.body, names));
    const shared = mine.filter((x) => theirs.has(x)).length;
    if (shared / mine.length > 0.5) return s.name;
  }
  return null;
}
