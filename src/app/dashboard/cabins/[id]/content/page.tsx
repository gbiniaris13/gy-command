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
    </div>
  );
}
