"use client";

// v3 Pillar 8 — Upload UI for charter documents.
//
// Drag-and-drop / file picker / paste-text for the four primary
// document types. Sends to /api/admin/charter-extract and shows the
// extraction result inline. For contracts, surfaces the activation
// summary (deal_id, milestones generated).

import { useState } from "react";

interface DealRow {
  id: string;
  primary_contact_id: string | null;
  vessel_name: string | null;
  charter_start_date: string | null;
  charter_end_date: string | null;
  embark_port: string | null;
  disembark_port: string | null;
  guest_count: number | null;
  charter_fee_eur: number | null;
  apa_eur: number | null;
  total_eur: number | null;
  payment_status: string | null;
  contract_signed: boolean | null;
  lifecycle_status: string | null;
  lifecycle_activated_at: string | null;
}

interface DocRow {
  id: string;
  document_type: string;
  original_filename: string | null;
  uploaded_at: string;
  extraction_status: string | null;
  extraction_confidence: number | null;
  extraction_errors: string | null;
}

interface MilestoneRow {
  id: string;
  milestone_type: string;
  due_date: string;
  status: string;
  auto_action: string | null;
}

type DocumentType = "contract" | "passport" | "guest_list" | "pif";

interface ExtractResponse {
  ok: boolean;
  document_id: string;
  document_type: string;
  extraction_status: string;
  extraction_confidence: number;
  extraction_errors: string | null;
  extracted_data: unknown;
  activation: {
    ok: boolean;
    deal_id: string | null;
    milestones_generated: number;
    client_full_name: string | null;
    vessel_name: string | null;
    charter_start_date: string | null;
    charter_end_date: string | null;
    message: string;
  } | null;
}

const TYPE_LABELS: Record<DocumentType, string> = {
  contract: "📜 Contract (MYBA / private)",
  passport: "🛂 Passport",
  guest_list: "👥 Guest list (CSV / text)",
  pif: "📋 PIF (Preference & Information Form)",
};

const TYPE_HINTS: Record<DocumentType, string> = {
  contract:
    "Paste the full contract text. The activation cascade will populate the deal, mirror to the contact, and generate the 17 lifecycle milestones if confidence ≥ 0.80.",
  passport:
    "Paste OCR'd passport text. Only the last 4 digits of the passport number will be persisted.",
  guest_list:
    "Paste a CSV or freeform list. Columns: name, email, phone, role, notes (any subset works).",
  pif: "Paste the completed PIF. Captures dietary, allergies, music, special occasions, kids/pets onboard.",
};

