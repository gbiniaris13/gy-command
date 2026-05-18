// gy-command — Charterer Preference Sheet (PII-stripped of broker
// identity, but INCLUDES guest manifest because the captain needs
// passports for port authorities).
//
// Brand-styled to match The Cabin · Filotimo (navy / gold / ivory,
// Georgia editorial, sans for UI labels). Optimised for A4 print
// + PDF export — every section has page-break-inside: avoid and
// the cover/manifest/specs blocks page-break-before.
//
// Sections follow the industry standard (Bluefin, Greek brokers,
// Burgess template) so the document reads correctly to a captain,
// chef, or owner who has never seen our system before.

import { notFound } from "next/navigation";
import {
  getCabin,
  getCabinSections,
  getCabinGuestsManifest,
} from "@/lib/cabin-admin";
import PrintButton from "../print/PrintButton";

export const dynamic = "force-dynamic";

// =================== BRAND TOKENS ============================
const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const IVORY = "#F8F5F0";
const RULE = "rgba(13, 27, 42, 0.12)";
const MUTED = "rgba(13, 27, 42, 0.55)";
const FONT_EDITORIAL = "Georgia, 'Times New Roman', serif";
const FONT_UI = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

// =================== HELPERS =================================
function fmtDate(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function titleCase(s: string) {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function fmtMaybe(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    return v.map((x) => titleCase(String(x))).join(" · ");
  }
  return String(v);
}

// =================== SECTION RULES ===========================
// Pull only the fields we want to surface on the sheet. PII like
// emergency_contact.email/mobile is intentionally redacted — the
// captain has it on a separate sheet via a different document.

type GuestRow = {
  id: string;
  guest_order: number | null;
  full_name: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  passport_number: string | null;
  passport_expiry: string | null;
  is_minor: boolean | null;
  email: string | null;
  mobile: string | null;
  cabin_pairing: string | null;
  shoe_size: string | null;
  allergies_dietary: string | null;
};

type SectionRow = {
  section_key: string;
  data: Record<string, unknown> | null;
  completed?: boolean;
};

function getSection(
  sections: SectionRow[],
  key: string
): Record<string, unknown> {
  const row = sections.find((s) => s.section_key === key);
  return (row?.data ?? {}) as Record<string, unknown>;
}

function get<T = unknown>(
  obj: Record<string, unknown>,
  path: string
): T | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur as T;
}

