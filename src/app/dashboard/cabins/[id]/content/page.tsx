// gy-command — edit the JSONB content blobs that the client Cabin
// renders. Crew + menu now have form-based editors (no JSON). The
// inspiration block stays JSON because it's free-form and unused
// in the current product; if we start using it, a form follows.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCabin } from "@/lib/cabin-admin";
import ContentEditor from "./ContentEditor";
import CrewForm from "./CrewForm";
import MenuForm from "./MenuForm";
import BrochureDropzones from "./BrochureDropzones";

export const dynamic = "force-dynamic";

export default async function CabinContentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  return (
    <div style={{ padding: 24, maxWidth: 1080, margin: "0 auto" }}>
      <Link href={`/dashboard/cabins/${id}`} style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", textDecoration: "none" }}>
        ← Back to cabin
      </Link>

      <header style={{ marginTop: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C" }}>
          Content for the client view
        </div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 26, fontWeight: 300 }}>
          {cabin.vessel_name} · client-facing copy
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13.5, fontStyle: "italic" }}>
          Crew list is white-labelled: first name + role + 1–2 line bio only,
          no surnames, no vessel owner references, no central agent disclosed.
          Edits save instantly — the client view re-renders on next page load.
        </p>
      </header>

      <BrochureDropzones cabinId={id} />

      {/* Each form's internal useState() is seeded from `initial`
          only on first mount. When the brochure dropzones above
          run an extraction and call router.refresh(), the server
          re-fetches cabin and we land here with new `initial` —
          but without a key change the form keeps its stale state.
          A content-derived key (cheap stringify) remounts the
          form so the extracted data appears. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CrewForm
          key={`crew:${JSON.stringify(cabin.crew_display ?? []).length}`}
          cabinId={id}
          initial={cabin.crew_display ?? []}
        />
        <MenuForm
          key={`menu:${JSON.stringify(cabin.sample_menu ?? {}).length}`}
          cabinId={id}
          initial={cabin.sample_menu ?? {}}
        />
        <ContentEditor
          key={`vessel:${JSON.stringify((cabin as Record<string, unknown>).vessel_brochure ?? {}).length}`}
          cabinId={id}
          field="vessel_brochure"
          title="Vessel brochure (auto-extracted · raw JSON)"
          hint="Populated automatically when you drop a brochure PDF above. Edit any field by hand if Claude got something wrong."
          initial={(cabin as Record<string, unknown>).vessel_brochure ?? {}}
        />
        <ContentEditor
          cabinId={id}
          field="inspiration_content"
          title="Greek cuisine inspiration (optional · raw JSON)"
          hint="Free-form supplemental content. Leave empty if unused."
          initial={cabin.inspiration_content ?? {}}
        />
      </div>

      {/*
        2026-05-20 — George friend-test pass 2: after uploading the
        crew / menu / vessel brochures and saving, he was stuck on
        this page with no clear "where do I go next" cue (only the
        small grey "← Back to cabin" link at the top). Adding an
        explicit footer with primary "Done" + a row of related
        cabin sections he commonly needs to fill before sending to
        the client.
      */}
      <footer
        style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: "1px solid var(--gy-border, rgba(13,27,42,0.12))",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Link
            href={`/dashboard/cabins/${id}`}
            style={{
              background: "var(--gy-navy, #0D1B2A)",
              color: "var(--gy-ivory, #F8F5F0)",
              padding: "11px 22px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 2.2,
              textTransform: "uppercase",
              border: "1px solid var(--gy-gold, #C9A84C)",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            ✓ Done — back to cabin overview
          </Link>
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: 10,
              letterSpacing: 2,
              textTransform: "uppercase",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={{ color: "var(--gy-navy-soft, rgba(13,27,42,0.55))" }}>
              Continue with:
            </span>
            <Link
              href={`/dashboard/cabins/${id}/edit-basics`}
              style={{ color: "var(--gy-gold, #C9A84C)", textDecoration: "none" }}
            >
              Cabin details →
            </Link>
            <Link
              href={`/dashboard/cabins/${id}/manifest`}
              style={{ color: "var(--gy-gold, #C9A84C)", textDecoration: "none" }}
            >
              Guest manifest →
            </Link>
            <Link
              href={`/dashboard/cabins/${id}/preference-sheet`}
              style={{ color: "var(--gy-gold, #C9A84C)", textDecoration: "none" }}
            >
              Preference sheet →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
