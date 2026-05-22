"use client";

// Tabular editor for the cabin guests manifest. Mirrors the look
// of new-cabin and edit-basics (navy/gold/ivory overlay) so George
// reads the form calmly. Each row is one guest. Empty rows are
// dropped on save. The first row is pre-seeded from the cabin's
// principal_charterer fields so George rarely has to retype it.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressPassportForUpload } from "@/lib/passport-compress";

type Guest = {
  full_name: string;
  date_of_birth: string;
  nationality: string;
  passport_number: string;
  passport_expiry: string;
  is_minor: boolean;
  email: string;
  mobile: string;
  cabin_pairing: string;
  shoe_size: string;
  allergies_dietary: string;
  allergies_severity: string;
  emergency_note: string;
};

const EMPTY_GUEST: Guest = {
  full_name: "",
  date_of_birth: "",
  nationality: "",
  passport_number: "",
  passport_expiry: "",
  is_minor: false,
  email: "",
  mobile: "",
  cabin_pairing: "",
  shoe_size: "",
  allergies_dietary: "",
  allergies_severity: "",
  emergency_note: "",
};

function normaliseInitial(
  rows: Array<Record<string, unknown>>,
  principal: { full_name: string; email: string; mobile: string },
): Guest[] {
  // Existing manifest rows take priority. If none exist, seed row
  // one with the principal charterer's contact info.
  if (rows.length > 0) {
    return rows.map((r) => ({
      full_name: (r.full_name as string) || "",
      date_of_birth: (r.date_of_birth as string) || "",
      nationality: (r.nationality as string) || "",
      passport_number: (r.passport_number as string) || "",
      passport_expiry: (r.passport_expiry as string) || "",
      is_minor: Boolean(r.is_minor),
      email: (r.email as string) || "",
      mobile: (r.mobile as string) || "",
      cabin_pairing: (r.cabin_pairing as string) || "",
      shoe_size: (r.shoe_size as string) || "",
      allergies_dietary: (r.allergies_dietary as string) || "",
      allergies_severity: (r.allergies_severity as string) || "",
      emergency_note: (r.emergency_note as string) || "",
    }));
  }
  return [
    {
      ...EMPTY_GUEST,
      full_name: principal.full_name,
      email: principal.email,
      mobile: principal.mobile,
    },
    { ...EMPTY_GUEST },
  ];
}

