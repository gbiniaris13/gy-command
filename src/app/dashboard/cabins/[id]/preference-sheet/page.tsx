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
import type { Metadata } from "next";
import {
  getCabin,
  getCabinSections,
  getCabinGuestsManifest,
  getCabinMembers,
} from "@/lib/cabin-admin";
import { mergeGuestRecords, type MergedGuest } from "@/lib/cabin-guest-merge";
import PrintButton from "../print/PrintButton";

export const dynamic = "force-dynamic";

// 2026-05-22 — Sensible PDF filename when Save-as-PDF is used.
// Without this, macOS uses the browser-tab title ("(50) GY Command
// | George Yachts.pdf") which George couldn't find.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const cabin = await getCabin(id);
  const vessel = cabin?.vessel_name || "Cabin";
  return { title: `${vessel} — Charter Preferences` };
}

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
  allergies_severity: string | null;
  emergency_note: string | null;
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

  const [sections, manifest, members] = await Promise.all([
    getCabinSections(id),
    getCabinGuestsManifest(id),
    getCabinMembers(id),
  ]);

  // 2026-05-22 — Brief delegation + opt-out surfacing on the sheet.
  // The captain/chef/George see at a glance who can sign-off and who
  // has formally stepped aside from order/cellar decisions. Personal
  // facts (allergies, dietary, swimming, passport) still apply to
  // every member regardless of opt-out status.
  type MemberRow = {
    id: string;
    role: string | null;
    display_name: string | null;
    email: string | null;
    is_brief_admin: boolean | null;
    brief_participation_opt_out_at: string | null;
    brief_participation_opt_out_note: string | null;
  };
  const memberRows = (members ?? []) as MemberRow[];
  const delegatedAdmins = memberRows.filter(
    (m) => m.is_brief_admin && m.role !== "principal_charterer",
  );
  const optedOut = memberRows.filter((m) => m.brief_participation_opt_out_at);

  const arrival = getSection(sections, "arrival");
  const guestsSection = getSection(sections, "guests");
  const health = getSection(sections, "health");
  const itinerary = getSection(sections, "itinerary");
  const lifeAboard = getSection(sections, "life_aboard");
  const dining = getSection(sections, "dining");
  const beverages = getSection(sections, "beverages");
  const little = getSection(sections, "little_things");
  const children = getSection(sections, "children");

  // 2026-05-26 — Brief 02 (Task B1): merge cabin_members
  // (.personal_details) with cabin_guests_manifest into one canonical
  // per-person list. Member-self data wins (e.g. a guest who self-
  // filled DOB + passport via /cabin/me beats a stale principal-
  // seeded manifest blank). Powers BOTH the §02 Manifest cards and
  // the new §03 chef allergy roll-up below.
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
    <div style={{ background: IVORY, minHeight: "100vh" }} className="gy-prefs-root">
      <style>{`
        body { font-family: ${FONT_EDITORIAL}; color: ${NAVY}; background: ${IVORY}; }
        h1, h2, h3 { font-weight: 300; }
        /* 2026-05-22 — Full print-mode reset. The dashboard layout
           wraps every page in a flex h-screen overflow-hidden shell
           with an overflow-y-auto <main>. Without these overrides,
           print only outputs the first viewport's worth (George got
           a 1-page screenshot of the top + a CRM toolbar). */
        @media print {
          @page { size: A4; margin: 16mm 14mm 18mm 14mm; }
          /* 2026-05-27 — Brief 06 (#5): depth-independent shell reset.
             The body > div > div.flex.h-screen direct-child chains
             below broke when the dashboard layout nesting changed,
             so the h-screen overflow-hidden shell stayed and clipped
             the PDF to one screenful — George got only the first
             section (Logistics). These class-contains selectors
             neutralise the shell AND the overflow-y-auto <main> at
             ANY depth so the full sheet paginates across A4 pages. */
          [class*="h-screen"] {
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
            overflow: visible !important;
          }
          [class*="overflow-hidden"] { overflow: visible !important; }
          [class*="overflow-y-auto"],
          [class*="overflow-auto"] {
            overflow: visible !important;
            max-height: none !important;
          }
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Hide every piece of dashboard chrome that lives outside
             our preference-sheet root. */
          body > div > div.flex.h-screen,
          body > div > div.flex,
          aside,
          .lg\\:hidden,
          [class*="bottom-0"],
          [class*="fixed"],
          [class*="sticky"],
          .no-print {
            /* nuclear hide-on-print; the next selector restores
               OUR content tree. */
          }
          aside { display: none !important; }
          .no-print { display: none !important; }
          /* Hide the dashboard sticky top bar (mute, bell,
             hamburger), the bottom tab bar, the FAB, the floating
             chat button. */
          main > div.sticky,
          nav.fixed,
          a.fixed,
          div.fixed { display: none !important; }
          /* Reset the layout shell so our content flows naturally
             across pages. */
          body > div > div.flex.h-screen.overflow-hidden,
          body > div > div[class*="h-screen"] {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          main {
            overflow: visible !important;
            padding-bottom: 0 !important;
            flex: none !important;
          }
          /* Our content root: take the full page width, no shadow,
             pure white. */
          .gy-prefs-root {
            background: white !important;
            min-height: 0 !important;
          }
          /* Make sure each Section starts on a fresh page when it
             needs to, and avoids splitting tables/cards awkwardly. */
          .page-break-before { page-break-before: always !important; break-before: page !important; }
          .avoid-break { page-break-inside: avoid !important; break-inside: avoid !important; }
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: FONT_UI }}>
            Charter preferences ·{" "}
            <span style={{ color: GOLD }}>⌘P / Ctrl+P to save as PDF</span>
          </span>
          <span style={{ fontSize: 10, color: `${IVORY}aa`, fontStyle: "italic", fontFamily: FONT_UI }}>
            In the print dialog, UNCHECK &ldquo;Headers and footers&rdquo; for a clean document.
          </span>
        </div>
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
            George Yachts · Charter preferences
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
            Prepared with care by George Yachts — to help everyone caring for
            our charterer aboard {cabin.vessel_name} give them the most
            thoughtful week possible. Shared with the operating team, the
            captain and crew, the chef and hostess, and the yacht&apos;s owner
            so every preference lands where it can do the most good.
          </p>

          {/* 2026-06-02 — Data-ownership / confidentiality notice. Replaces
              the old "handle as you would any guest information of your own"
              line, which implied the recipient could treat the data as their
              own. George's clients + their personal/special-category data
              belong to George Yachts; shared for this charter only. */}
          <div
            style={{
              marginTop: 22,
              padding: "14px 16px",
              border: `1px solid ${GOLD}`,
              borderLeft: `3px solid ${GOLD}`,
              fontFamily: FONT_UI,
              fontSize: 10.5,
              lineHeight: 1.7,
              color: "rgba(248,245,240,0.92)",
              maxWidth: 620,
            }}
          >
            <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
              CONFIDENTIAL — CLIENT INFORMATION.
            </span>{" "}
            This preference sheet contains personal and special-category data
            (including dietary, allergy and health details) belonging to the
            guests, who are clients of George Yachts Brokerage House LLC. It is
            shared with you in confidence and solely to plan and deliver this
            charter ({cabin.vessel_name}
            {cabin.charter_period_from && cabin.charter_period_to
              ? ` · ${fmtDate(cabin.charter_period_from)} – ${fmtDate(cabin.charter_period_to)}`
              : ""}) — provisioning, crew and chef briefing, and onboard
            service — and may be used for that purpose only. It may not be
            copied, added to any database, retained beyond what this charter
            requires, shared with anyone who does not need it for this charter,
            or used to contact, solicit or market to the guests. The guests
            are, and remain, clients of George Yachts; the client relationship
            and their contact details are the confidential and proprietary
            information of George Yachts Brokerage House LLC. Any other use
            requires our prior written consent.
          </div>
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
            <Row k="Flight type" v={fmtMaybe(get(arrival, "flight_group_1.flight_type"))} />
            <Row k="Coming from" v={fmtMaybe(get(arrival, "flight_group_1.coming_from"))} />
            <Row k="Guests on flight" v={fmtMaybe(get(arrival, "flight_group_1.number_of_guests"))} />
            {get(arrival, "flight_group_2.airline_and_flight") ? (
              <>
                <Row k="Flight #2" v={fmtMaybe(get(arrival, "flight_group_2.airline_and_flight"))} />
                <Row k="Date #2" v={fmtMaybe(get(arrival, "flight_group_2.date_of_arrival"))} />
                <Row k="Time #2" v={fmtMaybe(get(arrival, "flight_group_2.time_of_arrival"))} />
                <Row k="Flight #2 type" v={fmtMaybe(get(arrival, "flight_group_2.flight_type"))} />
              </>
            ) : null}
            <Row k="Private arrival notes" v={fmtMaybe(get(arrival, "private_arrival_notes"))} />
            <Row k="Yachting experience" v={fmtMaybe(get(arrival, "yachting_experience"))} />
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

          {/* 2026-05-22 — Local Contact in Greece (3-way routing).
              George's white-glove broker-in-country offer is one of
              the charter's defining services — many charterers will
              tap "George P. Biniaris" as the local contact rather
              than asking a relative to be on call. The print sheet
              names whoever is on the hook so the captain knows
              exactly whom to call. */}
          {(() => {
            const routing = get<string>(arrival, "local_contact.routing") || "principal";
            const fullName = get<string>(arrival, "local_contact.full_name");
            const relationship = get<string>(arrival, "local_contact.relationship");
            const mobile = get<string>(arrival, "local_contact.mobile");
            const notes = get<string>(arrival, "local_contact.notes");

            if (routing === "broker") {
              return (
                <SubBlock label="Local contact in Greece">
                  <p style={{ margin: 0, fontStyle: "italic", color: "rgba(13,27,42,0.7)", fontSize: 12.5, lineHeight: 1.55 }}>
                    Captain to coordinate via the broker —{" "}
                    <strong style={{ fontStyle: "normal", fontWeight: 600 }}>George P. Biniaris</strong>,
                    {" "}George Yachts Brokerage House.
                    <br />
                    <span style={{ color: "rgba(13,27,42,0.55)" }}>
                      Athens: +30 6970 380 999 · WhatsApp (US): +1 786 798 8798 · george@georgeyachts.com
                    </span>
                  </p>
                </SubBlock>
              );
            }

            if (routing === "other") {
              return (
                <SubBlock label="Local contact in Greece">
                  <Row k="Full name" v={fmtMaybe(fullName)} />
                  <Row k="Relationship" v={fmtMaybe(relationship)} />
                  <Row k="Mobile" v={fmtMaybe(mobile)} />
                  <Row k="Notes for the captain" v={fmtMaybe(notes)} />
                </SubBlock>
              );
            }

            // principal (or unset → default)
            return (
              <SubBlock label="Local contact in Greece">
                <p style={{ margin: 0, fontStyle: "italic", color: "rgba(13,27,42,0.6)", fontSize: 12.5 }}>
                  Captain to coordinate directly with the principal charterer.
                </p>
              </SubBlock>
            );
          })()}
        </Section>

        {/* ============ 02 — THE GROUP ============ */}
        <Section
          number="02"
          title="The group"
          italic="who is aboard, and why"
          pageBreakBefore
        >
          {get<string>(guestsSection, "charter_purpose_narrative") ? (
            <div
              className="avoid-break"
              style={{
                background: "rgba(201,168,76,0.06)",
                borderLeft: `2px solid ${GOLD}`,
                padding: "16px 20px",
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 10.5,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: GOLD,
                  fontWeight: 500,
                  marginBottom: 8,
                }}
              >
                In the charterer's words
              </div>
              <p
                style={{
                  margin: 0,
                  fontFamily: FONT_EDITORIAL,
                  fontStyle: "italic",
                  fontSize: 16,
                  lineHeight: 1.7,
                  color: NAVY,
                }}
              >
                &ldquo;{fmtMaybe(get(guestsSection, "charter_purpose_narrative"))}&rdquo;
              </p>
            </div>
          ) : null}

          {Boolean(
            get(guestsSection, "group_type") ||
            get(guestsSection, "energy_level") ||
            get(guestsSection, "group_scenarios") ||
            get(guestsSection, "group_notes"),
          ) && (
            <SubBlock label="Character of the group">
              <Row k="Type of week" v={fmtMaybe(get(guestsSection, "group_type"))} />
              <Row k="Energy level" v={fmtMaybe(get(guestsSection, "energy_level"))} />
              <Row k="Scenarios" v={fmtMaybe(get(guestsSection, "group_scenarios"))} />
              <Row k="General notes" v={fmtMaybe(get(guestsSection, "group_notes"))} />
            </SubBlock>
          )}

          {get(guestsSection, "has_pet") || get(guestsSection, "pet_details") ? (
            <SubBlock label="Pets on board">
              <Row
                k="A four-legged guest?"
                v={
                  get(guestsSection, "has_pet") === true ||
                  get(guestsSection, "has_pet") === "true"
                    ? "Yes"
                    : "No"
                }
              />
              <Row k="Details" v={fmtMaybe(get(guestsSection, "pet_details"))} />
            </SubBlock>
          ) : null}

          {/* 2026-05-22 — Photo preference for the group. Only renders
              when the principal has actively chosen to refrain — by
              default unset, so the captain sees nothing and treats
              the cabin like every other (discreet but normal). */}
          {(get(guestsSection, "no_photos_of_guests") === true ||
            get(guestsSection, "no_photos_of_guests") === "true") && (
            <SubBlock label="Photography preference">
              <Row
                k="Photographing the guests"
                v="The principal has asked the crew NOT to photograph the guests during the week. No phones pointed at the cabin."
              />
            </SubBlock>
          )}

          {(delegatedAdmins.length > 0 || optedOut.length > 0) && (
            <div
              style={{
                marginTop: 18,
                padding: "14px 16px",
                background: "rgba(201, 168, 76, 0.07)",
                borderLeft: `2px solid ${GOLD}`,
              }}
              className="avoid-break"
            >
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 10,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: "#8a7327",
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                Brief sign-off &amp; opt-outs
              </div>
              {delegatedAdmins.length > 0 && (
                <p
                  style={{
                    fontFamily: FONT_EDITORIAL,
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: "rgba(13, 27, 42, 0.8)",
                    margin: "0 0 6px 0",
                  }}
                >
                  <strong style={{ fontWeight: 500, color: NAVY }}>
                    Delegated brief admin
                    {delegatedAdmins.length > 1 ? "s" : ""}:
                  </strong>{" "}
                  {delegatedAdmins
                    .map((m) => m.display_name || m.email)
                    .join(", ")}
                  . The principal has explicitly authorised{" "}
                  {delegatedAdmins.length > 1 ? "them" : "this guest"} to
                  send the brief on their behalf — logged in the
                  cabin&apos;s audit trail.
                </p>
              )}
              {optedOut.length > 0 && (
                <p
                  style={{
                    fontFamily: FONT_EDITORIAL,
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: "rgba(13, 27, 42, 0.8)",
                    margin: 0,
                  }}
                >
                  <strong style={{ fontWeight: 500, color: NAVY }}>
                    Opted out of orders &amp; cellar:
                  </strong>{" "}
                  {optedOut
                    .map((m) => {
                      const name = m.display_name || m.email;
                      const note = m.brief_participation_opt_out_note;
                      return note ? `${name} ("${note}")` : name;
                    })
                    .join(", ")}
                  . Personal facts (allergies, dietary, swimming,
                  passport) still apply to{" "}
                  {optedOut.length > 1 ? "them" : "this guest"} — they
                  have only stepped aside from group purchasing choices.
                </p>
              )}
            </div>
          )}

          <h3
            style={{
              fontFamily: FONT_UI,
              fontSize: 10.5,
              letterSpacing: 3.5,
              textTransform: "uppercase",
              color: GOLD,
              margin: "26px 0 14px",
              fontWeight: 500,
            }}
          >
            Manifest
          </h3>
          {/* 2026-05-26 — Brief 02 (Task B1): cards now source from
              mergeGuestRecords(...) instead of the raw manifest, so
              a guest who self-filled /cabin/me without ever appearing
              in cabin_guests_manifest still gets a card with their
              DOB / passport / allergies (no more blank dashes for
              new-model guests). The principal's own member row is
              folded in too. */}
          {mergedGuests.length === 0 ? (
            <p style={mutedItalic}>
              The guest list will appear here once members fill in
              their own crew-list lines (or the charterer seeds the
              manifest from the CRM). Until then, please coordinate
              names and arrival details with George directly.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {mergedGuests.map((g, i) => (
                <GuestCard key={g.id ?? `m-${i}`} order={i + 1} g={g} />
              ))}
            </div>
          )}
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

          {/* 2026-05-26 — Brief 02 (Task B2): chef-facing per-member
              allergy roll-up. Source is mergeGuestRecords(...) so
              each guest's self-filled allergies (from
              cabin_members.personal_details.allergies_dietary)
              reaches the chef regardless of what the principal
              typed into the Health section above. Severity uses
              the existing life-threatening red styling when
              flagged on the manifest. Absence-of-allergy is
              rendered explicitly ("No allergies reported by the
              party.") because confirmation is itself useful for
              the chef briefing — never hide the block. */}
          <ChefAllergyBlock guests={mergedGuests} />

          <SubBlock label="Itinerary">
            <Row k="Pace of the week" v={fmtMaybe(itinerary.pace)} />
            <Row k="Overall character" v={fmtMaybe(itinerary.overall_experience)} />
            <Row k="Docking preference" v={fmtMaybe(itinerary.docking_preference)} />
            <Row k="Preferred areas" v={fmtMaybe(itinerary.preferred_areas)} />
            <Row k="Specific places they would love" v={fmtMaybe(itinerary.specific_places)} />
            <Row k="Night-time preference" v={fmtMaybe(itinerary.night_preference)} />
          </SubBlock>

          {Boolean(
            itinerary.special_event_types ||
            itinerary.special_event_extras ||
            itinerary.celebrations,
          ) && (
            <SubBlock label="Celebrations on board">
              <Row k="Type of occasion" v={fmtMaybe(itinerary.special_event_types)} />
              <Row k="Extras to pre-stage" v={fmtMaybe(itinerary.special_event_extras)} />
              <Row k="Details" v={fmtMaybe(itinerary.celebrations)} />
            </SubBlock>
          )}

          <SubBlock label="Life aboard">
            <Row k="Crew presence preference" v={fmtMaybe(lifeAboard.crew_interaction)} />
            <Row k="Activities of interest" v={fmtMaybe(lifeAboard.activities)} />
            <Row k="Other activities" v={fmtMaybe(lifeAboard.activities_other)} />
            {/* 2026-05-22 — Music collapsed from four per-time-of-
                day rows to one freeform "general taste" row.
                Wellness onboard row removed entirely (yoga, etc.
                were a paid-extra trap). Legacy keys still rendered
                IF an older brief has them, so the captain doesn't
                lose anything that was already captured. */}
            <Row k="Music taste" v={fmtMaybe(get(lifeAboard, "music_taste"))} />
            {Boolean(get(lifeAboard, "music.specific_artists")) && (
              <Row k="Music — legacy detailed notes" v={fmtMaybe(get(lifeAboard, "music.specific_artists"))} />
            )}
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

          <SubBlock label="Service preferences">
            <Row k="Lunch service" v={fmtMaybe(dining.lunch_service)} />
            <Row k="Dinner service" v={fmtMaybe(dining.dinner_service)} />
          </SubBlock>

          <SubBlock label="Breakfast">
            <Row k="Styles" v={fmtMaybe(dining.breakfast_styles || dining.breakfast_style)} />
            <Row k="Items to stock" v={fmtMaybe(dining.breakfast_items)} />
            <Row k="Cheese kind" v={fmtMaybe(dining.breakfast_cheese_kind)} />
            <Row k="Cereal kind" v={fmtMaybe(dining.breakfast_cereal_kind)} />
            <Row k="Jam kind" v={fmtMaybe(dining.breakfast_jam_kind)} />
            <Row k="Tea kind" v={fmtMaybe(dining.breakfast_tea_kind)} />
            <Row k="Juice kind" v={fmtMaybe(dining.breakfast_juice_kind)} />
            <Row k="Anything else" v={fmtMaybe(dining.breakfast_specifics)} />
          </SubBlock>

          <SubBlock label="Coffee, tea & cold drinks">
            <Row k="Preferences" v={fmtMaybe(dining.coffee_tea)} />
          </SubBlock>

          {/* Food matrix table — only render if any item has a verdict */}
          {Boolean(
            dining.food_matrix &&
              typeof dining.food_matrix === "object" &&
              Object.keys(dining.food_matrix as Record<string, unknown>).length > 0,
          ) && (
            <FoodMatrixTable matrix={dining.food_matrix as Record<string, string>} />
          )}

          {Boolean(dining.food_loves || dining.food_avoid) && (
            <SubBlock label="Foods (legacy multi-select)">
              <Row k="Loves" v={fmtMaybe(dining.food_loves)} />
              <Row k="Avoid" v={fmtMaybe(dining.food_avoid)} />
            </SubBlock>
          )}

          <SubBlock label="Dessert">
            <Row k="Styles" v={fmtMaybe(dining.dessert_styles)} />
            <Row k="Specifics" v={fmtMaybe(dining.dessert_specifics)} />
          </SubBlock>

          <SubBlock label="Snacks & afternoon tea">
            <Row k="Snacks between meals" v={fmtMaybe(dining.snacks_yes_no)} />
            <Row k="Snack details" v={fmtMaybe(dining.snacks_details)} />
            <Row k="Afternoon tea" v={fmtMaybe(dining.afternoon_tea_yes_no)} />
            <Row k="Tea details" v={fmtMaybe(dining.afternoon_tea_details)} />
          </SubBlock>

          <SubBlock label="Dining ashore">
            <Row k="Evenings ashore (count)" v={fmtMaybe(dining.dining_ashore_evenings)} />
            <Row k="Notes" v={fmtMaybe(dining.dining_ashore_notes)} />
          </SubBlock>

          {Boolean(
            dining.kids_meal_arrangement ||
            dining.kids_meal_specifics ||
            dining.kids_needs_baby_cot ||
            dining.kids_needs_high_chair ||
            dining.kids_baby_food_specifics ||
            dining.children_at_table,
          ) && (
            <SubBlock label="Children at the table">
              <Row k="Meal arrangement" v={fmtMaybe(dining.kids_meal_arrangement)} />
              <Row k="What the children love" v={fmtMaybe(dining.kids_meal_specifics)} />
              <Row k="Baby cot needed" v={fmtMaybe(dining.kids_needs_baby_cot ? "Yes" : null)} />
              <Row k="High chair needed" v={fmtMaybe(dining.kids_needs_high_chair ? "Yes" : null)} />
              <Row k="Baby food / formula" v={fmtMaybe(dining.kids_baby_food_specifics)} />
              <Row k="Other notes" v={fmtMaybe(dining.children_at_table)} />
            </SubBlock>
          )}

          <SubBlock label="Open note to the chef">
            <Row k="From the charterer" v={fmtMaybe(dining.chef_open_note)} />
          </SubBlock>

          {Object.keys(children).length > 0 && (
            <SubBlock label="Children on board (legacy)">
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
          <SubBlock label="Bottled water">
            <Row k="Type" v={fmtMaybe(beverages.water_type || beverages.water)} />
            <Row k="Preferred brands" v={fmtMaybe(beverages.water_brand)} />
            {/* 2026-05-22 — `water_consumption_estimate` row removed.
                George: "αυτό βγαίνει — θα το υπολογίσει η εταιρεία.
                Δεν χρειάζεται να τους κουράζουμε." Schema field
                stays for back-compat with old briefs. */}
          </SubBlock>

          {/* 2026-05-22 — Frequency-based bar preferences (pass-3
              George capture mode). Previously the sheet only
              printed the legacy label/qty tables; the canonical
              freeform "we drink gin often, vodka rarely" capture
              never made it onto the captain's printout. Now first,
              so the hostess provisions from this and the label/qty
              tables (further below) act as label-specific overrides. */}
          {Boolean(
            beverages.champagne_wanted ||
              beverages.champagne_tier ||
              beverages.champagne_specifics,
          ) && (
            <SubBlock label="Champagne">
              <Row k="Wanted aboard" v={fmtMaybe(beverages.champagne_wanted)} />
              <Row k="Tier" v={fmtMaybe(beverages.champagne_tier)} />
              <Row k="Labels / notes" v={fmtMaybe(beverages.champagne_specifics)} />
            </SubBlock>
          )}

          {Boolean(
            beverages.wine_wanted ||
              beverages.wine_colors ||
              beverages.wine_grapes ||
              beverages.wine_tier ||
              beverages.wine_specifics,
          ) && (
            <SubBlock label="Wine — character preferences">
              <Row k="Wanted aboard" v={fmtMaybe(beverages.wine_wanted)} />
              <Row k="Colours" v={fmtMaybe(beverages.wine_colors)} />
              <Row k="Grapes / styles" v={fmtMaybe(beverages.wine_grapes)} />
              <Row k="Tier" v={fmtMaybe(beverages.wine_tier)} />
              <Row k="Labels / notes" v={fmtMaybe(beverages.wine_specifics)} />
            </SubBlock>
          )}

          {Boolean(
            beverages.spirits_frequency ||
              beverages.spirits_brands ||
              beverages.spirits_notes,
          ) && (
            <SubBlock label="Spirits — how often, which brands">
              <Row
                k="Frequency by spirit"
                v={fmtMaybe(beverages.spirits_frequency)}
              />
              <Row k="Brands the bar should carry" v={fmtMaybe(beverages.spirits_brands)} />
              <Row k="Notes" v={fmtMaybe(beverages.spirits_notes)} />
            </SubBlock>
          )}

          {Boolean(
            beverages.beers_frequency ||
              beverages.beers_origin ||
              beverages.beers_specifics ||
              beverages.beers_notes,
          ) && (
            <SubBlock label="Beers — character preferences">
              <Row k="Frequency" v={fmtMaybe(beverages.beers_frequency)} />
              <Row k="Origin preference" v={fmtMaybe(beverages.beers_origin)} />
              <Row k="Labels / notes" v={fmtMaybe(beverages.beers_specifics)} />
              <Row k="Other notes" v={fmtMaybe(beverages.beers_notes)} />
            </SubBlock>
          )}

          {Boolean(
            beverages.soft_drinks_frequency ||
              beverages.soft_drinks_brands,
          ) && (
            <SubBlock label="Soft drinks — frequency & brands">
              <Row
                k="Frequency by drink"
                v={fmtMaybe(beverages.soft_drinks_frequency)}
              />
              <Row k="Brands" v={fmtMaybe(beverages.soft_drinks_brands)} />
            </SubBlock>
          )}

          <LabelQtyTable label="Soft drinks (legacy label / qty)" rows={beverages.soft_drinks} />

          <SubBlock label="Standard bar (classics included)">
            <Row k="Tick-list" v={fmtMaybe(beverages.standard_bar_items)} />
            <Row k="Specific preferences" v={fmtMaybe(beverages.specific_preferences)} />
          </SubBlock>

          <SubBlock label="Wine — approach">
            <Row k="Greek vineyards" v={fmtMaybe(beverages.wine_greek_vineyards)} />
            <Row k="Preferred price range" v={fmtMaybe(beverages.wine_price_range)} />
            <Row k="Overall style" v={fmtMaybe(beverages.wine_style)} />
          </SubBlock>

          <LabelQtyTable
            label="Wine — specific labels"
            rows={beverages.wines}
            withPriceRange
          />

          <LabelQtyTable label="Whiskey"  rows={beverages.whiskey} />
          <LabelQtyTable label="Vodka"    rows={beverages.vodka} />
          <LabelQtyTable label="Gin"      rows={beverages.gin} />
          <LabelQtyTable label="Rum"      rows={beverages.rum} />
          <LabelQtyTable label="Tequila"  rows={beverages.tequila} />
          <LabelQtyTable label="Liqueur"  rows={beverages.liqueur} />

          <LabelQtyTable label="Beers — international" rows={beverages.beers} />
          <LabelQtyTable label="Beers — local Greek"   rows={beverages.beers_local} />

          <SubBlock label="Cocktails & mocktails">
            <Row k="Cocktails the hostess should know" v={fmtMaybe(beverages.cocktails)} />
            <Row k="Mocktails" v={fmtMaybe(beverages.mocktails)} />
          </SubBlock>
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

          <SubBlock label="Night service in cabins">
            <Row k="Place in each cabin (6–9pm)" v={fmtMaybe(little.night_service)} />
          </SubBlock>

          {/* 2026-05-22 — Drone photography / professional photographer
              SubBlock removed. George: "Είναι έξτρα — το βγάζουμε για
              τους ίδιους λόγους που βγάζουμε τα άλλα έξτρα." Schema
              keys stay for back-compat. */}

          <SubBlock label="Privacy & archive">
            {/* `connectivity` row removed — Internet quality is fixed
                per vessel and we can't change it from a brief.
                Keeping photo_archive_permission (GDPR self-consent
                for our archive use) is unrelated. */}
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

// 2026-05-26 — Brief 02 (Task B2): chef-facing per-member allergy
// roll-up. Sits inside §03 Health & Safety on the preference sheet.
// Renders one line per member who has any allergy/dietary note,
// red life-threatening styling when severity is flagged, and a
// calm "No allergies reported by the party." line when nobody
// has any (absence-as-information for the chef briefing — never
// hide the block).
function ChefAllergyBlock({ guests }: { guests: MergedGuest[] }) {
  // Filter: include any member with non-empty allergies_dietary
  // (skipping the literal "none" / blank), OR any non-empty
  // dietary_preferences (e.g. "Vegetarian", "No pork"). Empty
  // members are silently skipped — count surfaced in caption.
  const hasAllergyText = (s: string) =>
    s.trim().length > 0 && s.trim().toLowerCase() !== "none";
  const withAllergy = guests.filter(
    (g) =>
      hasAllergyText(g.allergies_dietary || "") ||
      (g.dietary && g.dietary.length > 0),
  );

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
        Allergies across the whole party (chef briefing)
      </h3>
      {withAllergy.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontFamily: FONT_EDITORIAL,
            fontStyle: "italic",
            fontSize: 13.5,
            color: MUTED,
          }}
        >
          No allergies reported by the party.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {withAllergy.map((g, i) => {
            const isLifeThreatening = g.allergies_severity === "life_threatening";
            const isStrong = g.allergies_severity === "strong_intolerance";
            const isMild =
              g.allergies_severity &&
              g.allergies_severity !== "life_threatening" &&
              g.allergies_severity !== "strong_intolerance";
            return (
              <li
                key={g.id ?? `cab-${i}`}
                className="avoid-break"
                style={{
                  margin: "6px 0",
                  padding: "10px 14px",
                  background: isLifeThreatening
                    ? "rgba(185, 28, 28, 0.06)"
                    : "#ffffff",
                  border: isLifeThreatening
                    ? "1px solid rgba(185, 28, 28, 0.35)"
                    : `1px solid ${RULE}`,
                  fontFamily: FONT_EDITORIAL,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <strong
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 10.5,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: isLifeThreatening ? "#b91c1c" : NAVY,
                      fontWeight: 600,
                    }}
                  >
                    {g.name || "—"}
                    {g.role === "principal_charterer" ? (
                      <span
                        style={{
                          marginLeft: 6,
                          color: GOLD,
                          fontWeight: 600,
                        }}
                      >
                        · Principal
                      </span>
                    ) : null}
                  </strong>
                  {isLifeThreatening ? (
                    <span
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 9.5,
                        letterSpacing: 1.6,
                        textTransform: "uppercase",
                        color: "#b91c1c",
                        fontWeight: 700,
                      }}
                    >
                      ⚠ Life-threatening
                    </span>
                  ) : isStrong ? (
                    <span
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 9.5,
                        letterSpacing: 1.6,
                        textTransform: "uppercase",
                        color: GOLD,
                      }}
                    >
                      Strong intolerance
                    </span>
                  ) : isMild ? (
                    <span
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 9.5,
                        letterSpacing: 1.6,
                        textTransform: "uppercase",
                        color: MUTED,
                      }}
                    >
                      Preference / mild
                    </span>
                  ) : null}
                </div>
                {hasAllergyText(g.allergies_dietary || "") ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: NAVY,
                    }}
                  >
                    {g.allergies_dietary}
                  </div>
                ) : null}
                {g.dietary && g.dietary.length > 0 ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: NAVY,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 10,
                        letterSpacing: 1.6,
                        textTransform: "uppercase",
                        color: MUTED,
                        marginRight: 6,
                      }}
                    >
                      Dietary:
                    </span>
                    <em style={{ fontStyle: "italic" }}>{g.dietary.join(" · ")}</em>
                  </div>
                ) : null}
                {g.emergency_note ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: isLifeThreatening ? "#0D1B2A" : MUTED,
                      fontStyle: "italic",
                    }}
                  >
                    {g.emergency_note}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p
        style={{
          margin: "10px 0 0 0",
          fontFamily: FONT_EDITORIAL,
          fontStyle: "italic",
          fontSize: 12,
          color: MUTED,
        }}
      >
        Source: each member&apos;s own /cabin/me/private. The principal&apos;s
        free-text Health row above may add extra context.
      </p>
    </div>
  );
}

// 2026-05-26 — Brief 02 (Task B1): GuestCard prop type switched
// from GuestRow (raw manifest shape) to MergedGuest (the helper
// output that folds in cabin_members.personal_details). The
// rendered field set is identical; only the field name for the
// display name changes (full_name → name).
function GuestCard({ order, g }: { order: number; g: MergedGuest }) {
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
          {g.name || "—"}
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
      {g.allergies_severity === "life_threatening" && (
        <div
          className="avoid-break"
          style={{
            marginTop: 10,
            padding: "10px 14px",
            background: "rgba(185, 28, 28, 0.06)",
            border: "1px solid rgba(185, 28, 28, 0.35)",
          }}
        >
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 10,
              letterSpacing: 2.5,
              textTransform: "uppercase",
              color: "#b91c1c",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            ⚠ Life-threatening allergy
          </div>
          {g.emergency_note ? (
            <div style={{ fontFamily: FONT_EDITORIAL, fontSize: 13.5, color: "#0D1B2A" }}>
              {g.emergency_note}
            </div>
          ) : null}
        </div>
      )}
      {g.allergies_severity && g.allergies_severity !== "life_threatening" && (
        <div
          style={{
            marginTop: 8,
            fontFamily: FONT_UI,
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: GOLD,
          }}
        >
          {g.allergies_severity === "strong_intolerance" ? "Strong intolerance" : "Preference / mild"}
          {g.emergency_note ? (
            <span style={{ marginLeft: 8, fontStyle: "italic", textTransform: "none", letterSpacing: 0, fontFamily: FONT_EDITORIAL, fontSize: 13, color: "#0D1B2A" }}>
              · {g.emergency_note}
            </span>
          ) : null}
        </div>
      )}
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

// =================== FOOD MATRIX TABLE =======================
// Renders the per-item Like/Dislike/Indifferent verdict as a
// compact navy-header table. We list every captured item regardless
// of verdict so absences are visible. Items with no verdict at all
// are intentionally dropped — caller already gated on truthy keys.
const FOOD_MATRIX_LABELS: Record<string, string> = {
  fish: "Fish",
  shellfish: "Shellfish",
  beef: "Beef",
  pork: "Pork",
  lamb: "Lamb",
  veal: "Veal",
  chicken: "Chicken",
  turkey: "Turkey",
  greek_meze: "Greek meze",
  pasta: "Pasta",
  rice: "Rice",
  vegetables: "Vegetables",
  salad: "Salad",
};

function FoodMatrixTable({ matrix }: { matrix: Record<string, string> }) {
  const entries = Object.entries(matrix).filter(([, v]) => v);
  if (entries.length === 0) return null;
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
        Lunch & dinner — preferences matrix
      </h3>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: FONT_EDITORIAL,
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ background: NAVY, color: IVORY }}>
            <th style={matrixHead}>Item</th>
            <th style={matrixHead}>Like</th>
            <th style={matrixHead}>Dislike</th>
            <th style={matrixHead}>Indifferent</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, verdict]) => {
            const label = FOOD_MATRIX_LABELS[key] || key.replace(/_/g, " ");
            return (
              <tr key={key} style={{ borderBottom: `1px solid ${RULE}` }}>
                <td style={matrixCellLabel}>{label}</td>
                <td style={matrixCell}>{verdict === "like" ? "✓" : ""}</td>
                <td style={matrixCell}>{verdict === "dislike" ? "✓" : ""}</td>
                <td style={matrixCell}>{verdict === "indifferent" ? "✓" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const matrixHead: React.CSSProperties = {
  padding: "8px 10px",
  fontFamily: FONT_UI,
  fontSize: 10,
  letterSpacing: 2,
  textTransform: "uppercase",
  textAlign: "left",
  color: "rgba(248,245,240,0.85)",
  fontWeight: 500,
};

const matrixCellLabel: React.CSSProperties = {
  padding: "8px 10px",
  fontFamily: FONT_EDITORIAL,
  fontSize: 14,
  color: NAVY,
};

const matrixCell: React.CSSProperties = {
  padding: "8px 10px",
  fontFamily: FONT_EDITORIAL,
  fontSize: 15,
  color: GOLD,
  fontWeight: 600,
};

// =================== LABEL × QTY TABLE =======================
// Renders soft drinks, wines, spirits, beers — any "label +
// quantity" provisioning list. Hidden entirely when the source
// is empty or every row is blank.
type LqRow = { label?: string | null; quantity?: string | null; price_range_per_bottle?: string | null };

function LabelQtyTable({
  label,
  rows,
  withPriceRange,
}: {
  label: string;
  rows: unknown;
  withPriceRange?: boolean;
}) {
  if (!Array.isArray(rows)) return null;
  const filled = (rows as LqRow[]).filter(
    (r) => (r?.label && r.label.trim()) || (r?.quantity && String(r.quantity).trim()),
  );
  if (filled.length === 0) return null;

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
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: FONT_EDITORIAL,
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ background: NAVY, color: IVORY }}>
            <th style={{ ...matrixHead, width: "60%" }}>Label</th>
            <th style={{ ...matrixHead, width: withPriceRange ? "20%" : "40%" }}>Quantity</th>
            {withPriceRange && <th style={{ ...matrixHead, width: "20%" }}>Price / bottle</th>}
          </tr>
        </thead>
        <tbody>
          {filled.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${RULE}` }}>
              <td style={matrixCellLabel}>{r.label || "—"}</td>
              <td style={matrixCellLabel}>{r.quantity || "—"}</td>
              {withPriceRange && (
                <td style={matrixCellLabel}>{r.price_range_per_bottle || "—"}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
