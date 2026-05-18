"use client";

// Modal dialog used by CabinDetailActions to send the preference
// sheet to the operating team. Receives recipients + optional
// note, posts to the local /send-preference-sheet endpoint which
// forwards to the public site's admin endpoint, and surfaces
// per-recipient send status when the request completes.

import { useState } from "react";

type Result = { email: string; ok: boolean; error: string | null };

export default function SharePreferenceSheetDialog({
  cabinId,
  vesselName,
  defaultRecipients = [],
  onClose,
}: {
  cabinId: string;
  vesselName: string;
  defaultRecipients?: string[];
  onClose: () => void;
}) {
  const [recipientsText, setRecipientsText] = useState(defaultRecipients.join("\n"));
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function parseRecipients(): { email: string; name?: string }[] {
    // Accept newline OR comma separation. Optional "Name <email@x>" syntax.
    return recipientsText
      .split(/[,\n]/)
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((entry) => {
        const m = entry.match(/^(.*)<\s*(.+?)\s*>$/);
        if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
        return { email: entry.toLowerCase() };
      })
      .filter((r) => r.email.includes("@"));
  }

  async function onSend() {
    setSending(true);
    setErr(null);
    setResults(null);
    try {
      const recipients = parseRecipients();
      if (recipients.length === 0) {
        throw new Error("No valid email addresses parsed from the field above.");
      }
      const r = await fetch(`/api/cabins/${cabinId}/send-preference-sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients,
          custom_message: customMessage,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "send-failed");
      setResults(j.results || []);
      setShareUrl(j.share_url || null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function copyShareUrl() {
    if (!shareUrl) return;
    void navigator.clipboard.writeText(shareUrl).catch(() => {});
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(13,27,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div
        style={{
          background: "#F8F5F0",
          color: "#0D1B2A",
          maxWidth: 620,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid #C9A84C",
          padding: "28px 28px 22px",
          fontFamily: "Georgia, serif",
        }}
      >
        <div
          style={{
            fontFamily: "-apple-system, sans-serif",
            fontSize: 10,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "#C9A84C",
            fontWeight: 500,
          }}
        >
          Share charter preferences
        </div>
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontWeight: 300,
            fontSize: 24,
            margin: "8px 0 4px",
            letterSpacing: -0.3,
          }}
        >
          {vesselName}
        </h2>
        <p
          style={{
            fontStyle: "italic",
            color: "rgba(13,27,42,0.6)",
            fontSize: 13.5,
            margin: "0 0 18px",
          }}
        >
          Send a tokenised read-only link to the operating team — captain,
          chef, hostess, management company, or the yacht&apos;s owner. The
          link works for a year and needs no account.
        </p>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span
            style={{
              fontFamily: "-apple-system, sans-serif",
              fontSize: 10.5,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "#C9A84C",
              fontWeight: 500,
              display: "block",
              marginBottom: 6,
            }}
          >
            Recipients
          </span>
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            rows={4}
            placeholder={'captain@vessel.com\nchef@vessel.com\nMaria Vlachou <maria@management.com>'}
            disabled={sending}
            style={{
              width: "100%",
              fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
              fontSize: 13,
              padding: 10,
              border: "1px solid rgba(13,27,42,0.2)",
              background: "#fff",
              color: "#0D1B2A",
              outline: "none",
            }}
          />
          <span
            style={{
              fontSize: 11.5,
              fontStyle: "italic",
              color: "rgba(13,27,42,0.55)",
              display: "block",
              marginTop: 4,
            }}
          >
            One per line, or comma-separated. <code>Name &lt;email&gt;</code> form supported.
          </span>
        </label>

        <label style={{ display: "block", marginBottom: 18 }}>
          <span
            style={{
              fontFamily: "-apple-system, sans-serif",
              fontSize: 10.5,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "#C9A84C",
              fontWeight: 500,
              display: "block",
              marginBottom: 6,
            }}
          >
            Optional note
          </span>
          <textarea
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            rows={4}
            placeholder="A few lines that appear at the top of the email, above the link."
            disabled={sending}
            style={{
              width: "100%",
              fontFamily: "Georgia, serif",
              fontSize: 14,
              padding: 10,
              border: "1px solid rgba(13,27,42,0.2)",
              background: "#fff",
              color: "#0D1B2A",
              outline: "none",
            }}
          />
        </label>

        {err && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FCA5A5",
              color: "#991B1B",
              padding: "10px 14px",
              fontSize: 13.5,
              fontStyle: "italic",
              marginBottom: 14,
            }}
          >
            {err}
          </div>
        )}

        {results && (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              background: "rgba(201,168,76,0.06)",
              border: "1px solid rgba(201,168,76,0.45)",
            }}
          >
            <div
              style={{
                fontFamily: "-apple-system, sans-serif",
                fontSize: 10,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#C9A84C",
                fontWeight: 500,
                marginBottom: 6,
              }}
            >
              Results
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}>
              {results.map((r) => (
                <li key={r.email} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                  <span style={{ color: r.ok ? "#16a34a" : "#b91c1c" }}>
                    {r.ok ? "✓" : "✕"}
                  </span>
                  <span>{r.email}</span>
                  {r.error && (
                    <span style={{ color: "#b91c1c", fontStyle: "italic" }}>· {r.error}</span>
                  )}
                </li>
              ))}
            </ul>
            {shareUrl && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid rgba(201,168,76,0.3)",
                  fontSize: 12,
                  fontStyle: "italic",
                  color: "rgba(13,27,42,0.65)",
                  wordBreak: "break-all",
                }}
              >
                <strong style={{ fontStyle: "normal", marginRight: 6 }}>Share URL:</strong>
                {shareUrl}
                <button
                  type="button"
                  onClick={copyShareUrl}
                  style={{
                    marginLeft: 10,
                    background: "transparent",
                    border: "1px solid rgba(13,27,42,0.2)",
                    color: "#0D1B2A",
                    padding: "4px 10px",
                    fontSize: 10,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontFamily: "-apple-system, sans-serif",
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            style={{
              background: "transparent",
              border: "1px solid rgba(13,27,42,0.2)",
              padding: "10px 18px",
              fontFamily: "-apple-system, sans-serif",
              fontSize: 11,
              letterSpacing: 2,
              textTransform: "uppercase",
              cursor: "pointer",
              color: "#0D1B2A",
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            style={{
              background: "#0D1B2A",
              color: "#F8F5F0",
              border: "1px solid #C9A84C",
              padding: "10px 22px",
              fontFamily: "-apple-system, sans-serif",
              fontSize: 11,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              cursor: sending ? "default" : "pointer",
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
