// v3 Pillar 7+8 — Charters index.
//
// Lists every deal with charter dates, ordered by start_date asc. Top
// row "+ New charter" jumps to /dashboard/charters/new for the
// upload-first flow. Sidebar link to /dashboard/charters/review queues
// up the documents stuck in manual_review.

import Link from "next/link";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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

export default async function ChartersIndexPage() {
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  const { data: deals } = await sb
    .from("deals")
    .select(
      "id, vessel_name, charter_start_date, charter_end_date, guest_count, charter_fee_eur, payment_status, lifecycle_status, primary_contact_id",
    )
    .order("charter_start_date", { ascending: true })
    .limit(500);

  const dealList = (deals ?? []) as DealRow[];

  const contactIds = Array.from(
    new Set(dealList.map((d) => d.primary_contact_id).filter(Boolean)),
  ) as string[];

  let contactMap = new Map<string, ContactRow>();
  if (contactIds.length) {
    const { data: contacts } = await sb
      .from("contacts")
      .select("id, first_name, last_name, email")
      .in("id", contactIds);
    contactMap = new Map(
      ((contacts ?? []) as ContactRow[]).map((c) => [c.id, c]),
    );
  }

  const { count: reviewCount } = await sb
    .from("charter_documents")
    .select("id", { count: "exact", head: true })
    .eq("extraction_status", "manual_review");

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-baseline justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">🛥️ Charters</h1>
          <p className="text-sm text-gray-600">
            All charter deals · {dealList.length} on file
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/charters/review"
            className="text-sm bg-yellow-100 text-yellow-900 border border-yellow-300 px-3 py-1.5 rounded"
          >
            ⚠️ Review queue ({reviewCount ?? 0})
          </Link>
          <Link
            href="/dashboard/charters/new"
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded"
          >
            + New charter
          </Link>
        </div>
      </header>

      {dealList.length === 0 ? (
        <p className="text-gray-500">
          No deals yet — upload a contract to activate the first one.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2">Vessel</th>
              <th>Client</th>
              <th>Dates</th>
              <th>Guests</th>
              <th>Fee</th>
              <th>Payment</th>
              <th>Lifecycle</th>
            </tr>
          </thead>
          <tbody>
            {dealList.map((d) => {
              const c = d.primary_contact_id
                ? contactMap.get(d.primary_contact_id)
                : null;
              const name = c
                ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                  c.email ||
                  "—"
                : "—";
              return (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-2">
                    <Link
                      className="text-blue-600 underline"
                      href={`/dashboard/charters/${d.id}`}
                    >
                      {d.vessel_name ?? "(unnamed)"}
                    </Link>
                  </td>
                  <td>{name}</td>
                  <td className="text-gray-600 text-xs">
                    {d.charter_start_date ?? "—"} → {d.charter_end_date ?? "—"}
                  </td>
                  <td>{d.guest_count ?? "—"}</td>
                  <td>
                    {d.charter_fee_eur
                      ? `€${Number(d.charter_fee_eur).toLocaleString()}`
                      : "—"}
                  </td>
                  <td>{d.payment_status ?? "—"}</td>
                  <td>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        d.lifecycle_status === "active"
                          ? "bg-green-100 text-green-800"
                          : d.lifecycle_status === "in_progress"
                            ? "bg-blue-100 text-blue-800"
                            : d.lifecycle_status === "completed"
                              ? "bg-gray-100 text-gray-700"
                              : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {d.lifecycle_status ?? "pending"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
