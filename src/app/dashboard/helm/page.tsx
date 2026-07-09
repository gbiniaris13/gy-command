// gy-command dashboard — The Helm: charter request pipeline.
// Server component; data fetched via service-role through the
// helm_listing view.

import Link from "next/link";
import { listHelm, type HelmListItem } from "@/lib/helm-admin";

export const dynamic = "force-dynamic";

const STAGE_ORDER = [
  "new", "drafted", "sent", "in_conversation", "negotiating", "won", "lost",
] as const;

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  drafted: "Drafted",
  sent: "Sent",
  in_conversation: "In conversation",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
};

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    new: "#9CA3AF",
    drafted: "#C9A84C",
    sent: "#60A5FA",
    in_conversation: "#34D399",
    negotiating: "#F59E0B",
    won: "#0D1B2A",
    lost: "#94a3b8",
  };
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px",
      background: map[s] || "#9CA3AF", color: "#fff",
      fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase",
    }}>{STAGE_LABEL[s] || s.replace(/_/g, " ")}</span>
  );
}

function followUpDue(r: HelmListItem): boolean {
  if (!r.follow_up_at) return false;
  if (!["sent", "in_conversation", "negotiating"].includes(r.status)) return false;
  return new Date(r.follow_up_at).getTime() <= Date.now();
}

function reqType(r: HelmListItem): "direct_client" | "travel_agent" {
  return r.request_type === "travel_agent" ? "travel_agent" : "direct_client";
}

function typeBadge(t: "direct_client" | "travel_agent") {
  const agent = t === "travel_agent";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px",
      background: agent ? "#6D28D9" : "#0D7C66", color: "#fff",
      fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>{agent ? "Travel Agent" : "Direct Client"}</span>
  );
}

export default async function HelmListPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const filter: "all" | "direct_client" | "travel_agent" =
    sp?.type === "travel_agent" || sp?.type === "direct_client" ? sp.type : "all";

  const requests = await listHelm();
  // 2026-07-08 (George): lost requests sink to the BOTTOM; everything
  // still alive stays on top, newest first, so the eye lands on what
  // needs action.
  const sorted = [...requests].sort((a, b) => {
    const aLost = a.status === "lost" ? 1 : 0;
    const bLost = b.status === "lost" ? 1 : 0;
    if (aLost !== bLost) return aLost - bLost;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
  const shown = filter === "all" ? sorted : sorted.filter((r) => reqType(r) === filter);

  const dueCount = requests.filter(followUpDue).length;
  const counts = {
    all: requests.length,
    direct_client: requests.filter((r) => reqType(r) === "direct_client").length,
    travel_agent: requests.filter((r) => reqType(r) === "travel_agent").length,
  };

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
            The Helm · Requests
          </div>
          <h1 style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 300 }}>
            Charter pipeline
          </h1>
          {dueCount > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#b45309" }}>
              {dueCount} request{dueCount === 1 ? "" : "s"} due for follow-up
            </div>
          )}
        </div>
        <Link href="/dashboard/helm/new" style={{
          background: "#0D1B2A", color: "#F8F5F0",
          padding: "10px 18px", textDecoration: "none",
          fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase",
          border: "1px solid #C9A84C",
        }}>
          + New request
        </Link>
      </header>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["all", "direct_client", "travel_agent"] as const).map((key) => {
          const label = key === "all" ? "All" : key === "travel_agent" ? "Travel Agent" : "Direct Client";
          const active = filter === key;
          const href = key === "all" ? "/dashboard/helm" : `/dashboard/helm?type=${key}`;
          return (
            <Link key={key} href={href} style={{
              padding: "6px 14px", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase",
              textDecoration: "none", border: `1px solid ${active ? "#0D1B2A" : "rgba(13,27,42,0.15)"}`,
              background: active ? "#0D1B2A" : "#fff", color: active ? "#F8F5F0" : "#6b7280",
            }}>{label} ({counts[key]})</Link>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "rgba(13,27,42,0.04)", textAlign: "left" }}>
              <th style={th}>Client</th>
              <th style={th}>Type</th>
              <th style={th}>Received</th>
              <th style={th}>Occasion</th>
              <th style={th}>Dates</th>
              <th style={th}>Area</th>
              <th style={th}>Status</th>
              <th style={th}>Follow-up</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: "center", color: "#6b7280", fontStyle: "italic" }}>
                {filter === "all" ? "No requests yet. Add the first one →" : "No requests of this type."}
              </td></tr>
            )}
            {shown.map((r) => {
              const due = followUpDue(r);
              const name = r.client_name
                || [r.first_name, r.last_name].filter(Boolean).join(" ")
                || r.client_email
                || r.contact_email
                || "(unnamed)";
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid rgba(13,27,42,0.05)" }}>
                  <td style={td}>
                    <strong>{name}</strong>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{r.client_email || r.contact_email || ""}</div>
                  </td>
                  <td style={td}>{typeBadge(reqType(r))}</td>
                  <td style={td}>
                    {r.created_at
                      ? <span style={{ whiteSpace: "nowrap" }}>{fmt(r.created_at)}</span>
                      : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={td}>{r.occasion || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={td}>
                    {r.dates_from || r.dates_to
                      ? `${fmt(r.dates_from)}${r.dates_to ? " – " + fmt(r.dates_to) : ""}`
                      : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={td}>{r.area || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={td}>{statusBadge(r.status)}</td>
                  <td style={td}>
                    {due
                      ? <span style={{ color: "#b45309", fontSize: 12, fontWeight: 600 }}>● due {fmt(r.follow_up_at)}</span>
                      : r.follow_up_at
                        ? <span style={{ color: "#6b7280", fontSize: 12 }}>{fmt(r.follow_up_at)}</span>
                        : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={td}>
                    <Link href={`/dashboard/helm/${r.id}`} style={{ color: "#0D1B2A", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* tiny legend so the pipeline stages read clearly */}
      <div style={{ marginTop: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {STAGE_ORDER.map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b7280" }}>
            {statusBadge(s)}
          </span>
        ))}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px", fontSize: 10, letterSpacing: 2,
  textTransform: "uppercase", color: "#374151", fontWeight: 500,
};
const td: React.CSSProperties = { padding: "12px 14px" };
