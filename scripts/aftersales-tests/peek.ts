// Read-only: print the After sales calendar from the live data. No writes.
import { buildCalendar } from "../../src/lib/aftersales/plan";
(async () => {
  const cal = await buildCalendar({ horizonDays: 75 });
  console.log("today", cal.today, "mode", cal.mode, "charters", cal.charters.length);
  for (const c of cal.charters.slice(0, 40)) {
    console.log(`C ${c.to} ${c.vessel} | advisor=${c.via_advisor} wl=${c.white_label} | people=${c.people.map((p) => `${p.first_name}(${p.role}${p.dob ? ",dob" : ""}${p.country ? "," + p.country : ""})`).join(" ")}`);
  }
  const counts: Record<string, number> = {};
  for (const t of cal.touches) counts[t.status] = (counts[t.status] ?? 0) + 1;
  console.log("statuses", counts);
  for (const t of cal.touches.filter((x) => ["due", "generated", "waiting", "held"].includes(x.status))) {
    console.log(`T ${t.status} ${t.due}->${t.expires} ${t.kind} ${t.person.first_name} <${t.person.email.replace(/(.).*@/, "$1***@")}> ${t.vessel} ${t.reason_el}`);
  }
  for (const t of cal.touches.filter((x) => x.status === "upcoming").slice(0, 15)) console.log(`U ${t.due} ${t.kind} ${t.person.first_name} ${t.vessel}`);
})().catch((e) => { console.error(e); process.exit(1); });
