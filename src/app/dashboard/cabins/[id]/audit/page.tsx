// gy-command — Audit log viewer for one cabin.
// Mitnick's mandate is non-negotiable: every concierge/admin
// action writes a row, and we need to be able to see them.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCabin } from "@/lib/cabin-admin";
import { createServiceClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_section: string | null;
  target_field: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const ACTION_BADGES: Record<string, { color: string; label: string }> = {
  cabin_created: { color: "#16a34a", label: "Cabin created" },
  cabin_updated: { color: "#0ea5e9", label: "Cabin updated" },
  cabin_invite_sent: { color: "#C9A84C", label: "Invite sent" },
  magic_link_requested: { color: "#9CA3AF", label: "Link requested" },
  magic_link_verified: { color: "#16a34a", label: "Signed in" },
  session_destroyed: { color: "#9CA3AF", label: "Signed out" },
  concierge_mode_on: { color: "#C9A84C", label: "Concierge ON" },
  concierge_mode_off: { color: "#9CA3AF", label: "Concierge OFF" },
  concierge_field_saved: { color: "#C9A84C", label: "Concierge edit" },
  concierge_sent_for_review: { color: "#C9A84C", label: "Sent for review" },
  brief_section_saved: { color: "#0ea5e9", label: "Brief saved" },
  brief_submitted: { color: "#16a34a", label: "Brief submitted" },
  pdf_exported: { color: "#9CA3AF", label: "PDF exported" },
  mood_board_uploaded: { color: "#0ea5e9", label: "Mood board ↑" },
  mood_board_deleted: { color: "#b91c1c", label: "Mood board ↓" },
  time_capsule_sealed: { color: "#C9A84C", label: "Capsule sealed" },
  time_capsule_revealed: { color: "#16a34a", label: "Capsule revealed" },
  memory_anchor_scheduled: { color: "#C9A84C", label: "Anchors queued" },
  memory_anchor_sent: { color: "#16a34a", label: "Anchor sent" },
  consent_changed: { color: "#0ea5e9", label: "Consent" },
  data_deleted: { color: "#b91c1c", label: "Data deleted" },
  filotimo_tier_upgraded: { color: "#C9A84C", label: "Tier ↑" },
  designated_assistant_added: { color: "#0ea5e9", label: "Assistant +" },
  designated_assistant_removed: { color: "#b91c1c", label: "Assistant −" },
};

function badge(action: string) {
  const b = ACTION_BADGES[action] ?? { color: "#6b7280", label: action.replace(/_/g, " ") };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      background: b.color,
      color: "#fff",
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      fontWeight: 500,
    }}>
      {b.label}
    </span>
  );
}

export default async function CabinAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const db = createServiceClient();
  const { data, error } = await db
    .from("cabin_audit_log")
    .select("*")
    .eq("cabin_id", id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AuditRow[];

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto" }}>
      <Link href={`/dashboard/cabins/${id}`} style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", textDecoration: "none" }}>
        ← Back to cabin
      </Link>

      <header style={{ marginTop: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C" }}>
          Audit log
        </div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 26, fontWeight: 300 }}>
          {cabin.principal_charterer_name} · <em style={{ color: "#C9A84C", fontStyle: "italic" }}>{cabin.vessel_name}</em>
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13.5, fontStyle: "italic" }}>
          Every admin and concierge action on this cabin, newest first.
          Up to 500 most recent rows.
        </p>
      </header>

      {rows.length === 0 ? (
        <p style={{ color: "#9CA3AF", fontStyle: "italic" }}>No audit entries yet.</p>
      ) : (
        <div style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(13,27,42,0.04)", textAlign: "left" }}>
                <th style={th}>When</th>
                <th style={th}>Actor</th>
                <th style={th}>Action</th>
                <th style={th}>Target</th>
                <th style={th}>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid rgba(13,27,42,0.05)" }}>
                  <td style={td}>
                    <div style={{ fontSize: 12 }}>{new Date(r.created_at).toLocaleString()}</div>
                  </td>
                  <td style={td}>
                    <div>{r.actor_email}</div>
                    <div style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>{r.actor_role}</div>
                  </td>
                  <td style={td}>{badge(r.action)}</td>
                  <td style={td}>
                    {r.target_section && <div>section: {r.target_section}</div>}
                    {r.target_field && <div>field: {r.target_field}</div>}
                    {!r.target_section && !r.target_field && <span style={{ color: "#9CA3AF" }}>—</span>}
                  </td>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#374151" }}>
                    {r.metadata && Object.keys(r.metadata).length > 0
                      ? JSON.stringify(r.metadata)
                      : <span style={{ color: "#9CA3AF" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 12px", fontSize: 10, letterSpacing: 2,
  textTransform: "uppercase", color: "#374151", fontWeight: 500,
};
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
