// Read-only: generate a few January notes for lost requests. Nothing stored or sent. Emails masked in output.
import fs from "node:fs";
import { buildCalendar } from "../../src/lib/aftersales/plan";
import { readState } from "../../src/lib/aftersales/store";
import { generateTouch } from "../../src/lib/aftersales/generate";
(async () => {
  const state = await readState();
  for (const l of fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); state.lost[r.id] = { category: r.category, at: "2026-11-25" }; }
  const cal = await buildCalendar({ horizonDays: 400, state });
  const pickKinds = ["lost_budget", "lost_silence", "lost_dates", "lost_short"];
  for (const k of pickKinds) {
    for (const t of cal.touches.filter((x) => x.kind === k).slice(0, 2)) {
      const c = cal.lost.find((x) => x.key === t.charter_key)!;
      const g = await generateTouch(t.kind, c, t.person, { due: t.due });
      console.log(`\n== ${k} · ${g.personalised ? "personalised" : "base"} · ${g.warnings.join("; ") || "clean"}${g.recent_inbound ? " · WROTE AFTER LOST " + g.recent_inbound.at : ""}\nSubject: ${g.subject}\n${g.body}`);
    }
  }
})();
