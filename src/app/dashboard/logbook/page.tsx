import { loadLogbook } from "@/lib/logbook";
import LogbookClient from "./LogbookClient";

// THE LOGBOOK (6/11/2026): how the site did, day by day. The real
// visitors and our place on Google, yesterday at a glance, every day
// kept and every month added up. Everything on the page is read from
// what the daily refresh stored (src/lib/logbook.ts).
export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await loadLogbook();
  return <LogbookClient data={data} />;
}
