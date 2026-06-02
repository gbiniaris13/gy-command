// gy-command — Crew list (port-authority paperwork).
//
// 2026-05-20 — Friend-test pass 4 (George):
//   "Στο GY Command όπως πατάω το preference sheet, να πατάω και
//    το crew list — να το παίρνω σαν PDF να το στέλνω εκεί που
//    πρέπει. Οι πελάτες συμπληρώνουν στα δικά τους /cabin/me,
//    εγώ το παίρνω εδώ έτοιμο."
//
// Print-ready A4. Pulls the manifest data from TWO sources and
// merges by email:
//   1. cabin_members + cabin_members.personal_details — what each
//      guest filled in via /cabin/me (DOB, nationality, passport,
//      allergies, swimming, mobility, cabin pairing).
//   2. cabin_guests_manifest — what George filled in via the CRM
//      manifest editor (legacy / for guests who didn't self-fill).
//
// When a row exists in BOTH, member-self data wins for everything
// the user can edit themselves (DOB, passport, allergies); the
// CRM-manifest is the fallback for guests who haven't joined yet.
//
// Output is plain HTML styled for A4 print. Browser print → "Save
// as PDF" gives George the file to email to the captain / marina.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getCabin,
  getCabinMembers,
  getCabinGuestsManifest,
} from "@/lib/cabin-admin";
import { mergeGuestRecords, type MergedGuest } from "@/lib/cabin-guest-merge";
import PrintButton from "../print/PrintButton";

export const dynamic = "force-dynamic";

// 2026-05-22 — Give the browser tab a sensible title so when George
// hits ⌘P → "Save as PDF" the default filename becomes
// "EFFIE STAR — Crew List.pdf", not "(50) GY Command _ George Yachts".
// macOS native save dialog reads this <title> verbatim.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const cabin = await getCabin(id);
  const vessel = cabin?.vessel_name || "Cabin";
  return { title: `${vessel} — Crew List` };
}

// Brand tokens (matched to /print/page.tsx so the two read as a pair)
const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const RULE = "rgba(13, 27, 42, 0.12)";
const MUTED = "rgba(13, 27, 42, 0.55)";
const FONT_EDITORIAL = "Georgia, 'Times New Roman', serif";
const FONT_UI = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

type AnyRec = Record<string, unknown>;

function s(v: unknown): string {
  return v == null ? "" : String(v);
}

function fmtDate(iso: unknown): string {
  if (!iso) return "";
  const str = String(iso);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return str;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const ROLE_LABEL: Record<string, string> = {
  principal_charterer: "Principal charterer",
  designated_assistant: "Designated assistant",
  guest: "Guest",
};

// 2026-05-26 — Brief 02 (Task B1): MergedGuest interface + merge()
// function extracted to src/lib/cabin-guest-merge.ts as the
// shared mergeGuestRecords() helper, so preference-sheet/page.tsx
// and print/page.tsx can use the same shape. The shared helper
// adds extra fields (cabin_pairing, shoe_size, allergies_dietary,
// allergies_severity, emergency_note, is_minor) that the
// preference sheet renders but crew-list ignores — no behavior
// change for crew-list (port-authority essentials only).
//
// 2026-05-22 — George directive: the Crew List PDF carries ONLY
// port-authority essentials (name, gender, DOB, ID/passport, mobile).
// Allergies, dietary, swimming, mobility, cabin pairing belong on
// the Preference Sheet and are stripped from here.
const GENDER_LABEL: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_say: "Prefers not to say",
};

