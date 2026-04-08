import { createServiceClient } from "@/lib/supabase-server";
import CalendarClient from "./CalendarClient";

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

  return <CalendarClient />;
}
