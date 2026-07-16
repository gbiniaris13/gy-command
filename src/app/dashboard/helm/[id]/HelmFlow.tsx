"use client";

// THE HELM — the guided spine (2026-07-16, George: "κάντε το Apple, όχι
// Excel του 1990"). Wave 1 of the UX rebuild, deliberately ZERO-RISK to the
// machinery underneath:
//
//   • HelmFlow — a sticky 5-step rail that always answers "where am I and
//     what do I press next". Step state is DERIVED from the request's data
//     (never stored), each step scrolls to its section, and one gold button
//     carries the single next action.
//   • Quiet<> — wraps secondary sections in a closed-by-default drawer so
//     the page reads as five calm moves instead of fourteen equal boxes.
//
// Nothing inside the sections changes — every existing control keeps
// working exactly as before.

import { useEffect, useState } from "react";

type StepKey = "request" | "yachts" | "review" | "edition" | "send";

export function HelmFlow({
  hasSupplier,
  hasExtraction,
  hasPdf,
  status,
}: {
  hasSupplier: boolean;
  hasExtraction: boolean;
  hasPdf: boolean;
  status: string;
}) {
  const sent = ["sent", "in_conversation", "negotiating", "won"].includes(status);

  const steps: { key: StepKey; n: number; title: string; done: boolean; anchor: string }[] = [
    { key: "request", n: 1, title: "The request", done: true, anchor: "flow-request" },
    { key: "yachts", n: 2, title: "Yachts in", done: hasSupplier, anchor: "flow-yachts" },
    { key: "review", n: 3, title: "Review", done: hasExtraction, anchor: "flow-review" },
    { key: "edition", n: 4, title: "The edition", done: hasPdf, anchor: "flow-review" },
    { key: "send", n: 5, title: "Send & follow", done: sent, anchor: "flow-send" },
  ];
  const current = steps.find((s) => !s.done) ?? steps[steps.length - 1];

  const nextAction: { label: string; anchor: string } = !hasSupplier
    ? { label: "Bring the yachts in — import the supplier emails", anchor: "flow-yachts" }
    : !hasExtraction
      ? { label: "Extract the yachts — one card per boat, you confirm the numbers", anchor: "flow-review" }
      : !hasPdf
        ? { label: "Generate the edition — magazine + PDF from your review", anchor: "flow-review" }
        : !sent
          ? { label: "Send it to the client", anchor: "flow-send" }
          : { label: "Sent — watch replies and the Salon signals below", anchor: "flow-send" };

  function jump(anchor: string) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 20, background: "rgba(250,249,246,0.94)",
      backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(13,27,42,0.08)",
      margin: "0 0 18px", padding: "10px 4px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {steps.map((s, i) => {
          const isCurrent = s.key === current.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => jump(s.anchor)}
              style={{
                display: "flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
                background: isCurrent ? "#0D1B2A" : "transparent",
                color: isCurrent ? "#F8F5F0" : s.done ? "#3A6B47" : "#9CA3AF",
                borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600,
              }}
            >
              <span style={{
                width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center",
                fontSize: 10.5, fontWeight: 700,
                background: s.done ? "#3A6B47" : isCurrent ? "#C9A84C" : "rgba(13,27,42,0.12)",
                color: s.done || isCurrent ? "#fff" : "#6b7280",
              }}>{s.done ? "✓" : s.n}</span>
              {s.title}
              {i < steps.length - 1 && <span style={{ color: "rgba(13,27,42,0.2)", marginLeft: 2 }}>›</span>}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => jump(nextAction.anchor)}
          style={{
            marginLeft: "auto", border: "1px solid #C9A84C", background: "#0D1B2A", color: "#F8F5F0",
            borderRadius: 2, padding: "8px 16px", fontSize: 11.5, fontWeight: 600,
            letterSpacing: "0.06em", cursor: "pointer",
          }}
        >
          {nextAction.label} →
        </button>
      </div>
    </div>
  );
}

/** A secondary section, folded away: one calm row, opens on demand.
 *  `hint` says in plain words when you would need it. */
export function Quiet({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // <details> would be simpler, but some inner components measure themselves
  // on mount — controlled visibility keeps them happy and animatable.
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  return (
    <section style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)", borderRadius: 2, marginTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", width: "100%", alignItems: "baseline", gap: 10, padding: "13px 16px",
          background: "none", border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ color: "#C9A84C", fontSize: 11, transform: open ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform .2s" }}>▶</span>
        <span style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#374151", fontWeight: 700 }}>{title}</span>
        {hint && <span style={{ fontSize: 12, color: "#9CA3AF" }}>{hint}</span>}
      </button>
      {open && <div style={{ padding: "0 16px 16px" }}>{children}</div>}
    </section>
  );
}
