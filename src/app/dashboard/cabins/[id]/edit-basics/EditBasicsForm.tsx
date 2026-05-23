"use client";

// Edit-mode twin of /dashboard/cabins/new.
// Same look & feel (full-viewport navy/gold overlay over the matrix
// dashboard chrome) so the form reads calmly. PATCHes /api/cabins/:id
// with a clean payload — empty strings become explicit null so a
// field can be CLEARED, not just overwritten. Numeric fields are
// parsed to numbers or null. After save → back to the cabin detail.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BerthPicker from "./BerthPicker";

type FormState = {
  vessel_name: string;
  vessel_make_model: string;
  vessel_length: string;
  vessel_capacity: string;
  homeport: string;
  myba_contract_number: string;
  charter_period_from: string;
  charter_period_to: string;
  port_embarkation: string;
  port_disembarkation: string;
  cruising_area: string;
  principal_charterer_name: string;
  principal_charterer_email: string;
  principal_charterer_mobile: string;
  captain_name_internal: string;
  chef_name_internal: string;
  hostess_name_internal: string;
  charter_fee_eur: string;
  apa_eur: string;
  // 2026-05-23 — Berth Map Phase 1.
  berth_label: string;
  berth_lat: string;
  berth_lng: string;
};

const CRUISING_AREAS = ["Cyclades", "Saronic", "Ionian", "Sporades", "Dodecanese", "Northern Greece", "Mixed", "Other"];

interface NearbyState {
  fetched_at: string | null;
  error: string | null;
  summary: string | null;
}

