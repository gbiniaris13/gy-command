// gy-command — Print-friendly view of a Cabin. George opens this
// in a new tab and uses ⌘P → Save as PDF. Zero PDF library deps,
// matches brand exactly because it's rendered HTML.

import { notFound } from "next/navigation";
import { getCabin, getCabinSections, getCabinMembers } from "@/lib/cabin-admin";
import PrintButton from "./PrintButton";

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

function fmt(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function renderValue(v: unknown): React.ReactNode {
  if (v == null || v === "") return <em style={{ color: "#94a3b8" }}>—</em>;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x != null && x !== "");
    if (!entries.length) return <em style={{ color: "#94a3b8" }}>—</em>;
    return (
      <dl style={{ margin: 0 }}>
        {entries.map(([k, x]) => (
          <div key={k} style={{ display: "flex", gap: 8 }}>
            <dt style={{ minWidth: 140, color: "#6b7280", fontSize: 12, textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</dt>
            <dd style={{ margin: 0, fontSize: 13 }}>{renderValue(x)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return String(v);
}

export default async function PrintCabinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const [sections, members] = await Promise.all([
    getCabinSections(id),
    getCabinMembers(id),
  ]);

  return (
    <div style={{ background: "#F8F5F0", minHeight: "100vh", padding: 0 }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .page-break { page-break-after: always; }
        }
        body { font-family: Georgia, serif; color: #0D1B2A; }
        h1, h2, h3 { font-weight: 300; }
      `}</style>

      <div className="no-print" style={{
        position: "sticky", top: 0, background: "#0D1B2A", color: "#F8F5F0",
        padding: "12px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", zIndex: 10,
      }}>
        <span style={{ fontSize: 12, letterSpacing: 2 }}>Print view · use ⌘P / Ctrl+P to save as PDF</span>
        <PrintButton />
      </div>

      <article style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px 60px" }}>
        {/* Cover */}
        <header style={{ borderBottom: "1px solid rgba(201,168,76,0.4)", paddingBottom: 24, marginBottom: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
            George Yachts · The Charter Brief
          </div>
          <h1 style={{ fontSize: 38, margin: "12px 0 4px", letterSpacing: -0.5 }}>
            {cabin.principal_charterer_name}
          </h1>
          <div style={{ fontSize: 16, color: "rgba(13,27,42,0.7)", fontStyle: "italic" }}>
            {cabin.vessel_name}{cabin.vessel_make_model ? " · " + cabin.vessel_make_model : ""}
          </div>
          <div style={{ fontSize: 13, color: "rgba(13,27,42,0.55)", marginTop: 8 }}>
            {fmt(cabin.charter_period_from)} – {fmt(cabin.charter_period_to)}
            {" · "}{cabin.port_embarkation} → {cabin.port_disembarkation}
            {" · "}{cabin.cruising_area}
          </div>
        </header>

        {/* Internal cover sheet info (for crew/owner consumption) */}
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", color: "#C9A84C", marginBottom: 12 }}>
            Internal — operations
          </h2>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <tbody>
              <tr><td style={tdL}>MYBA contract #</td><td>{cabin.myba_contract_number || "—"}</td></tr>
              <tr><td style={tdL}>Central agent</td><td>{cabin.central_agent_internal || "—"}</td></tr>
              <tr><td style={tdL}>Captain</td><td>{cabin.captain_name_internal || "—"}</td></tr>
              <tr><td style={tdL}>Chef</td><td>{cabin.chef_name_internal || "—"}</td></tr>
              <tr><td style={tdL}>Hostess</td><td>{cabin.hostess_name_internal || "—"}</td></tr>
              <tr><td style={tdL}>Charter fee</td><td>€ {cabin.charter_fee_eur?.toLocaleString() || "—"}</td></tr>
              <tr><td style={tdL}>APA</td><td>€ {cabin.apa_eur?.toLocaleString() || "—"}</td></tr>
              <tr><td style={tdL}>Charterer email</td><td>{cabin.principal_charterer_email}</td></tr>
              <tr><td style={tdL}>Charterer mobile</td><td>{cabin.principal_charterer_mobile || "—"}</td></tr>
              <tr><td style={tdL}>Members</td><td>{members.length}</td></tr>
            </tbody>
          </table>
        </section>

        {/* Each brief section */}
        {Object.entries(SECTION_LABELS).map(([key, label]) => {
          const row = sections.find((s) => s.section_key === key);
          if (!row || (!row.completed && (!row.data || Object.keys(row.data).length === 0))) return null;

          return (
            <section key={key} style={{ marginBottom: 28, paddingBottom: 24, borderBottom: "1px solid rgba(13,27,42,0.08)" }}>
              <h2 style={{ fontSize: 22, margin: "0 0 14px", fontStyle: "italic", color: "#0D1B2A" }}>
                {label}
              </h2>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                {renderValue(row.data)}
              </div>
            </section>
          );
        })}

        <footer style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid rgba(13,27,42,0.08)", fontSize: 11, color: "rgba(13,27,42,0.5)", textAlign: "center", letterSpacing: 1.5, textTransform: "uppercase" }}>
          George Yachts Brokerage House LLC · Filotimo · Φιλότιμο · georgeyachts.com
        </footer>
      </article>
    </div>
  );
}

const tdL: React.CSSProperties = {
  padding: "6px 12px 6px 0",
  fontSize: 10,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: "#6b7280",
  width: 180,
  borderBottom: "1px solid rgba(13,27,42,0.05)",
};
