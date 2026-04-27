// v3 Pillar 9 — Network growth dashboard.
//
// "How many contacts did George's network gain from each charter?"
// Groups contacts by network_source — the slug stamped on every contact
// created via the multi-guest cascade — and shows totals + recency.
//
// Plus a roll-up: how many GUEST_NETWORK contacts exist overall, how
// many have emails, how many have replied to a George email (proxy:
// last_activity_at < 90d).

import Link from "next/link";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  contact_type: string | null;
  relationship_to_primary: string | null;
  network_source: string | null;
  is_minor: boolean | null;
  last_activity_at: string | null;
  created_at: string | null;
  linked_charters: string[] | null;
}

interface DealRow {
  id: string;
  vessel_name: string | null;
  charter_start_date: string | null;
  primary_contact_id: string | null;
}

function daysSince(iso: string | null): number {
  if (!iso) return 999;
  const d = new Date(iso).getTime();
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}

export default async function NetworkPage() {
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  // Pull guest-network contacts in pages of 1000.
  const all: ContactRow[] = [];
  let from = 0;
  while (from < 10000) {
    const { data, error } = await sb
      .from("contacts")
      .select(
        "id, first_name, last_name, email, contact_type, relationship_to_primary, network_source, is_minor, last_activity_at, created_at, linked_charters",
      )
      .not("network_source", "is", null)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    all.push(...(data as ContactRow[]));
    if (data.length < 1000) break;
    from += 1000;
  }

  // Group by source.
  type Bucket = {
    network_source: string;
    contacts: ContactRow[];
    deal_id: string | null;
  };
  const bucketsMap = new Map<string, Bucket>();
  for (const c of all) {
    const src = c.network_source ?? "(none)";
    if (!bucketsMap.has(src)) {
      bucketsMap.set(src, { network_source: src, contacts: [], deal_id: null });
    }
    bucketsMap.get(src)!.contacts.push(c);
  }
  const buckets = Array.from(bucketsMap.values()).sort(
    (a, b) => b.contacts.length - a.contacts.length,
  );

  // Hydrate the parent deal (any of the linked_charters[] pointers
  // for any contact in the bucket, first one wins — they're all
  // tied to the same charter).
  const dealIdSet = new Set<string>();
  for (const b of buckets) {
    for (const c of b.contacts) {
      if (Array.isArray(c.linked_charters)) {
        for (const id of c.linked_charters) dealIdSet.add(id);
      }
    }
  }
  const dealMap = new Map<string, DealRow>();
  if (dealIdSet.size) {
    const { data: deals } = await sb
      .from("deals")
      .select("id, vessel_name, charter_start_date, primary_contact_id")
      .in("id", Array.from(dealIdSet));
    for (const d of (deals ?? []) as DealRow[]) dealMap.set(d.id, d);
  }
  for (const b of buckets) {
    for (const c of b.contacts) {
      const id = (c.linked_charters ?? [])[0];
      if (id && dealMap.has(id)) {
        b.deal_id = id;
        break;
      }
    }
  }

  const totalNetworkContacts = all.length;
  const withEmail = all.filter((c) => c.email).length;
  const recentlyActive = all.filter(
    (c) => daysSince(c.last_activity_at) <= 90,
  ).length;
  const minors = all.filter((c) => c.is_minor === true).length;

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-8">
      <header className="border-b pb-4">
        <h1 className="text-2xl font-bold">🌐 Network growth</h1>
        <p className="text-sm text-gray-600 mt-1">
          Contacts captured through the multi-guest charter cascade.
          Every onboard guest becomes a first-class contact tied to
          their host charter and primary client.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Network contacts" value={totalNetworkContacts} />
        <Stat label="With email" value={withEmail} />
        <Stat label="Active in 90d" value={recentlyActive} />
        <Stat label="Minors" value={minors} subtle />
      </section>

      <section>
        <h2 className="font-semibold mb-3">By charter</h2>
        {buckets.length === 0 ? (
          <p className="text-gray-500">
            No network contacts yet. Upload a passport, guest list or PIF
            against an active deal to seed the network.
          </p>
        ) : (
          <div className="space-y-4">
            {buckets.map((b) => {
              const deal = b.deal_id ? dealMap.get(b.deal_id) : null;
              const title = deal
                ? `${deal.vessel_name ?? "(unnamed)"} · ${deal.charter_start_date ?? ""}`
                : b.network_source;
              return (
                <div key={b.network_source} className="border rounded p-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="font-medium">
                      {title}{" "}
                      <span className="text-xs text-gray-500 font-normal">
                        · {b.contacts.length} guests
                      </span>
                    </h3>
                    {b.deal_id && (
                      <Link
                        href={`/dashboard/charters/${b.deal_id}`}
                        className="text-xs text-blue-600 underline"
                      >
                        Open charter →
                      </Link>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-gray-500 border-b">
                      <tr>
                        <th className="py-1">Name</th>
                        <th>Relationship</th>
                        <th>Email</th>
                        <th>Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.contacts.map((c) => {
                        const name =
                          `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() ||
                          c.email ||
                          "—";
                        return (
                          <tr
                            key={c.id}
                            className="border-b last:border-0 align-top"
                          >
                            <td className="py-1.5">
                              <Link
                                href={`/dashboard/contacts/${c.id}`}
                                className="text-blue-600 underline"
                              >
                                {name}
                              </Link>
                              {c.is_minor && (
                                <span className="ml-2 text-[10px] uppercase bg-yellow-100 text-yellow-800 rounded px-1.5">
                                  minor
                                </span>
                              )}
                            </td>
                            <td className="text-gray-600">
                              {c.relationship_to_primary ?? "—"}
                            </td>
                            <td className="text-gray-600">{c.email ?? "—"}</td>
                            <td className="text-gray-500 text-xs">
                              {c.last_activity_at
                                ? `${daysSince(c.last_activity_at)}d ago`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  subtle = false,
}: {
  label: string;
  value: number;
  subtle?: boolean;
}) {
  return (
    <div className="border rounded p-4 text-center">
      <div
        className={`text-3xl font-serif ${subtle ? "text-gray-500" : "text-gray-900"}`}
      >
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] uppercase tracking-widest text-gray-500 mt-1">
        {label}
      </div>
    </div>
  );
}
