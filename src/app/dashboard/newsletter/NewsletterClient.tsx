"use client";

// Newsletter operator surface inside GY Command Center.
//
// Three tabs:
//   1. Subscribers  — counts, masked list, bulk add, remove, suppression
//   2. Issues       — Issue #1 status, prepare-issue button
//   3. Composer     — placeholder for Phase 3 (triggered commands)
//
// All actions go through gy-command's own proxy routes
// (/api/admin/newsletter-*) which forward to the public-site admin
// endpoints using the server-side NEWSLETTER_PROXY_SECRET. The browser
// never sees the secret.

import { useState } from "react";

type Status = {
  flag: { var_name: string; raw_value: string | null; will_send: boolean; note: string };
  subscriber_count: number;
  subscribers_by_domain: Record<string, number>;
  subscribers_masked: string[];
  subscribers?: string[];
  env_presence: Record<string, boolean>;
};

// The 4-stream taxonomy = the categorisation. When you add an email
// you're answering "what is this person to George?" and we route + tone
// from there. The §6 matrix in lib/newsletter/router.js enforces the
// commission-protection rules (e.g. broker peers never get offers).
const STREAMS = [
  {
    key: "bridge",
    label: "The Bridge — Client",
    desc: "Charter client / prospect (UHNW). Gets stories, intel, new arrivals. Never offers with prices.",
    cadence: "Bi-weekly · Thursdays",
  },
  {
    key: "wake",
    label: "The Wake — Travel Advisor",
    desc: "Travel advisors, concierges, agencies. Commission-friendly intel + white-label-ready copy.",
    cadence: "Monthly · 15th",
  },
  {
    key: "compass",
    label: "The Compass — Broker Peer",
    desc: "Other yacht brokers / industry insiders. Peer-to-peer signals only — never offers, never new-arrival pitches.",
    cadence: "Bi-monthly · 1st",
  },
  {
    key: "greece",
    label: "Από την Ελλάδα — Greek personal",
    desc: "George's personal Greek-speaking circle. Casual, ad-hoc, written in Greek.",
    cadence: "Ad hoc",
  },
] as const;

type StreamKey = (typeof STREAMS)[number]["key"];

export default function NewsletterClient(props: {
  initialStatus: Status | null;
  initialError: string | null;
}) {
  const [tab, setTab] = useState<"subscribers" | "issues" | "composer">("subscribers");
  const [status, setStatus] = useState<Status | null>(props.initialStatus);
  const [error, setError] = useState<string | null>(props.initialError);

  async function refreshStatus() {
    try {
      // The status route exists on the public site, but the proxy
      // already grabbed it server-side at page load. We refresh by
      // calling the same proxy via a small client-side route. To keep
      // the bundle minimal we skip a dedicated /api/admin/newsletter-status
      // proxy and just reload the page — Next handles caching.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "refresh failed");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-baseline justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold">📨 Newsletter</h1>
          <p className="text-sm text-gray-600">
            The Bridge · The Wake · The Compass · Από την Ελλάδα
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status?.flag?.will_send ? (
            <span className="text-xs bg-green-100 text-green-800 border border-green-300 px-2 py-1 rounded">
              live sends ON
            </span>
          ) : (
            <span className="text-xs bg-gray-100 text-gray-600 border border-gray-300 px-2 py-1 rounded">
              sends gated by Telegram approval
            </span>
          )}
          <button
            onClick={refreshStatus}
            className="text-xs text-gray-500 hover:text-gray-900 underline"
          >
            refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <strong>Status fetch failed:</strong> {error}
          <p className="text-xs mt-1 text-red-600">
            Likely cause: <code>NEWSLETTER_PROXY_SECRET</code> not set on this CRM
            project. Add it to <code>command.georgeyachts.com</code> Vercel env
            equal to the same value you used for{" "}
            <code>NEWSLETTER_UNSUB_SECRET</code> on georgeyachts.com.
          </p>
        </div>
      )}

      {/* Tabs */}
      <nav className="flex gap-1 border-b">
        {(["subscribers", "issues", "composer"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
              tab === t
                ? "border-blue-600 text-blue-700 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t === "subscribers" ? "Subscribers" : t === "issues" ? "Issues" : "Composer"}
          </button>
        ))}
      </nav>

      {tab === "subscribers" && <SubscribersTab status={status} />}
      {tab === "issues" && <IssuesTab status={status} />}
      {tab === "composer" && <ComposerTab />}
    </main>
  );
}

