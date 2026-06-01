"use client";

// The Helm — per-request media (vessel photos + brochure), hosted on
// Cloudinary. George never visits Cloudinary: uploads go through the
// admin-gated /upload-media route. Falls back to paste-a-link when
// Cloudinary is not connected. Photos embed into the proposal PDF;
// the brochure becomes a "View full brochure" button.

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Photo = { url: string; source: "upload" | "link"; caption?: string };

export default function HelmMedia({
  requestId, initialPhotos, initialBrochureUrl, cloudinaryConfigured,
}: {
  requestId: string;
  initialPhotos: Photo[];
  initialBrochureUrl: string | null;
  cloudinaryConfigured: boolean;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos || []);
  const [brochure, setBrochure] = useState<string | null>(initialBrochureUrl);
  const [photoLink, setPhotoLink] = useState("");
  const [brochureLink, setBrochureLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const brochureInput = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File, kind: "photo" | "brochure") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const r = await fetch(`/api/helm/${requestId}/upload-media`, { method: "POST", body: fd });
    return r.json();
  }

  async function onPickFiles(files: FileList | null, kind: "photo" | "brochure") {
    if (!files || !files.length) return;
    setBusy(true); setMsg(null); setWarn(null);
    try {
      for (const file of Array.from(files)) {
        const j = await uploadFile(file, kind);
        if (j.configured === false) { setMsg(j.message); break; }
        if (j.error) { setMsg(j.error); break; }
        if (kind === "brochure" && j.url) setBrochure(j.url);
        if (kind === "photo" && j.vessel_photos) setPhotos(j.vessel_photos);
      }
      router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally {
      setBusy(false);
      if (photoInput.current) photoInput.current.value = "";
      if (brochureInput.current) brochureInput.current.value = "";
    }
  }

  async function action(body: Record<string, unknown>) {
    setBusy(true); setMsg(null); setWarn(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/upload-media`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.error) { setMsg(j.error); return; }
      if (j.vessel_photos) setPhotos(j.vessel_photos);
      if ("brochure_url" in j) setBrochure(j.brochure_url);
      if (j.warning) setWarn(j.warning);
      if (j.note) setWarn(j.note);
      router.refresh();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Media — vessel photos &amp; brochure</div>

      {!cloudinaryConfigured && (
        <div style={warnBox}>
          Cloudinary is not connected yet (add <b>CLOUDINARY_URL</b> on Vercel). Uploads are disabled; you can still paste image / brochure links below.
        </div>
      )}

      {/* photos */}
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 6 }}>Vessel photos</div>
      {photos.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {photos.map((p) => (
            <div key={p.url} style={{ position: "relative", width: 96, height: 64 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" style={{ width: 96, height: 64, objectFit: "cover", borderRadius: 2, border: "1px solid rgba(13,27,42,0.12)" }} />
              <button type="button" onClick={() => action({ action: "remove-photo", url: p.url })} disabled={busy}
                title="Remove" style={{ position: "absolute", top: -8, right: -8, width: 20, height: 20, borderRadius: 10, border: "1px solid #b91c1c", background: "#fff", color: "#b91c1c", cursor: "pointer", fontSize: 12, lineHeight: "18px" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input ref={photoInput} type="file" accept="image/*" multiple disabled={!cloudinaryConfigured || busy}
          onChange={(e) => onPickFiles(e.target.files, "photo")} style={{ fontSize: 12 }} />
        <span style={{ color: "#9CA3AF", fontSize: 12 }}>or paste image link:</span>
        <input value={photoLink} onChange={(e) => setPhotoLink(e.target.value)} placeholder="https://..." style={linkInput} />
        <button type="button" disabled={busy || !photoLink.trim()} onClick={() => { action({ action: "add-photo-link", url: photoLink.trim() }); setPhotoLink(""); }} style={miniBtn}>Add link</button>
      </div>

      {/* brochure */}
      <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", marginBottom: 6 }}>Brochure (PDF or link)</div>
      {brochure && (
        <div style={{ fontSize: 12.5, marginBottom: 8 }}>
          <a href={brochure} target="_blank" rel="noreferrer" style={{ color: "#0D1B2A" }}>Current brochure ↗</a>
          <button type="button" onClick={() => action({ action: "remove-brochure" })} disabled={busy} style={{ ...miniBtn, marginLeft: 8, color: "#b91c1c", borderColor: "rgba(185,28,28,0.4)" }}>Remove</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input ref={brochureInput} type="file" accept="application/pdf" disabled={!cloudinaryConfigured || busy}
          onChange={(e) => onPickFiles(e.target.files, "brochure")} style={{ fontSize: 12 }} />
        <span style={{ color: "#9CA3AF", fontSize: 12 }}>or paste link:</span>
        <input value={brochureLink} onChange={(e) => setBrochureLink(e.target.value)} placeholder="https://georgeyachts.com/..." style={linkInput} />
        <button type="button" disabled={busy || !brochureLink.trim()} onClick={() => { action({ action: "add-brochure-link", url: brochureLink.trim() }); setBrochureLink(""); }} style={miniBtn}>Add link</button>
      </div>

      {warn && <p style={{ color: "#7c4a03", fontSize: 12, marginTop: 10 }}>{warn}</p>}
      {msg && <p style={{ color: "#b91c1c", fontSize: 12, marginTop: 10 }}>{msg}</p>}
      {busy && <p style={{ color: "#6b7280", fontSize: 12, marginTop: 8 }}>Working…</p>}
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const warnBox: React.CSSProperties = { background: "rgba(176,122,44,0.08)", border: "1px solid rgba(176,122,44,0.4)", color: "#7c4a03", padding: "8px 12px", marginBottom: 12, fontSize: 12.5 };
const linkInput: React.CSSProperties = { padding: 7, border: "1px solid rgba(13,27,42,0.15)", fontSize: 12.5, fontFamily: "inherit", minWidth: 220 };
const miniBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.25)", padding: "6px 12px", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer" };
