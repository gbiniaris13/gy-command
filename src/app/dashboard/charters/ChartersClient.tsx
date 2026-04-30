"use client";

import Link from "next/link";
import { useState, useMemo } from "react";

// Phase 3.2 (2026-04-30) — Newsletter-style tabbed charters dashboard.
// Three operator views over the same deal list:
//   Pipeline    — funnel grouped by lifecycle_status (default)
//   Active      — currently chartering or embarking soon
//   Post-charter — recently completed, awaiting follow-up
//
// All filtering is client-side over the pre-fetched deals array — page
// stays a server component for the fetch, this client component just
// owns the tab UX. No URL params yet (refresh resets to Pipeline);
// can add ?tab=… later if George deep-links.

interface DealRow {
  id: string;
  vessel_name: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  guest_count: number | null;
  charter_fee_eur: number | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  primary_contact_id: string | null;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface Props {
  deals: DealRow[];
  contactsById: Record<string, ContactRow>;
  reviewCount: number;
}

const LIFECYCLE_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Inquiry", color: "bg-yellow-100 text-yellow-800" },
  active: { label: "Confirmed", color: "bg-green-100 text-green-800" },
  in_progress: { label: "In progress", color: "bg-blue-100 text-blue-800" },
  completed: { label: "Completed", color: "bg-gray-100 text-gray-700" },
};

