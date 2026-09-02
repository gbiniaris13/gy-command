// gy-command dashboard — Cabin list.
// Server component; data fetched via service-role.

import Link from "next/link";
import { listCabins } from "@/lib/cabin-admin";

export const dynamic = "force-dynamic";

function fmt(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: "#9CA3AF",
    invited: "#C9A84C",
    active: "#34D399",
    in_voyage: "#60A5FA",
    completed: "#0D1B2A",
    archived: "#94a3b8",
  };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px",
      background: map[s] || "#9CA3AF", color: "#fff",
      fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    }}>{s.replace(/_/g, " ")}</span>
  );
}

export default async function CabinsListPage() {
  const cabins = await listCabins();

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
            The Cabin · Admin
          </div>
          <h1 style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 300 }}>
            All cabins
          </h1>
        </div>
        <Link href="/dashboard/cabins/new" style={{
          background: "#0D1B2A", color: "#F8F5F0",
          padding: "10px 18px", textDecoration: "none",
          fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase",
          border: "1px solid #C9A84C",
        }}>
          + New cabin
        </Link>
      </header>

      {/* 2026-09-02 (iPhone pass) - the row set is ~670px wide; without
          its own horizontal scroll the Dates / Status / Brief columns
          were simply cut off on a phone. */}
      <div style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "rgba(13,27,42,0.04)", textAlign: "left" }}>
              <th style={th}>Charterer</th>
              <th style={th}>Vessel</th>
              <th style={th}>Dates</th>
              <th style={th}>Status</th>
              <th style={th}>Brief</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {cabins.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#6b7280", fontStyle: "italic" }}>
                No cabins yet. Create the first one →
              </td></tr>
            )}
            {cabins.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid rgba(13,27,42,0.05)" }}>
                <td style={td}>
                  <strong>{c.principal_charterer_name}</strong>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{c.principal_charterer_email}</div>
                </td>
                <td style={td}>{c.vessel_name}</td>
                <td style={td}>{fmt(c.charter_period_from)} – {fmt(c.charter_period_to)}</td>
                <td style={td}>{statusBadge(c.status)}{c.concierge_mode_active && <span style={{ marginLeft: 8, fontSize: 10, color: "#C9A84C" }}>· concierge</span>}</td>
                <td style={td}>
                  <span style={{ fontFamily: "monospace" }}>{c.brief_completion_percent}%</span>
                  <span style={{ marginLeft: 8, color: "#6b7280", fontSize: 12 }}>· {c.members_count} member{c.members_count === 1 ? "" : "s"}</span>
                </td>
                <td style={td}>
                  <Link href={`/dashboard/cabins/${c.id}`} style={{ color: "#0D1B2A", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px", fontSize: 10, letterSpacing: 2,
  textTransform: "uppercase", color: "#374151", fontWeight: 500,
};
const td: React.CSSProperties = { padding: "12px 14px" };
