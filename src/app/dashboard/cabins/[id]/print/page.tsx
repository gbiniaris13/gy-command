// gy-command — Internal print view of a Cabin.
//
// This is the FULL-PII version: charterer name, email, mobile,
// internal ops (captain / chef / hostess), MYBA contract #, central
// agent, charter fee and APA. For George's own records. Distinct
// from the preference-sheet view which strips that information
// before sharing with the captain / chef / owner.
//
// Brand-styled to match the preference sheet (navy hero, gold
// section numbers, ivory body) so the two documents read as a pair
// when both are printed.

import { notFound } from "next/navigation";
import {
  getCabin,
  getCabinSections,
  getCabinMembers,
  getCabinGuestsManifest,
} from "@/lib/cabin-admin";
import { mergeGuestRecords } from "@/lib/cabin-guest-merge";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

// =================== BRAND TOKENS ============================
const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const IVORY = "#F8F5F0";
const RULE = "rgba(13, 27, 42, 0.12)";
const MUTED = "rgba(13, 27, 42, 0.55)";
const FONT_EDITORIAL = "Georgia, 'Times New Roman', serif";
const FONT_UI = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

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
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function fmtVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((x) => titleCase(String(x))).join(" · ");
  }
  return "";
}

// Renders nested objects recursively as gold-labelled rows. Used for
// the "data dump" sections of the brief that don't have a tailored
// view (most internal printing just needs the raw data legibly laid
// out).
function renderValue(v: unknown): React.ReactNode {
  if (v == null || v === "") return <em style={{ color: "rgba(13,27,42,0.35)" }}>—</em>;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return <em style={{ color: "rgba(13,27,42,0.35)" }}>—</em>;
    // Array of objects → render each as a small inline block.
    if (v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
      return (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {v.map((entry, i) => (
            <li key={i} style={{ borderTop: i ? `1px dashed ${RULE}` : "none", padding: i ? "6px 0 0" : 0, marginTop: i ? 6 : 0 }}>
              {renderValue(entry)}
            </li>
          ))}
        </ul>
      );
    }
    return v.map((x) => titleCase(String(x))).join(" · ");
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, x]) => x != null && x !== "",
    );
    if (!entries.length) return <em style={{ color: "rgba(13,27,42,0.35)" }}>—</em>;
    return (
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(([k, x]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12 }}>
            <dt
              style={{
                fontFamily: FONT_UI,
                fontSize: 10,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                color: MUTED,
                paddingTop: 2,
              }}
            >
              {titleCase(k)}
            </dt>
            <dd style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: NAVY }}>
              {renderValue(x)}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return String(v);
}

