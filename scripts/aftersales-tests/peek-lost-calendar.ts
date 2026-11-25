// Read-only: the calendar with the November reasons applied in memory. Nothing written.
import fs from "node:fs";
import { buildCalendar } from "../../src/lib/aftersales/plan";
import { readState } from "../../src/lib/aftersales/store";
(async () => {
  const state = await readState();
  for (const l of fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(l); state.lost[r.id] = { category: r.category, reason_el: r.reason_el, at: "2026-11-25" };
  }
  const cal = await buildCalendar({ horizonDays: 400, state });
  const by: Record<string, number> = {};
  for (const l of cal.lost) by[l.lost!.category] = (by[l.lost!.category] ?? 0) + 1;
  console.log("lost people:", cal.lost.length, by);
  const waves: Record<string, Record<string, number>> = {};
  for (const t of cal.touches.filter((x) => x.kind.startsWith("lost_"))) { waves[t.due] ??= {}; waves[t.due][t.kind] = (waves[t.due][t.kind] ?? 0) + 1; }
  console.log(waves);
  console.log("non-lost due today:", cal.touches.filter((t) => !t.kind.startsWith("lost_") && ["due", "generated"].includes(t.status)).length);
})();
