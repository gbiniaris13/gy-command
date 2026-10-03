// Daily 05:20 UTC (08:20 Athens): the one morning email. `?preview=1`
// returns the HTML instead of sending.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { observeCron } from "@/lib/cron-observer";
import { buildMorningBrief, sendMorningBrief } from "@/lib/morning-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const u = new URL(req.url);
  if (u.searchParams.get("preview") === "1") {
    const b = await buildMorningBrief();
    return new NextResponse(b.html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (u.searchParams.get("text") === "1") {
    const b = await buildMorningBrief();
    return NextResponse.json({ ok: true, subject: b.subject, text: b.text, sections: b.sections.map((s) => s.title) });
  }
  return observeCron("morning-brief", async () => NextResponse.json({ ok: true, ...(await sendMorningBrief()) }));
}