export default async function PrintCabinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const [sections, members, manifest] = await Promise.all([
    getCabinSections(id),
    getCabinMembers(id),
    getCabinGuestsManifest(id),
  ]);

  // 2026-05-26 — Brief 02 (Task B1): merge cabin_members.personal_details
  // with cabin_guests_manifest. Member-self data wins. The internal
  // print now surfaces every member even if there's no manifest row
  // (the new model lets guests live ONLY in personal_details).
  const mergedGuests = mergeGuestRecords(
    (members ?? []) as Array<Record<string, unknown>>,
    (manifest ?? []) as Array<Record<string, unknown>>,
    {
      full_name: cabin.principal_charterer_name ?? "",
      email: cabin.principal_charterer_email ?? "",
      mobile: cabin.principal_charterer_mobile ?? "",
    },
  );

  return (
    <div style={{ background: IVORY, minHeight: "100vh" }}>
      <style>{`
        body { font-family: ${FONT_EDITORIAL}; color: ${NAVY}; background: ${IVORY}; }
        h1, h2, h3 { font-weight: 300; }
        @media print {
          @page { size: A4; margin: 16mm 14mm 16mm 14mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .page-break-before { page-break-before: always; }
          .avoid-break { page-break-inside: avoid; }
        }
      `}</style>

      <div
        className="no-print"
        style={{
          position: "sticky",
          top: 0,
          background: NAVY,
          color: IVORY,
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
          borderBottom: `1px solid ${GOLD}55`,
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            fontFamily: FONT_UI,
          }}
        >
          Internal print · full PII ·{" "}
          <span style={{ color: GOLD }}>⌘P / Ctrl+P to save as PDF</span>
        </span>
        <PrintButton />
      </div>

      <article style={{ maxWidth: 920, margin: "0 auto", padding: "0 24px 60px" }}>
        {/* ============ NAVY COVER ============ */}
        <header
          className="avoid-break"
          style={{
            background: NAVY,
            color: IVORY,
            margin: "32px -24px 36px",
            padding: "48px 40px 40px",
          }}
        >
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 10,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: GOLD,
              fontWeight: 500,
            }}
          >
            George Yachts · Internal charter record
          </div>
          <h1
            style={{
              fontFamily: FONT_EDITORIAL,
              fontSize: 42,
              fontWeight: 300,
              margin: "16px 0 4px",
              letterSpacing: -0.5,
              color: IVORY,
            }}
          >
            {cabin.principal_charterer_name}
          </h1>
          <div
            style={{
              fontFamily: FONT_EDITORIAL,
              fontStyle: "italic",
              fontSize: 18,
              color: "rgba(248,245,240,0.85)",
              marginTop: 6,
            }}
          >
            {cabin.vessel_name}
            {cabin.vessel_make_model ? ` · ${cabin.vessel_make_model}` : ""}
          </div>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              letterSpacing: 2,
              color: "rgba(248,245,240,0.7)",
              marginTop: 10,
              textTransform: "uppercase",
            }}
          >
            {fmt(cabin.charter_period_from)} – {fmt(cabin.charter_period_to)}
            {cabin.port_embarkation && cabin.port_disembarkation
              ? `  ·  ${cabin.port_embarkation} → ${cabin.port_disembarkation}`
              : ""}
            {cabin.cruising_area ? `  ·  ${cabin.cruising_area}` : ""}
          </div>
        </header>

        {/* ============ INTERNAL OPS ============ */}
        <Section number="01" title="Internal operations" italic="commercial + crew">
          <SubBlock label="Contract">
            <Row k="MYBA contract #" v={cabin.myba_contract_number || "—"} />
            <Row k="Central agent" v={cabin.central_agent_internal || "—"} />
            <Row k="Vessel owner" v={cabin.vessel_owner_internal || "—"} />
            <Row k="Charter fee" v={cabin.charter_fee_eur ? `€ ${cabin.charter_fee_eur.toLocaleString()}` : "—"} />
            <Row k="APA" v={cabin.apa_eur ? `€ ${cabin.apa_eur.toLocaleString()}` : "—"} />
            <Row k="Status" v={titleCase(cabin.status || "")} />
            <Row k="Brief progress" v={`${cabin.brief_completion_percent ?? 0}%`} />
          </SubBlock>

          <SubBlock label="Crew (internal)">
            <Row k="Captain" v={cabin.captain_name_internal || "—"} />
            <Row k="Chef" v={cabin.chef_name_internal || "—"} />
            <Row k="Hostess" v={cabin.hostess_name_internal || "—"} />
          </SubBlock>

          <SubBlock label="Principal charterer">
            <Row k="Name" v={cabin.principal_charterer_name || "—"} />
            <Row k="Email" v={cabin.principal_charterer_email || "—"} />
            <Row k="Mobile" v={cabin.principal_charterer_mobile || "—"} />
            <Row k="Cabin members" v={String(members.length)} />
          </SubBlock>

          <SubBlock label="Vessel">
            <Row k="Make / model" v={cabin.vessel_make_model || "—"} />
            <Row k="Length" v={cabin.vessel_length || "—"} />
            <Row k="Capacity (guests)" v={cabin.vessel_capacity != null ? String(cabin.vessel_capacity) : "—"} />
            <Row k="Homeport" v={cabin.homeport || "—"} />
            <Row k="Cruising area" v={cabin.cruising_area || "—"} />
            <Row k="Embarkation" v={cabin.port_embarkation || "—"} />
            <Row k="Disembarkation" v={cabin.port_disembarkation || "—"} />
          </SubBlock>
        </Section>

        {/* ============ GUEST MANIFEST ============ */}
        {/* 2026-05-26 — Brief 02 (Task B1): switched from raw
            manifest rows to mergeGuestRecords output. Same field
            set, but now a guest who self-filled /cabin/me without
            ever appearing in cabin_guests_manifest still gets a
            SubBlock with their DOB / passport / allergy on the
            internal print (no more blank dashes for new-model
            guests). Only the display-name field renames
            full_name → name. */}
        {mergedGuests.length > 0 && (
          <Section
            number="02"
            title="Guest manifest"
            italic="passports & paperwork"
            pageBreakBefore
          >
            {mergedGuests.map((g, i) => (
              <SubBlock key={g.id ?? `m-${i}`} label={`${String(i + 1).padStart(2, "0")} · ${g.name || "—"}${i === 0 ? " · Principal" : ""}`}>
                <Row k="Date of birth" v={fmt(g.date_of_birth) || "—"} />
                <Row k="Nationality" v={g.nationality || "—"} />
                <Row k="Passport №" v={g.passport_number || "—"} />
                <Row k="Passport expiry" v={fmt(g.passport_expiry) || "—"} />
                <Row k="Cabin pairing" v={g.cabin_pairing || "—"} />
                <Row k="Shoe size" v={g.shoe_size || "—"} />
                {i === 0 && <Row k="Mobile" v={g.mobile || "—"} />}
                {i === 0 && <Row k="Email" v={g.email || "—"} />}
                <Row k="Minor" v={g.is_minor ? "Yes" : "No"} />
                <Row k="Allergies / dietary" v={g.allergies_dietary || "—"} />
                {g.allergies_severity && (
                  <Row
                    k="Severity"
                    v={
                      g.allergies_severity === "life_threatening"
                        ? "⚠ Life-threatening"
                        : titleCase(g.allergies_severity)
                    }
                  />
                )}
                {g.emergency_note && <Row k="Emergency note" v={g.emergency_note} />}
              </SubBlock>
            ))}
          </Section>
        )}

        {/* ============ BRIEF SECTIONS ============ */}
        {Object.entries(SECTION_LABELS).map(([key, label], idx) => {
          const row = sections.find((s) => s.section_key === key);
          if (
            !row ||
            (!row.completed &&
              (!row.data || Object.keys(row.data as Record<string, unknown>).length === 0))
          ) {
            return null;
          }

          return (
            <Section
              key={key}
              number={String(idx + 3).padStart(2, "0")}
              title={label}
              italic={row.completed ? "complete" : "in progress"}
              pageBreakBefore
            >
              <div className="avoid-break" style={{ fontSize: 13.5, lineHeight: 1.65 }}>
                {renderValue(row.data)}
              </div>
            </Section>
          );
        })}

        <footer
          style={{
            marginTop: 48,
            paddingTop: 20,
            borderTop: `1px solid ${RULE}`,
            fontFamily: FONT_UI,
            fontSize: 10,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: MUTED,
            textAlign: "center",
          }}
        >
          George Yachts Brokerage House LLC · Internal record · Filotimo · Φιλότιμο
        </footer>
      </article>
    </div>
  );
}

