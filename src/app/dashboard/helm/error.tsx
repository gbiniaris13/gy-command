"use client";

// Calm failure for the whole Helm back office (2026-07-18, George: a broker
// opening his desk must never meet a raw crash). The commonest cause is the
// live database blinking for a few seconds (Supabase 522) — the request/list
// pages read it directly, so a hiccup used to render a white 500. This
// boundary catches ANY render/data error under /dashboard/helm and offers a
// one-tap retry instead. Nothing is lost; the next load reads fresh.

import { useEffect, useState } from "react";
import Link from "next/link";

// A blink of the database (Supabase "API Gateway - Degraded Performance",
// September 2026) used to put this page in front of George on every other
// open. The server reads now retry on their own; if the page still fails,
// this boundary quietly tries twice more, a few seconds apart, before it
// says anything. The counter lives in sessionStorage because reset()
// remounts this component.
const AUTO_RETRIES = 2;
const AUTO_RETRY_MS = 3000;

export default function HelmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const key = `helm-auto-retry:${typeof window !== "undefined" ? window.location.pathname : ""}`;
  const readUsed = () => { try { return Number(sessionStorage.getItem(key) || "0"); } catch { return AUTO_RETRIES; } };
  // Decided once, at mount: are silent retries still available for this page?
  const [autoRetrying] = useState(() => readUsed() < AUTO_RETRIES);

  useEffect(() => {
    // Surfaces in the server/log stream for later diagnosis without alarming George.
    console.error("[helm] page error", error);
    if (!autoRetrying) {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      return;
    }
    const t = setTimeout(() => {
      try { sessionStorage.setItem(key, String(readUsed() + 1)); } catch { /* ignore */ }
      reset();
    }, AUTO_RETRY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, reset, autoRetrying]);

  if (autoRetrying) {
    return (
      <div style={{ padding: 24, maxWidth: 640, margin: "48px auto 0", textAlign: "center" }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
          The Helm
        </div>
        <p style={{ marginTop: 14, fontSize: 14, color: "#6b7280" }}>One moment, the database blinked. Trying again…</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: "48px auto 0", textAlign: "center" }}>
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
        The Helm
      </div>
      <h1 style={{ margin: "12px 0 0", fontSize: 24, fontWeight: 300, color: "#0D1B2A" }}>
        One moment — the desk could not load
      </h1>
      <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#6b7280" }}>
        The database did not answer after three tries. This is a blink on its side,
        not lost work. Nothing was saved over or deleted. Try again in a moment.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 22, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C",
            padding: "11px 22px", fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", cursor: "pointer",
          }}
        >
          Try again
        </button>
        <Link
          href="/dashboard/helm"
          style={{
            background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)",
            padding: "11px 22px", fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", textDecoration: "none",
          }}
        >
          Back to the pipeline
        </Link>
      </div>
      {error?.digest && (
        <p style={{ marginTop: 18, fontSize: 11, color: "#cbd5e1" }}>Reference: {error.digest}</p>
      )}
    </div>
  );
}
