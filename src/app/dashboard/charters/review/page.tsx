// v3 Pillar 8 — Manual review queue.
//
// Lists every charter_documents row stuck in extraction_status =
// 'manual_review' (low confidence or missing critical fields). Each
// row links into the deal workspace — or, if no deal yet, into the
// "new" workspace where a human can paste corrected text and re-run
// the extraction.

import Link from "next/link";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface DocRow {
  id: string;
  deal_id: string | null;
  contact_id: string | null;
  document_type: string;
  original_filename: string | null;
  uploaded_at: string;
  extraction_status: string | null;
  extraction_confidence: number | null;
  extraction_errors: string | null;
  extracted_data: Record<string, unknown> | null;
}

export default async function ReviewQueuePage() {
  const cookieStore = await cookies();
  const sb = createServerSupabaseClient(cookieStore);

  const { data, error } = await sb
    .from("charter_documents")
    .select(
      "id, deal_id, contact_id, document_type, original_filename, uploaded_at, extraction_status, extraction_confidence, extraction_errors, extracted_data",
    )
    .eq("extraction_status", "manual_review")
    .order("uploaded_at", { ascending: false })
    .limit(200);

  const docs = (data ?? []) as DocRow[];

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="border-b pb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">⚠️ Manual review queue</h1>
          <p className="text-sm text-gray-600">
            Documents that fell below the auto-activation confidence
            threshold (0.80) or are missing critical fields.
          </p>
        </div>
        <Link
          href="/dashboard/charters"
          className="text-sm text-blue-600 underline"
        >
          ← All charters
        </Link>
      </header>

      {error && (
        <p className="text-red-600 text-sm">DB error: {error.message}</p>
      )}

      {docs.length === 0 ? (
        <p className="text-gray-500">
          Queue empty. Every uploaded document either auto-activated or
          completed cleanly.
        </p>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => {
            const target = d.deal_id
              ? `/dashboard/charters/${d.deal_id}`
              : "/dashboard/charters/new";
            return (
              <li
                key={d.id}
                className="border rounded p-4 bg-yellow-50 border-yellow-300"
              >
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="font-semibold">
                      {d.document_type}{" "}
                      <span className="text-sm text-gray-500 font-normal">
                        · {d.original_filename ?? "—"}
                      </span>
                    </h3>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Uploaded{" "}
                      {new Date(d.uploaded_at).toLocaleString()} ·
                      Confidence:{" "}
                      <strong>
                        {d.extraction_confidence
                          ? `${(d.extraction_confidence * 100).toFixed(0)}%`
                          : "—"}
                      </strong>
                    </p>
                    {d.extraction_errors && (
                      <p className="text-sm text-red-700 mt-1">
                        {d.extraction_errors}
                      </p>
                    )}
                  </div>
                  <Link
                    href={target}
                    className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded shrink-0"
                  >
                    Open workspace →
                  </Link>
                </div>
                {d.extracted_data && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-gray-600">
                      Extracted JSON
                    </summary>
                    <pre className="mt-2 bg-white border rounded p-2 overflow-auto max-h-64">
                      {JSON.stringify(d.extracted_data, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