function contactName(c: ContactRow | null | undefined): string {
  if (!c) return "—";
  const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return full || c.email || "—";
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function formatEur(amount: number | null): string {
  if (!amount) return "—";
  return `€${Number(amount).toLocaleString()}`;
}

export default function ChartersClient({ deals, contactsById, reviewCount }: Props) {
  const [tab, setTab] = useState<"pipeline" | "active" | "post">("pipeline");

  const now = Date.now();

  // Active = either currently within [start, end] OR start within next 30 days
  const activeDeals = useMemo(
    () =>
      deals.filter((d) => {
        const start = d.charter_start_date ? new Date(d.charter_start_date).getTime() : null;
        const end = d.charter_end_date ? new Date(d.charter_end_date).getTime() : null;
        if (start && end && start <= now && now <= end) return true;
        if (start && start > now && start - now <= 30 * 86400000) return true;
        return false;
      }),
    [deals, now],
  );

  // Post-charter = end_date in the past within last 90 days
  const postDeals = useMemo(
    () =>
      deals.filter((d) => {
        const end = d.charter_end_date ? new Date(d.charter_end_date).getTime() : null;
        if (!end) return false;
        return end < now && now - end <= 90 * 86400000;
      }),
    [deals, now],
  );

  // Pipeline = all deals grouped by lifecycle_status
  const pipelineGroups = useMemo(() => {
    const groups: Record<string, DealRow[]> = {
      pending: [],
      active: [],
      in_progress: [],
      completed: [],
    };
    for (const d of deals) {
      const k = d.lifecycle_status ?? "pending";
      if (!(k in groups)) groups[k] = [];
      groups[k].push(d);
    }
    return groups;
  }, [deals]);

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-baseline justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">🛥️ Charters</h1>
          <p className="text-sm text-gray-600">
            {deals.length} on file · {activeDeals.length} active · {postDeals.length} recent
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/charters/review"
            className="text-sm bg-yellow-100 text-yellow-900 border border-yellow-300 px-3 py-1.5 rounded"
          >
            ⚠️ Review queue ({reviewCount})
          </Link>
          <Link
            href="/dashboard/charters/new"
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded"
          >
            + New charter
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 border-b">
        {(
          [
            { key: "pipeline", label: "Pipeline", count: deals.length },
            { key: "active", label: "Active", count: activeDeals.length },
            { key: "post", label: "Post-charter", count: postDeals.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t.key
                ? "border-blue-600 text-blue-700 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-gray-400">{t.count}</span>
          </button>
        ))}
      </nav>

      {tab === "pipeline" && (
        <div className="space-y-6">
          {(["pending", "active", "in_progress", "completed"] as const).map(
            (status) => {
              const list = pipelineGroups[status] ?? [];
              if (list.length === 0) return null;
              const meta = LIFECYCLE_LABELS[status];
              return (
                <section key={status}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-xs text-gray-400">({list.length})</span>
                  </h2>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-gray-500 bg-gray-50 border-b">
                        <tr>
                          <th className="py-2 px-3">Vessel</th>
                          <th className="py-2 px-3">Client</th>
                          <th className="py-2 px-3">Dates</th>
                          <th className="py-2 px-3">Guests</th>
                          <th className="py-2 px-3">Fee</th>
                          <th className="py-2 px-3">Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((d) => {
                          const c = d.primary_contact_id
                            ? contactsById[d.primary_contact_id]
                            : null;
                          return (
                            <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="py-2 px-3">
                                <Link
                                  className="text-blue-600 hover:underline"
                                  href={`/dashboard/charters/${d.id}`}
                                >
                                  {d.vessel_name ?? "(unnamed)"}
                                </Link>
                              </td>
                              <td className="py-2 px-3">{contactName(c)}</td>
                              <td className="py-2 px-3 text-xs text-gray-600">
                                {d.charter_start_date ?? "—"} →{" "}
                                {d.charter_end_date ?? "—"}
                              </td>
                              <td className="py-2 px-3">{d.guest_count ?? "—"}</td>
                              <td className="py-2 px-3">{formatEur(d.charter_fee_eur)}</td>
                              <td className="py-2 px-3 text-xs">{d.payment_status ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            },
          )}
          {Object.values(pipelineGroups).every((g) => g.length === 0) && (
            <p className="text-gray-500 py-12 text-center">
              No deals yet — upload a contract to activate the first one.
            </p>
          )}
        </div>
      )}

      {tab === "active" && (
        <div className="space-y-3">
          {activeDeals.length === 0 ? (
            <p className="text-gray-500 py-12 text-center">
              No active or upcoming charters in the next 30 days.
            </p>
          ) : (
            activeDeals.map((d) => {
              const c = d.primary_contact_id ? contactsById[d.primary_contact_id] : null;
              const days = daysUntil(d.charter_start_date);
              const status =
                days !== null && days < 0
                  ? "🛳 currently sailing"
                  : days !== null
                    ? `⏳ embarks in ${days} day${days === 1 ? "" : "s"}`
                    : "—";
              return (
                <Link
                  key={d.id}
                  href={`/dashboard/charters/${d.id}`}
                  className="block rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 p-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-gray-900">
                        {d.vessel_name ?? "(unnamed)"}
                      </p>
                      <p className="text-sm text-gray-600">{contactName(c)}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {d.charter_start_date ?? "—"} → {d.charter_end_date ?? "—"} ·{" "}
                        {d.guest_count ?? "—"} guests · {formatEur(d.charter_fee_eur)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded">
                      {status}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      )}

      {tab === "post" && (
        <div className="space-y-3">
          {postDeals.length === 0 ? (
            <p className="text-gray-500 py-12 text-center">
              No recently-completed charters. (Looks at last 90 days.)
            </p>
          ) : (
            postDeals.map((d) => {
              const c = d.primary_contact_id ? contactsById[d.primary_contact_id] : null;
              const ago =
                d.charter_end_date && Math.abs(daysUntil(d.charter_end_date) ?? 0);
              return (
                <Link
                  key={d.id}
                  href={`/dashboard/charters/${d.id}`}
                  className="block rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50/30 p-4 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-gray-900">
                        {d.vessel_name ?? "(unnamed)"}
                      </p>
                      <p className="text-sm text-gray-600">{contactName(c)}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Disembarked {d.charter_end_date} · {formatEur(d.charter_fee_eur)} ·
                        Payment: {d.payment_status ?? "—"}
                      </p>
                    </div>
                    {ago !== null && (
                      <span className="shrink-0 text-xs font-medium text-amber-800 bg-amber-100 px-2 py-1 rounded">
                        {ago}d ago
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-amber-700">
                    Suggested: testimonial request · debrief notes · 6-month rebooking
                    nudge
                  </p>
                </Link>
              );
            })
          )}
        </div>
      )}
    </main>
  );
}
