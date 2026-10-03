"use client";
// The folder editor. One column of plain fields on the left, the client's
// view on the right, updated as George types. Rough or careful: only the
// name is required. "Fill from the site" copies the yacht's page; "Save"
// keeps it; nothing is sent anywhere.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { YachtDossier } from "@/lib/helm/dossier";

type Form = {
  name: string; type: string; spec_line: string; description: string; inside_info: string; crew_line: string;
  highlights: string; water_toys: string; accommodation: string; distinctions: string;
  main_url: string; extra_urls: string[]; brochure_url: string; video_url: string; notes: string; sanity_slug: string;
};

const TYPES = ["MOTOR YACHT", "SAILING CATAMARAN", "POWER CATAMARAN", "SAILING YACHT", "MOTOR SAILER", "GULET"];

function toForm(d: YachtDossier | null): Form {
  return {
    name: d?.name ?? "", type: d?.type ?? "", spec_line: d?.spec_line ?? "", description: d?.description ?? "",
    inside_info: d?.inside_info ?? "", crew_line: d?.crew_line ?? "",
    highlights: (d?.highlights ?? []).join("\n"), water_toys: (d?.water_toys ?? []).join("\n"),
    accommodation: (d?.accommodation ?? []).map(([a, b]) => (b ? `${a} · ${b}` : a)).join("\n"),
    distinctions: (d?.distinctions ?? []).join("\n"),
    main_url: d?.main_url ?? "", extra_urls: d?.extra_urls ?? [], brochure_url: d?.brochure_url ?? "", video_url: d?.video_url ?? "",
    notes: d?.notes ?? "", sanity_slug: d?.sanity_slug ?? "",
  };
}
const lines = (s: string) => s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
function fromForm(f: Form, key?: string): Record<string, unknown> {
  return {
    ...(key ? { key } : {}),
    name: f.name, type: f.type, spec_line: f.spec_line, description: f.description, inside_info: f.inside_info, crew_line: f.crew_line,
    highlights: lines(f.highlights), water_toys: lines(f.water_toys),
    accommodation: lines(f.accommodation).map((l) => { const [a, ...rest] = l.split(/\s*[·|:]\s*/); return [a, rest.join(" · ")]; }),
    distinctions: lines(f.distinctions),
    main_url: f.main_url, extra_urls: f.extra_urls, brochure_url: f.brochure_url, video_url: f.video_url, notes: f.notes, sanity_slug: f.sanity_slug,
    source: "manual",
  };
}