// =================== PAGE ====================================
export default async function PreferenceSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  const [sections, manifest] = await Promise.all([
    getCabinSections(id),
    getCabinGuestsManifest(id),
  ]);

  const arrival = getSection(sections, "arrival");
  const guestsSection = getSection(sections, "guests");
  const health = getSection(sections, "health");
  const itinerary = getSection(sections, "itinerary");
  const lifeAboard = getSection(sections, "life_aboard");
  const dining = getSection(sections, "dining");
  const beverages = getSection(sections, "beverages");
  const little = getSection(sections, "little_things");
  const children = getSection(sections, "children");

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

      {/* Sticky action bar — hidden in print */}
      <div
        className="no-print"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: NAVY,
          color: IVORY,
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: `1px solid ${GOLD}55`,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: FONT_UI }}>
          Preference sheet · for crew & owner ·{" "}
          <span style={{ color: GOLD }}>⌘P / Ctrl+P to save as PDF</span>
        </span>
        <PrintButton />
      </div>

      <article style={{ maxWidth: 920, margin: "0 auto", padding: "0 24px 60px" }}>
        {/* ============ COVER ============ */}
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
            George Yachts · Charterer Preference Sheet
          </div>
          <h1
            style={{
              fontFamily: FONT_EDITORIAL,
              fontSize: 46,
              fontWeight: 300,
              margin: "16px 0 4px",
              letterSpacing: -0.5,
              color: IVORY,
            }}
          >
            {cabin.vessel_name}
            {cabin.vessel_make_model ? (
              <span style={{ fontStyle: "italic", color: "rgba(248,245,240,0.7)", fontSize: 28 }}>
                {" · "}
                {cabin.vessel_make_model}
              </span>
            ) : null}
          </h1>
          <div
            style={{
              fontFamily: FONT_EDITORIAL,
              fontSize: 16,
              fontStyle: "italic",
              color: "rgba(248,245,240,0.85)",
              marginTop: 12,
            }}
          >
            {fmtDate(cabin.charter_period_from) ?? "—"} to {fmtDate(cabin.charter_period_to) ?? "—"}
          </div>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              letterSpacing: 2,
              color: "rgba(248,245,240,0.7)",
              marginTop: 6,
              textTransform: "uppercase",
            }}
          >
            {cabin.port_embarkation || "—"} → {cabin.port_disembarkation || "—"}
            {cabin.cruising_area ? `  ·  ${cabin.cruising_area}` : ""}
          </div>

          <p
            style={{
              marginTop: 28,
              fontFamily: FONT_EDITORIAL,
              fontSize: 13,
              fontStyle: "italic",
              color: "rgba(248,245,240,0.7)",
              lineHeight: 1.7,
              maxWidth: 540,
            }}
          >
            For the captain, chef and hostess of {cabin.vessel_name}. Please
            treat as confidential. The principal charterer&apos;s identity is
            included so port-authority paperwork can be filed in advance; this
            sheet stays aboard and is destroyed at the close of the charter.
          </p>
        </header>

        {/* ============ 01 — LOGISTICS ============ */}
        <Section number="01" title="Logistics" italic="arrival & departure">
          <SubBlock label="Yacht">
            <Row k="Vessel" v={`${cabin.vessel_name}${cabin.vessel_make_model ? " · " + cabin.vessel_make_model : ""}`} />
            <Row k="Length" v={cabin.vessel_length} />
            <Row k="Homeport" v={cabin.homeport} />
            <Row k="Cruising area" v={cabin.cruising_area} />
            <Row k="Embarkation" v={cabin.port_embarkation} />
            <Row k="Disembarkation" v={cabin.port_disembarkation} />
          </SubBlock>

          <SubBlock label="Arrival">
            <Row k="Date" v={fmtMaybe(get(arrival, "flight_group_1.date_of_arrival"))} />
            <Row k="Time" v={fmtMaybe(get(arrival, "flight_group_1.time_of_arrival"))} />
            <Row
              k="Flight"
              v={fmtMaybe(get(arrival, "flight_group_1.airline_and_flight"))}
            />
            <Row k="Coming from" v={fmtMaybe(get(arrival, "flight_group_1.coming_from"))} />
            <Row k="Guests on flight" v={fmtMaybe(get(arrival, "flight_group_1.number_of_guests"))} />
            {get(arrival, "flight_group_2.airline_and_flight") ? (
              <>
                <Row k="Flight #2" v={fmtMaybe(get(arrival, "flight_group_2.airline_and_flight"))} />
                <Row k="Date #2" v={fmtMaybe(get(arrival, "flight_group_2.date_of_arrival"))} />
                <Row k="Time #2" v={fmtMaybe(get(arrival, "flight_group_2.time_of_arrival"))} />
              </>
            ) : null}
            <Row k="Private arrival notes" v={fmtMaybe(get(arrival, "private_arrival_notes"))} />
          </SubBlock>

          <SubBlock label="Accommodation ashore">
            <Row k="Hotel before embarkation" v={fmtMaybe(get(arrival, "before_embarkation.hotel_or_address"))} />
            <Row k="Check-out date" v={fmtMaybe(get(arrival, "before_embarkation.check_out_date"))} />
            <Row k="Hotel after disembarkation" v={fmtMaybe(get(arrival, "after_disembarkation.hotel_or_address"))} />
            <Row k="Check-in date" v={fmtMaybe(get(arrival, "after_disembarkation.check_in_date"))} />
          </SubBlock>

          <SubBlock label="Transfers">
            <Row k="Requested" v={fmtMaybe(arrival.transfers_requested)} />
            {get(arrival, "transfer_to_yacht.pickup_location") ? (
              <>
                <Row k="To yacht — pickup" v={fmtMaybe(get(arrival, "transfer_to_yacht.pickup_location"))} />
                <Row k="To yacht — when" v={fmtMaybe(get(arrival, "transfer_to_yacht.pickup_datetime"))} />
                <Row k="To yacht — guests" v={fmtMaybe(get(arrival, "transfer_to_yacht.number_of_guests"))} />
              </>
            ) : null}
            {get(arrival, "transfer_from_yacht.dropoff_location") ? (
              <>
                <Row k="From yacht — drop-off" v={fmtMaybe(get(arrival, "transfer_from_yacht.dropoff_location"))} />
                <Row k="From yacht — when" v={fmtMaybe(get(arrival, "transfer_from_yacht.dropoff_datetime"))} />
                <Row k="From yacht — guests" v={fmtMaybe(get(arrival, "transfer_from_yacht.number_of_guests"))} />
              </>
            ) : null}
          </SubBlock>
        </Section>

        {/* ============ 02 — GUEST MANIFEST ============ */}
        <Section
          number="02"
          title="Guest manifest"
          italic="who is aboard"
          pageBreakBefore
        >
          {manifest.length === 0 ? (
            <p style={mutedItalic}>
              No guests have been added to the manifest yet. Add via the
              Manifest editor in the cabin detail page so the captain can file
              port-authority paperwork ahead of arrival.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {(manifest as GuestRow[]).map((g, i) => (
                <GuestCard key={g.id} order={i + 1} g={g} />
              ))}
            </div>
          )}
          {get(guestsSection, "group_notes") || get(guestsSection, "group_scenarios") ? (
            <SubBlock label="About the group">
              <Row k="Scenarios" v={fmtMaybe(get(guestsSection, "group_scenarios"))} />
              <Row k="General notes" v={fmtMaybe(get(guestsSection, "group_notes"))} />
            </SubBlock>
          ) : null}
        </Section>

        {/* ============ 03 — HEALTH & ITINERARY ============ */}
        <Section
          number="03"
          title="Health, safety & itinerary"
          italic="what shapes the week"
          pageBreakBefore
        >
          <SubBlock label="Health & safety">
            <Row k="Allergies & dietary requirements" v={fmtMaybe(health.allergies_dietary)} />
            <Row k="Medical conditions" v={fmtMaybe(health.medical_conditions)} />
            <Row k="Medications brought on board" v={fmtMaybe(health.medications_onboard)} />
            <Row k="Swimming experience" v={fmtMaybe(health.swimming_experience)} />
            <Row k="Swimming notes" v={fmtMaybe(health.swimming_other)} />
          </SubBlock>

          <SubBlock label="Itinerary">
            <Row k="Pace of the week" v={fmtMaybe(itinerary.pace)} />
            <Row k="Preferred areas" v={fmtMaybe(itinerary.preferred_areas)} />
            <Row k="Specific places they would love" v={fmtMaybe(itinerary.specific_places)} />
            <Row k="Night-time preference" v={fmtMaybe(itinerary.night_preference)} />
            <Row k="Celebrations during the week" v={fmtMaybe(itinerary.celebrations)} />
          </SubBlock>

          <SubBlock label="Life aboard">
            <Row k="Crew presence preference" v={fmtMaybe(lifeAboard.crew_interaction)} />
            <Row k="Activities of interest" v={fmtMaybe(lifeAboard.activities)} />
            <Row k="Other activities" v={fmtMaybe(lifeAboard.activities_other)} />
            <Row k="Music — morning" v={fmtMaybe(get(lifeAboard, "music.morning"))} />
            <Row k="Music — lunch & afternoon" v={fmtMaybe(get(lifeAboard, "music.lunch_afternoon"))} />
            <Row k="Music — sunset & dinner" v={fmtMaybe(get(lifeAboard, "music.sunset_dinner"))} />
            <Row k="Music — late night" v={fmtMaybe(get(lifeAboard, "music.late_night"))} />
            <Row k="Specific artists / playlists" v={fmtMaybe(get(lifeAboard, "music.specific_artists"))} />
            <Row k="Small touches to ask about" v={fmtMaybe(lifeAboard.extras_freeform)} />
          </SubBlock>
        </Section>

        {/* ============ 04 — FOOD & DRINK ============ */}
        <Section
          number="04"
          title="Food & drink preferences"
          italic="what the chef should know"
          pageBreakBefore
        >
          <SubBlock label="Meal times">
            <Row k="Breakfast" v={fmtMaybe(dining.breakfast_time)} />
            <Row k="Lunch" v={fmtMaybe(dining.lunch_time)} />
            <Row k="Dinner" v={fmtMaybe(dining.dinner_time)} />
          </SubBlock>

          <SubBlock label="Breakfast">
            <Row k="Style" v={fmtMaybe(dining.breakfast_style)} />
            <Row k="Specifics" v={fmtMaybe(dining.breakfast_specifics)} />
          </SubBlock>

          <SubBlock label="Coffee & tea">
            <Row k="Preference" v={fmtMaybe(dining.coffee_tea)} />
            <Row k="Specifics" v={fmtMaybe(dining.coffee_tea_specifics)} />
          </SubBlock>

          <SubBlock label="At the table">
            <Row k="Foods they love" v={fmtMaybe(dining.food_loves)} />
            <Row k="Foods to avoid" v={fmtMaybe(dining.food_avoid)} />
            <Row k="Children at the table" v={fmtMaybe(dining.children_at_table)} />
            <Row k="Open note to the chef" v={fmtMaybe(dining.chef_open_note)} />
          </SubBlock>

          <SubBlock label="Dining ashore">
            <Row k="Evenings ashore (count)" v={fmtMaybe(dining.dining_ashore_evenings)} />
            <Row k="Notes" v={fmtMaybe(dining.dining_ashore_notes)} />
          </SubBlock>

          {/* CHILDREN — only show if data exists */}
          {Object.keys(children).length > 0 && (
            <SubBlock label="Children on board">
              <Row k="Children profiles" v={fmtMaybe(children.children)} />
              <Row k="Equipment requested" v={fmtMaybe(children.equipment)} />
              <Row k="Other equipment" v={fmtMaybe(children.equipment_other)} />
            </SubBlock>
          )}
        </Section>

        {/* ============ 05 — BAR & CELLAR ============ */}
        <Section
          number="05"
          title="Bar & cellar"
          italic="what to provision"
          pageBreakBefore
        >
          <SubBlock label="Water">
            <Row k="Preference" v={fmtMaybe(beverages.water)} />
            <Row k="Brand" v={fmtMaybe(beverages.water_brand)} />
          </SubBlock>

          <SubBlock label="Bar">
            <Row k="Standard items" v={fmtMaybe(beverages.standard_bar_items)} />
            <Row k="Specific preferences" v={fmtMaybe(beverages.specific_preferences)} />
            <Row k="Cocktails the hostess should know" v={fmtMaybe(beverages.cocktails)} />
          </SubBlock>

          <SubBlock label="Wine">
            <Row k="Style" v={fmtMaybe(beverages.wine_style)} />
          </SubBlock>

          {/* Provisioning-list note. Until we ship the detailed
              beverage / wine / spirit label-and-quantity grids,
              this paragraph tells the captain what to do. */}
          <p
            style={{
              ...mutedItalic,
              marginTop: 14,
              padding: "12px 14px",
              background: "rgba(201,168,76,0.06)",
              borderLeft: `2px solid ${GOLD}`,
            }}
          >
            Detailed provisioning quantities (specific bottle labels, soft-drink
            counts, wine labels with price ranges) are agreed in a follow-up
            conversation between the charterer and George ahead of embarkation
            — they are not collected in The Cabin yet. Please coordinate via
            the broker for the captain&apos;s shopping list.
          </p>
        </Section>

        {/* ============ 06 — CLOSING NOTES ============ */}
        <Section
          number="06"
          title="Closing notes"
          italic="the small things"
          pageBreakBefore
        >
          <SubBlock label="Surprises & celebrations">
            <Row k="Surprises to plan" v={fmtMaybe(little.surprises_celebrations)} />
            <Row k="Things to avoid" v={fmtMaybe(little.things_to_avoid)} />
          </SubBlock>

          <SubBlock label="Practical">
            <Row k="Connectivity preference" v={fmtMaybe(little.connectivity)} />
            <Row k="Photo archive permission" v={fmtMaybe(little.photo_archive_permission)} />
          </SubBlock>

          <SubBlock label="Anything else">
            <Row k="From the charterer" v={fmtMaybe(little.anything_else)} />
          </SubBlock>
        </Section>

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
          George Yachts Brokerage House LLC · Filotimo · Φιλότιμο · georgeyachts.com
        </footer>
      </article>
    </div>
  );
}

