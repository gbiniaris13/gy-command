// Read-only: Generate for a whole family, feeding each letter to the next as a sibling. Nothing stored or sent.
import { buildCalendar, type Kind } from "../../src/lib/aftersales/plan";
import { generateTouch, type Sibling } from "../../src/lib/aftersales/generate";
(async () => {
  const kind = (process.argv[2] ?? "thank_you") as Kind;
  const cal = await buildCalendar({ horizonDays: 75 });
  const c = cal.charters.find((x) => x.vessel === "Effie Star")!;
  const sib: Sibling[] = [];
  for (const p of c.people) {
    const g = await generateTouch(kind, c, p, { siblings: sib });
    console.log(`\n== ${kind} · ${p.first_name} · ${g.personalised ? "personalised" : "base"} · ${g.warnings.join("; ") || "clean"}\n${g.body}`);
    sib.push({ name: p.first_name, body: g.body });
  }
})().catch((e) => { console.error(e); process.exit(1); });