export default function ManifestForm({
  cabinId,
  cabinLabel,
  principalCharterer,
  initial,
}: {
  cabinId: string;
  cabinLabel: string;
  principalCharterer: { full_name: string; email: string; mobile: string };
  initial: Array<Record<string, unknown>>;
}) {
  const router = useRouter();

  useEffect(() => {
    document.body.classList.add("cabin-form-mode");
    return () => document.body.classList.remove("cabin-form-mode");
  }, []);

  const [guests, setGuests] = useState<Guest[]>(() =>
    normaliseInitial(initial, principalCharterer),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function update<K extends keyof Guest>(i: number, key: K, value: Guest[K]) {
    setGuests((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  }
  function addRow() {
    setGuests((rows) => [...rows, { ...EMPTY_GUEST }]);
  }
  function removeRow(i: number) {
    setGuests((rows) => rows.filter((_, j) => j !== i));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      // Drop rows where the user added then never typed a name.
      // Server does the same filter as defence-in-depth.
      const payload = guests.filter((g) => g.full_name.trim());
      const r = await fetch(`/api/cabins/${cabinId}/manifest`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guests: payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      setMsg({
        ok: true,
        text: `Saved · ${j.count} guest${j.count === 1 ? "" : "s"} on the manifest.`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
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
      }}
    >
      <style>{`
        body.cabin-form-mode .crt-overlay,
        body.cabin-form-mode .scan-beam { display: none !important; }
        .mfx { font-family: Georgia, serif; }
        .mfx,
        .mfx * { color: #0D1B2A !important; }
        .mfx em,
        .mfx .gold,
        .mfx h1 em,
        .mfx h2 em { color: #C9A84C !important; font-style: italic; }
        .mfx label > span {
          display: block;
          font-family: -apple-system, sans-serif !important;
          font-size: 10px;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          color: #C9A84C !important;
          margin-bottom: 4px;
          font-weight: 500;
        }
        .mfx input,
        .mfx select {
          width: 100%;
          background: #fff !important;
          color: #0D1B2A !important;
          border: 1px solid rgba(13,27,42,0.18) !important;
          padding: 8px 10px;
          font-size: 14px;
          font-family: Georgia, serif;
          outline: none;
        }
        .mfx input:focus,
        .mfx select:focus { border-color: #C9A84C !important; }
        .mfx .close {
          position: fixed;
          top: 14px;
          right: 14px;
          z-index: 1001;
          background: #0D1B2A;
          color: #F8F5F0 !important;
          border: 1px solid #C9A84C;
          width: 40px;
          height: 40px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .mfx .row {
          background: #fff;
          border: 1px solid rgba(13,27,42,0.08);
          padding: 16px;
          margin-bottom: 14px;
        }
        .mfx .row-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .mfx .row-num {
          font-family: -apple-system, sans-serif !important;
          font-size: 10px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: #C9A84C !important;
          font-weight: 500;
        }
        .mfx .grid3 {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 720px) {
          .mfx .grid3 { grid-template-columns: 2fr 1fr 1fr; }
          .mfx .grid2 { grid-template-columns: 1fr 1fr; }
        }
        .mfx .grid2 { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .mfx .full { grid-column: 1 / -1; }
        .mfx .minor-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: -apple-system, sans-serif;
          font-size: 12px;
          color: rgba(13,27,42,0.7) !important;
          margin-top: 4px;
        }
        .mfx .remove {
          background: transparent;
          border: 0;
          color: #b91c1c !important;
          font-size: 11px;
          cursor: pointer;
          padding: 0;
        }
        .mfx .primary {
          background: #0D1B2A !important;
          color: #F8F5F0 !important;
          border: 1px solid #C9A84C;
          padding: 12px 28px;
          font-family: -apple-system, sans-serif;
          font-size: 11px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          cursor: pointer;
        }
        .mfx .primary:disabled { opacity: 0.6; }
        .mfx .ghost {
          background: transparent;
          border: 1px solid rgba(13,27,42,0.18);
          padding: 12px 22px;
          font-family: -apple-system, sans-serif;
          font-size: 11px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          cursor: pointer;
        }
      `}</style>

      <button
        type="button"
        className="close"
        aria-label="Back to cabin"
        onClick={() => router.push(`/dashboard/cabins/${cabinId}`)}
      >
        ×
      </button>

      <div className="mfx" style={{ maxWidth: 960, margin: "0 auto", padding: "32px 20px 80px" }}>
        <header
          style={{
            borderBottom: "1px solid rgba(201,168,76,0.4)",
            paddingBottom: 18,
            marginBottom: 24,
          }}
        >
          <div
            className="gold"
            style={{
              fontFamily: "-apple-system, sans-serif",
              fontSize: 10,
              letterSpacing: 3,
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            The Cabin · Guest manifest
          </div>
          <h1
            style={{
              margin: "8px 0 4px",
              fontSize: 30,
              fontWeight: 300,
              fontFamily: "Georgia, serif",
            }}
          >
            Manifest for <em>{cabinLabel}</em>
          </h1>
          <p
            style={{
              margin: 0,
              fontStyle: "italic",
              color: "rgba(13,27,42,0.6)",
              fontSize: 14,
              fontFamily: "Georgia, serif",
              maxWidth: 640,
            }}
          >
            Add every guest who will board. The captain files port-authority
            paperwork from this list and the chef tunes provisioning around
            allergies. Add only what you have — incomplete rows still save.
          </p>
        </header>

        {/* 2026-05-21 — Roberto P1 + George: passport extraction for
            the principal. Upload the principal charterer's passport
            PDF / image; we read the bio page (cross-referencing the
            MRZ) and populate row #1's full name, DOB, nationality,
            passport number and expiry. The signature-form name
            ("Patricia R. Stevens") goes onto the cabin's display
            field; the full bundle stays in this manifest for
            marina paperwork and the back-office crew list. */}
        <PassportDropzone
          cabinId={cabinId}
          onApplied={(extracted, manifestPatch) => {
            // Patch row #1 (principal) with what passport extraction
            // returned so George sees the values without a refresh.
            setGuests((prev) => {
              const next = [...prev];
              const r0 = next[0] ?? { ...EMPTY_GUEST };
              next[0] = {
                ...r0,
                full_name: manifestPatch.full_name ?? r0.full_name,
                date_of_birth: manifestPatch.date_of_birth ?? r0.date_of_birth,
                nationality: manifestPatch.nationality ?? r0.nationality,
                passport_number: manifestPatch.passport_number ?? r0.passport_number,
                passport_expiry: manifestPatch.passport_expiry ?? r0.passport_expiry,
                is_minor: manifestPatch.is_minor ?? r0.is_minor,
              };
              return next;
            });
            // Soft refresh so the parent cabin page picks up the
            // patched principal_charterer_name on next nav.
            router.refresh();
          }}
        />

        {guests.map((g, i) => (
          <div key={i} className="row">
            <div className="row-header">
              <span className="row-num">
                {String(i + 1).padStart(2, "0")}
                {i === 0 ? " · Principal charterer" : ""}
              </span>
              {guests.length > 1 && (
                <button type="button" className="remove" onClick={() => removeRow(i)}>
                  × Remove this guest
                </button>
              )}
            </div>

            <div className="grid3" style={{ marginBottom: 12 }}>
              <label>
                <span>Full name</span>
                <input
                  type="text"
                  value={g.full_name}
                  onChange={(e) => update(i, "full_name", e.target.value)}
                  placeholder="As it appears on the passport"
                />
              </label>
              <label>
                <span>Nationality</span>
                <input
                  type="text"
                  value={g.nationality}
                  onChange={(e) => update(i, "nationality", e.target.value)}
                  placeholder="USA, IT, GR…"
                />
              </label>
              <label>
                <span>Date of birth</span>
                <input
                  type="date"
                  value={g.date_of_birth}
                  onChange={(e) => update(i, "date_of_birth", e.target.value)}
                />
              </label>
            </div>

            <div className="grid2" style={{ marginBottom: 12 }}>
              <label>
                <span>Passport number</span>
                <input
                  type="text"
                  value={g.passport_number}
                  onChange={(e) => update(i, "passport_number", e.target.value)}
                />
              </label>
              <label>
                <span>Passport expiry</span>
                <input
                  type="date"
                  value={g.passport_expiry}
                  onChange={(e) => update(i, "passport_expiry", e.target.value)}
                />
              </label>
            </div>

            <div className="grid3" style={{ marginBottom: 12 }}>
              <label>
                <span>Cabin assignment</span>
                <input
                  type="text"
                  value={g.cabin_pairing}
                  onChange={(e) => update(i, "cabin_pairing", e.target.value)}
                  placeholder="Master · Front · Aft Starboard Twin"
                />
              </label>
              {/* 2026-05-22 — Shoe Size re-added at George's request
                  after comparing our brief against the BF Charter
                  Preferences Form: "Cabin Share / Shoe Size — το
                  ξαναβάζεις." Industry sheets capture shoe size so
                  the boat can pre-stage snorkel fins / wakeboard
                  bindings / ski boots that fit each guest before
                  they board. Free-text on purpose: EU "39", US "8",
                  UK "6.5", kid's "12c" — formats vary. */}
              <label>
                <span>Shoe size</span>
                <input
                  type="text"
                  value={g.shoe_size}
                  onChange={(e) => update(i, "shoe_size", e.target.value)}
                  placeholder="EU 42 / US 9"
                />
              </label>
              <label className="minor-row" style={{ alignSelf: "end" }}>
                <input
                  type="checkbox"
                  checked={g.is_minor}
                  onChange={(e) => update(i, "is_minor", e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: 12, color: "rgba(13,27,42,0.7)", letterSpacing: 0.5, textTransform: "none", margin: 0 }}>
                  This guest is a minor
                </span>
              </label>
            </div>

            {i === 0 && (
              <div className="grid2" style={{ marginBottom: 12 }}>
                <label>
                  <span>Mobile</span>
                  <input
                    type="tel"
                    value={g.mobile}
                    onChange={(e) => update(i, "mobile", e.target.value)}
                    placeholder="+30 6970 380 999"
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={g.email}
                    onChange={(e) => update(i, "email", e.target.value)}
                  />
                </label>
              </div>
            )}

            <label>
              <span>Allergies & dietary requirements</span>
              <input
                type="text"
                value={g.allergies_dietary}
                onChange={(e) => update(i, "allergies_dietary", e.target.value)}
                placeholder="Severe peanut allergy · gluten-free · pescatarian · none"
              />
            </label>

            {g.allergies_dietary.trim() && (
              <div className="grid2" style={{ marginTop: 12 }}>
                <label>
                  <span>Severity</span>
                  <select
                    value={g.allergies_severity}
                    onChange={(e) => update(i, "allergies_severity", e.target.value)}
                  >
                    <option value="">— how serious —</option>
                    <option value="life_threatening">Life-threatening (anaphylaxis)</option>
                    <option value="strong_intolerance">Strong intolerance</option>
                    <option value="preference">Preference / mild</option>
                  </select>
                </label>
                <label>
                  <span>Emergency note (medication aboard, action)</span>
                  <input
                    type="text"
                    value={g.emergency_note}
                    onChange={(e) => update(i, "emergency_note", e.target.value)}
                    placeholder="e.g. EpiPen in cabin · Inhaler in luggage"
                  />
                </label>
              </div>
            )}
          </div>
        ))}

        <button type="button" className="ghost" onClick={addRow}>
          + Add another guest
        </button>

        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 26,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button type="button" className="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save manifest"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => router.push(`/dashboard/cabins/${cabinId}`)}
          >
            Cancel
          </button>
          {msg && (
            <span
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: msg.ok ? "italic" : "normal",
                fontSize: 13,
                color: msg.ok ? "#16a34a" : "#b91c1c",
              }}
            >
              {msg.text}
            </span>
          )}
        </div>

        <p
          style={{
            marginTop: 18,
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 12,
            color: "rgba(13,27,42,0.55)",
            maxWidth: 640,
          }}
        >
          Saving replaces the manifest entirely — the previous list is removed
          and the new rows take its place. Audit log records who edited and
          when.
        </p>
      </div>
    </div>
  );
}

// =============================================================
// PassportDropzone — uploads the principal's passport PDF/image
// to the extract-passport endpoint. On success, the server has
// already written the manifest row #1 and patched the cabin's
// display name; the parent component just patches local state so
// George sees the populated row without a refresh.
// =============================================================
function PassportDropzone({
  cabinId,
  onApplied,
}: {
  cabinId: string;
  onApplied: (
    extracted: Record<string, unknown>,
    manifestPatch: {
      full_name?: string | null;
      date_of_birth?: string | null;
      nationality?: string | null;
      passport_number?: string | null;
      passport_expiry?: string | null;
      is_minor?: boolean | null;
    },
  ) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function send(file: File) {
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      // 2026-05-21 — No MIME guard here. The compressor sniffs
      // the file's content (PDF magic, JPEG, PNG, HEIC) and
      // throws a clear human-readable error if it genuinely
      // can't read it. We don't want to second-guess the
      // browser's MIME labelling for 70-year-old clients
      // uploading photos taken on phones.
      const compressed = await compressPassportForUpload(file);
      const fd = new FormData();
      fd.append("file", compressed);
      fd.append("guest_order", "1");
      const r = await fetch(`/api/cabins/${cabinId}/extract-passport`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        throw new Error(j?.error || j?.message || `Failed (${r.status})`);
      }
      const e = j.extracted || {};
      const dob =
        typeof e.date_of_birth === "string" ? e.date_of_birth : null;
      let isMinor: boolean | null = null;
      if (dob) {
        const dobMs = Date.parse(dob);
        if (!Number.isNaN(dobMs)) {
          const years =
            (Date.now() - dobMs) / (365.25 * 24 * 3600 * 1000);
          isMinor = years < 18;
        }
      }
      onApplied(e, {
        full_name: typeof e.full_name === "string" ? e.full_name : null,
        date_of_birth: dob,
        nationality:
          typeof e.nationality === "string" ? e.nationality : null,
        passport_number:
          typeof e.passport_number === "string" ? e.passport_number : null,
        passport_expiry:
          typeof e.date_of_expiration === "string"
            ? e.date_of_expiration
            : null,
        is_minor: isMinor,
      });
      const niceName =
        typeof e.signature_display_name === "string"
          ? e.signature_display_name
          : typeof e.full_name === "string"
            ? e.full_name
            : "the principal";
      setOk(
        `Read ${niceName}. Cabin display name updated. Manifest row 1 populated.`,
      );
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        marginBottom: 24,
        background: "#fff",
        border: "1px solid rgba(13,27,42,0.08)",
        padding: 22,
      }}
    >
      <div
        style={{
          fontFamily: "-apple-system, sans-serif",
          fontSize: 10,
          letterSpacing: 2.5,
          textTransform: "uppercase",
          color: "#C9A84C",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        Principal passport · auto-fill row 1
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const f = e.dataTransfer?.files?.[0];
          if (f) void send(f);
        }}
        style={{
          border: `2px dashed ${dragOver ? "#C9A84C" : "rgba(13,27,42,0.22)"}`,
          background: dragOver ? "rgba(201,168,76,0.04)" : "#FBFAF7",
          padding: "26px 20px",
          textAlign: "center",
          fontFamily: "Georgia, serif",
          color: "rgba(13,27,42,0.78)",
        }}
      >
        {busy ? (
          <span style={{ fontStyle: "italic", fontSize: 14 }}>
            Reading passport…
          </span>
        ) : (
          <>
            <div style={{ fontSize: 14, marginBottom: 10 }}>
              Drag the passport PDF or photo here
            </div>
            <label
              style={{
                display: "inline-block",
                background: "#0D1B2A",
                color: "#F8F5F0",
                border: "1px solid #C9A84C",
                padding: "10px 18px",
                fontFamily: "-apple-system, sans-serif",
                fontSize: 10.5,
                letterSpacing: 2,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Or choose a file
              {/* 2026-05-21 — accept everything. The compressor
                  content-sniffs the file (PDF magic, JPEG, PNG,
                  HEIC) and converts to JPEG before upload. */}
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void send(f);
                  e.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            <p
              style={{
                margin: "12px 0 0 0",
                fontStyle: "italic",
                fontSize: 12,
                color: "rgba(13,27,42,0.55)",
              }}
            >
              We read full name, date of birth, nationality, passport number
              and expiry. Only the signature-form name appears in the
              customer&apos;s cabin — the rest stays here in the back office.
            </p>
          </>
        )}
      </div>

      {err && (
        <p
          role="alert"
          style={{
            margin: "12px 0 0",
            color: "#b91c1c",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 13,
          }}
        >
          {err}
        </p>
      )}
      {ok && (
        <p
          style={{
            margin: "12px 0 0",
            color: "#16a34a",
            fontFamily: "Georgia, serif",
            fontStyle: "italic",
            fontSize: 13,
          }}
        >
          ✓ {ok}
        </p>
      )}
    </div>
  );
}
