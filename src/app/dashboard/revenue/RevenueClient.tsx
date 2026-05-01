"use client";

import { useMemo, useState } from "react";

// Newsletter-style refactor (2026-04-30) — 4 tabs:
//   Overview   — 3 KPI cards + monthly commission bars
//   Deals      — full deals list with stage + status filters
//   Payments   — focus on payment status (paid / pending / overdue)
//                with separate totals + per-deal table
//   Forecast   — pipeline by stage (Hot / Warm / Meeting / Proposal)
//                with weighted forecast value

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

type Tab = "overview" | "deals" | "payments" | "forecast";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
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
    case "Meeting Booked":
      return "bg-electric-cyan/15 text-electric-cyan";
    case "Proposal Sent":
      return "bg-neon-purple/15 text-neon-purple";
    case "Warm":
      return "bg-amber/15 text-amber";
    default:
      return "bg-muted-blue/15 text-muted-blue";
  }
}

// Probability weights per stage — used for the forecast tab.
const STAGE_PROBABILITY: Record<string, number> = {
  Hot: 0.7,
  "Meeting Booked": 0.5,
  "Proposal Sent": 0.4,
  Warm: 0.25,
  "New Lead": 0.1,
  "Closed Won": 1.0,
  "Closed Lost": 0,
};

