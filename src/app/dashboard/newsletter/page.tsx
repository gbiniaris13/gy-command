// v3 Pillar 4 — Newsletter index.
//
// Lists every campaign + a "+ New campaign" button. Two streams shown
// side-by-side (general / advisor). Per-campaign status badge.

import Link from "next/link";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import NewCampaignButton from "./NewCampaignButton";

export const dynamic = "force-dynamic";

interface CampaignRow {
  id: string;
  stream: string;
  subject: string;
  status: string;
  audience_size: number | null;
  sent_at: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  test_sent: "bg-blue-100 text-blue-800",
  approved: "bg-purple-100 text-purple-800",
  sending: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export default async function NewsletterIndexPage() {
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  const { data, error } = await sb
    .from("newsletter_campaigns")
    .select(
      "id, stream, subject, status, audience_size, sent_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const campaigns = (data ?? []) as CampaignRow[];

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-baseline justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">📨 Newsletter</h1>
          <p className="text-sm text-gray-600 mt-1">
            Two streams: general monthly + travel-advisor drip. Every send
            requires a test pass and an explicit confirm.
          </p>
        </div>
        <NewCampaignButton />
      </header>

      {error && (
        <p className="text-red-700 text-sm bg-red-50 border border-red-200 rounded p-3">
          DB error — likely the v3-newsletter-migration.sql hasn&apos;t
          been applied yet. Detail: {error.message}
        </p>
      )}

      {campaigns.length === 0 ? (
        <p className="text-gray-500">
          No campaigns yet. Hit &quot;+ New campaign&quot; to draft one.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2">Stream</th>
              <th>Subject</th>
              <th>Audience</th>
              <th>Status</th>
              <th>Created</th>
              <th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="py-2 text-xs uppercase tracking-wider text-gray-600">
                  {c.stream}
                </td>
                <td>
                  <Link
                    href={`/dashboard/newsletter/${c.id}`}
                    className="text-blue-600 underline"
                  >
                    {c.subject}
                  </Link>
                </td>
                <td>{c.audience_size ?? "—"}</td>
                <td>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      STATUS_STYLE[c.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
                <td className="text-gray-500 text-xs">
                  {new Date(c.created_at).toLocaleDateString()}
                </td>
                <td className="text-gray-500 text-xs">
                  {c.sent_at
                    ? new Date(c.sent_at).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
