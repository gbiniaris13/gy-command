"use client";

// Gmail import panel — George points at emails, we pull them in.
// "Load thread" lists this request's own Gmail thread; the search box runs a
// normal Gmail query (only on click — nothing is read unattended). Ticked
// messages are appended to the supplier text verbatim; PDF attachments are
// saved as brochures and (optionally) read once by AI so their facts feed
// Extract. Nothing here touches the client-facing flow.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Listed = { id: string; from: string; subject: string; date: string; snippet: string };
type Brochure = { filename: string; url: string; facts: boolean };

export default function GmailImport({
  requestId,
  hasThread,
  defaultQuery,
}: {
  requestId: string;
  hasThread: boolean;
  defaultQuery: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(defaultQuery);
  const [messages, setMessages] = useState<Listed[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [readBrochures, setReadBrochures] = useState(true);
  const [busy, setBusy] = useState<"" | "thread" | "search" | "import">("");
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

  async function load(kind: "thread" | "search") {
    setBusy(kind); setError(""); setReport(null);
    try {
      const json = await call(kind === "thread" ? { action: "thread" } : { action: "search", q });
      setMessages(json.messages || []);
      setSelected(new Set());
      if (!(json.messages || []).length) setError("No messages found.");
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

  return (
    <section style={{
      background: "#fff", border: "1px solid rgba(13,27,42,0.08)", borderRadius: 2,
      padding: 20, display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>
        Import from Gmail · pick the exact emails for this request
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {hasThread && (
          <button style={btnGhost} disabled={!!busy} onClick={() => load("thread")}>
            {busy === "thread" ? "Loading…" : "Load this request's thread"}
          </button>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) load("search"); }}
          placeholder='Gmail search, e.g. from:info@ekka.gr "Lagoon 55"'
          style={{
            flex: "1 1 260px", padding: "8px 10px", fontSize: 13,
            border: "1px solid rgba(13,27,42,0.15)", borderRadius: 2,
          }}
        />
        <button style={btn} disabled={!!busy || !q.trim()} onClick={() => load("search")}>
          {busy === "search" ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <div style={{ fontSize: 13, color: "#B91C1C" }}>{error}</div>}

      {messages && messages.length > 0 && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflow: "auto" }}>
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
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1f2937" }}>
                    {m.subject || "(no subject)"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    {m.from} · {m.date}
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
                : `Import ${selected.size || ""} selected into supplier text`}
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
            ✓ {report.appended} email{report.appended === 1 ? "" : "s"} appended to the supplier text.
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
