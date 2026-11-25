// Read-only: what the Lighthouse list says on given days. No writes.
import { buildCalendar } from "../../src/lib/aftersales/plan";
(async () => {
  for (const day of process.argv.slice(2)) {
    const cal = await buildCalendar({ horizonDays: 3, today: day });
    const act = cal.touches.filter((t) => ["due", "generated", "waiting", "held"].includes(t.status) && t.due <= day);
    console.log(`== ${day}: ${act.length}`);
    for (const t of act) console.log(`  ${t.status.padEnd(9)} ${t.kind.padEnd(13)} ${t.person.first_name} ${t.vessel} ${t.reason_el}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
