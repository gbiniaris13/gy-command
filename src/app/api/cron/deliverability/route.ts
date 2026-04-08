import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

/**
 * Check if a DNS TXT record contains a given prefix.
 */
async function checkDnsRecord(
  domain: string,
  prefix: string
): Promise<boolean> {
  try {
    // Use Google DNS-over-HTTPS for serverless-friendly DNS lookups
    const res = await fetch(
      `https://dns.google/resolve?name=${domain}&type=TXT`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (!res.ok) return false;

    const data = await res.json();
    const answers = data.Answer ?? [];
    return answers.some(
      (a: { data?: string }) =>
        typeof a.data === "string" &&
        a.data.toLowerCase().includes(prefix.toLowerCase())
    );
  } catch {
    return false;
  }
}

/**
 * Weekly cron (Sundays 08:00 UTC): email deliverability monitor.
 * Checks SPF, DKIM, DMARC records and outreach bounce rate.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const domain = "georgeyachts.com";
    const supabase = createServiceClient();

    // DNS checks in parallel
    const [hasSPF, hasDKIM, hasDMARC] = await Promise.all([
      checkDnsRecord(domain, "v=spf1"),
      checkDnsRecord(`google._domainkey.${domain}`, "v=DKIM1").then(
        async (found) => {
          // Also try default selector
          if (found) return true;
          return checkDnsRecord(`default._domainkey.${domain}`, "v=DKIM1");
        }
      ),
      checkDnsRecord(`_dmarc.${domain}`, "v=DMARC1"),
    ]);

    // Bounce rate from outreach bot contacts
    const { count: totalOutreach } = await supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("source", "outreach_bot");

    const { count: errorOutreach } = await supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("type", "email_bounce");

    const total = totalOutreach ?? 0;
    const errors = errorOutreach ?? 0;
    const bounceRate = total > 0 ? ((errors / total) * 100).toFixed(1) : "0.0";

    const spfIcon = hasSPF ? "\u2705" : "\u274C";
    const dkimIcon = hasDKIM ? "\u2705" : "\u274C";
    const dmarcIcon = hasDMARC ? "\u2705" : "\u274C";

    const report = [
      `<b>Weekly Deliverability Report</b>`,
      "",
      `SPF: ${spfIcon}`,
      `DKIM: ${dkimIcon}`,
      `DMARC: ${dmarcIcon}`,
      `Bounce rate: ${bounceRate}% (${errors} errors / ${total} total outreach)`,
    ].join("\n");

    await sendTelegram(report);

    return NextResponse.json({
      ok: true,
      spf: hasSPF,
      dkim: hasDKIM,
      dmarc: hasDMARC,
      bounce_rate: parseFloat(bounceRate),
      total_outreach: total,
      errors,
    });
  } catch (err) {
    console.error("[Deliverability] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
