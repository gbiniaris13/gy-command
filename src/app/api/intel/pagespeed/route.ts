import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface PSResult {
  mobile: { score: number; lcp: string; cls: string } | null;
  desktop: { score: number; lcp: string; cls: string } | null;
}

async function fetchScore(strategy: "mobile" | "desktop") {
  const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://georgeyachts.com&strategy=${strategy}&category=performance`;
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) return null;
  const json = await res.json();
  const perf = json.lighthouseResult?.categories?.performance?.score;
  const audits = json.lighthouseResult?.audits;
  return {
    score: Math.round((perf ?? 0) * 100),
    lcp: audits?.["largest-contentful-paint"]?.displayValue ?? "—",
    cls: audits?.["cumulative-layout-shift"]?.displayValue ?? "—",
  };
}

export async function GET() {
  const [mobile, desktop] = await Promise.all([
    fetchScore("mobile"),
    fetchScore("desktop"),
  ]);

  return NextResponse.json({ mobile, desktop } as PSResult);
}
