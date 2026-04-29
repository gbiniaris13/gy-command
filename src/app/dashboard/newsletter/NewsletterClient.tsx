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

import { useState, useEffect } from "react";

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

// ─── Composer tab ─────────────────────────────────────────────────
//
// Phase 3 — five forms that each call POST /api/admin/newsletter-compose
// with a different content_type. The compose endpoint runs the §13
// validator, allocates per-stream issue counters, creates KV drafts,
// and Telegrams George the approval card. Nothing sends until he taps ✅.

type YachtOpt = {
  slug: string;
  name: string;
  subtitle?: string;
  length?: string;
  cruisingRegion?: string;
  fleetTier?: string;
  // Update 2 §5.3 — voice/composer signals
  has_voice_notes?: boolean;
  has_captain_credentials?: boolean;
  voice_notes?: string | null;
};
type PostOpt = { slug: string; title: string; publishedAt?: string };

type ComposeResult = {
  ok: boolean;
  content_type: string;
  final_audience: string[];
  refused: string[];
  refusal_reasons: string[];
  drafts_created: number;
  drafts_blocked: number;
  errors: number;
  results: Array<{
    stream: string;
    draft_id?: string;
    issue_number?: number;
    audience_size?: number;
    status?: string;
    violations?: { rule: string }[];
    warnings?: { rule: string }[];
    telegram?: { ok: boolean; error?: string };
    error?: string;
  }>;
  error?: string;
};

type ContentType = "announcement" | "offer" | "story" | "intel" | "blog";

// Default suggested audience per content type (mirrors §6 routing matrix).
const DEFAULT_AUDIENCE: Record<ContentType, StreamKey[]> = {
  announcement: ["bridge", "wake"],
  offer: ["bridge", "wake"],
  story: ["bridge"],
  intel: ["wake", "compass"],
  blog: ["bridge"],
};

