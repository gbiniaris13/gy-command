"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Deal {
  id: string;
  name: string;
  company: string | null;
  vessel: string | null;
  charter_start: string | null;
  charter_end: string | null;
  charter_fee: string | null;
  payment_status: string;
  last_activity_at: string | null;
  days_until_charter: number | null;
}

export default function ClientIntelWidget() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/crm/active-deals")
      .then((r) => (r.ok ? r.json() : { deals: [] }))
      .then((d) => setDeals(d.deals ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="h-2 w-2 rounded-full bg-emerald" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          CLIENT INTEL — ACTIVE OPERATIONS
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
          {deals.length} OPS
        </span>
        <svg className={`h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {!collapsed && (
        <div className="mt-4">
          {deals.length === 0 ? (
            <p className="py-4 text-center font-[family-name:var(--font-mono)] text-xs text-muted-blue/40">
              NO ACTIVE OPERATIONS
            </p>
          ) : (
            <div className="space-y-3">
              {deals.map((deal) => (
                <Link
                  key={deal.id}
                  href={`/dashboard/contacts/${deal.id}`}
                  className="block rounded-lg border border-border-glow bg-glass-light/20 p-4 transition-all hover:border-electric-cyan/20"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-[family-name:var(--font-mono)] text-sm font-bold text-soft-white">
                        {deal.vessel ? `OP: ${deal.vessel.toUpperCase()}` : deal.name}
                      </p>
                      <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/60">
                        {deal.name}{deal.company ? ` — ${deal.company}` : ""}
                      </p>
                    </div>
                    {deal.charter_fee && (
                      <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-electric-cyan">
                        {deal.charter_fee}
                      </span>
                    )}
                  </div>

                  {/* Charter dates */}
                  {deal.charter_start && (
                    <div className="mb-2 font-[family-name:var(--font-mono)] text-[10px] text-muted-blue/50">
                      DATES: {new Date(deal.charter_start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {deal.charter_end ? ` — ${new Date(deal.charter_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                    </div>
                  )}

                  {/* Payment + countdown */}
                  <div className="flex items-center gap-3">
                    <div className="rounded border border-border-glow bg-glass-light/30 px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[10px]">
                      <span className="text-muted-blue/50">PAYMENT: </span>
                      <span className={deal.payment_status === "paid" ? "text-emerald" : deal.payment_status === "partial" ? "text-amber" : "text-muted-blue/60"}>
                        {deal.payment_status === "paid" ? "COMPLETE" : deal.payment_status === "partial" ? "PARTIAL" : "PENDING"}
                      </span>
                    </div>
                    {deal.days_until_charter !== null && deal.days_until_charter > 0 && (
                      <span className={`font-[family-name:var(--font-mono)] text-[10px] font-bold ${
                        deal.days_until_charter < 15 ? "text-hot-red" : deal.days_until_charter < 30 ? "text-amber" : "text-electric-cyan/60"
                      }`}>
                        T-{deal.days_until_charter} DAYS
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