// =================== PRIMITIVES ==============================
const mutedItalic: React.CSSProperties = {
  fontFamily: FONT_EDITORIAL,
  fontStyle: "italic",
  fontSize: 13,
  color: MUTED,
  lineHeight: 1.6,
  margin: 0,
};

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
            <em style={{ color: GOLD, fontStyle: "italic", marginLeft: 8 }}>
              · {italic}
            </em>
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

function GuestCard({ order, g }: { order: number; g: GuestRow }) {
  return (
    <div
      className="avoid-break"
      style={{
        background: "#ffffff",
        border: `1px solid ${RULE}`,
        padding: "16px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
        <span
          style={{
            fontFamily: FONT_UI,
            fontSize: 10,
            letterSpacing: 2.5,
            textTransform: "uppercase",
            color: GOLD,
            fontWeight: 500,
          }}
        >
          {String(order).padStart(2, "0")}
          {order === 1 ? " · Principal" : ""}
        </span>
        <h3
          style={{
            fontFamily: FONT_EDITORIAL,
            fontSize: 19,
            fontWeight: 400,
            margin: 0,
            color: NAVY,
          }}
        >
          {g.full_name || "—"}
          {g.is_minor ? (
            <em style={{ color: GOLD, marginLeft: 8, fontSize: 13 }}>· minor</em>
          ) : null}
        </h3>
      </div>
      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "4px 24px",
          fontFamily: FONT_EDITORIAL,
          fontSize: 13,
        }}
      >
        <GuestCell label="DOB" v={fmtDate(g.date_of_birth) ?? "—"} />
        <GuestCell label="Nationality" v={g.nationality || "—"} />
        <GuestCell label="Passport №" v={g.passport_number || "—"} />
        <GuestCell label="Passport expiry" v={fmtDate(g.passport_expiry) ?? "—"} />
        <GuestCell label="Cabin pairing" v={g.cabin_pairing || "—"} />
        <GuestCell label="Shoe size" v={g.shoe_size || "—"} />
        {order === 1 ? (
          <>
            <GuestCell label="Mobile" v={g.mobile || "—"} />
            <GuestCell label="Email" v={g.email || "—"} />
          </>
        ) : null}
        <GuestCell label="Allergies / dietary" v={g.allergies_dietary || "—"} fullWidth />
      </dl>
    </div>
  );
}

function GuestCell({
  label,
  v,
  fullWidth,
}: {
  label: string;
  v: string;
  fullWidth?: boolean;
}) {
  const empty = !v || v === "—";
  return (
    <div
      style={{
        gridColumn: fullWidth ? "1 / -1" : undefined,
        display: "flex",
        gap: 10,
        padding: "3px 0",
      }}
    >
      <dt
        style={{
          fontFamily: FONT_UI,
          fontSize: 9.5,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          color: MUTED,
          minWidth: 110,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          color: empty ? "rgba(13,27,42,0.35)" : NAVY,
          fontStyle: empty ? "italic" : "normal",
        }}
      >
        {empty ? "—" : v}
      </dd>
    </div>
  );
}
