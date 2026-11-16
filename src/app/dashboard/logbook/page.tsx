import { loadLogbook } from "@/lib/logbook";
import { readClean } from "@/lib/logbookClean";
import LogbookClient from "./LogbookClient";

// THE LOGBOOK (6/11/2026): how the site did, day by day. The real
// visitors and our place on Google, yesterday at a glance, every day
// kept and every month added up. Everything on the page is read from
// what the daily refresh stored (src/lib/logbook.ts). Since 16/11/2026
// also the clean numbers, US and every other country, with their checks
// (src/lib/logbookClean.ts); if they cannot be read the page is as before.
export const dynamic = "force-dynamic";

export default async function Page() {
  const [data, clean] = await Promise.all([loadLogbook(), readClean()]);
  return <LogbookClient data={data} clean={clean} />;
}