export default function UploadClient(props: {
  dealId: string | null;
  deal: DealRow | null;
  documents: DocRow[];
  milestones: MilestoneRow[];
  primaryContactName: string | null;
}) {
  const { dealId, deal, documents, milestones, primaryContactName } = props;

  const [docType, setDocType] = useState<DocumentType>("contract");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("document_type", docType);
      form.set("raw_text", rawText);
      if (file) form.set("file", file);
      if (dealId) form.set("deal_id", dealId);
      if (deal?.primary_contact_id)
        form.set("primary_contact_id", deal.primary_contact_id);

      const res = await fetch("/api/admin/charter-extract", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as ExtractResponse & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? "extraction failed");
      } else {
        setResult(json);
        // If a brand-new deal was created, jump to its page.
        if (
          json.activation?.deal_id &&
          json.activation.deal_id !== dealId
        ) {
          setTimeout(() => {
            window.location.href = `/dashboard/charters/${json.activation!.deal_id}`;
          }, 1500);
        } else {
          setTimeout(() => window.location.reload(), 1500);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function readFileAsText(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(f);
    });
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && /\.(txt|csv|tsv|md|json)$/i.test(f.name)) {
      try {
        const text = await readFileAsText(f);
        setRawText(text);
      } catch {
        // user can paste manually
      }
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="border-b pb-4">
        <h1 className="text-2xl font-bold">
          🛥️ Charter workspace
          {deal?.vessel_name && (
            <span className="text-gray-500 font-normal">
              {" "}
              — {deal.vessel_name}
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          {dealId === null ? (
            "New charter — upload the contract first to activate."
          ) : (
            <>
              Deal <code className="text-xs">{dealId}</code>
              {primaryContactName && <> · {primaryContactName}</>}
              {deal?.charter_start_date && (
                <>
                  {" "}
                  · {deal.charter_start_date} → {deal.charter_end_date}
                </>
              )}
              {deal?.lifecycle_status && (
                <>
                  {" "}
                  · <strong>{deal.lifecycle_status}</strong>
                </>
              )}
            </>
          )}
        </p>
      </header>

      {/* Deal summary */}
      {deal && (
        <section className="rounded border bg-gray-50 p-4">
          <h2 className="font-semibold mb-2">Charter snapshot</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Vessel</dt>
              <dd>{deal.vessel_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Embark</dt>
              <dd>{deal.embark_port ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Disembark</dt>
              <dd>{deal.disembark_port ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Guests</dt>
              <dd>{deal.guest_count ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Charter fee</dt>
              <dd>
                {deal.charter_fee_eur
                  ? `€${Number(deal.charter_fee_eur).toLocaleString()}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">APA</dt>
              <dd>
                {deal.apa_eur
                  ? `€${Number(deal.apa_eur).toLocaleString()}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Total</dt>
              <dd>
                {deal.total_eur
                  ? `€${Number(deal.total_eur).toLocaleString()}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Payment</dt>
              <dd>{deal.payment_status ?? "—"}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Upload form */}
      <section className="rounded border p-4">
        <h2 className="font-semibold mb-3">Upload a document</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TYPE_LABELS) as DocumentType[]).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setDocType(t)}
                className={`text-sm px-3 py-1 rounded border ${
                  docType === t
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300"
                }`}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600">{TYPE_HINTS[docType]}</p>

          <div>
            <label className="block text-sm font-medium mb-1">
              File (optional — stored in bucket)
            </label>
            <input
              type="file"
              onChange={onFileChange}
              className="text-sm"
              accept=".pdf,.txt,.csv,.tsv,.md,.json,.jpg,.jpeg,.png,.docx"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Document text (paste here — required for AI extraction)
            </label>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              required
              minLength={20}
              rows={12}
              className="w-full border rounded p-2 font-mono text-xs"
              placeholder="Paste the full text of the contract / passport / guest list / PIF here…"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting || rawText.length < 20}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            >
              {submitting ? "Extracting…" : "Extract & process"}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      </section>

      {/* Result */}
      {result && (
        <section
          className={`rounded border p-4 ${
            result.activation?.ok
              ? "border-green-600 bg-green-50"
              : result.extraction_status === "manual_review"
                ? "border-yellow-600 bg-yellow-50"
                : "border-gray-300"
          }`}
        >
          <h3 className="font-semibold">
            {result.activation?.ok
              ? "✅ Charter activated"
              : result.extraction_status === "manual_review"
                ? "⚠️ Manual review required"
                : `Status: ${result.extraction_status}`}
          </h3>
          <p className="text-sm mt-1">
            Confidence:{" "}
            <strong>{(result.extraction_confidence * 100).toFixed(0)}%</strong>
            {result.extraction_errors && (
              <span className="text-red-700"> · {result.extraction_errors}</span>
            )}
          </p>
          {result.activation && (
            <p className="text-sm mt-1">
              {result.activation.message}
              {result.activation.client_full_name && (
                <>
                  {" "}
                  · Client:{" "}
                  <strong>{result.activation.client_full_name}</strong>
                </>
              )}
              {result.activation.vessel_name && (
                <> · Vessel: <strong>{result.activation.vessel_name}</strong></>
              )}
            </p>
          )}
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-gray-600">
              Raw extraction
            </summary>
            <pre className="mt-2 bg-white border rounded p-2 overflow-auto max-h-96">
              {JSON.stringify(result.extracted_data, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {/* Existing documents */}
      {documents.length > 0 && (
        <section className="rounded border p-4">
          <h2 className="font-semibold mb-3">Documents on file</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b">
              <tr>
                <th className="py-1">Type</th>
                <th>Filename</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-1">{d.document_type}</td>
                  <td className="text-gray-600">
                    {d.original_filename ?? "—"}
                  </td>
                  <td className="text-gray-500">
                    {new Date(d.uploaded_at).toLocaleString()}
                  </td>
                  <td>
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        d.extraction_status === "extracted"
                          ? "bg-green-100 text-green-800"
                          : d.extraction_status === "manual_review"
                            ? "bg-yellow-100 text-yellow-800"
                            : d.extraction_status === "failed"
                              ? "bg-red-100 text-red-800"
                              : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {d.extraction_status ?? "pending"}
                    </span>
                  </td>
                  <td className="text-gray-500">
                    {d.extraction_confidence
                      ? `${(d.extraction_confidence * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Lifecycle milestones */}
      {milestones.length > 0 && (
        <section className="rounded border p-4">
          <h2 className="font-semibold mb-3">
            17-milestone lifecycle ({milestones.length} planned)
          </h2>
          <ol className="text-sm space-y-1">
            {milestones.map((m) => (
              <li key={m.id} className="flex gap-3">
                <span className="font-mono text-xs w-24 text-gray-600">
                  {m.milestone_type}
                </span>
                <span className="font-mono text-xs w-24 text-gray-500">
                  {m.due_date}
                </span>
                <span
                  className={`text-xs px-1.5 rounded w-20 text-center ${
                    m.status === "completed"
                      ? "bg-green-100 text-green-800"
                      : m.status === "blocked"
                        ? "bg-red-100 text-red-800"
                        : m.status === "skipped"
                          ? "bg-gray-100 text-gray-600"
                          : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {m.status}
                </span>
                <span className="text-gray-700 flex-1">{m.auto_action}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
