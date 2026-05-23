// gy-command — single Cabin detail. Concierge toggle, invite button,
// section completion status, link to print/PDF view.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCabin,
  getCabinSections,
  getCabinMembers,
  refreshBerthNearby,
} from "@/lib/cabin-admin";
import CabinDetailActions from "./CabinDetailActions";
import StatusTransitions from "./StatusTransitions";

export const dynamic = "force-dynamic";

const SECTION_LABELS: Record<string, string> = {
  arrival: "Arrival & Departure",
  guests: "Your Group",
  health: "Health & Safety",
  itinerary: "Itinerary",
  life_aboard: "Life Aboard",
  dining: "At the Table",
  beverages: "In the Cellar",
  little_things: "The Little Things",
  children: "The Little Sailors",
};

export default async function CabinDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const [sections, members] = await Promise.all([
    getCabinSections(id),
    getCabinMembers(id),
  ]);

  // 2026-05-23 — Berth Map Phase 2 backfill on cabin detail load.
  // Same trigger as EditBasicsPage: if coords exist but no cached
  // nearby data, fire fetch in background. By the time George
  // clicks "Edit Cabin Details", the panel summary is already
  // populated. Zero clicks for the operator.
  const hasBerthCoords =
    typeof cabin.berth_lat === "number" &&
    typeof cabin.berth_lng === "number" &&
    Number.isFinite(cabin.berth_lat) &&
    Number.isFinite(cabin.berth_lng);
  if (hasBerthCoords && !cabin.berth_nearby) {
    void refreshBerthNearby(
      id,
      cabin.berth_lat as number,
      cabin.berth_lng as number,
    ).catch((e) =>
      console.error("[cabin-detail] auto-backfill berth_nearby failed:", e),
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: "0 auto" }}>
      <Link href="/dashboard/cabins" style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", textDecoration: "none" }}>
        ← All cabins
      </Link>

      <header style={{ marginTop: 12, paddingBottom: 18, borderBottom: "1px solid rgba(13,27,42,0.08)" }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C" }}>
          {cabin.status}{cabin.concierge_mode_active ? " · concierge active" : ""}
        </div>
        <h1 style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 300 }}>
          {cabin.principal_charterer_name} · <em>{cabin.vessel_name}</em>
        </h1>
        <div style={{ color: "#6b7280", marginTop: 6 }}>
          {cabin.charter_period_from} – {cabin.charter_period_to} · {cabin.port_embarkation} → {cabin.port_disembarkation}
        </div>
        {/* 2026-05-22 — Brief submission badge. Renders only when
            the principal has hit "Send to George" in the cabin
            review screen. Gold pill, surfaces in-place at the
            cabin head so it's the first thing the operator sees
            walking into the page. */}
        {cabin.brief_submitted_at && (
          <div style={{
            marginTop: 14,
            padding: "10px 14px",
            background: "rgba(201,168,76,0.12)",
            border: "1px solid rgba(201,168,76,0.55)",
            borderLeft: "3px solid #C9A84C",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 12.5,
          }}>
            <span style={{ fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 700 }}>
              ✓ Brief submitted
            </span>
            <span style={{ color: "rgba(13,27,42,0.65)" }}>
              {new Date(cabin.brief_submitted_at).toLocaleString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span style={{ color: "rgba(13,27,42,0.45)", fontSize: 11.5 }}>
              · The cabin is locked for guests. Open Preference sheet to read or forward to the captain.
            </span>
            <form action={`/api/cabins/${id}/reopen-brief`} method="post" style={{ marginLeft: "auto" }}>
              <button
                type="submit"
                style={{
                  fontSize: 10,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  background: "transparent",
                  border: "1px solid rgba(13,27,42,0.3)",
                  padding: "7px 12px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Reopen brief
              </button>
            </form>
          </div>
        )}
      </header>

      <CabinDetailActions
        cabinId={id}
        conciergeOn={!!cabin.concierge_mode_active}
        status={cabin.status}
        principalEmail={cabin.principal_charterer_email}
        vesselName={cabin.vessel_name}
      />
      <StatusTransitions cabinId={id} current={cabin.status} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24 }}>
        <section>
          <h2 style={h2}>Charter at-a-glance</h2>
          <dl style={dl}>
            <Row k="Charterer email">{cabin.principal_charterer_email}</Row>
            <Row k="Charterer mobile">{cabin.principal_charterer_mobile || "—"}</Row>
            <Row k="Vessel make/model">{cabin.vessel_make_model || "—"}</Row>
            <Row k="Vessel length">{cabin.vessel_length || "—"}</Row>
            <Row k="Capacity">{cabin.vessel_capacity || "—"}</Row>
            <Row k="Homeport">{cabin.homeport || "—"}</Row>
            <Row k="Cruising area">{cabin.cruising_area || "—"}</Row>
            <Row k="Captain (internal)">{cabin.captain_name_internal || "—"}</Row>
            <Row k="Chef (internal)">{cabin.chef_name_internal || "—"}</Row>
            <Row k="Hostess (internal)">{cabin.hostess_name_internal || "—"}</Row>
            <Row k="Central agent">{cabin.central_agent_internal || "—"}</Row>
            <Row k="Charter fee €">{cabin.charter_fee_eur ? cabin.charter_fee_eur.toLocaleString() : "—"}</Row>
            <Row k="APA €">{cabin.apa_eur ? cabin.apa_eur.toLocaleString() : "—"}</Row>
            <Row k="MYBA #">{cabin.myba_contract_number || "—"}</Row>
          </dl>
        </section>

        <section>
          <h2 style={h2}>Brief progress · {cabin.brief_completion_percent}%</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(SECTION_LABELS).map(([k, label]) => {
              const row = sections.find((s) => s.section_key === k);
              const done = !!row?.completed;
              return (
                <li key={k} style={{
                  display: "grid", gridTemplateColumns: "20px 1fr auto",
                  alignItems: "center", gap: 12, padding: "8px 12px",
                  background: "#fff", border: "1px solid rgba(13,27,42,0.06)",
                }}>
                  <span style={{ color: done ? "#C9A84C" : "#cbd5e1", fontWeight: 700 }}>
                    {done ? "●" : "○"}
                  </span>
                  <span>{label}</span>
                  <span style={{ fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>
                    {row?.last_edited_at ? "saved " + new Date(row.last_edited_at).toLocaleString() : "—"}
                  </span>
                </li>
              );
            })}
          </ul>

          <h2 style={{ ...h2, marginTop: 22 }}>Members</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {members.map((m) => (
              <li key={m.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(13,27,42,0.05)" }}>
                <strong>{m.display_name || m.email}</strong>
                <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 12 }}>
                  · {m.role.replace(/_/g, " ")}
                </span>
                {m.last_login_at && (
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    last sign-in {new Date(m.last_login_at).toLocaleString()}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: "#C9A84C", margin: "0 0 12px", fontWeight: 500 };
const dl: React.CSSProperties = { margin: 0, display: "flex", flexDirection: "column", gap: 4 };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, padding: "4px 0", fontSize: 13.5, borderBottom: "1px solid rgba(13,27,42,0.04)" }}>
      <dt style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#6b7280" }}>{k}</dt>
      <dd style={{ margin: 0 }}>{children}</dd>
    </div>
  );
}
