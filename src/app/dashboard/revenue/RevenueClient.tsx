"use client";

interface DealRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  charter_vessel: string | null;
  charter_fee: number | null;
  commission_earned: number | null;
  commission_rate: number | null;
  payment_status: string | null;
  charter_start_date: string | null;
  pipeline_stage: { name: string } | null;
}

interface Props {
  seasonRevenue: number;
  pendingPayments: number;
  pipelineValue: number;
  deals: DealRow[];
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return value.toLocaleString();
}

function formatFull(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function statusBadge(status: string | null) {
  switch (status) {
    case "paid":
      return "bg-emerald/15 text-emerald";
    case "pending":
      return "bg-amber/15 text-amber";
    case "overdue":
      return "bg-hot-red/15 text-hot-red";
    default:
      return "bg-muted-blue/15 text-muted-blue";
  }
}

function stageBadge(name: string) {
  switch (name) {
    case "Closed Won":
      return "bg-emerald/15 text-emerald";
    case "Hot":
      return "bg-hot-red/15 text-hot-red";
    case "Meeting":
      return "bg-electric-cyan/15 text-electric-cyan";
    case "Proposal":
      return "bg-neon-purple/15 text-neon-purple";
    default:
      return "bg-muted-blue/15 text-muted-blue";
  }
}

export default function RevenueClient({
  seasonRevenue,
  pendingPayments,
  pipelineValue,
  deals,
}: Props) {
  // Monthly revenue chart data
  const monthlyData = deals.reduce<Record<string, number>>((acc, d) => {
    if (d.commission_earned && d.charter_start_date) {
      const month = d.charter_start_date.slice(0, 7); // "YYYY-MM"
      acc[month] = (acc[month] ?? 0) + d.commission_earned;
    }
    return acc;
  }, {});

  const sortedMonths = Object.keys(monthlyData).sort();
  const maxMonthly = Math.max(...Object.values(monthlyData), 1);

  const stats = [
    {
      label: "Season Revenue",
      value: formatCurrency(seasonRevenue),
      sub: formatFull(seasonRevenue),
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      label: "Pending Payments",
      value: String(pendingPayments),
      sub: "awaiting payment",
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    {
      label: "Pipeline Value",
      value: formatCurrency(pipelineValue),
      sub: formatFull(pipelineValue),
      icon: (
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
          <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">RESTRICTED</span>
        </div>
        <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
          TREASURY — FINANCIAL INTEL
        </h1>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
          COMMISSION TRACKING &amp; CHARTER PIPELINE
        </p>
      </div>

      {/* Stat Cards */}
      <div className="mb-6 sm:mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="glass-card relative overflow-hidden p-5 sm:p-6"
          >
            <div className="absolute top-4 right-4 opacity-10">
              {stat.icon}
            </div>
            <p className="text-[11px] font-medium tracking-wider text-muted-blue uppercase">
              {stat.label}
            </p>
            <p className="mt-3 font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-bold text-electric-cyan">
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-muted-blue/60">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Monthly Revenue Chart */}
      {sortedMonths.length > 0 && (
        <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-base font-semibold text-soft-white">
            Monthly Commission
          </h2>
          <div className="flex items-end gap-2 h-40">
            {sortedMonths.map((month) => {
              const val = monthlyData[month];
              const heightPct = (val / maxMonthly) * 100;
              const label = new Date(month + "-01").toLocaleDateString(
                "en-US",
                { month: "short" }
              );
              return (
                <div
                  key={month}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-electric-cyan/70">
                    {formatCurrency(val)}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-electric-cyan/20 transition-all hover:bg-electric-cyan/40"
                    style={{
                      height: `${Math.max(heightPct, 4)}%`,
                      background: `linear-gradient(to top, rgba(0,255,200,0.3), rgba(0,255,200,0.1))`,
                    }}
                  />
                  <span className="text-[10px] text-muted-blue">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deals List */}
      <div className="glass-card p-4 sm:p-6">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-base font-semibold text-soft-white">
          Deals
        </h2>
        {deals.length === 0 ? (
          <p className="text-sm text-muted-blue">
            No charter deals yet. Activate a charter to see revenue data.
          </p>
        ) : (
          <div className="space-y-2">
            {deals.map((deal) => {
              const name = [deal.first_name, deal.last_name]
                .filter(Boolean)
                .join(" ");
              const stage = deal.pipeline_stage?.name ?? "Unknown";
              return (
                <a
                  key={deal.id}
                  href={`/dashboard/contacts/${deal.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border-glow bg-glass-light/30 px-3 sm:px-4 py-3 transition-all hover:border-electric-cyan/20 hover:bg-glass-light/50 min-h-[44px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-soft-white">
                        {deal.charter_vessel ?? "TBD"}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageBadge(
                          stage
                        )}`}
                      >
                        {stage}
                      </span>
                    </div>
                    <p className="text-xs text-muted-blue">
                      {name || "Client"}{" "}
                      {deal.charter_start_date
                        ? `-- ${new Date(
                            deal.charter_start_date
                          ).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`
                        : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-[family-name:var(--font-mono)] text-sm font-semibold text-electric-cyan">
                      {deal.charter_fee
                        ? formatFull(deal.charter_fee)
                        : "--"}
                    </p>
                    <div className="flex items-center justify-end gap-2 mt-0.5">
                      {deal.commission_earned != null && (
                        <span className="font-[family-name:var(--font-mono)] text-[10px] text-emerald">
                          +{formatFull(deal.commission_earned)}
                        </span>
                      )}
                      {deal.payment_status && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge(
                            deal.payment_status
                          )}`}
                        >
                          {deal.payment_status}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