// ─── Subscribers tab ───────────────────────────────────────────────

function SubscribersTab({ status }: { status: Status | null }) {
  const [stream, setStream] = useState<StreamKey>("bridge");
  const [raw, setRaw] = useState("");
  const [sendWelcome, setSendWelcome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [removeEmail, setRemoveEmail] = useState("");
  const [removeStream, setRemoveStream] = useState<StreamKey | "all">("all");
  const [removeSuppress, setRemoveSuppress] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeResult, setRemoveResult] = useState<any>(null);

  function tokenise(text: string): string[] {
    return Array.from(
      new Set(
        text
          .split(/[,\s;\n\r]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s && s.includes("@")),
      ),
    );
  }

  async function add() {
    setResult(null);
    const emails = tokenise(raw);
    if (emails.length === 0) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/newsletter-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream, emails, send_welcome: sendWelcome }),
      });
      const j = await r.json();
      setResult(j);
      if (j?.added > 0) setRaw("");
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setRemoveResult(null);
    const e = removeEmail.trim().toLowerCase();
    if (!e || !e.includes("@")) {
      setRemoveResult({ error: "valid email required" });
      return;
    }
    if (
      !confirm(
        `Remove ${e} from ${removeStream === "all" ? "ALL streams" : `the ${removeStream} stream`}? ${
          removeSuppress ? "They'll also be added to suppression so they can never be re-added." : ""
        }`,
      )
    ) {
      return;
    }
    setRemoveBusy(true);
    try {
      const res = await fetch("/api/admin/newsletter-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e,
          stream: removeStream === "all" ? undefined : removeStream,
          suppress: removeSuppress,
        }),
      });
      const j = await res.json();
      setRemoveResult(j);
      if (j?.ok) setRemoveEmail("");
    } catch (e) {
      setRemoveResult({ error: e instanceof Error ? e.message : "failed" });
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Counts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {STREAMS.map((s) => {
          // We only have aggregate count from the public-site status endpoint
          // (sum of legacy newsletter:subscribers). Per-stream breakdown
          // isn't exposed yet — show "—" until we extend the upstream
          // status response.
          return (
            <div key={s.key} className="border rounded p-4 bg-gray-50">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {s.label}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">
                    {s.cadence}
                  </div>
                </div>
                <div className="text-2xl font-serif text-right shrink-0">
                  {s.key === "bridge" && status ? status.subscriber_count : "—"}
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-2 leading-relaxed">
                {s.desc}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bulk add */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">Bulk add</h2>
        <p className="text-sm text-gray-600">
          Paste any list — newlines, commas, semicolons, spaces all work.
          Auto-dedups, drops obvious junk, refuses to re-add anyone on
          the suppression list. Telegram pings you with a masked summary
          on every batch.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={stream}
            onChange={(e) => setStream(e.target.value as StreamKey)}
            className="border rounded px-3 py-2 text-sm"
          >
            {STREAMS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendWelcome}
              onChange={(e) => setSendWelcome(e.target.checked)}
            />
            Send Issue #1 welcome immediately to each new Bridge subscriber
          </label>
        </div>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          className="w-full border rounded p-2 font-mono text-sm"
          placeholder={"hitesh@example.com\nfounder@partner.io\nor paste a comma-separated dump…"}
        />
        <div className="flex gap-3 items-center">
          <button
            onClick={add}
            disabled={busy || !raw.trim()}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {busy ? "Adding…" : `Add to ${stream}`}
          </button>
          {result && !result.error && (
            <span className="text-sm text-gray-700">
              <strong>{result.added}</strong> added · {result.already_on_list}{" "}
              already on list · {result.received} received
              {result.suppressed?.length ? ` · ${result.suppressed.length} suppressed` : ""}
              {result.rejected?.length ? ` · ${result.rejected.length} rejected` : ""}
              {result.welcome_sends ? ` · ${result.welcome_sends} welcome emails fired` : ""}
            </span>
          )}
          {result?.error && (
            <span className="text-sm text-red-700">Error: {result.error}</span>
          )}
        </div>
      </section>

      {/* Remove */}
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">Remove subscriber</h2>
        <div className="flex flex-col sm:flex-row gap-3 items-start">
          <input
            type="email"
            value={removeEmail}
            onChange={(e) => setRemoveEmail(e.target.value)}
            placeholder="email@example.com"
            className="border rounded px-3 py-2 text-sm flex-1"
          />
          <select
            value={removeStream}
            onChange={(e) => setRemoveStream(e.target.value as any)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="all">All streams</option>
            {STREAMS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={removeSuppress}
              onChange={(e) => setRemoveSuppress(e.target.checked)}
            />
            Also suppress (prevent re-add)
          </label>
          <button
            onClick={remove}
            disabled={removeBusy || !removeEmail.trim()}
            className="bg-red-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {removeBusy ? "Removing…" : "Remove"}
          </button>
        </div>
        {removeResult?.ok && (
          <p className="text-sm text-gray-700">
            Removed from {removeResult.removed_from_sets} set(s).
            {removeResult.suppressed ? " Added to suppression list." : ""}
          </p>
        )}
        {removeResult?.error && (
          <p className="text-sm text-red-700">Error: {removeResult.error}</p>
        )}
      </section>

      {/* Masked list */}
      {status?.subscribers_masked && status.subscribers_masked.length > 0 && (
        <section className="border rounded p-4">
          <h2 className="font-semibold mb-2">Current Bridge subscribers (masked)</h2>
          <p className="text-xs text-gray-500 mb-2">
            Total {status.subscriber_count} · domains:{" "}
            {Object.entries(status.subscribers_by_domain ?? {})
              .map(([d, c]) => `${d}: ${c}`)
              .join(" · ")}
          </p>
          <ul className="text-sm font-mono text-gray-700 space-y-1">
            {status.subscribers_masked.map((m) => (
              <li key={m}>· {m}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Issues tab ────────────────────────────────────────────────────

function IssuesTab({ status: _status }: { status: Status | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [reset, setReset] = useState(false);

  async function prepare() {
    if (
      !confirm(
        reset
          ? "Reset the bridge counter back to 1 and prepare a fresh Issue #1? Any pending bridge draft will be dropped."
          : "Prepare a fresh Issue #1 draft? You'll get a Telegram approval card with the hero photo. Nothing sends until you tap ✅.",
      )
    ) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/admin/newsletter-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset }),
      });
      const j = await r.json();
      setResult(j);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">Prepare Issue #1 (founder note)</h2>
        <p className="text-sm text-gray-600">
          Generates the draft, runs the §13 hard-rules validator, writes
          it to KV with a 24h TTL, and Telegrams you the approval card
          with the hero photo + caption + 3 buttons (Preview / Approve / Abort).
          Nothing sends until you tap ✅ in Telegram.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reset}
            onChange={(e) => setReset(e.target.checked)}
          />
          Reset counter (drop any pending bridge draft + start at Issue #1)
        </label>
        <button
          onClick={prepare}
          disabled={busy}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? "Preparing…" : "📨 Prepare Issue #1"}
        </button>
        {result?.ok && (
          <div className="text-sm bg-green-50 border border-green-200 rounded p-3 mt-3">
            ✅ Draft <code>{result.draft_id}</code> prepared · audience{" "}
            <strong>{result.audience_size}</strong> · Issue #
            {result.issue_number} ·{" "}
            {result.telegram?.ok
              ? `Telegram message ${result.telegram.message_id} sent`
              : `Telegram failed: ${result.telegram?.error}`}
          </div>
        )}
        {result?.error && (
          <div className="text-sm bg-red-50 border border-red-200 rounded p-3 mt-3 text-red-800">
            Error: {result.error}
          </div>
        )}
      </section>

      <section className="border rounded p-4">
        <h2 className="font-semibold mb-2">Past sends</h2>
        <p className="text-sm text-gray-500">
          (Phase 6 — issue history view comes after the first real send
          so we have something to display.)
        </p>
      </section>
    </div>
  );
}

// ─── Composer tab (Phase 3 placeholder) ────────────────────────────

function ComposerTab() {
  return (
    <div className="border rounded p-6 bg-gray-50">
      <h2 className="font-semibold">Composer</h2>
      <p className="text-sm text-gray-600 mt-2">
        Phase 3 territory — triggered commands like <code>/announce yacht ALTEYA</code>,{" "}
        <code>/offer yacht X 20%</code>, <code>/story</code>, <code>/intel</code>,{" "}
        <code>/blog</code>. Each will live here with its own form. Today
        you have one path: prepare Issue #1 from the Issues tab.
      </p>
      <p className="text-xs text-gray-500 mt-3">
        Coming next: yacht picker (Sanity) + audience override +
        urgency framing for offers + photo curation gate.
      </p>
    </div>
  );
}
