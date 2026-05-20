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
import {
  getCabin,
  getCabinMembers,
  getCabinGuestsManifest,
} from "@/lib/cabin-admin";
import PrintButton from "../print/PrintButton";

export const dynamic = "force-dynamic";

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

interface MergedGuest {
  name: string;
  role: string;
  email: string;
  mobile: string;
  date_of_birth: string;
  nationality: string;
  passport_number: string;
  passport_expiry: string;
  allergies_dietary: string;
  dietary_preferences: string[];
  swims: string;
  mobility_notes: string;
  cabin_pairing: string;
  source: "member_self" | "manifest" | "principal_seed";
}

const SWIMS_LABEL: Record<string, string> = {
  confident: "Confident swimmer",
  some: "Comfortable with help",
  non_swimmer: "Non-swimmer",
  prefer_not_say: "Prefers not to say",
};

function merge(
  members: AnyRec[],
  manifest: AnyRec[],
  principalSeed: { full_name: string; email: string; mobile: string }
): MergedGuest[] {
  const byEmail = new Map<string, MergedGuest>();

  // Seed every member row first — that's the source of truth for
  // who has access to the cabin.
  for (const m of members) {
    const pd = (m.personal_details as AnyRec) || {};
    const email = String(m.email ?? "").toLowerCase();
    byEmail.set(email, {
      name: s(m.display_name) || principalSeed.full_name,
      role: s(m.role),
      email,
      mobile: s(m.mobile),
      date_of_birth: s(pd.date_of_birth),
      nationality: s(pd.nationality),
      passport_number: s(pd.passport_number),
      passport_expiry: s(pd.passport_expiry),
      allergies_dietary: s(pd.allergies_dietary),
      dietary_preferences: Array.isArray(pd.dietary_preferences)
        ? (pd.dietary_preferences as string[])
        : [],
      swims: s(pd.swims),
      mobility_notes: s(pd.mobility_notes),
      cabin_pairing: s(pd.cabin_pairing),
      source: "member_self",
    });
  }

  // Layer manifest rows on top — but only fill BLANKS. Member-
  // self data wins for any field the user filled themselves.
  for (const g of manifest) {
    const email = String(g.email ?? "").toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      existing.date_of_birth ||= fmtIsoSafe(g.date_of_birth);
      existing.nationality ||= s(g.nationality);
      existing.passport_number ||= s(g.passport_number);
      existing.passport_expiry ||= fmtIsoSafe(g.passport_expiry);
      existing.allergies_dietary ||= s(g.allergies_dietary);
      existing.cabin_pairing ||= s(g.cabin_pairing);
      existing.mobile ||= s(g.mobile);
      existing.name = s(g.full_name) || existing.name;
    } else {
      // Manifest-only entry (no portal member yet). Include with
      // the manifest data we have so paperwork is complete.
      byEmail.set(email || `manifest-${g.id}`, {
        name: s(g.full_name) || "—",
        role: "guest",
        email,
        mobile: s(g.mobile),
        date_of_birth: fmtIsoSafe(g.date_of_birth),
        nationality: s(g.nationality),
        passport_number: s(g.passport_number),
        passport_expiry: fmtIsoSafe(g.passport_expiry),
        allergies_dietary: s(g.allergies_dietary),
        dietary_preferences: [],
        swims: "",
        mobility_notes: "",
        cabin_pairing: s(g.cabin_pairing),
        source: "manifest",
      });
    }
  }

  // Sort: principal_charterer first, then assistants, then guests
  // alphabetically by name.
  const out = Array.from(byEmail.values());
  out.sort((a, b) => {
    const order: Record<string, number> = {
      principal_charterer: 0,
      designated_assistant: 1,
      guest: 2,
    };
    const ao = order[a.role] ?? 99;
    const bo = order[b.role] ?? 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return out;
}

function fmtIsoSafe(v: unknown): string {
  if (!v) return "";
  const str = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : "";
}

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

  const guests = merge(
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
        <div style={{ fontFamily: FONT_UI, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: MUTED }}>
          Crew list · Internal
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
                  <Row label="Date of birth" value={fmtDate(g.date_of_birth)} />
                  <Row label="Nationality" value={g.nationality} />
                  <Row label="Passport number" value={g.passport_number} />
                  <Row label="Passport expiry" value={fmtDate(g.passport_expiry)} />
                  <Row label="Email" value={g.email} />
                  <Row label="Mobile" value={g.mobile} />
                  <Row label="Cabin pairing" value={g.cabin_pairing} />
                  <Row
                    label="Allergies & dietary"
                    value={
                      [
                        g.allergies_dietary,
                        g.dietary_preferences?.length
                          ? `(${g.dietary_preferences.join(", ")})`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    }
                    highlight={Boolean(g.allergies_dietary)}
                  />
                  <Row
                    label="Swimming"
                    value={SWIMS_LABEL[g.swims] ?? g.swims}
                  />
                  <Row label="Mobility / medical" value={g.mobility_notes} />
                </tbody>
              </table>
            </li>
          ))}
        </ol>
      )}

      <p
        style={{
          fontFamily: FONT_EDITORIAL,
          fontStyle: "italic",
          fontSize: 11.5,
          color: MUTED,
          marginTop: 32,
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        Generated by George Yachts Brokerage House LLC for the use of
        the captain and the marina authorities. Personal data herein
        is shared on a need-to-know basis and is not retained beyond
        the close of the charter.
      </p>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page {
            size: A4;
            margin: 12mm;
          }
          body { background: #ffffff !important; }
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
