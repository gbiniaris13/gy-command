"use client";

// Gmail import panel — v2 after George's feedback (2026-07-15): the raw
// Gmail-query box was "πάρα πολύ δύσκολο". No search syntax anywhere now.
// He sees his INBOX like in Gmail (sender, subject, exact arrival time,
// newest first), narrows with plain controls (who sent it / how far back /
// only with PDF), ticks the emails for this request, Import. The panel
// always says in plain words what it is showing. Nothing is read unattended.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Listed = { id: string; from: string; subject: string; date: string; snippet: string };
type Brochure = { filename: string; url: string; facts: boolean };

const PERIODS = [
  { key: "1d", label: "Today", words: "today" },
  { key: "3d", label: "Last 3 days", words: "the last 3 days" },
  { key: "7d", label: "Last 7 days", words: "the last 7 days" },
  { key: "30d", label: "Last 30 days", words: "the last 30 days" },
] as const;

/** "EKKA Yachts <info@ekka.gr>" → "EKKA Yachts" (keeps address if no name). */
function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim();
}

/** Gmail Date header → "Tue 15 Jul, 14:32" in Athens time. */
function fmtWhen(dateHeader: string): string {
  const d = new Date(dateHeader);
  if (isNaN(d.getTime())) return dateHeader;
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens",
  });
}

