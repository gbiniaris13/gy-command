"use client";

import { useState } from "react";

interface CampaignRow {
  id: string;
  stream: string;
  subject: string;
  body_markdown: string | null;
  body_html: string | null;
  audience_definition: Record<string, unknown> | null;
  audience_size: number | null;
  status: string;
  test_sent_to: string | null;
  test_sent_at: string | null;
  sent_at: string | null;
  ai_generated: boolean | null;
  ai_model_used: string | null;
}

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  filter_definition: Record<string, unknown>;
}

export default function ComposerClient({
  campaign,
  segments,
  sendCounts,
}: {
  campaign: CampaignRow | null;
  segments: SegmentRow[];
  sendCounts: Record<string, number>;
}) {
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body_markdown ?? "");
  const [audienceDef, setAudienceDef] = useState<Record<string, unknown>>(
    campaign?.audience_definition ?? {
      subscribed_to_newsletter: true,
      has_email: true,
      excludes_minors: true,
    },
  );
  const [audienceSize, setAudienceSize] = useState<number | null>(
    campaign?.audience_size ?? null,
  );
  const [audienceSample, setAudienceSample] = useState<
    { email: string; first_name: string | null }[]
  >([]);
  const [testRecipients, setTestRecipients] = useState(
    "george@georgeyachts.com",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!campaign) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-red-700">Campaign not found.</p>
      </main>
    );
  }

  async function regenerate() {
    setBusy("regenerate");
    setError(null);
    try {
      const res = await fetch("/api/admin/newsletter?action=compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: campaign?.stream,
          brief: subject ? `Keep tone matching this subject: ${subject}` : undefined,
        }),
      });
      const j = (await res.json()) as {
        subject?: string;
        body_markdown?: string;
        error?: string;
      };
      if (j.error) {
        setError(j.error);
      } else {
        if (j.subject) setSubject(j.subject);
        if (j.body_markdown) setBody(j.body_markdown);
      }
    } finally {
      setBusy(null);
    }
  }

  async function previewAudience() {
    setBusy("preview");
    setError(null);
    try {
      const res = await fetch(
        "/api/admin/newsletter?action=preview-audience",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience_definition: audienceDef }),
        },
      );
      const j = (await res.json()) as {
        audience_size?: number;
        sample?: { email: string; first_name: string | null }[];
        error?: string;
      };
      if (j.error) {
        setError(j.error);
      } else {
        setAudienceSize(j.audience_size ?? 0);
        setAudienceSample(j.sample ?? []);
      }
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/newsletter?id=${campaign?.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          body_markdown: body,
          audience_definition: audienceDef,
        }),
      });
      // PATCH not implemented yet — fall back to PUT-like via DELETE+POST? simplest: just direct PG via POST as create (would dupe).
      // For v1, we save by recreating the campaign via the storage API.
      // Until then, treat the textareas as the live source — surface a hint.
      if (res.status === 405 || res.status === 404) {
        setMessage(
          "Inline save isn't wired yet — use Test send + Send actions; subject/body changes here are local-only.",
        );
      } else if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? `save failed (${res.status})`);
      } else {
        setMessage("Saved.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function testSend() {
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      const recipients = testRecipients
        .split(/[,\s;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(
        `/api/admin/newsletter?action=test-send&id=${campaign?.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients }),
        },
      );
      const j = (await res.json()) as {
        results?: { to: string; ok: boolean; error?: string }[];
        error?: string;
      };
      if (j.error) {
        setError(j.error);
      } else {
        const okCount = (j.results ?? []).filter((r) => r.ok).length;
        const failCount = (j.results ?? []).filter((r) => !r.ok).length;
        setMessage(`Test send: ${okCount} ok, ${failCount} failed.`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function sendForReal() {
    if (
      !confirm(
        `This will send to the full audience (${audienceSize ?? "?"} recipients). Continue?`,
      )
    )
      return;
    setBusy("send");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/newsletter?action=send&id=${campaign?.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        },
      );
      const j = (await res.json()) as {
        sent?: number;
        failed?: number;
        status?: string;
        hint?: string;
        error?: string;
      };
      if (j.error) {
        setError(j.error);
      } else {
        setMessage(
          `${j.sent ?? 0} sent · ${j.failed ?? 0} failed · status: ${j.status} · ${j.hint ?? ""}`,
        );
        setTimeout(() => window.location.reload(), 2000);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="border-b pb-4">
        <h1 className="text-2xl font-bold">📨 {subject || "Untitled draft"}</h1>
        <p className="text-sm text-gray-600">
          Stream: <strong>{campaign.stream}</strong> · Status:{" "}
          <strong>{campaign.status}</strong>
          {campaign.ai_generated && (
            <>
              {" "}
              · AI: <strong>{campaign.ai_model_used ?? "yes"}</strong>
            </>
          )}
        </p>
        {campaign.test_sent_at && (
          <p className="text-xs text-gray-500 mt-1">
            Last test: {new Date(campaign.test_sent_at).toLocaleString()} →{" "}
            {campaign.test_sent_to}
          </p>
        )}
        {campaign.sent_at && (
          <p className="text-xs text-green-700 mt-1">
            Sent {new Date(campaign.sent_at).toLocaleString()}
          </p>
        )}
        {Object.keys(sendCounts).length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Send breakdown:{" "}
            {Object.entries(sendCounts)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ")}
          </p>
        )}
      </header>

      <section className="rounded border p-4 space-y-3">
        <div className="flex justify-between items-baseline">
          <h2 className="font-semibold">Composition</h2>
          <button
            onClick={regenerate}
            disabled={busy !== null}
            className="text-xs text-blue-600 underline disabled:opacity-50"
          >
            {busy === "regenerate" ? "Regenerating…" : "↻ AI regenerate"}
          </button>
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full border rounded p-2 text-sm font-medium"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          className="w-full border rounded p-2 text-sm font-mono"
          placeholder="Markdown body — use {first_name} as a placeholder for personalization."
        />
      </section>

      <section className="rounded border p-4 space-y-3">
        <h2 className="font-semibold">Audience</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="text-xs text-gray-500">Use saved segment</span>
            <select
              value={(audienceDef.segment_id as string) ?? ""}
              onChange={(e) =>
                setAudienceDef({
                  ...audienceDef,
                  segment_id: e.target.value || undefined,
                })
              }
              className="w-full border rounded p-2 mt-1"
            >
              <option value="">(none — use filters below)</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">contact_type filter</span>
            <input
              value={(audienceDef.contact_type as string) ?? ""}
              onChange={(e) =>
                setAudienceDef({
                  ...audienceDef,
                  contact_type: e.target.value || undefined,
                })
              }
              placeholder="DIRECT_CLIENT, TRAVEL_ADVISOR, GUEST_NETWORK…"
              className="w-full border rounded p-2 mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">country filter</span>
            <input
              value={(audienceDef.country as string) ?? ""}
              onChange={(e) =>
                setAudienceDef({
                  ...audienceDef,
                  country: e.target.value || undefined,
                })
              }
              placeholder="GR, US, GB…"
              className="w-full border rounded p-2 mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">network_source filter</span>
            <input
              value={(audienceDef.network_source as string) ?? ""}
              onChange={(e) =>
                setAudienceDef({
                  ...audienceDef,
                  network_source: e.target.value || undefined,
                })
              }
              placeholder="effie_star_jun_2026_charter"
              className="w-full border rounded p-2 mt-1"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={previewAudience}
            disabled={busy !== null}
            className="text-sm bg-gray-200 px-3 py-1.5 rounded disabled:opacity-50"
          >
            {busy === "preview" ? "Counting…" : "🔍 Preview audience"}
          </button>
          {audienceSize !== null && (
            <span className="text-sm">
              <strong>{audienceSize}</strong> recipients matched
            </span>
          )}
        </div>
        {audienceSample.length > 0 && (
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer">
              First {audienceSample.length} recipients
            </summary>
            <ul className="mt-2 space-y-0.5">
              {audienceSample.map((m) => (
                <li key={m.email}>
                  {m.first_name ?? "—"} · {m.email}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded border p-4 space-y-3">
        <h2 className="font-semibold">Approval gate</h2>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <label className="block flex-1">
            <span className="text-xs text-gray-500">
              Test recipients (comma-separated)
            </span>
            <input
              value={testRecipients}
              onChange={(e) => setTestRecipients(e.target.value)}
              className="w-full border rounded p-2 mt-1 text-sm"
            />
          </label>
          <button
            onClick={testSend}
            disabled={busy !== null}
            className="text-sm bg-blue-600 text-white px-3 py-2 rounded disabled:opacity-50"
          >
            {busy === "test" ? "Sending test…" : "✉️ Send test"}
          </button>
        </div>
        <button
          onClick={sendForReal}
          disabled={busy !== null || campaign.status === "sent"}
          className="text-sm bg-red-600 text-white px-3 py-2 rounded disabled:opacity-50"
        >
          {busy === "send"
            ? "Sending…"
            : campaign.status === "sent"
              ? "Already sent"
              : `🚀 Send to ${audienceSize ?? "?"} recipients`}
        </button>
        <p className="text-xs text-gray-500">
          The send goes through Gmail per recipient and never blasts —
          one-by-one, with a per-recipient unsubscribe token. Time-budgeted
          to 250s per call; re-invoke if the audience is large.
        </p>
      </section>

      {(message || error) && (
        <section className="rounded border p-3">
          {message && <p className="text-sm text-green-700">{message}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </section>
      )}

      <p className="text-xs text-gray-500">
        Inline subject/body edits are local-only for v1 — use &quot;AI
        regenerate&quot; or recreate the draft to persist changes.
      </p>

      {/* Save action exists in code but the PATCH endpoint isn't wired
          for v1 — the button is intentionally hidden to avoid confusion. */}
      <button hidden onClick={save}>
        save
      </button>
    </main>
  );
}
