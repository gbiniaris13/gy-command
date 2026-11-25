// Read-only: the unified Lighthouse calendar from the live data. No writes.
import { buildCalendar } from "../../src/lib/aftersales/plan";
(async () => {
  const cal = await buildCalendar({ horizonDays: 370 });
  console.log("today", cal.today, "mode", cal.mode, "charters", cal.charters.length, "lost", cal.lost.length);
  for (const c of cal.charters) console.log(`C ${c.from}..${c.to} ${c.vessel} | people=${c.people.map((p) => `${p.first_name}(${p.role}${p.dob ? ",dob " + p.dob : ""}${p.country ? "," + p.country : ""})`).join(" ")}`);
  const counts: Record<string, number> = {};
  for (const t of cal.touches) counts[t.status] = (counts[t.status] ?? 0) + 1;
  console.log("statuses", counts);
  for (const t of cal.touches.filter((x) => !x.kind.startsWith("lost_") && x.due <= "2027-02-28")) {
    console.log(`${t.status.padEnd(9)} ${t.due} ${t.kind.padEnd(12)} ${t.person.first_name.padEnd(9)} ${t.vessel} ${t.reason_el}`);
  }
  const lostByDue: Record<string, number> = {};
  for (const t of cal.touches.filter((x) => x.kind.startsWith("lost_"))) lostByDue[`${t.due} ${t.status}`] = (lostByDue[`${t.due} ${t.status}`] ?? 0) + 1;
  console.log("lost", lostByDue);
})().catch((e) => { console.error(e); process.exit(1); });