// =================== PRIMITIVES ==============================
function Section({
  number,
  title,
  italic,
  children,
  pageBreakBefore,
}: {
  number: string;
  title: string;
  italic?: string;
  children: React.ReactNode;
  pageBreakBefore?: boolean;
}) {
  return (
    <section
      className={pageBreakBefore ? "page-break-before avoid-break" : "avoid-break"}
      style={{
        marginTop: 32,
        paddingBottom: 28,
        borderBottom: `1px solid ${RULE}`,
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 18 }}>
        <span
          style={{
            fontFamily: FONT_EDITORIAL,
            fontStyle: "italic",
            fontSize: 32,
            fontWeight: 300,
            color: GOLD,
            letterSpacing: -0.5,
          }}
        >
          {number}
        </span>
        <h2
          style={{
            fontFamily: FONT_EDITORIAL,
            fontWeight: 300,
            fontSize: 26,
            margin: 0,
            letterSpacing: -0.3,
            color: NAVY,
          }}
        >
          {title}
          {italic ? (
            <em style={{ color: GOLD, fontStyle: "italic", marginLeft: 8 }}>· {italic}</em>
          ) : null}
        </h2>
      </header>
      {children}
    </section>
  );
}

function SubBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="avoid-break" style={{ marginTop: 18 }}>
      <h3
        style={{
          fontFamily: FONT_UI,
          fontSize: 10.5,
          letterSpacing: 3.5,
          textTransform: "uppercase",
          color: GOLD,
          margin: "0 0 10px",
          fontWeight: 500,
        }}
      >
        {label}
      </h3>
      <dl style={{ margin: 0, display: "flex", flexDirection: "column" }}>{children}</dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  const empty = v == null || v === "" || v === "—";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "210px 1fr",
        gap: 16,
        padding: "7px 0",
        borderBottom: `1px solid ${RULE}`,
        fontFamily: FONT_EDITORIAL,
      }}
    >
      <dt
        style={{
          fontFamily: FONT_UI,
          fontSize: 10,
          letterSpacing: 1.8,
          textTransform: "uppercase",
          color: MUTED,
          paddingTop: 2,
        }}
      >
        {k}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.55,
          color: empty ? "rgba(13,27,42,0.35)" : NAVY,
          fontStyle: empty ? "italic" : "normal",
        }}
      >
        {empty ? "—" : v}
      </dd>
    </div>
  );
}
