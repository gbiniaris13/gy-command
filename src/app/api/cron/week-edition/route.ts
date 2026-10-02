// Daily 05:00 UTC (08:00 Athens): the Week edition email for every won
// charter whose Cabin brief is complete (src/lib/helm/week-edition.ts).
//   ?dry=1  lists candidates without writing anything.
import { NextResponse } from "next/server";
import { observeCron } from "@/lib/cron-observer";
import { dispatchWeekEditions } from "@/lib/helm/week-edition";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || url.searchParams.get("key");
  if (auth !== process.env.CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = url.searchParams.get("dry") === "1";
  if (dry) return NextResponse.json(await dispatchWeekEditions({ dryRun: true }));
  return observeCron("week-edition", async () => NextResponse.json(await dispatchWeekEditions()));
}
