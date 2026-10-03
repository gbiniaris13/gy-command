"use client";
// The Fleet Book, list view. Two shelves: the folders George has written, and
// the yachts on the site that have no folder yet (one click writes one).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { YachtDossier } from "@/lib/helm/dossier";

type SiteRow = { name: string; slug: string; category: string | null; photo: string | null };

const CAT: Record<string, string> = {
  "motor-yachts": "Motor yacht", "sailing-catamarans": "Sailing catamaran",
  "power-catamarans": "Power catamaran", "sailing-monohulls": "Sailing yacht",
};

export default function FleetBook({ dossiers, site }: { dossiers: YachtDossier[]; site: SiteRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const mine = useMemo(() => dossiers.filter((d) => !needle || d.name.toLowerCase().includes(needle) || (d.type ?? "").toLowerCase().includes(needle)), [dossiers, needle]);
  const onSite = useMemo(() => site.filter((y) => !needle || y.name.toLowerCase().includes(needle)), [site, needle]);

  async function addFromSite(y: SiteRow) {
    setBusy(y.slug); setError(null);
    try {
      const r = await fetch(`/api/helm/dossiers/${encodeURIComponent(y.slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "from-site", slug: y.slug }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "could not read the site");
      const s = await fetch(`/api/helm/dossiers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossier: j.dossier }),
      });
      const sj = await s.json();
      if (!s.ok) throw new Error(sj.error || "could not save");
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>The Helm · The Fleet Book</div>
          <h1 style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 300 }}>Every yacht, written once</h1>
          <div style={{ marginTop: 6, fontSize: 13, color: "#6B7280", maxWidth: 640, lineHeight: 1.5 }}>
            A folder holds how a yacht is presented: type, spec line, your Inside Info, the lists, the photographs, the brochure.
            Every new proposal that names the yacht reads it. Prices and dates always come from the email of the day.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href="/dashboard/helm" style={ghost}>← Requests</Link>
          <Link href="/dashboard/helm/yachts/new" style={primary}>+ New yacht</Link>
        </div>
      </header>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a yacht…"
        style={{ width: "100%", maxWidth: 420, padding: "10px 12px", border: "1px solid rgba(13,27,42,0.2)", fontSize: 14, fontFamily: "inherit", marginBottom: 20 }} />
      {error && <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <section>
        <div style={eyebrow}>In the book · {mine.length}</div>
        {mine.length === 0 ? (
          <div style={{ fontSize: 13, color: "#6B7280", padding: "14px 0 24px" }}>
            Nothing written yet. Add a yacht from the site below, or press &quot;Save to the Fleet Book&quot; on any yacht card inside a request.
          </div>
        ) : (
          <div style={grid}>
            {mine.map((d) => (
              <Link key={d.key} href={`/dashboard/helm/yachts/${encodeURIComponent(d.key)}`} style={card}>
                <div style={{ height: 150, background: "#0D1B2A", overflow: "hidden" }}>
                  {d.main_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.main_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#C9A84C", fontSize: 10, letterSpacing: 2 }}>NO PHOTOGRAPH YET</div>
                  )}
                </div>
                <div style={{ padding: "12px 14px 14px" }}>
                  <div style={{ fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: "#C9A84C" }}>{d.type || "yacht"}</div>
                  <div style={{ fontSize: 18, fontWeight: 300, color: "#0D1B2A", marginTop: 2 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4, minHeight: 32, lineHeight: 1.4 }}>{d.spec_line || "No spec line yet"}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <Pill ok={!!d.inside_info}>Inside Info</Pill>
                    <Pill ok={(d.extra_urls?.length ?? 0) + (d.main_url ? 1 : 0) >= 4}>{(d.extra_urls?.length ?? 0) + (d.main_url ? 1 : 0)} photos</Pill>
                    <Pill ok={!!d.brochure_url}>Brochure</Pill>
                  </div>
                  <div style={{ fontSize: 10.5, color: "#9CA3AF", marginTop: 10 }}>
                    {d.source === "site" ? "From the site" : d.source === "request" ? "From a request" : "Written by hand"}
                    {d.updated_at ? ` · ${new Date(d.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {onSite.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <div style={eyebrow}>On the site, not yet in the book · {onSite.length}</div>
          <div style={{ fontSize: 12.5, color: "#6B7280", margin: "4px 0 12px" }}>One click copies what the site already says about her. You can polish it afterwards.</div>
          <div style={grid}>
            {onSite.map((y) => (
              <div key={y.slug} style={{ ...card, cursor: "default" }}>
                <div style={{ height: 110, background: "#0D1B2A", overflow: "hidden", opacity: 0.85 }}>
                  {y.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={y.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : null}
                </div>
                <div style={{ padding: "10px 14px 14px" }}>
                  <div style={{ fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>{y.category ? CAT[y.category] ?? y.category : "yacht"}</div>
                  <div style={{ fontSize: 16, fontWeight: 300, color: "#0D1B2A", marginTop: 2 }}>{y.name}</div>
                  <button type="button" onClick={() => addFromSite(y)} disabled={busy !== null}
                    style={{ ...ghost, marginTop: 10, cursor: "pointer", fontSize: 9.5 }}>
                    {busy === y.slug ? "Writing…" : "Add to the book"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 9.5, letterSpacing: 1, textTransform: "uppercase", padding: "2px 7px", borderRadius: 2, border: `1px solid ${ok ? "rgba(58,107,71,0.5)" : "rgba(13,27,42,0.15)"}`, color: ok ? "#3A6B47" : "#9CA3AF" }}>
      {children}
    </span>
  );
}

const eyebrow: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 600, marginBottom: 10 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 };
const card: React.CSSProperties = { display: "block", background: "#fff", border: "1px solid rgba(13,27,42,0.12)", textDecoration: "none", color: "inherit", overflow: "hidden" };
const ghost: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.25)", padding: "9px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", textDecoration: "none", display: "inline-block" };
const primary: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", textDecoration: "none", display: "inline-block" };