export default function GmailImport({
  requestId,
  hasThread,
}: {
  requestId: string;
  hasThread: boolean;
}) {
  const router = useRouter();
  const [fromFilter, setFromFilter] = useState("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("3d");
  const [pdfOnly, setPdfOnly] = useState(false);
  const [showing, setShowing] = useState(""); // plain-words description of the current list
  const [messages, setMessages] = useState<Listed[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readBrochures, setReadBrochures] = useState(true);
  const [busy, setBusy] = useState<"" | "list" | "thread" | "import">("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<{
    appended: number; brochures: Brochure[]; skipped: string[]; warnings: string[];
  } | null>(null);

  async function call(payload: Record<string, unknown>) {
    const res = await fetch(`/api/helm/${requestId}/gmail-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  // The query is BUILT here from the plain controls — George never sees or
  // types Gmail syntax.
  function builtQuery(): { q: string; words: string } {
    const parts = ["in:inbox", `newer_than:${period}`];
    const words: string[] = [];
    const p = PERIODS.find((x) => x.key === period)!;
    if (fromFilter.trim()) {
      parts.push(`from:(${fromFilter.trim()})`);
      words.push(`from "${fromFilter.trim()}"`);
    }
    if (pdfOnly) {
      parts.push("has:attachment filename:pdf");
      words.push("with a PDF attached");
    }
    words.push(`received ${p.words}`);
    return { q: parts.join(" "), words: `Inbox emails ${words.join(", ")} — newest first.` };
  }

  async function loadInbox() {
    setBusy("list"); setError(""); setReport(null);
    try {
      const { q, words } = builtQuery();
      const json = await call({ action: "search", q });
      setMessages(json.messages || []);
      setSelected(new Set());
      setShowing(words);
      if (!(json.messages || []).length) setError("No emails match. Try a longer period or clear the sender.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function loadThread() {
    setBusy("thread"); setError(""); setReport(null);
    try {
      const json = await call({ action: "thread" });
      setMessages(json.messages || []);
      setSelected(new Set());
      setShowing("All emails in this request's own conversation.");
      if (!(json.messages || []).length) setError("No messages in this request's thread yet.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function doImport() {
    if (!selected.size) return;
    setBusy("import"); setError("");
    try {
      const json = await call({
        action: "import",
        messageIds: Array.from(selected),
        readBrochures,
      });
      setReport({
        appended: json.appended || 0,
        brochures: json.brochures || [],
        skipped: json.skipped || [],
        warnings: json.warnings || [],
      });
      setMessages(null);
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const btn: React.CSSProperties = {
    padding: "8px 14px", fontSize: 12, letterSpacing: 0.5, cursor: "pointer",
    background: "#0D1B2A", color: "#fff", border: "none", borderRadius: 2,
  };
  const btnGhost: React.CSSProperties = {
    ...btn, background: "transparent", color: "#0D1B2A", border: "1px solid #0D1B2A",
  };
  const chip = (active: boolean): React.CSSProperties => ({
    padding: "5px 10px", fontSize: 12, cursor: "pointer", borderRadius: 999,
    border: active ? "1px solid #0D1B2A" : "1px solid rgba(13,27,42,0.2)",
    background: active ? "#0D1B2A" : "transparent",
    color: active ? "#fff" : "#374151",
  });

  return (
    <section style={{
      background: "#fff", border: "1px solid rgba(13,27,42,0.08)", borderRadius: 2,
      padding: 20, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>
        Import from Gmail · tick the emails that belong to this request
      </div>

      {/* Plain controls — no search syntax anywhere */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={fromFilter}
          onChange={(e) => setFromFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") loadInbox(); }}
          placeholder="From who? (optional — e.g. ekka or info@ekka.gr)"
          style={{
            flex: "1 1 240px", padding: "8px 10px", fontSize: 13,
            border: "1px solid rgba(13,27,42,0.15)", borderRadius: 2,
          }}
        />
        {PERIODS.map((p) => (
          <button key={p.key} style={chip(period === p.key)} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
        <button style={chip(pdfOnly)} onClick={() => setPdfOnly(!pdfOnly)}>
          📎 Only with PDF
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn} disabled={!!busy} onClick={loadInbox}>
          {busy === "list" ? "Loading…" : "Show my inbox"}
        </button>
        {hasThread && (
          <button style={btnGhost} disabled={!!busy} onClick={loadThread}>
            {busy === "thread" ? "Loading…" : "This request's own thread"}
          </button>
        )}
      </div>

      {showing && messages && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>{showing}</div>
      )}

      {error && <div style={{ fontSize: 13, color: "#B91C1C" }}>{error}</div>}

      {messages && messages.length > 0 && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflow: "auto" }}>
            {messages.map((m) => (
              <label key={m.id} style={{
                display: "flex", gap: 10, alignItems: "flex-start", padding: 10,
                background: selected.has(m.id) ? "rgba(13,27,42,0.06)" : "rgba(13,27,42,0.02)",
                borderRadius: 2, cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                  style={{ marginTop: 3 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>
                      {senderName(m.from)}
                    </span>
                    <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {fmtWhen(m.date)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#374151" }}>
                    {m.subject || "(no subject)"}
                  </div>
                  {m.snippet && (
                    <div style={{ fontSize: 12, color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.snippet}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button style={btn} disabled={!selected.size || !!busy} onClick={doImport}>
              {busy === "import"
                ? "Importing…"
                : selected.size
                  ? `Import ${selected.size} email${selected.size === 1 ? "" : "s"} into this request`
                  : "Tick emails above, then import"}
            </button>
            <label style={{ fontSize: 12.5, color: "#374151", display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={readBrochures}
                onChange={(e) => setReadBrochures(e.target.checked)}
              />
              Read PDF brochures too (saves each PDF + adds its facts)
            </label>
          </div>
        </>
      )}

      {report && (
        <div style={{ fontSize: 13, color: "#1f2937", background: "rgba(13,27,42,0.03)", padding: 12, borderRadius: 2, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            ✓ {report.appended} email{report.appended === 1 ? "" : "s"} imported into the supplier text below.
            {report.skipped.length > 0 && ` ${report.skipped.length} already imported earlier (skipped).`}
          </div>
          {report.brochures.map((b) => (
            <div key={b.url} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>📎 {b.filename}{b.facts ? " · facts added to supplier text" : ""}</span>
              <button
                style={{ ...btnGhost, padding: "3px 8px", fontSize: 11 }}
                onClick={() => navigator.clipboard.writeText(b.url)}
              >
                Copy brochure link
              </button>
            </div>
          ))}
          {report.appended > 0 && (
            <div style={{ fontSize: 12.5, color: "#374151", fontWeight: 600 }}>
              Next step: press “Extract all yachts” below — a card appears for each yacht and you confirm the numbers.
            </div>
          )}
          {report.brochures.length > 0 && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              Paste each brochure link on its yacht&apos;s card (Brochure field) after Extract.
            </div>
          )}
          {report.warnings.map((w, i) => (
            <div key={i} style={{ color: "#B45309" }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </section>
  );
}
