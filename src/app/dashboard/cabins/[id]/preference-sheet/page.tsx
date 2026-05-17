// gy-command — Charterer Preference Sheet (PII-stripped).
//
// George forwards this to the yacht owner / management company /
// captain. Same brief data the charterer filled, but with NO
// client identifying details (no name, no email, no mobile,
// no contract number). The yacht side gets the operational
// flavour they need — what to provision, how to cook, when to
// sail — without needing the client's identity.
//
// Crew lists are a separate document (port-required, mandatory
// PII). This is just the preference list.

import { notFound } from "next/navigation";
import { getCabin, getCabinSections } from "@/lib/cabin-admin";

export const dynamic = "force-dynamic";

const SECTION_LABELS: Record<string, string> = {
  arrival: "Arrival logistics",
  guests: "Group profile",
  health: "Health & safety needs",
  itinerary: "Itinerary preferences",
  life_aboard: "Life on board",
  dining: "Dining preferences",
  beverages: "Bar & cellar",
  little_things: "Closing notes",
  children: "Children on board",
};

// Per-section field allowlist + label. Keys not in this list are
// suppressed. PII keys (emergency_contact.email/mobile, etc.) are
// excluded. Free-text fields with potential PII are summarised
// only by presence, not content (e.g. "Yes — see brief").
const SECTION_FIELD_RULES: Record<
  string,
  { keep: Record<string, string>; redact?: string[] }