export default function RevenueClient({
  seasonRevenue,
  pendingPayments,
  pipelineValue,
  deals,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [stageFilter, setStageFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<string>("All");

  // ── Derived data ──────────────────────────────────────────────────

  const monthlyData = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const d of deals) {
      if (d.commission_earned && d.charter_start_date) {
        const month = d.charter_start_date.slice(0, 7);
        acc[month] = (acc[month] ?? 0) + d.commission_earned;
      }
    }
    return acc;
  }, [deals]);

  const sortedMonths = useMemo(
    () => Object.keys(monthlyData).sort(),
    [monthlyData],
  );
  const maxMonthly = useMemo(
    () => Math.max(...Object.values(monthlyData), 1),
    [monthlyData],
  );

  const allStages = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) {
      const s = d.pipeline_stage?.name;
      if (s) set.add(s);
    }
    return ["All", ...Array.from(set)];
  }, [deals]);

  const filteredDeals = useMemo(
    () =>
      deals.filter((d) => {
        if (stageFilter !== "All") {
          if (d.pipeline_stage?.name !== stageFilter) return false;
        }
        if (statusFilter !== "All") {
          if ((d.payment_status ?? "—") !== statusFilter) return false;
        }
        return true;
      }),
    [deals, stageFilter, statusFilter],
  );

  // Payments view aggregates
  const paymentTotals = useMemo(() => {
    const groups: Record<string, { count: number; total: number; rows: DealRow[] }> = {
      paid: { count: 0, total: 0, rows: [] },
      pending: { count: 0, total: 0, rows: [] },
      overdue: { count: 0, total: 0, rows: [] },
      other: { count: 0, total: 0, rows: [] },
    };
    for (const d of deals) {
      const k =
        d.payment_status === "paid"
          ? "paid"
          : d.payment_status === "pending"
            ? "pending"
            : d.payment_status === "overdue"
              ? "overdue"
              : "other";
      groups[k].count += 1;
      groups[k].total += d.charter_fee ?? 0;
      groups[k].rows.push(d);
    }
    return groups;
  }, [deals]);

  // Forecast aggregates
  const stageForecast = useMemo(() => {
    const groups: Record<
      string,
      { count: number; total: number; weighted: number; rows: DealRow[] }
    > = {};
    for (const d of deals) {
      const s = d.pipeline_stage?.name ?? "Unknown";
      if (s === "Closed Won" || s === "Closed Lost") continue;
      if (!groups[s]) groups[s] = { count: 0, total: 0, weighted: 0, rows: [] };
      groups[s].count += 1;
      groups[s].total += d.charter_fee ?? 0;
      groups[s].weighted += (d.charter_fee ?? 0) * (STAGE_PROBABILITY[s] ?? 0.2);
      groups[s].rows.push(d);
    }
    return groups;
  }, [deals]);

  const totalWeighted = useMemo(
    () => Object.values(stageForecast).reduce((s, g) => s + g.weighted, 0),
    [stageForecast],
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
          <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">
            RESTRICTED
          </span>
        </div>
        <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
          TREASURY — FINANCIAL INTEL
        </h1>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
          COMMISSION TRACKING · PIPELINE FORECAST · PAYMENT STATUS
        </p>
      </div>

      {/* Tab nav */}
      <div className="mb-6 flex gap-1 border-b border-white/10">
        {(
          [
            { key: "overview", label: "Overview" },
            { key: "deals", label: "Deals", count: deals.length },
            { key: "payments", label: "Payments", count: pendingPayments },
            { key: "forecast", label: "Forecast" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-[family-name:var(--font-mono)] font-bold tracking-wider uppercase transition-colors -mb-px border-b-2 ${
              tab === t.key
                ? "text-electric-cyan border-electric-cyan"
                : "text-ivory/40 border-transparent hover:text-ivory/70"
            }`}
          >
            {t.label}
            {"count" in t && t.count !== undefined && (
              <span className="ml-1.5 text-[10px] text-ivory/30">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <>
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="glass-card relative overflow-hidden p-5">
              <p className="text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                Season Revenue
              </p>
              <p className="mt-3 font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-bold text-emerald">
                {formatCurrency(seasonRevenue)}
              </p>
              <p className="mt-1 text-xs text-muted-blue/60">{formatFull(seasonRevenue)}</p>
            </div>
            <div className="glass-card relative overflow-hidden p-5">
              <p className="text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                Pipeline Value
              </p>
              <p className="mt-3 font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-bold text-electric-cyan">
                {formatCurrency(pipelineValue)}
              </p>
              <p className="mt-1 text-xs text-muted-blue/60">{formatFull(pipelineValue)}</p>
            </div>
            <div className="glass-card relative overflow-hidden p-5">
              <p className="text-[11px] font-medium tracking-wider text-muted-blue uppercase">
                Pending Payments
              </p>
              <p className="mt-3 font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-bold text-amber">
                {pendingPayments}
              </p>
              <p className="mt-1 text-xs text-muted-blue/60">
                {formatFull(paymentTotals.pending.total)} awaiting
              </p>
            </div>
          </div>

          {sortedMonths.length > 0 && (
            <div className="glass-card p-4 sm:p-6">
              <h2 className="mb-4 font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
                MONTHLY COMMISSION
              </h2>
              <div className="flex items-end gap-2 h-40">
                {sortedMonths.map((month) => {
                  const val = monthlyData[month];
                  const heightPct = (val / maxMonthly) * 100;
                  const label = new Date(month + "-01").toLocaleDateString("en-US", {
                    month: "short",
                  });
                  return (
                    <div key={month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="font-[family-name:var(--font-mono)] text-[10px] text-electric-cyan/70">
                        {formatCurrency(val)}
                      </span>
                      <div
                        className="w-full rounded-t-md transition-all hover:opacity-80"
                        style={{
                          height: `${Math.max(heightPct, 4)}%`,
                          background:
                            "linear-gradient(to top, rgba(0,255,200,0.3), rgba(0,255,200,0.1))",
                        }}
                      />
                      <span className="text-[10px] text-muted-blue">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* DEALS */}
      {tab === "deals" && (
        <div className="glass-card p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              ALL DEALS
            </h2>
            <span className="text-[10px] text-muted-blue/40">
              · showing {filteredDeals.length} of {deals.length}
            </span>
            <div className="ml-auto flex gap-1 flex-wrap">
              {allStages.slice(0, 7).map((s) => (
                <button
                  key={s}
                  onClick={() => setStageFilter(s)}
                  className={`rounded px-2 py-1 text-[10px] font-[family-name:var(--font-mono)] font-bold tracking-wider uppercase transition-colors ${
                    stageFilter === s
                      ? "bg-electric-cyan/15 text-electric-cyan border border-electric-cyan/40"
                      : "bg-glass-light/10 text-muted-blue/60 border border-white/5 hover:text-ivory/70"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {filteredDeals.length === 0 ? (
            <p className="text-sm text-muted-blue py-8 text-center">No deals match this filter.</p>
          ) : (
            <div className="space-y-2">
              {filteredDeals.map((deal) => {
                const name = [deal.first_name, deal.last_name].filter(Boolean).join(" ");
                const stage = deal.pipeline_stage?.name ?? "Unknown";
                return (
                  <a
                    key={deal.id}
                    href={`/dashboard/contacts/${deal.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border-glow bg-glass-light/30 px-3 sm:px-4 py-3 transition-all hover:border-electric-cyan/20 hover:bg-glass-light/50 min-h-[44px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-soft-white">
                          {deal.charter_vessel ?? "TBD"}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stageBadge(stage)}`}
                        >
                          {stage}
                        </span>
                      </div>
                      <p className="text-xs text-muted-blue mt-0.5">
                        {name || "Client"}
                        {deal.charter_start_date
                          ? ` · ${new Date(deal.charter_start_date).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-[family-name:var(--font-mono)] text-sm font-semibold text-electric-cyan">
                        {deal.charter_fee ? formatFull(deal.charter_fee) : "—"}
                      </p>
                      <div className="flex items-center justify-end gap-2 mt-0.5">
                        {deal.commission_earned != null && (
                          <span className="font-[family-name:var(--font-mono)] text-[10px] text-emerald">
                            +{formatFull(deal.commission_earned)}
                          </span>
                        )}
                        {deal.payment_status && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge(deal.payment_status)}`}
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
      )}

      {/* PAYMENTS */}
      {tab === "payments" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(
              [
                { key: "paid", label: "Paid", color: "text-emerald" },
                { key: "pending", label: "Pending", color: "text-amber" },
                { key: "overdue", label: "Overdue", color: "text-hot-red" },
              ] as const
            ).map((b) => {
              const grp = paymentTotals[b.key];
              return (
                <div key={b.key} className="glass-card p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-muted-blue/60 uppercase">
                    {b.label}
                  </p>
                  <p className={`mt-2 font-[family-name:var(--font-mono)] text-2xl font-black ${b.color}`}>
                    {grp.count}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-blue/60">
                    {formatFull(grp.total)} total
                  </p>
                </div>
              );
            })}
          </div>

          {paymentTotals.overdue.count > 0 && (
            <div className="glass-card p-4 border border-hot-red/30">
              <h2 className="mb-3 font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-hot-red uppercase">
                🚨 OVERDUE — needs immediate follow-up
              </h2>
              <div className="space-y-2">
                {paymentTotals.overdue.rows.map((deal) => {
                  const name = [deal.first_name, deal.last_name].filter(Boolean).join(" ");
                  return (
                    <a
                      key={deal.id}
                      href={`/dashboard/contacts/${deal.id}`}
                      className="flex items-center justify-between rounded-lg border border-hot-red/20 bg-hot-red/5 px-3 py-2.5 hover:bg-hot-red/10"
                    >
                      <span className="text-sm font-medium text-soft-white">
                        {name || "Client"} — {deal.charter_vessel ?? "TBD"}
                      </span>
                      <span className="font-[family-name:var(--font-mono)] text-sm font-semibold text-hot-red">
                        {deal.charter_fee ? formatFull(deal.charter_fee) : "—"}
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <div className="glass-card p-4">
            <h2 className="mb-3 font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              PENDING PAYMENTS — awaiting collection
            </h2>
            {paymentTotals.pending.rows.length === 0 ? (
              <p className="text-sm text-muted-blue/40 py-4 text-center">
                Nothing pending right now.
              </p>
            ) : (
              <div className="space-y-2">
                {paymentTotals.pending.rows.map((deal) => {
                  const name = [deal.first_name, deal.last_name].filter(Boolean).join(" ");
                  return (
                    <a
                      key={deal.id}
                      href={`/dashboard/contacts/${deal.id}`}
                      className="flex items-center justify-between rounded-lg border border-amber/15 bg-amber/5 px-3 py-2.5 hover:bg-amber/10"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-soft-white truncate">
                          {name || "Client"} — {deal.charter_vessel ?? "TBD"}
                        </p>
                        <p className="text-[10px] text-muted-blue/60">
                          {deal.charter_start_date
                            ? new Date(deal.charter_start_date).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </p>
                      </div>
                      <span className="font-[family-name:var(--font-mono)] text-sm font-semibold text-amber">
                        {deal.charter_fee ? formatFull(deal.charter_fee) : "—"}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* FORECAST */}
      {tab === "forecast" && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <h2 className="mb-2 font-[family-name:var(--font-mono)] text-xs font-bold tracking-[2px] text-electric-cyan uppercase">
              WEIGHTED PIPELINE FORECAST
            </h2>
            <p className="font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-bold text-neon-purple">
              {formatCurrency(totalWeighted)}
            </p>
            <p className="mt-1 text-[11px] text-muted-blue/60">
              {formatFull(totalWeighted)} weighted pipeline value · multiply by your commission rate (~10–15%) for expected income
            </p>
            <p className="mt-2 text-[10px] text-muted-blue/40">
              Probabilities: Hot 70% · Meeting 50% · Proposal 40% · Warm 25% · New 10%
            </p>
          </div>

          {Object.entries(stageForecast)
            .sort((a, b) => b[1].weighted - a[1].weighted)
            .map(([stage, grp]) => {
              const prob = STAGE_PROBABILITY[stage] ?? 0.2;
              return (
                <div key={stage} className="glass-card p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${stageBadge(stage)}`}
                    >
                      {stage}
                    </span>
                    <span className="text-[10px] text-muted-blue/60">
                      {grp.count} deal{grp.count === 1 ? "" : "s"} · {formatFull(grp.total)} ·{" "}
                      <span className="text-neon-purple/80">
                        {formatFull(grp.weighted)} weighted ({Math.round(prob * 100)}%)
                      </span>
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {grp.rows.map((deal) => {
                      const name = [deal.first_name, deal.last_name].filter(Boolean).join(" ");
                      return (
                        <a
                          key={deal.id}
                          href={`/dashboard/contacts/${deal.id}`}
                          className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-glass-light/20 text-[11px]"
                        >
                          <span className="text-soft-white truncate max-w-[60%]">
                            {name || "Client"} — {deal.charter_vessel ?? "TBD"}
                          </span>
                          <span className="font-[family-name:var(--font-mono)] text-electric-cyan">
                            {deal.charter_fee ? formatFull(deal.charter_fee) : "—"}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}

          {Object.keys(stageForecast).length === 0 && (
            <div className="glass-card p-8 text-center">
              <p className="text-sm text-muted-blue/40">
                No active pipeline. Move deals to Hot / Warm / Meeting / Proposal stages to forecast.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