export default function EditBasicsForm({
  cabinId,
  initial,
  nearbyState,
}: {
  cabinId: string;
  initial: FormState;
  nearbyState?: NearbyState;
}) {
  const router = useRouter();
  const [nearby, setNearby] = useState<NearbyState>(
    nearbyState ?? { fetched_at: null, error: null, summary: null },
  );
  const [refreshingNearby, setRefreshingNearby] = useState(false);

  async function refreshNearby() {
    setRefreshingNearby(true);
    try {
      const r = await fetch(`/api/cabins/${cabinId}/refresh-nearby`, {
        method: "POST",
      });
      const j = await r.json();
      if (!r.ok) {
        setNearby((n) => ({
          ...n,
          error: j.error || `HTTP ${r.status}`,
          fetched_at: new Date().toISOString(),
        }));
        return;
      }
      // Server-side has already updated the DB. Reload page-level
      // data so the summary one-liner reflects the new counts.
      router.refresh();
      setNearby((n) => ({
        ...n,
        error: j.partial ? (j.errors || []).join("; ") : null,
        fetched_at: new Date().toISOString(),
      }));
    } catch (e) {
      setNearby((n) => ({
        ...n,
        error: (e as Error).message,
        fetched_at: new Date().toISOString(),
      }));
    } finally {
      setRefreshingNearby(false);
    }
  }

  useEffect(() => {
    document.body.classList.add("cabin-form-mode");
    return () => document.body.classList.remove("cabin-form-mode");
  }, []);

  const [form, setForm] = useState<FormState>(initial);
  const [showInternal, setShowInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeMsg, setGeocodeMsg] = useState<string | null>(null);

  // 2026-05-23 — Free geocoding via OpenStreetMap Nominatim.
  // Smart fallback: pier/dock granularity isn't in OSM for most
  // Greek marinas, so we try a sequence of progressively-simpler
  // queries. Whichever one returns first wins. The user then
  // refines the exact pier by CLICKING the map below.
  async function nominatimSearch(q: string) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "Accept-Language": "en" } },
      );
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length > 0) return arr[0];
    } catch {
      /* fall through */
    }
    return null;
  }

  function buildFallbackQueries(label: string): string[] {
    const trimmed = label.trim();
    if (!trimmed) return [];
    const queries: string[] = [trimmed];

    // Strip trailing pier/dock/berth/wharf references — they
    // confuse Nominatim and aren't queryable anyway.
    const stripped = trimmed.replace(
      /[,·\s]+(pier|dock|berth|wharf|quay|jetty)\s*[\dA-Z]*\.?$/i,
      "",
    );
    if (stripped !== trimmed && stripped) queries.push(stripped);

    // Try just the first two comma-separated chunks (e.g.
    // "Alimos Marina, Athens"). Most marinas in Greece are
    // resolvable at city level.
    const chunks = stripped.split(",").map((s) => s.trim()).filter(Boolean);
    if (chunks.length >= 2) {
      const firstTwo = `${chunks[0]}, ${chunks[1]}`;
      if (!queries.includes(firstTwo)) queries.push(firstTwo);
    }
    // Finally, just the first chunk + "Greece" as last resort.
    if (chunks.length >= 1) {
      const firstAndGreece = `${chunks[0]}, Greece`;
      if (!queries.includes(firstAndGreece)) queries.push(firstAndGreece);
    }
    return queries;
  }

  async function geocodeFromLabel() {
    const q = form.berth_label.trim();
    if (!q) {
      setGeocodeMsg("Type a berth label first (e.g. 'Alimos Marina Pier 6').");
      return;
    }
    setGeocoding(true);
    setGeocodeMsg(null);
    const queries = buildFallbackQueries(q);
    let hit: { lat?: string; lon?: string; display_name?: string } | null = null;
    let used = "";
    for (const tryQuery of queries) {
      hit = await nominatimSearch(tryQuery);
      if (hit) {
        used = tryQuery;
        break;
      }
    }
    setGeocoding(false);

    if (!hit) {
      setGeocodeMsg(
        "Couldn't find a match. Click on the map below at the exact berth — that sets the pin directly.",
      );
      return;
    }
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setForm((f) => ({
        ...f,
        berth_lat: lat.toFixed(6),
        berth_lng: lng.toFixed(6),
      }));
      const wasFallback = used !== q;
      setGeocodeMsg(
        wasFallback
          ? `Pinned approximate location via "${used}" — drag the pin or click on the map for exact pier.`
          : `Pinned · ${hit.display_name?.slice(0, 80) || ""}`,
      );
    } else {
      setGeocodeMsg("Couldn't parse that location.");
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): string | null {
    if (!form.vessel_name.trim()) return "Vessel name is required.";
    if (!form.charter_period_from) return "Charter start date is required.";
    if (!form.charter_period_to) return "Charter end date is required.";
    if (form.charter_period_to < form.charter_period_from)
      return "End date must be after start date.";
    if (!form.principal_charterer_name.trim()) return "Principal charterer name is required.";
    // Email is intentionally NOT editable from this form — changing the
    // principal's email mid-cabin is a separate operation (auth identity
    // moves with it). If George needs to fix it, delete + recreate.
    if (form.charter_fee_eur && Number.isNaN(Number(form.charter_fee_eur)))
      return "Charter fee must be a number.";
    if (form.apa_eur && Number.isNaN(Number(form.apa_eur))) return "APA must be a number.";
    if (form.vessel_capacity && Number.isNaN(Number(form.vessel_capacity)))
      return "Capacity must be a number.";
    return null;
  }

  // For text fields: trimmed string OR null (so blanking actually wipes
  // the DB column, unlike the create form which omits empty fields).
  function strOrNull(v: string): string | null {
    const t = v.trim();
    return t === "" ? null : t;
  }
  function numOrNull(v: string): number | null {
    if (!v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // Latitude must be in [-90, 90], longitude in [-180, 180]. Bad
  // input is rejected silently → null → DB column cleared.
  function latOrNull(v: string): number | null {
    const n = numOrNull(v);
    return n != null && n >= -90 && n <= 90 ? n : null;
  }
  function lngOrNull(v: string): number | null {
    const n = numOrNull(v);
    return n != null && n >= -180 && n <= 180 ? n : null;
  }

  function buildPayload(): Record<string, unknown> {
    return {
      vessel_name: form.vessel_name.trim(),
      vessel_make_model: strOrNull(form.vessel_make_model),
      vessel_length: strOrNull(form.vessel_length),
      vessel_capacity: numOrNull(form.vessel_capacity),
      homeport: strOrNull(form.homeport),
      myba_contract_number: strOrNull(form.myba_contract_number),
      charter_period_from: form.charter_period_from,
      charter_period_to: form.charter_period_to,
      port_embarkation: strOrNull(form.port_embarkation),
      port_disembarkation: strOrNull(form.port_disembarkation),
      cruising_area: strOrNull(form.cruising_area),
      principal_charterer_name: form.principal_charterer_name.trim(),
      principal_charterer_mobile: strOrNull(form.principal_charterer_mobile),
      captain_name_internal: strOrNull(form.captain_name_internal),
      chef_name_internal: strOrNull(form.chef_name_internal),
      hostess_name_internal: strOrNull(form.hostess_name_internal),
      charter_fee_eur: numOrNull(form.charter_fee_eur),
      apa_eur: numOrNull(form.apa_eur),
      // 2026-05-23 — Berth Map fields. lat/lng must validate as
      // finite numbers in the realistic earth range; otherwise sent
      // as null so a bad paste doesn't corrupt the DB.
      berth_label: strOrNull(form.berth_label),
      berth_lat: latOrNull(form.berth_lat),
      berth_lng: lngOrNull(form.berth_lng),
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/cabins/${cabinId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setMsg("✓ Saved. Redirecting to the cabin…");
      // Small delay so George sees the confirmation flash.
      setTimeout(() => {
        router.push(`/dashboard/cabins/${cabinId}`);
        router.refresh();
      }, 600);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "#F8F5F0",
        color: "#0D1B2A",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <style>{`
        body.cabin-form-mode .crt-overlay,
        body.cabin-form-mode .scan-beam {
          display: none !important;
        }
        .cabin-form-close {
          position: fixed;
          top: 14px;
          right: 14px;
          z-index: 1001;
          background: #0D1B2A;
          color: #F8F5F0;
          border: 1px solid #C9A84C;
          width: 40px;
          height: 40px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: Georgia, serif;
        }
        .cabin-form-close:hover { background: #142233; }

        .cabin-form,
        .cabin-form * { color: #0D1B2A !important; }
        .cabin-form h1 em,
        .cabin-form em,
        .cabin-form .label-text,
        .cabin-form label > span,
        .cabin-form .req,
        .cabin-form .lede-eyebrow,
        .cabin-form summary { color: #C9A84C !important; }
        .cabin-form .req::after { color: #C9A84C !important; }
        .cabin-form input::placeholder,
        .cabin-form textarea::placeholder {
          color: rgba(13,27,42,0.35) !important;
          opacity: 1;
        }
        .cabin-form input,
        .cabin-form select,
        .cabin-form textarea {
          background: #FFFFFF !important;
          color: #0D1B2A !important;
          border: 1px solid rgba(13,27,42,0.18) !important;
          box-shadow: none !important;
        }
        .cabin-form input:focus,
        .cabin-form select:focus,
        .cabin-form textarea:focus {
          border-color: #C9A84C !important;
          outline: none !important;
        }
        .cabin-form .eyebrow { color: #C9A84C !important; }
        .cabin-form .lede,
        .cabin-form .field-hint { color: rgba(13,27,42,0.6) !important; }
        .cabin-form .primary {
          background: #0D1B2A !important;
          color: #F8F5F0 !important;
        }
        .cabin-form .primary:hover:not(:disabled) { background: #142233 !important; }
        .cabin-form .section { background: #FFFFFF !important; }

        .cabin-form *:not(svg):not(path) {
          font-family: Georgia, "Times New Roman", serif;
        }
        .cabin-form label > span,
        .cabin-form .label-text {
          font-family: -apple-system, "Helvetica Neue", Arial, sans-serif !important;
          font-size: 10.5px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #C9A84C;
          font-weight: 500;
          display: block;
          margin-bottom: 6px;
        }
        .cabin-form input,
        .cabin-form select,
        .cabin-form textarea {
          width: 100%;
          padding: 11px 12px;
          font-size: 15px;
          font-family: Georgia, serif;
          outline: none;
          transition: border-color 160ms ease;
          border-radius: 0;
        }
        .cabin-form .req::after { content: " ●"; color: #C9A84C; font-size: 10px; vertical-align: super; }
        .cabin-form .field-hint {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 12px;
          margin: 4px 0 0 0;
        }
        .cabin-form .section {
          border: 1px solid rgba(13,27,42,0.08);
          padding: 24px;
          margin-bottom: 16px;
        }
        .cabin-form .section h2 {
          font-family: Georgia, serif;
          font-size: 20px;
          font-weight: 300;
          margin: 0 0 6px;
        }
        .cabin-form .section .lede {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 13.5px;
          margin: 0 0 20px 0;
        }
        .cabin-form .grid2 { display: grid; grid-template-columns: 1fr; gap: 18px; }
        @media (min-width: 720px) {
          .cabin-form .grid2 { grid-template-columns: 1fr 1fr; }
        }
        .cabin-form .toggle {
          background: transparent;
          border: 1px solid rgba(13,27,42,0.18);
          padding: 10px 18px;
          font-family: -apple-system, sans-serif;
          font-size: 10.5px;
          letter-spacing: 2px;
          text-transform: uppercase;
          cursor: pointer;
          width: 100%;
          text-align: left;
        }
        .cabin-form .toggle:hover { border-color: #C9A84C; }
        .cabin-form .primary {
          border: 1px solid #C9A84C;
          padding: 14px 32px;
          font-family: -apple-system, sans-serif;
          font-size: 11px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          cursor: pointer;
        }
        .cabin-form .primary:disabled { opacity: 0.6; cursor: default; }
        .cabin-form .ghost {
          background: transparent;
          border: 1px solid rgba(13,27,42,0.18);
          padding: 14px 28px;
          font-family: -apple-system, sans-serif;
          font-size: 11px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          cursor: pointer;
        }
        .cabin-form .err {
          background: #FEF2F2;
          border: 1px solid #FCA5A5;
          color: #991B1B !important;
          padding: 12px 16px;
          font-family: Georgia, serif;
          font-style: italic;
          margin: 16px 0 0;
        }
        .cabin-form .ok {
          background: #ECFDF5;
          border: 1px solid #A7F3D0;
          color: #065F46 !important;
          padding: 12px 16px;
          font-family: Georgia, serif;
          font-style: italic;
          margin: 16px 0 0;
        }
      `}</style>

      <button
        type="button"
        className="cabin-form-close"
        aria-label="Close without saving"
        onClick={() => router.push(`/dashboard/cabins/${cabinId}`)}
      >
        ×
      </button>

      <div className="cabin-form" style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px 80px" }}>
        <header style={{ borderBottom: "1px solid rgba(201,168,76,0.4)", paddingBottom: 20, marginBottom: 28 }}>
          <div className="eyebrow" style={{ fontFamily: "-apple-system, sans-serif", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", fontWeight: 500 }}>
            The Cabin · Admin
          </div>
          <h1 style={{ margin: "8px 0 4px", fontSize: 32, fontWeight: 300, fontFamily: "Georgia, serif" }}>
            Edit <em style={{ color: "#C9A84C", fontStyle: "italic" }}>cabin details</em>
          </h1>
          <p style={{ margin: 0, fontStyle: "italic", color: "rgba(13,27,42,0.6)", fontSize: 14, fontFamily: "Georgia, serif" }}>
            Vessel, charter window, ports, principal charterer, internal ops. Email is
            locked — to change the principal’s email, delete and recreate the cabin so
            the magic-link identity follows correctly.
          </p>
        </header>

        <form onSubmit={submit}>
          {/* ────── Vessel ────── */}
          <div className="section">
            <h2>The vessel</h2>
            <p className="lede">What your client sees on the home screen of their Cabin.</p>
            <div className="grid2">
              <label>
                <span className="req">Vessel name</span>
                <input type="text" value={form.vessel_name}
                  onChange={(e) => set("vessel_name", e.target.value)}
                  placeholder="M/Y Alena" required />
              </label>
              <label>
                <span>Make / model</span>
                <input type="text" value={form.vessel_make_model}
                  onChange={(e) => set("vessel_make_model", e.target.value)}
                  placeholder="Sunreef 50 Power" />
              </label>
              <label>
                <span>Length</span>
                <input type="text" value={form.vessel_length}
                  onChange={(e) => set("vessel_length", e.target.value)}
                  placeholder="51 ft" />
              </label>
              <label>
                <span>Capacity (guests)</span>
                <input type="number" inputMode="numeric" value={form.vessel_capacity}
                  onChange={(e) => set("vessel_capacity", e.target.value)}
                  placeholder="10" min="1" max="50" />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Homeport</span>
                <input type="text" value={form.homeport}
                  onChange={(e) => set("homeport", e.target.value)}
                  placeholder="Piraeus · Alimos · Lavrio …" />
              </label>
            </div>
          </div>

          {/* ────── Berth & map (2026-05-23) ────── */}
          <div className="section">
            <h2>Berth &amp; map</h2>
            <p className="lede">
              The exact berth shown on the customer&apos;s cabin home.
              Type the marina + pier, hit &ldquo;Find&rdquo;, and we look
              up the coordinates from OpenStreetMap (free, no key).
              Leave everything blank to hide the map block entirely.
            </p>
            <div className="grid2">
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Berth label</span>
                <input
                  type="text"
                  value={form.berth_label}
                  onChange={(e) => set("berth_label", e.target.value)}
                  placeholder="Alimos Marina · Pier 6"
                />
              </label>
              <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#4b5563" }}>
                  Customer sees this map preview on /cabin home with the
                  pin at the coordinates below + a quiet legal footnote
                  about possible port-authority changes.
                </span>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={geocodeFromLabel}
                    disabled={geocoding || !form.berth_label.trim()}
                    style={{
                      background: "#C9A84C",
                      color: "#0D1B2A",
                      border: 0,
                      padding: "8px 16px",
                      fontSize: 10.5,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      cursor: geocoding ? "wait" : "pointer",
                      fontFamily: "inherit",
                      opacity: geocoding || !form.berth_label.trim() ? 0.55 : 1,
                    }}
                  >
                    {geocoding ? "Looking up…" : "↗ Find on OpenStreetMap"}
                  </button>
                  {geocodeMsg && (
                    <span style={{ fontSize: 12, color: "#4b5563", fontStyle: "italic" }}>
                      {geocodeMsg}
                    </span>
                  )}
                </div>
              </label>
              <label>
                <span>Latitude</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.berth_lat}
                  onChange={(e) => set("berth_lat", e.target.value)}
                  placeholder="37.9215"
                />
              </label>
              <label>
                <span>Longitude</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.berth_lng}
                  onChange={(e) => set("berth_lng", e.target.value)}
                  placeholder="23.7044"
                />
              </label>
              {/* 2026-05-23 — Click-to-pin map. Solves the
                  pier-precision problem Nominatim can't (OSM
                  doesn't index pier numbers). Click anywhere on
                  the map, the lat/lng inputs above update. */}
              <BerthPicker
                lat={form.berth_lat ? Number(form.berth_lat) : null}
                lng={form.berth_lng ? Number(form.berth_lng) : null}
                onChange={(lat, lng) => {
                  set("berth_lat", lat.toFixed(6));
                  set("berth_lng", lng.toFixed(6));
                }}
              />
              {/* 2026-05-23 — Berth Map Phase 2: nearby info panel.
                  Auto-refreshes when coords change in updateCabin.
                  Manual button below for when George wants to force
                  a re-fetch (e.g. a new ATM opens in the marina). */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  marginTop: 8,
                  padding: "14px 16px",
                  background: "#F7F4EC",
                  border: "1px solid rgba(13, 27, 42, 0.10)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      color: "#1f2937",
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    Around your berth
                  </div>
                  <div style={{ fontSize: 13, color: "#0D1B2A" }}>
                    {nearby.summary || (
                      <span style={{ color: "#6b7280", fontStyle: "italic" }}>
                        Not fetched yet — save berth coords or hit refresh.
                      </span>
                    )}
                  </div>
                  {nearby.fetched_at && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "rgba(13, 27, 42, 0.6)",
                        marginTop: 3,
                      }}
                    >
                      Last refreshed:{" "}
                      {new Date(nearby.fetched_at).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </div>
                  )}
                  {nearby.error && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#b91c1c",
                        marginTop: 3,
                      }}
                    >
                      ⚠ {nearby.error}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={refreshNearby}
                  disabled={
                    refreshingNearby ||
                    !form.berth_lat ||
                    !form.berth_lng
                  }
                  style={{
                    padding: "8px 14px",
                    background: refreshingNearby ? "#9ca3af" : "#0D1B2A",
                    color: "#F8F5F0",
                    border: "1px solid #0D1B2A",
                    borderRadius: 3,
                    fontSize: 11,
                    letterSpacing: 1.6,
                    textTransform: "uppercase",
                    cursor:
                      refreshingNearby ||
                      !form.berth_lat ||
                      !form.berth_lng
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 600,
                    opacity:
                      !form.berth_lat || !form.berth_lng ? 0.45 : 1,
                    whiteSpace: "nowrap",
                  }}
                  title={
                    !form.berth_lat || !form.berth_lng
                      ? "Set berth coordinates first"
                      : "Refresh nearby info from OpenStreetMap + OSRM"
                  }
                >
                  {refreshingNearby ? "Refreshing…" : "Refresh nearby"}
                </button>
              </div>
            </div>
          </div>

          {/* ────── Charter window ────── */}
          <div className="section">
            <h2>Charter window</h2>
            <p className="lede">When and where. Empty a field to wipe it.</p>
            <div className="grid2">
              <label>
                <span className="req">From</span>
                <input type="date" value={form.charter_period_from}
                  onChange={(e) => set("charter_period_from", e.target.value)} required />
              </label>
              <label>
                <span className="req">To</span>
                <input type="date" value={form.charter_period_to}
                  onChange={(e) => set("charter_period_to", e.target.value)}
                  min={form.charter_period_from || undefined} required />
              </label>
              <label>
                <span>Embarkation port</span>
                <input type="text" value={form.port_embarkation}
                  onChange={(e) => set("port_embarkation", e.target.value)}
                  placeholder="Piraeus · Alimos · Lavrio …" />
              </label>
              <label>
                <span>Disembarkation port</span>
                <input type="text" value={form.port_disembarkation}
                  onChange={(e) => set("port_disembarkation", e.target.value)}
                  placeholder="Mykonos · Athens · Paros …" />
              </label>
              <label>
                <span>Cruising area</span>
                <select value={form.cruising_area}
                  onChange={(e) => set("cruising_area", e.target.value)}>
                  <option value="">— choose —</option>
                  {CRUISING_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label>
                <span>MYBA contract #</span>
                <input type="text" value={form.myba_contract_number}
                  onChange={(e) => set("myba_contract_number", e.target.value)}
                  placeholder="MYBA-2027-0001" />
              </label>
            </div>
          </div>

          {/* ────── Principal charterer ────── */}
          <div className="section">
            <h2>Principal charterer</h2>
            <p className="lede">Name + mobile editable. Email is locked.</p>
            <div className="grid2">
              <label style={{ gridColumn: "1 / -1" }}>
                <span className="req">Full name</span>
                <input type="text" value={form.principal_charterer_name}
                  onChange={(e) => set("principal_charterer_name", e.target.value)}
                  autoComplete="name" required />
              </label>
              <label>
                <span>Email (locked)</span>
                <input type="email" value={form.principal_charterer_email}
                  readOnly
                  onChange={() => { /* locked */ }}
                  style={{ opacity: 0.55, cursor: "not-allowed", background: "rgba(13,27,42,0.04)" }} />
                <p className="field-hint">Magic-link identity. Recreate the cabin to change.</p>
              </label>
              <label>
                <span>Mobile</span>
                <input type="tel" value={form.principal_charterer_mobile}
                  onChange={(e) => set("principal_charterer_mobile", e.target.value)}
                  placeholder="+30 6970 380 999" inputMode="tel" />
              </label>
            </div>
          </div>

          {/* ────── Internal ops (collapsed) ────── */}
          <div className="section" style={{ padding: showInternal ? 24 : 0 }}>
            <button
              type="button"
              onClick={() => setShowInternal((v) => !v)}
              className="toggle"
              style={{ width: "100%", padding: showInternal ? "0 0 14px" : "16px 24px", borderBottom: showInternal ? "1px solid rgba(13,27,42,0.08)" : "none", border: showInternal ? "none" : "1px solid rgba(13,27,42,0.18)" }}
            >
              {showInternal ? "− Hide" : "+ Show"} internal · operations (optional)
            </button>
            {showInternal && (
              <div className="grid2" style={{ marginTop: 18 }}>
                <label>
                  <span>Captain</span>
                  <input type="text" value={form.captain_name_internal} onChange={(e) => set("captain_name_internal", e.target.value)} />
                </label>
                <label>
                  <span>Chef</span>
                  <input type="text" value={form.chef_name_internal} onChange={(e) => set("chef_name_internal", e.target.value)} />
                </label>
                <label>
                  <span>Hostess</span>
                  <input type="text" value={form.hostess_name_internal} onChange={(e) => set("hostess_name_internal", e.target.value)} />
                </label>
                <label>
                  <span>Charter fee (€)</span>
                  <input type="number" inputMode="decimal" value={form.charter_fee_eur} onChange={(e) => set("charter_fee_eur", e.target.value)} min="0" />
                </label>
                <label>
                  <span>APA (€)</span>
                  <input type="number" inputMode="decimal" value={form.apa_eur} onChange={(e) => set("apa_eur", e.target.value)} min="0" />
                </label>
                <p className="field-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
                  NEVER shown to the client. Operator-only print sheet.
                </p>
              </div>
            )}
          </div>

          {error && <p className="err" role="alert">{error}</p>}
          {msg && <p className="ok" role="status">{msg}</p>}

          <div style={{ display: "flex", gap: 14, marginTop: 24, flexWrap: "wrap" }}>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => router.push(`/dashboard/cabins/${cabinId}`)}
            >
              Cancel
            </button>
          </div>
          <p className="field-hint" style={{ marginTop: 14 }}>
            Changes save instantly to the database. The client view at
            <code style={{ background: "rgba(13,27,42,0.05)", padding: "2px 6px", margin: "0 4px" }}>georgeyachts.com/cabin</code>
            updates on next page load.
          </p>
        </form>
      </div>
    </div>
  );
}