function ComposerTab() {
  const [contentType, setContentType] =
    useState<ContentType>("announcement");
  const [yachts, setYachts] = useState<YachtOpt[]>([]);
  const [posts, setPosts] = useState<PostOpt[]>([]);
  const [optsErr, setOptsErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/newsletter-compose-options", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setOptsErr(j.error);
        setYachts(j.yachts ?? []);
        setPosts(j.posts ?? []);
      })
      .catch((e) => live && setOptsErr(e?.message ?? "load failed"));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="border rounded p-4 space-y-3 bg-gray-50">
        <h2 className="font-semibold">Composer</h2>
        <p className="text-sm text-gray-600">
          Generate a draft for one or more streams. Each form fills the
          §8 template, runs the §13 validator, then Telegrams you an
          approval card per stream. Nothing sends until you tap ✅ in
          Telegram.
        </p>
        {optsErr && (
          <p className="text-xs text-red-700">
            Options load failed: {optsErr}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["announcement", "📣 /announce — New yacht"],
              ["offer", "💎 /offer — Availability"],
              ["story", "✍️ /story — From the bridge"],
              ["intel", "📊 /intel — Market signal"],
              ["blog", "📰 /blog — Blog recap"],
            ] as [ContentType, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setContentType(k)}
              className={`text-sm px-3 py-1.5 rounded border transition ${
                contentType === k
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-800 border-gray-300 hover:border-blue-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {contentType === "announcement" && (
        <AnnounceForm yachts={yachts} />
      )}
      {contentType === "offer" && <OfferForm yachts={yachts} />}
      {contentType === "story" && <StoryForm />}
      {contentType === "intel" && <IntelForm />}
      {contentType === "blog" && <BlogForm posts={posts} />}
    </div>
  );
}

// ─── Form helpers ─────────────────────────────────────────────────

function AudiencePicker({
  contentType,
  value,
  onChange,
}: {
  contentType: ContentType;
  value: StreamKey[];
  onChange: (v: StreamKey[]) => void;
}) {
  function toggle(s: StreamKey) {
    onChange(
      value.includes(s) ? value.filter((x) => x !== s) : [...value, s],
    );
  }
  return (
    <div>
      <label className="text-sm font-medium block mb-2">
        Audience
        <span className="text-xs text-gray-500 font-normal ml-2">
          (§6 matrix — blocked streams will be refused server-side)
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        {STREAMS.map((s) => {
          const isOn = value.includes(s.key);
          // visual hint for streams normally blocked for this content_type
          // (these will still be refused by the server even if checked)
          const blockedHint =
            contentType === "offer" && s.key === "compass"
              ? "always blocked for offers"
              : contentType === "blog" && s.key === "compass"
                ? "always blocked for blog"
                : contentType === "intel" && s.key === "greece"
                  ? "always blocked for intel"
                  : "";
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              disabled={!!blockedHint}
              className={`text-sm px-3 py-1.5 rounded border transition ${
                blockedHint
                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                  : isOn
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-800 border-gray-300 hover:border-blue-400"
              }`}
              title={blockedHint || s.desc}
            >
              {s.label.split("—")[0].trim()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: ComposeResult | null }) {
  if (!result) return null;
  if (result.error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
        Error: {result.error}
      </div>
    );
  }
  return (
    <div className="bg-gray-50 border rounded p-4 space-y-2 text-sm">
      <div>
        <strong>{result.drafts_created}</strong> draft
        {result.drafts_created === 1 ? "" : "s"} created ·{" "}
        <strong>{result.drafts_blocked}</strong> blocked ·{" "}
        <strong>{result.errors}</strong> errors
      </div>
      {result.refused.length > 0 && (
        <div className="text-xs text-amber-800">
          Routing refused: {result.refused.join(", ")} ·{" "}
          {result.refusal_reasons.join(" · ")}
        </div>
      )}
      <ul className="space-y-1.5 mt-2">
        {result.results.map((r, i) => (
          <li
            key={i}
            className={`border rounded p-2 ${
              r.status === "pending"
                ? "border-green-300 bg-green-50"
                : r.status === "blocked"
                  ? "border-red-300 bg-red-50"
                  : "border-gray-300 bg-white"
            }`}
          >
            <div className="font-medium">
              {r.stream} · Issue #{r.issue_number ?? "—"} ·{" "}
              {r.audience_size ?? 0} subscribers · {r.status ?? "?"}
            </div>
            {r.draft_id && (
              <div className="text-xs text-gray-500 font-mono">
                {r.draft_id}
              </div>
            )}
            {r.violations && r.violations.length > 0 && (
              <ul className="text-xs text-red-700 mt-1">
                {r.violations.map((v, j) => (
                  <li key={j}>• {v.rule}</li>
                ))}
              </ul>
            )}
            {r.warnings && r.warnings.length > 0 && (
              <ul className="text-xs text-amber-700 mt-1">
                {r.warnings.map((v, j) => (
                  <li key={j}>⚠︎ {v.rule}</li>
                ))}
              </ul>
            )}
            {r.telegram?.ok && (
              <div className="text-xs text-gray-600 mt-1">
                Telegram approval card delivered.
              </div>
            )}
            {r.error && (
              <div className="text-xs text-red-700 mt-1">{r.error}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function postCompose(body: any): Promise<ComposeResult> {
  const r = await fetch("/api/admin/newsletter-compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ─── /announce ─────────────────────────────────────────────────────

function AnnounceForm({ yachts }: { yachts: YachtOpt[] }) {
  const [yachtSlug, setYachtSlug] = useState("");
  const [angle, setAngle] = useState("");
  const [audience, setAudience] = useState<StreamKey[]>(
    DEFAULT_AUDIENCE.announcement,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);

  // Lookup the picked yacht so we can surface voice_notes guidance
  // and grey out the credentials checkbox when no credentials exist.
  const pickedYacht = yachts.find((y) => y.slug === yachtSlug) ?? null;

  async function submit() {
    if (!yachtSlug) {
      setResult({
        ok: false,
        error: "pick a yacht",
      } as ComposeResult);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const j = await postCompose({
        content_type: "announcement",
        audience,
        yacht_slug: yachtSlug,
        george_angle: angle.trim() || undefined,
      });
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="font-semibold">📣 Announce — new yacht in fleet</h2>
      <p className="text-xs text-gray-600">
        Pulls the yacht facts from Sanity (length, builder, region, hero
        photo). You add a 1-2 sentence personal angle — why{" "}
        <em>you</em> like her. The template assembles per-stream tone.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm space-y-1">
          <span className="font-medium block">Yacht</span>
          <select
            value={yachtSlug}
            onChange={(e) => setYachtSlug(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full"
          >
            <option value="">— pick a yacht —</option>
            {yachts.map((y) => (
              <option key={y.slug} value={y.slug}>
                {y.name}
                {y.length ? ` · ${y.length}` : ""}
                {y.cruisingRegion ? ` · ${y.cruisingRegion}` : ""}
              </option>
            ))}
          </select>
        </label>
        <AudiencePicker
          contentType="announcement"
          value={audience}
          onChange={setAudience}
        />
      </div>
      {pickedYacht?.has_voice_notes && pickedYacht.voice_notes && (
        <div className="border-l-4 border-amber-500 bg-amber-50 p-3 rounded text-sm">
          <div className="font-semibold text-amber-900 flex items-center gap-2">
            🗣 Voice notes for this yacht — what NOT to say
          </div>
          <p className="text-amber-900 mt-1 italic">
            {pickedYacht.voice_notes}
          </p>
          <p className="text-xs text-amber-800 mt-2">
            This is guidance, not content. Make sure your angle below
            does not contradict it. Composer will also surface this in
            the Telegram approval card.
          </p>
        </div>
      )}
      <label className="text-sm space-y-1 block">
        <span className="font-medium">George&apos;s angle (optional)</span>
        <textarea
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          rows={3}
          className="w-full border rounded p-2 text-sm"
          placeholder={
            "1-2 sentences in your voice. Why does she belong on this list? What makes her interesting RIGHT NOW? Leave blank to use the yacht's default positioning_one_liner from Sanity."
          }
        />
      </label>
      {/* Captain credentials checkbox removed 2026-04-29 — Boardroom
          Update 2 amendment: crew identities are volatile across
          bookings, so /announce body never references named crew or
          credentials. captain_credentials_short still lives in Sanity
          for /intel safety briefings (different flow). */}
      <button
        onClick={submit}
        disabled={busy || !yachtSlug}
        className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
      >
        {busy ? "Composing…" : "Compose announcement → Telegram"}
      </button>
      <ResultPanel result={result} />
    </section>
  );
}

// ─── /offer ────────────────────────────────────────────────────────

function OfferForm({ yachts }: { yachts: YachtOpt[] }) {
  const [yachtSlug, setYachtSlug] = useState("");
  const [angle, setAngle] = useState("");
  const [posture, setPosture] = useState("select availability");
  const [audience, setAudience] = useState<StreamKey[]>(
    DEFAULT_AUDIENCE.offer,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);

  async function submit() {
    if (!angle.trim()) {
      setResult({ ok: false, error: "angle required" } as ComposeResult);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const j = await postCompose({
        content_type: "offer",
        audience,
        yacht_slug: yachtSlug || undefined,
        george_angle: angle.trim(),
        posture: posture.trim() || undefined,
      });
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="font-semibold">💎 Offer — availability note</h2>
      <p className="text-xs text-gray-600">
        Compass is <strong>always</strong> blocked here (§6). Body never
        contains a specific week, a price, or a calendar date — those
        live in your 1-on-1 reply only. Posture-only nudge.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm space-y-1">
          <span className="font-medium block">
            Yacht (optional — generic if blank)
          </span>
          <select
            value={yachtSlug}
            onChange={(e) => setYachtSlug(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full"
          >
            <option value="">— generic / no yacht —</option>
            {yachts.map((y) => (
              <option key={y.slug} value={y.slug}>
                {y.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="font-medium block">Posture phrase</span>
          <input
            value={posture}
            onChange={(e) => setPosture(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full"
            placeholder="select availability / a quiet window / a small opening"
          />
        </label>
      </div>
      <AudiencePicker
        contentType="offer"
        value={audience}
        onChange={setAudience}
      />
      <label className="text-sm space-y-1 block">
        <span className="font-medium">George&apos;s angle</span>
        <textarea
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          rows={3}
          className="w-full border rounded p-2 text-sm"
          placeholder={
            "1-3 sentences. Why is this worth knowing about? Stay vague — no weeks, no dates, no prices."
          }
        />
      </label>
      <button
        onClick={submit}
        disabled={busy || !angle.trim()}
        className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
      >
        {busy ? "Composing…" : "Compose offer → Telegram"}
      </button>
      <ResultPanel result={result} />
    </section>
  );
}

// ─── /story ────────────────────────────────────────────────────────

function StoryForm() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [hero, setHero] = useState("");
  const [audience, setAudience] = useState<StreamKey[]>(DEFAULT_AUDIENCE.story);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);

  async function submit() {
    if (body.trim().length < 40) {
      setResult({ ok: false, error: "body too short (min 40 chars)" } as ComposeResult);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const j = await postCompose({
        content_type: "story",
        audience,
        subject_line: subject.trim() || undefined,
        body_text: body.trim(),
        hero_image_url: hero.trim() || undefined,
      });
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="font-semibold">✍️ Story — from the bridge</h2>
      <p className="text-xs text-gray-600">
        Free-form. Whatever you write IS the body — the only thing
        appended is the per-stream sign-off. Compass is blocked (§6).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm space-y-1">
          <span className="font-medium block">Subject line</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full"
            placeholder="From the bridge / Από τη γέφυρα"
          />
        </label>
        <label className="text-sm space-y-1">
          <span className="font-medium block">
            Hero photo URL (optional)
          </span>
          <input
            value={hero}
            onChange={(e) => setHero(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-full"
            placeholder="https://cdn.sanity.io/images/…"
          />
        </label>
      </div>
      <AudiencePicker contentType="story" value={audience} onChange={setAudience} />
      <label className="text-sm space-y-1 block">
        <span className="font-medium">Body (your voice — no template)</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="w-full border rounded p-2 text-sm font-serif"
          placeholder={"Write the whole thing. Greek waters context expected. No prices, no weeks, no agent names."}
        />
        <span className="text-xs text-gray-500">
          {body.trim().split(/\s+/).filter(Boolean).length} words
        </span>
      </label>
      <button
        onClick={submit}
        disabled={busy || body.trim().length < 40}
        className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
      >
        {busy ? "Composing…" : "Compose story → Telegram"}
      </button>
      <ResultPanel result={result} />
    </section>
  );
}

// ─── /intel ────────────────────────────────────────────────────────

function IntelForm() {
  const [headline, setHeadline] = useState("");
  const [signal, setSignal] = useState("");
  const [source, setSource] = useState("");
  const [audience, setAudience] = useState<StreamKey[]>(DEFAULT_AUDIENCE.intel);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);

  async function submit() {
    if (signal.trim().length < 40) {
      setResult({ ok: false, error: "signal too short (min 40 chars)" } as ComposeResult);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const j = await postCompose({
        content_type: "intel",
        audience,
        headline: headline.trim() || undefined,
        signal_text: signal.trim(),
        source_note: source.trim() || undefined,
      });
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="font-semibold">📊 Intel — market signal</h2>
      <p className="text-xs text-gray-600">
        Wake + Compass primary. Bridge sometimes (only if client-relevant).
        Greece blocked (§6). Signal text is the meat — 80–200 words ideal.
      </p>
      <label className="text-sm space-y-1 block">
        <span className="font-medium">Headline (one line)</span>
        <input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-full"
          placeholder="Cyclades July week 30 already 70% gone"
        />
      </label>
      <label className="text-sm space-y-1 block">
        <span className="font-medium">Signal</span>
        <textarea
          value={signal}
          onChange={(e) => setSignal(e.target.value)}
          rows={8}
          className="w-full border rounded p-2 text-sm"
          placeholder={"What you're seeing on the ground. Be specific without naming central agents or quoting prices."}
        />
        <span className="text-xs text-gray-500">
          {signal.trim().split(/\s+/).filter(Boolean).length} words
        </span>
      </label>
      <label className="text-sm space-y-1 block">
        <span className="font-medium">Source note (optional)</span>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-full"
          placeholder="e.g. from 12 charter inquiries this week"
        />
      </label>
      <AudiencePicker contentType="intel" value={audience} onChange={setAudience} />
      <button
        onClick={submit}
        disabled={busy || signal.trim().length < 40}
        className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
      >
        {busy ? "Composing…" : "Compose intel → Telegram"}
      </button>
      <ResultPanel result={result} />
    </section>
  );
}

// ─── /blog ─────────────────────────────────────────────────────────

function BlogForm({ posts }: { posts: PostOpt[] }) {
  const [postSlug, setPostSlug] = useState("");
  const [angle, setAngle] = useState("");
  const [audience, setAudience] = useState<StreamKey[]>(DEFAULT_AUDIENCE.blog);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);

  async function submit() {
    if (!postSlug) {
      setResult({ ok: false, error: "pick a blog post" } as ComposeResult);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const j = await postCompose({
        content_type: "blog",
        audience,
        post_slug: postSlug,
        george_angle: angle.trim() || undefined,
      });
      setResult(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border rounded p-4 space-y-3">
      <h2 className="font-semibold">📰 Blog recap</h2>
      <p className="text-xs text-gray-600">
        Pulls title + excerpt + hero from Sanity. You add a sentence on
        why this post matters NOW. Compass and Greece blocked (§6).
      </p>
      <label className="text-sm space-y-1 block">
        <span className="font-medium">Blog post</span>
        <select
          value={postSlug}
          onChange={(e) => setPostSlug(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-full"
        >
          <option value="">— pick a post —</option>
          {posts.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title}
              {p.publishedAt
                ? ` · ${p.publishedAt.slice(0, 10)}`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm space-y-1 block">
        <span className="font-medium">Angle (optional)</span>
        <textarea
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          rows={3}
          className="w-full border rounded p-2 text-sm"
          placeholder="Why does this post matter right now?"
        />
      </label>
      <AudiencePicker contentType="blog" value={audience} onChange={setAudience} />
      <button
        onClick={submit}
        disabled={busy || !postSlug}
        className="bg-blue-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
      >
        {busy ? "Composing…" : "Compose blog recap → Telegram"}
      </button>
      <ResultPanel result={result} />
    </section>
  );
}
