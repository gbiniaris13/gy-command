// gy-command — Concierge brief editor.
// One page, all 9 sections, each in a collapsible JSON textarea.
// This is the no-bullshit admin form for filling on behalf of a
// 75-year-old client. Polished UI for the client is /cabin/brief
// on the public site; here we trade polish for speed of entry.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCabin, getCabinSections } from "@/lib/cabin-admin";
import SectionEditor from "./SectionEditor";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { key: "arrival",        title: "Arrival & Departure" },
  { key: "guests",         title: "Your Group" },
  { key: "health",         title: "Health & Safety" },
  { key: "itinerary",      title: "Itinerary" },
  { key: "life_aboard",    title: "Life Aboard" },
  { key: "dining",         title: "At the Table" },
  { key: "beverages",      title: "In the Cellar" },
  { key: "little_things",  title: "The Little Things" },
  { key: "children",       title: "Children (conditional)" },
];

export default async function CabinBriefEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();
  const sections = await getCabinSections(id);

  function dataFor(key: string) {
    return sections.find((s) => s.section_key === key)?.data ?? {};
  }

  return (
    <div style={{ padding: 24, maxWidth: 1080, margin: "0 auto" }}>
      <Link href={`/dashboard/cabins/${id}`} style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", textDecoration: "none" }}>
        ← Back to cabin
      </Link>

      <header style={{ marginTop: 12, marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
          Concierge brief editor
        </div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 26, fontWeight: 300 }}>
          {cabin.principal_charterer_name} · <em style={{ color: "#C9A84C", fontStyle: "italic" }}>{cabin.vessel_name}</em>
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13.5, fontStyle: "italic" }}>
          Each section is a JSON object that mirrors what the client would see
          as a form. Edit, then save — the audit log records it as a concierge
          edit. When you are done, return to the cabin detail page and click
          <strong> Send for review</strong>.
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {SECTIONS.map((s) => (
          <SectionEditor
            key={s.key}
            cabinId={id}
            sectionKey={s.key}
            title={s.title}
            initial={dataFor(s.key)}
          />
        ))}
      </div>
    </div>
  );
}
