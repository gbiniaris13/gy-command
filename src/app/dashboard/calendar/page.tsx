import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase-server";
import { createServerSupabaseClient } from "@/lib/supabase";
import CalendarClient from "./CalendarClient";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  let connected = false;

  try {
    const sb = createServiceClient();
    const { data } = await sb
      .from("settings")
      .select("value")
      .eq("key", "gmail_refresh_token")
      .single();
    connected = !!data?.value;
  } catch {
    connected = false;
  }

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-navy-light">
            <svg
              className="h-10 w-10 text-gold"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
              />
            </svg>
          </div>
          <h2 className="mb-2 font-[family-name:var(--font-montserrat)] text-xl font-semibold text-ivory">
            Connect Calendar
          </h2>
          <p className="mb-6 text-sm text-ivory/60">
            Connect your Google account to view and manage your calendar from GY
            Command. Calendar access is included with Gmail connection.
          </p>
          <a
            href="/api/auth/gmail"
            className="inline-flex items-center gap-2 rounded-lg border border-gold bg-gold/10 px-6 py-3 font-[family-name:var(--font-montserrat)] text-sm font-semibold text-gold transition-colors hover:bg-gold hover:text-navy"
          >
            Connect Google Account
          </a>
        </div>
      </div>
    );
  }

  // Pull upcoming + active charters from deals so the Charters tab has
  // server-rendered data on first paint. Window: any charter ending in
  // the future, or starting within the next 12 months.
  const cookieStore = await cookies();
  const sbAuth = createServerSupabaseClient(cookieStore);
  const todayIso = new Date().toISOString().slice(0, 10);
  const yearOutIso = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);

  const { data: charterDeals } = await sbAuth
    .from("deals")
    .select(
      "id, vessel_name, charter_start_date, charter_end_date, guest_count, charter_fee_eur, payment_status, lifecycle_status, primary_contact_id",
    )
    .or(
      `charter_end_date.gte.${todayIso},and(charter_start_date.gte.${todayIso},charter_start_date.lte.${yearOutIso})`,
    )
    .order("charter_start_date", { ascending: true })
    .limit(100);

  // Resolve primary contact names in one pass
  const contactIds = (charterDeals ?? [])
    .map((d) => d.primary_contact_id)
    .filter(Boolean) as string[];
  const contactsById = new Map<
    string,
    { id: string; first_name: string | null; last_name: string | null }
  >();
  if (contactIds.length > 0) {
    const { data: contacts } = await sbAuth
      .from("contacts")
      .select("id, first_name, last_name")
      .in("id", contactIds);
    for (const c of contacts ?? []) {
      contactsById.set(c.id, c);
    }
  }

  const charters = (charterDeals ?? []).map((d) => {
    const c = d.primary_contact_id
      ? contactsById.get(d.primary_contact_id)
      : null;
    return {
      id: d.id,
      vessel_name: d.vessel_name,
      start: d.charter_start_date,
      end: d.charter_end_date,
      guest_count: d.guest_count,
      fee_eur: d.charter_fee_eur,
      payment_status: d.payment_status,
      lifecycle_status: d.lifecycle_status,
      contact_id: d.primary_contact_id,
      contact_name: c
        ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()
        : null,
    };
  });

  return <CalendarClient charters={charters} />;
}