export default function DossierEditor({ initial, isNew, siteSlug, canUpload }: { initial: YachtDossier | null; isNew: boolean; siteSlug: string | null; canUpload: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [key, setKey] = useState<string | undefined>(initial?.key);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const set = (p: Partial<Form>) => { setF((o) => ({ ...o, ...p })); setDirty(true); setMsg(null); };

  // A "?site=<slug>" arrival pre-fills from the site once, on first paint.
  const [primed, setPrimed] = useState(false);
  useEffect(() => {
    if (primed) return;
    setPrimed(true);
    if (isNew && siteSlug) void fillFromSite(siteSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primed]);

  async function fillFromSite(slug?: string) {
    const who = slug || f.sanity_slug || f.name;
    if (!who.trim()) { setError("Type the yacht's name first, then I can look her up on the site."); return; }
    setBusy("site"); setError(null);
    try {
      const r = await fetch(`/api/helm/dossiers/${encodeURIComponent(key || who)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "from-site", slug: who }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "could not read the site");
      const d = j.dossier as YachtDossier;
      setF((o) => ({ ...toForm(d), notes: o.notes || "" }));
      setDirty(true);
      setMsg(`Filled from the site page of ${j.matched}. Check it, change what you like, then save.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function save() {
    if (!f.name.trim()) { setError("A yacht needs a name."); return; }
    setBusy("save"); setError(null);
    try {
      const r = await fetch(`/api/helm/dossiers`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossier: fromForm(f, key) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "could not save");
      const saved = j.dossier as YachtDossier;
      setKey(saved.key); setDirty(false);
      setMsg(`Saved. This is how ${saved.name} will be presented from now on.`);
      if (isNew) router.replace(`/dashboard/helm/yachts/${encodeURIComponent(saved.key)}`);
      else router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function upload(file: File, where: "main" | "extra") {
    setBusy("upload"); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch(`/api/helm/dossiers/${encodeURIComponent(key || f.name || "yacht")}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "upload failed");
      if (where === "main") set({ main_url: j.url }); else set({ extra_urls: [...f.extra_urls, j.url].slice(0, 24) });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function remove() {
    if (!key) return;
    if (!window.confirm(`Remove ${f.name} from the Fleet Book? Proposals already sent are not touched.`)) return;
    setBusy("remove");
    try {
      await fetch(`/api/helm/dossiers/${encodeURIComponent(key)}`, { method: "DELETE" });
      router.push("/dashboard/helm/yachts");
    } finally { setBusy(null); }
  }

  const photos = useMemo(() => [f.main_url, ...f.extra_urls].filter(Boolean), [f.main_url, f.extra_urls]);
  const filled = [f.type, f.spec_line, f.description, f.inside_info, f.main_url].filter(Boolean).length;

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>The Fleet Book · {isNew && !key ? "New yacht" : "Folder"}</div>
          <h1 style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 300 }}>{f.name || "A new yacht"}</h1>
          <div style={{ marginTop: 6, fontSize: 12.5, color: "#6B7280" }}>
            {filled}/5 essentials · the name is the only thing required. Write it roughly now, polish it when you have a minute.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/dashboard/helm/yachts" style={ghost}>← The book</Link>
          <button type="button" onClick={() => fillFromSite()} disabled={busy !== null} style={{ ...ghost, cursor: "pointer" }}>
            {busy === "site" ? "Reading the site…" : "Fill from the site"}
          </button>
          <button type="button" onClick={save} disabled={busy !== null} style={{ ...primary, cursor: "pointer", opacity: dirty ? 1 : 0.75 }}>
            {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </header>

      {msg && <div style={{ background: "rgba(58,107,71,0.08)", border: "1px solid rgba(58,107,71,0.35)", padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{msg}</div>}
      {error && <div style={{ background: "rgba(177,74,58,0.08)", border: "1px solid rgba(177,74,58,0.5)", color: "#7f1d1d", padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 28, alignItems: "start" }}>
        {/* ── the form ── */}
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Name" hint="As the client will read it. No M/Y or S/CAT prefix needed.">
            <input value={f.name} onChange={(e) => set({ name: e.target.value })} style={txt} placeholder="EFFIE STAR" />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <Field label="Type">
              <input list="yacht-types" value={f.type} onChange={(e) => set({ type: e.target.value.toUpperCase() })} style={txt} placeholder="MOTOR YACHT" />
              <datalist id="yacht-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <Field label="Spec line" hint="Builder | Built | Length | cabins | guests | crew">
              <input value={f.spec_line} onChange={(e) => set({ spec_line: e.target.value })} style={txt} placeholder="Ferretti | Built 2019 | 24 m | 4 cabins | 8 guests | Crew of 3" />
            </Field>
          </div>
          <Field label="One sentence about her" hint="The line under the photograph. Supplier-true, no superlatives you cannot back.">
            <input value={f.description} onChange={(e) => set({ description: e.target.value })} style={txt} maxLength={400} />
          </Field>
          <Field label="Your Inside Info" hint={`${f.inside_info.length}/240 · your exact words, first person, printed verbatim on every proposal`}>
            <textarea value={f.inside_info} onChange={(e) => set({ inside_info: e.target.value.slice(0, 240) })} rows={3} style={{ ...txt, resize: "vertical", lineHeight: 1.5 }} placeholder="Why this one, who she is right for, the one reason to choose her over the others." />
          </Field>
          <Field label="Crew line" hint="Roles, size, years. Never a name.">
            <input value={f.crew_line} onChange={(e) => set({ crew_line: e.target.value })} style={txt} placeholder="A crew of three: captain, chef and stewardess, together since 2021." />
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Highlights" hint="One per line">
              <textarea value={f.highlights} onChange={(e) => set({ highlights: e.target.value })} rows={5} style={{ ...txt, resize: "vertical" }} />
            </Field>
            <Field label="Water toys" hint="One per line">
              <textarea value={f.water_toys} onChange={(e) => set({ water_toys: e.target.value })} rows={5} style={{ ...txt, resize: "vertical" }} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Accommodation" hint="One cabin per line: Master · king bed, ensuite">
              <textarea value={f.accommodation} onChange={(e) => set({ accommodation: e.target.value })} rows={4} style={{ ...txt, resize: "vertical" }} />
            </Field>
            <Field label="Distinctions" hint="Awards and press, verbatim. One per line.">
              <textarea value={f.distinctions} onChange={(e) => set({ distinctions: e.target.value })} rows={4} style={{ ...txt, resize: "vertical" }} />
            </Field>
          </div>

          <Field label="Photographs" hint="The first is the cover. Up to 24, the first three also print in the PDF. Our own photographs or the site's; never a brochure with another office's name.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {photos.map((u, i) => (
                <div key={u} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" style={{ width: i === 0 ? 132 : 88, height: i === 0 ? 88 : 58, objectFit: "cover", border: i === 0 ? "2px solid #C9A84C" : "1px solid rgba(13,27,42,0.15)" }} />
                  {i > 0 && (
                    <button type="button" title="Make this the cover" onClick={() => set({ main_url: u, extra_urls: [f.main_url, ...f.extra_urls.filter((x) => x !== u)].filter(Boolean) })}
                      style={{ position: "absolute", left: 2, bottom: 2, fontSize: 9, padding: "1px 5px", background: "#fff", border: "1px solid rgba(13,27,42,0.25)", cursor: "pointer" }}>cover</button>
                  )}
                  <button type="button" title="Remove" onClick={() => (i === 0 ? set({ main_url: f.extra_urls[0] ?? "", extra_urls: f.extra_urls.slice(1) }) : set({ extra_urls: f.extra_urls.filter((x) => x !== u) }))}
                    style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, lineHeight: "16px", padding: 0, borderRadius: 9, border: "1px solid rgba(13,27,42,0.25)", background: "#fff", cursor: "pointer", fontSize: 11 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {canUpload && (
                <label style={{ ...chip, cursor: "pointer" }}>
                  {busy === "upload" ? "Uploading…" : "Upload a photograph"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file, f.main_url ? "extra" : "main"); e.target.value = ""; }} />
                </label>
              )}
              <PasteUrl placeholder="…or paste a photo link and press Enter" onAdd={(u) => (f.main_url ? set({ extra_urls: [...f.extra_urls, u].slice(0, 24) }) : set({ main_url: u }))} />
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Brochure (PDF link)" hint="White-label only.">
              <input value={f.brochure_url} onChange={(e) => set({ brochure_url: e.target.value })} style={txt} placeholder="https://…" />
            </Field>
            <Field label="Video link" hint="YouTube, Vimeo or Loom.">
              <input value={f.video_url} onChange={(e) => set({ video_url: e.target.value })} style={txt} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Your private notes" hint="Owner, central agent, quirks, what to remember. Never shown to anyone.">
            <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} style={{ ...txt, resize: "vertical" }} />
          </Field>
          {key && (
            <div style={{ marginTop: 6 }}>
              <button type="button" onClick={remove} disabled={busy !== null} style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                Remove this yacht from the book
              </button>
            </div>
          )}
        </div>

        {/* ── as the client sees it ── */}
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 8 }}>As the client sees it</div>
          <div style={{ background: "#F8F5F0", border: "1px solid rgba(13,27,42,0.12)", padding: 0, overflow: "hidden" }}>
            <div style={{ height: 260, background: "#0D1B2A" }}>
              {f.main_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.main_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#C9A84C", fontSize: 10, letterSpacing: 2 }}>THE COVER PHOTOGRAPH GOES HERE</div>
              )}
            </div>
            {f.extra_urls.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, padding: 3, background: "#0D1B2A" }}>
                {f.extra_urls.slice(0, 3).map((u) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={u} src={u} alt="" style={{ width: "100%", height: 70, objectFit: "cover" }} />
                ))}
              </div>
            )}
            <div style={{ padding: "22px 26px 26px" }}>
              <div style={{ fontSize: 9.5, letterSpacing: 2.5, textTransform: "uppercase", color: "#C9A84C" }}>Our recommendation</div>
              <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 30, fontWeight: 300, color: "#0D1B2A", marginTop: 4, letterSpacing: 1 }}>{f.name || "YACHT"}</div>
              <div style={{ fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: "#6B7280", marginTop: 6 }}>
                {[f.type, f.spec_line].filter(Boolean).join(" · ") || "Type · spec line"}
              </div>
              {f.description && <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#1f2937", margin: "16px 0 0" }}>{f.description}</p>}
              <div style={{ marginTop: 18, borderTop: "1px solid rgba(201,168,76,0.5)", paddingTop: 12 }}>
                <div style={{ fontSize: 9.5, letterSpacing: 2.5, textTransform: "uppercase", color: "#C9A84C" }}>George&apos;s Inside Info</div>
                <p style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 14.5, lineHeight: 1.65, color: "#0D1B2A", margin: "6px 0 0", minHeight: 24 }}>
                  {f.inside_info || "Your words will appear here, exactly as you write them."}
                </p>
              </div>
              {f.crew_line && <p style={{ fontSize: 12.5, color: "#4B5563", margin: "12px 0 0" }}>{f.crew_line}</p>}
              {(lines(f.highlights).length > 0 || lines(f.water_toys).length > 0) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                  {lines(f.highlights).slice(0, 6).map((h) => <span key={h} style={tag}>{h}</span>)}
                  {lines(f.water_toys).slice(0, 6).map((h) => <span key={h} style={{ ...tag, borderColor: "rgba(13,27,42,0.15)", color: "#6B7280" }}>{h}</span>)}
                </div>
              )}
              <div style={{ marginTop: 18, fontSize: 11, color: "#9CA3AF" }}>
                Price, dates and ports come from the supplier&apos;s email of each request; they are never kept here.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 600 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "#9CA3AF", margin: "2px 0 5px" }}>{hint}</div>}
      {!hint && <div style={{ height: 5 }} />}
      {children}
    </label>
  );
}

function PasteUrl({ placeholder, onAdd }: { placeholder: string; onAdd: (u: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { const u = v.trim(); if (/^https?:\/\//.test(u)) { onAdd(u); setV(""); } };
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} onBlur={go}
      placeholder={placeholder} style={{ ...txt, width: 320 }} />
  );
}

const txt: React.CSSProperties = { width: "100%", padding: 8, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13.5, fontFamily: "inherit", background: "#fff" };
const ghost: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.25)", padding: "9px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", textDecoration: "none", display: "inline-block" };
const primary: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", textDecoration: "none", display: "inline-block" };
const chip: React.CSSProperties = { background: "rgba(201,168,76,0.12)", color: "#0D1B2A", border: "1px solid #C9A84C", padding: "6px 12px", fontSize: 12 };
const tag: React.CSSProperties = { fontSize: 10.5, padding: "3px 8px", border: "1px solid rgba(201,168,76,0.6)", color: "#0D1B2A", borderRadius: 2 };