export default async function CabinCrewListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();
  const [members, manifest] = await Promise.all([
    getCabinMembers(id),
    getCabinGuestsManifest(id),
  ]);

  const guests: MergedGuest[] = mergeGuestRecords(
    members as AnyRec[],
    manifest as AnyRec[],
    {
      full_name: cabin.principal_charterer_name ?? "",
      email: cabin.principal_charterer_email ?? "",
      mobile: cabin.principal_charterer_mobile ?? "",
    }
  );

  const charterDates =
    cabin.charter_period_from && cabin.charter_period_to
      ? `${fmtDate(cabin.charter_period_from)} – ${fmtDate(cabin.charter_period_to)}`
      : "";

  return (
    <main
      style={{
        background: "#ffffff",
        color: NAVY,
        fontFamily: FONT_EDITORIAL,
        maxWidth: "210mm",
        margin: "0 auto",
        padding: "24px 18mm",
        minHeight: "100vh",
      }}
    >
      {/* Sticky print bar — hidden on @media print */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 0 20px",
          borderBottom: `1px solid ${RULE}`,
          marginBottom: 26,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
            Crew list · Port-authority paperwork
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 10, color: MUTED, fontStyle: "italic" }}>
            In the print dialog, UNCHECK &ldquo;Headers and footers&rdquo; for a clean document.
          </div>
        </div>
        <PrintButton />
      </div>

      {/* Hero */}
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 10.5,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: GOLD,
            fontWeight: 600,
          }}
        >
          George Yachts · Crew List
        </div>
        <h1
          style={{
            fontFamily: FONT_EDITORIAL,
            fontSize: 30,
            fontWeight: 300,
            margin: "10px 0 6px 0",
            lineHeight: 1.15,
          }}
        >
          {cabin.vessel_name}
          {cabin.vessel_make_model ? (
            <em style={{ color: GOLD, fontStyle: "italic" }}>
              {" · "}
              {cabin.vessel_make_model}
            </em>
          ) : null}
        </h1>
        {charterDates && (
          <div
            style={{
              fontFamily: FONT_EDITORIAL,
              fontStyle: "italic",
              fontSize: 15,
              color: MUTED,
            }}
          >
            {charterDates}
          </div>
        )}
      </header>

      {guests.length === 0 ? (
        <p style={{ fontStyle: "italic", color: MUTED }}>
          No guests on the manifest yet. Add members from the cabin
          detail page or have them sign in via the magic link and
          fill /cabin/me.
        </p>
      ) : (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {guests.map((g, i) => (
            <li
              key={g.email || `g-${i}`}
              style={{
                background: "#ffffff",
                border: `1px solid ${RULE}`,
                padding: "16px 18px",
                pageBreakInside: "avoid",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "baseline",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_EDITORIAL,
                    fontStyle: "italic",
                    color: GOLD,
                    fontSize: 22,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong style={{ fontSize: 18, fontFamily: FONT_EDITORIAL, fontWeight: 400 }}>
                    {g.name || "—"}
                  </strong>
                  <div
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 10,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: GOLD,
                      marginTop: 2,
                    }}
                  >
                    {ROLE_LABEL[g.role] ?? g.role ?? "Guest"}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: FONT_UI,
                    fontSize: 9.5,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: MUTED,
                  }}
                >
                  {g.source === "manifest" ? "(CRM manifest)" : ""}
                </div>
              </div>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                  fontFamily: FONT_EDITORIAL,
                }}
              >
                <tbody>
                  <Row label="Gender" value={GENDER_LABEL[g.gender] ?? g.gender} />
                  <Row label="Date of birth" value={fmtDate(g.date_of_birth)} />
                  <Row label="Nationality" value={g.nationality} />
                  <Row label="ID / Passport number" value={g.passport_number} />
                  <Row label="Passport expiry" value={fmtDate(g.passport_expiry)} />
                  <Row label="Email" value={g.email} />
                  <Row label="Mobile" value={g.mobile} />
                </tbody>
              </table>
            </li>
          ))}
        </ol>
      )}

      {/* 2026-06-02 — Confidentiality / data-ownership notice. Replaces the
          earlier short footer with a firm statement: these are George Yachts
          clients + their port-authority personal data, provided for this
          charter only (need-to-know), not for the recipient to keep or reuse. */}
      <div
        style={{
          marginTop: 32,
          padding: "13px 16px",
          border: `1px solid ${GOLD}`,
          borderLeft: `3px solid ${GOLD}`,
          fontFamily: FONT_UI,
          fontSize: 10.5,
          color: NAVY,
          lineHeight: 1.7,
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>
          CONFIDENTIAL — GEORGE YACHTS CLIENTS.
        </span>{" "}
        This crew list is generated by George Yachts Brokerage House LLC and
        provided to the captain and the port/marina authorities strictly to
        clear and operate this charter ({cabin.vessel_name}
        {charterDates ? ` · ${charterDates}` : ""}). The passengers are clients
        of George Yachts; their personal data — names, dates of birth,
        nationality, passport/ID and contact details — is shared on a
        need-to-know basis for this charter only. Except where a public
        authority is required by law to retain it, this data may not be copied,
        stored beyond the close of the charter, shared with anyone who does not
        need it for this charter, or used to contact, solicit or market to the
        passengers. The client relationship reflected here is the confidential
        and proprietary information of George Yachts Brokerage House LLC; any
        other use requires our prior written consent.
      </div>

      <style>{`
        /* 2026-05-22 — Full print-mode reset for the Crew List PDF.
           Without these overrides, the dashboard layout's flex
           h-screen overflow-hidden shell + sticky top bar + bottom
           tab bar all leak into the saved PDF, and the content
           clips to a single page. */
        @media print {
          @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
          /* 2026-05-27 — Brief 06 (#5): depth-independent shell reset.
             The rules further down use body > div > div.flex.h-screen
             direct-child chains, which BROKE when the dashboard layout
             nesting changed (provider wrappers / The Helm merge). The
             unmatched h-screen overflow-hidden shell then stayed at
             100vh + overflow:hidden and clipped the PDF to a single
             screenful — the crew list cut off at the 3rd person. These
             class-contains selectors neutralise the shell AND the
             overflow-y-auto <main> at ANY nesting depth, so the list
             flows across as many A4 pages as it needs. */
          /* 2026-06-02 — also COLLAPSE the flex shell to block + full
             width. The real DOM is body > div.flex.h-screen > main.flex-1,
             so the body>div>div display:block rule below never matched and
             <main> kept its ~1680px desktop flex width in print — the A4
             page then clipped the right ~half, dropping every crew-list
             VALUE (gender / DOB / passport / mobile) and the confidentiality
             box off the right edge. Forcing the shell to block + 100% width
             lets <main> shrink to the page so the value column fits. */
          [class*="h-screen"] {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
            overflow: visible !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          body { display: block !important; }
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
          aside { display: none !important; }
          .no-print { display: none !important; }
          main > div.sticky,
          nav.fixed,
          a.fixed,
          div.fixed { display: none !important; }
          body > div > div.flex.h-screen.overflow-hidden,
          body > div > div[class*="h-screen"] {
            display: block !important;
            height: auto !important;
            overflow: visible !important;
          }
          main {
            display: block !important;
            overflow: visible !important;
            padding-bottom: 0 !important;
            flex: 0 0 auto !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>
    </main>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  if (!value) {
    return (
      <tr style={{ borderTop: `1px dashed ${RULE}` }}>
        <td
          style={{
            padding: "6px 0",
            width: "32%",
            fontFamily: FONT_UI,
            fontSize: 10,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            color: MUTED,
            verticalAlign: "top",
          }}
        >
          {label}
        </td>
        <td style={{ padding: "6px 0", color: "rgba(13, 27, 42, 0.3)" }}>—</td>
      </tr>
    );
  }
  return (
    <tr style={{ borderTop: `1px dashed ${RULE}` }}>
      <td
        style={{
          padding: "6px 0",
          width: "32%",
          fontFamily: FONT_UI,
          fontSize: 10,
          letterSpacing: 1.8,
          textTransform: "uppercase",
          color: highlight ? "#b14a3a" : MUTED,
          verticalAlign: "top",
          fontWeight: highlight ? 700 : 500,
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "6px 0",
          color: highlight ? "#b14a3a" : NAVY,
          fontWeight: highlight ? 600 : 400,
        }}
      >
        {value}
      </td>
    </tr>
  );
}
