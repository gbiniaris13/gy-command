import { createServiceClient } from "@/lib/supabase-server";
import EmailClient from "./EmailClient";

export default async function EmailPage() {
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
    // Table may not exist yet or no token stored
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
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
          </div>
          <h2 className="mb-2 font-[family-name:var(--font-montserrat)] text-xl font-semibold text-ivory">
            Connect Gmail
          </h2>
          <p className="mb-6 text-sm text-ivory/60">
            Connect your Google account to manage emails, classify leads with
            AI, and sync your calendar — all from GY Command.
          </p>
          <a
            href="/api/auth/gmail"
            className="inline-flex items-center gap-2 rounded-lg border border-gold bg-gold/10 px-6 py-3 font-[family-name:var(--font-montserrat)] text-sm font-semibold text-gold transition-colors hover:bg-gold hover:text-navy"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Connect Google Account
          </a>
        </div>
      </div>
    );
  }

  return <EmailClient />;
}
