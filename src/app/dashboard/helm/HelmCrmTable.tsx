"use client";

// The Helm — the CRM table (2026-07-17, George's spec: "μπαίνω και έχω πλήρη
// εικόνα και δεν μπερδεύομαι"). One clean row per request: Ref code, client
// with country flag from their phone, party & budget, route, dates with a
// LOUD year badge (2027 must jump out), nights, status, next action. A single
// search box matches name, email, area AND the GY ref code; chips filter by
// year, stage and day/week. Clicking a row opens the request as before.

import Link from "next/link";
import { useMemo, useState } from "react";

export type CrmRow = {
  id: string;
  ref: string;
  name: string;
  email: string;
  whatsapp: string;
  flag: string;
  country: string;
  party: string;
  budget: string;
  area: string;
  datesFrom: string | null;
  datesTo: string | null;
  year: number | null;
  nights: number | null;
  isDay: boolean;
  status: string;
  due: boolean;
  followUpAt: string | null;
  isAgent: boolean;
  createdAt: string;
};

const STAGE_LABEL: Record<string, string> = {
  new: "New", drafted: "Drafted", sent: "Sent", in_conversation: "In conversation",
  negotiating: "Negotiating", won: "Won", lost: "Lost",
};
const STAGE_COLOR: Record<string, string> = {
  new: "#9CA3AF", drafted: "#C9A84C", sent: "#60A5FA", in_conversation: "#34D399",
  negotiating: "#F59E0B", won: "#0D1B2A", lost: "#94a3b8",
};

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function HelmCrmTable({ rows }: { rows: CrmRow[] }) {
  const [q, setQ] = useState("");
  const [year, setYear] = useState<"all" | number>("all");
  const [stage, setStage] = useState<"all" | "active" | string>("active");
  const [kind, setKind] = useState<"all" | "day" | "week">("all");

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => r.year).filter((y): y is number => !!y))).sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && ![r.name, r.email, r.area, r.ref, r.whatsapp, r.country].some((v) => v.toLowerCase().includes(needle))) return false;
      if (year !== "all" && r.year !== year) return false;
      if (stage === "active" && (r.status === "lost" || r.status === "won")) return false;
      if (stage !== "all" && stage !== "active" && r.status !== stage) return false;
      if (kind === "day" && !r.isDay) return false;
      if (kind === "week" && r.isDay) return false;
      return true;
    });
  }, [rows, q, year, stage, kind]);

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
    border: `1px solid ${active ? "#0D1B2A" : "rgba(13,27,42,0.15)"}`,
    background: active ? "#0D1B2A" : "#fff", color: active ? "#F8F5F0" : "#6b7280",
    cursor: "pointer", borderRadius: 999,
  });

  return (
    <>
      {/* controls: one search, three chip groups */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search: name, email, Ref GY…, area"
          style={{ flex: "1 1 260px", maxWidth: 360, padding: "8px 12px", fontSize: 13, border: "1px solid rgba(13,27,42,0.15)", borderRadius: 2 }}
        />
        <button type="button" style={chip(stage === "active")} onClick={() => setStage("active")}>Active</button>
        <button type="button" style={chip(stage === "all")} onClick={() => setStage("all")}>All</button>
        <button type="button" style={chip(stage === "won")} onClick={() => setStage(stage === "won" ? "active" : "won")}>Won</button>
        <span style={{ width: 1, height: 20, background: "rgba(13,27,42,0.12)" }} />
        <button type="button" style={chip(year === "all")} onClick={() => setYear("all")}>All years</button>
        {years.map((y) => (
          <button key={y} type="button" style={{ ...chip(year === y), ...(y > new Date().getFullYear() && year !== y ? { borderColor: "#C9A84C", color: "#A8873B" } : {}) }} onClick={() => setYear(y)}>{y}</button>
        ))}
        <span style={{ width: 1, height: 20, background: "rgba(13,27,42,0.12)" }} />
        <button type="button" style={chip(kind === "week")} onClick={() => setKind(kind === "week" ? "all" : "week")}>Weekly</button>
        <button type="button" style={chip(kind === "day")} onClick={() => setKind(kind === "day" ? "all" : "day")}>Day</button>
      </div>

      <div style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 900 }}>
          <thead>
            <tr style={{ background: "rgba(13,27,42,0.04)", textAlign: "left" }}>
              <th style={th}>Ref</th>
              <th style={th}>Client</th>
              <th style={th}>Guests · Budget</th>
              <th style={th}>Route / Area</th>
              <th style={th}>Dates</th>
              <th style={th}>Status</th>
              <th style={th}>Next action</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#6b7280", fontStyle: "italic" }}>
                Nothing matches. Clear the search or filters.
              </td></tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(13,27,42,0.05)", opacity: r.status === "lost" ? 0.55 : 1 }}>
                <td style={td}>
                  <Link href={`/dashboard/helm/${r.id}`} style={{ fontFamily: "monospace", fontSize: 12, color: "#A8873B", fontWeight: 700, textDecoration: "none" }}>
                    {r.ref}
                  </Link>
                  <div style={{ fontSize: 10.5, color: "#cbd5e1" }}>{fmt(r.createdAt)}</div>
                </td>
                <td style={td}>
                  <Link href={`/dashboard/helm/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                    <strong>{r.flag ? `${r.flag} ` : ""}{r.name}</strong>
                    {r.isAgent && <span style={{ marginLeft: 6, fontSize: 9, background: "#6D28D9", color: "#fff", padding: "1px 6px", letterSpacing: 1 }}>AGENT</span>}
                    <div style={{ fontSize: 11.5, color: "#6b7280" }}>
                      {r.email}{r.whatsapp ? ` · ${r.whatsapp}` : ""}
                    </div>
                  </Link>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {r.party ? `${r.party} guests` : "—"}
                  <div style={{ fontSize: 11.5, color: "#6b7280" }}>{r.budget || ""}</div>
                </td>
                <td style={{ ...td, maxWidth: 220 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.area}>
                    {r.area || "—"}
                  </span>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {r.datesFrom ? (
                    <>
                      {fmt(r.datesFrom)}{r.datesTo ? ` – ${fmt(r.datesTo)}` : ""}
                      {r.year && (
                        <span style={{
                          marginLeft: 8, fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 999,
                          background: r.year > new Date().getFullYear() ? "#C9A84C" : "rgba(13,27,42,0.08)",
                          color: r.year > new Date().getFullYear() ? "#0D1B2A" : "#6b7280",
                        }}>{r.year}</span>
                      )}
                      <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>
                        {r.isDay ? "day charter" : r.nights ? `${r.nights} nights` : ""}
                      </div>
                    </>
                  ) : "—"}
                </td>
                <td style={td}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", background: STAGE_COLOR[r.status] || "#9CA3AF",
                    color: "#fff", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
                  }}>{STAGE_LABEL[r.status] || r.status}</span>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {r.due
                    ? <span style={{ color: "#b45309", fontSize: 12, fontWeight: 700 }}>● Follow up now</span>
                    : r.followUpAt
                      ? <span style={{ color: "#6b7280", fontSize: 12 }}>Follow-up {fmt(r.followUpAt)}</span>
                      : r.status === "new"
                        ? <span style={{ color: "#A8873B", fontSize: 12 }}>Start: yachts in</span>
                        : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 11.5, color: "#9CA3AF" }}>
        {shown.length} of {rows.length} requests · search matches names, emails, areas and Ref codes
      </div>
    </>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px", fontSize: 10, letterSpacing: 2,
  textTransform: "uppercase", color: "#374151", fontWeight: 500,
};
const td: React.CSSProperties = { padding: "11px 14px", verticalAlign: "top" };