> = {
  arrival: {
    keep: {
      arrival_party_count: "Number of arriving guests",
      transfers_requested: "Transfers requested",
      hotel_pre_charter: "Pre-charter hotel",
      hotel_post_charter: "Post-charter hotel",
    },
    redact: ["emergency_contact"],
  },
  guests: {
    keep: {
      group_scenarios: "Group scenarios",
      group_notes: "General notes about the group",
    },
  },
  health: {
    keep: {
      allergies_dietary: "Allergies & dietary requirements",
      medical_conditions: "Medical conditions to be aware of",
      medications_onboard: "Medications brought on board",
      swimming_experience: "Swimming experience",
      swimming_other: "Swimming notes",
    },
    redact: ["emergency_contact"], // captain has this separately
  },
  itinerary: {
    keep: {
      preferred_areas: "Preferred cruising areas",
      specific_places: "Specific places they'd love to visit",
      pace: "Pace of the week",
      night_preference: "Night-time preference",
      celebrations: "Celebrations during the week",
    },
  },
  life_aboard: {
    keep: {
      crew_interaction: "Crew presence preference",
      activities: "Activities of interest",
      activities_other: "Other activities",
      music: "Music preferences (by time of day)",
      extras_freeform: "Small touches to ask about",
    },
  },
  dining: {
    keep: {
      breakfast_time: "Breakfast time",
      lunch_time: "Lunch time",
      dinner_time: "Dinner time",
      breakfast_style: "Breakfast style",
      breakfast_specifics: "Breakfast specifics",
      coffee_tea: "Coffee & tea",
      coffee_tea_specifics: "Coffee/tea specifics",
      food_loves: "Foods they love",
      food_avoid: "Foods to avoid",
      dining_ashore_evenings: "Evenings dining ashore",
      dining_ashore_notes: "Ashore dining notes",
      children_at_table: "Children at the table",
      chef_open_note: "Open note to the chef",
    },
  },
  beverages: {
    keep: {
      water: "Water preference",
      water_brand: "Water brand",
      standard_bar_items: "Standard bar items",
      specific_preferences: "Specific preferences",
      wine_style: "Wine style",
      cocktails: "Cocktails the hostess should know",
    },
  },
  little_things: {
    keep: {
      surprises_celebrations: "Surprises & celebrations",
      things_to_avoid: "Things to avoid",
      connectivity: "Connectivity preference",
      photo_archive_permission: "Photo archive permission",
      anything_else: "Anything else",
    },
  },
  children: {
    keep: {
      children: "Children profiles",
      equipment: "Equipment requested",
      equipment_other: "Other equipment",
    },
  },
};

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function renderValue(v: unknown): React.ReactNode {
  if (v == null || v === "") return <em style={{ color: "#94a3b8" }}>—</em>;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return <em style={{ color: "#94a3b8" }}>—</em>;
    return v.map((s) => String(s).replace(/_/g, " ")).join(" · ");
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, x]) => x != null && x !== ""
    );
    if (!entries.length) return <em style={{ color: "#94a3b8" }}>—</em>;
    return (
      <dl style={{ margin: 0 }}>
        {entries.map(([k, x]) => (
          <div key={k} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
            <dt style={{ minWidth: 140, color: "#6b7280", fontSize: 12, textTransform: "capitalize" }}>
              {k.replace(/_/g, " ")}
            </dt>
            <dd style={{ margin: 0, fontSize: 13 }}>{renderValue(x)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return String(v);
}

function projectSection(key: string, data: Record<string, unknown> | null) {
  const rules = SECTION_FIELD_RULES[key];
  if (!rules || !data) return {};
  const out: Record<string, unknown> = {};
  for (const [field, label] of Object.entries(rules.keep)) {
    if (data[field] !== undefined && data[field] !== null && data[field] !== "") {
      out[label] = data[field];
    }
  }
  return out;
}

export default async function PreferenceSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const sections = await getCabinSections(id);

  return (
    <div style={{ background: "#F8F5F0", minHeight: "100vh", padding: 0 }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
        }
        body { font-family: Georgia, serif; color: #0D1B2A; }
        h1, h2, h3 { font-weight: 300; }
      `}</style>

      <div className="no-print" style={{
        position: "sticky", top: 0, background: "#0D1B2A", color: "#F8F5F0",
        padding: "12px 20px", display: "flex", justifyContent: "space-between",
        alignItems: "center", zIndex: 10,
      }}>
        <span style={{ fontSize: 12, letterSpacing: 2 }}>
          Preference sheet · PII-stripped · ⌘P / Ctrl+P to save as PDF
        </span>
        <button
          onClick={() => globalThis.print()}
          style={{
            background: "#C9A84C", color: "#0D1B2A", padding: "8px 16px",
            border: 0, fontSize: 10, letterSpacing: 2,
            textTransform: "uppercase", cursor: "pointer",
          }}
        >
          Print / save as PDF
        </button>
      </div>

      <article style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px 60px" }}>
        <header
          style={{
            borderBottom: "1px solid rgba(201,168,76,0.4)",
            paddingBottom: 24,
            marginBottom: 32,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
            George Yachts · Charterer preference sheet
          </div>
          <h1 style={{ fontSize: 30, margin: "12px 0 4px", letterSpacing: -0.5 }}>
            {cabin.vessel_name}
            {cabin.vessel_make_model ? <span style={{ fontStyle: "italic", color: "rgba(13,27,42,0.6)" }}> · {cabin.vessel_make_model}</span> : null}
          </h1>
          <div style={{ fontSize: 13, color: "rgba(13,27,42,0.55)", marginTop: 10 }}>
            <strong>{fmt(cabin.charter_period_from)}</strong> to{" "}
            <strong>{fmt(cabin.charter_period_to)}</strong>
            {" · "}
            {cabin.port_embarkation || "—"} → {cabin.port_disembarkation || "—"}
            {" · "}
            {cabin.cruising_area || "—"}
          </div>
          <p style={{
            marginTop: 16, fontSize: 12, color: "rgba(13,27,42,0.55)",
            fontStyle: "italic", lineHeight: 1.6,
          }}>
            For internal use by the captain, chef and hostess only.
            Charterer identity is intentionally not included on this
            sheet — a separate crew list is sent for port-authority
            paperwork. Please treat as confidential and destroy when
            the charter is over.
          </p>
        </header>

        {Object.entries(SECTION_LABELS).map(([key, label]) => {
          const row = sections.find((s) => s.section_key === key);
          const projected = projectSection(key, row?.data ?? null);
          if (!Object.keys(projected).length) return null;
          return (
            <section
              key={key}
              style={{
                marginBottom: 28,
                paddingBottom: 24,
                borderBottom: "1px solid rgba(13,27,42,0.08)",
                pageBreakInside: "avoid",
              }}
            >
              <h2 style={{ fontSize: 18, margin: "0 0 12px", fontStyle: "italic", color: "#0D1B2A" }}>
                {label}
              </h2>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                {renderValue(projected)}
              </div>
            </section>
          );
        })}

        <footer style={{
          marginTop: 40, paddingTop: 18,
          borderTop: "1px solid rgba(13,27,42,0.08)",
          fontSize: 11, color: "rgba(13,27,42,0.5)",
          textAlign: "center", letterSpacing: 1.5, textTransform: "uppercase",
        }}>
          George Yachts Brokerage House LLC · Filotimo · Φιλότιμο
        </footer>
      </article>
    </div>
  );
}
