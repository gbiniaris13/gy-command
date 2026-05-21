// gy-command — create a new Cabin via friendly form.
// Cabin-branded (navy/gold/ivory), not the matrix dashboard theme,
// because George does this work calmly and accurately. Power-user
// "Paste JSON" mode preserved at the bottom for bulk inputs.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PDFDocument } from "pdf-lib";
import { compressPassportForUpload } from "@/lib/passport-compress";

type FormState = {
  // Vessel
  vessel_name: string;
  vessel_make_model: string;
  vessel_length: string;
  vessel_capacity: string;
  homeport: string;
  // Charter window
  myba_contract_number: string;
  charter_period_from: string;
  charter_period_to: string;
  port_embarkation: string;
  port_disembarkation: string;
  cruising_area: string;
  // Principal charterer
  principal_charterer_name: string;
  principal_charterer_email: string;
  principal_charterer_mobile: string;
  // Internal (operational)
  captain_name_internal: string;
  chef_name_internal: string;
  hostess_name_internal: string;
  // central_agent_internal + vessel_owner_internal — intentionally
  // removed from the form. The DB columns still exist for archival
  // use but we never surface them in the UI, per George's principle
  // that nothing about the supply chain ever leaks toward the client.
  charter_fee_eur: string;
  apa_eur: string;
  // Crew display (what the charterer sees)
  crew_display: { first_name: string; role: string; bio: string }[];
};

const EMPTY: FormState = {
  vessel_name: "",
  vessel_make_model: "",
  vessel_length: "",
  vessel_capacity: "",
  homeport: "",
  myba_contract_number: "",
  charter_period_from: "",
  charter_period_to: "",
  port_embarkation: "",
  port_disembarkation: "",
  cruising_area: "",
  principal_charterer_name: "",
  principal_charterer_email: "",
  principal_charterer_mobile: "",
  captain_name_internal: "",
  chef_name_internal: "",
  hostess_name_internal: "",
  charter_fee_eur: "",
  apa_eur: "",
  crew_display: [
    { first_name: "", role: "Captain", bio: "" },
    { first_name: "", role: "Chef", bio: "" },
    { first_name: "", role: "Hostess", bio: "" },
  ],
};

const CRUISING_AREAS = ["Cyclades", "Saronic", "Ionian", "Sporades", "Dodecanese", "Northern Greece", "Mixed", "Other"];
const CREW_ROLES = ["Captain", "Chef", "Hostess", "Steward", "Engineer", "Deckhand", "Other"];

export default function NewCabinPage() {
  const router = useRouter();

  // The dashboard layout paints a matrix-themed background with
  // scan-beam + CRT overlay + AlienBackground. They make the form
  // hard to read. We add a body class while this page is mounted
  // so the global CSS below can hide those layers.
  useEffect(() => {
    document.body.classList.add("cabin-form-mode");
    return () => document.body.classList.remove("cabin-form-mode");
  }, []);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [showInternal, setShowInternal] = useState(false);
  const [showCrew, setShowCrew] = useState(false);
  const [showJsonMode, setShowJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 2026-05-21 — Roberto P1 + George's explicit ask:
  //   "I'm not going to type 15 fields. I'll upload the MYBA
  //    contract, press save, and the fields should populate."
  //
  // Step machine for the extract-first creation flow:
  //   "upload" — show only the MYBA dropzone. The form is hidden.
  //              When the PDF is dropped we slim it to page 1
  //              (where every Charter Particulars field lives),
  //              call the preview-extract endpoint, pre-fill
  //              form state, and advance to the form step.
  //   "form"   — the existing form, pre-filled. George reviews,
  //              fixes anything Gemini misread, fills in the email
  //              and mobile (the contract doesn't carry those),
  //              then submits to /api/cabins to actually create.
  //
  // "skip extraction" is available on the upload step for the
  // edge case where the MYBA isn't ready yet but a placeholder
  // cabin needs to exist.
  type Step = "upload" | "form";
  const [step, setStep] = useState<Step>("upload");
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedInternal, setExtractedInternal] = useState<
    Record<string, unknown> | null
  >(null);
  const [extractedRaw, setExtractedRaw] = useState<unknown>(null);

  // 2026-05-21 — George's UX directive: "If I upload all PDFs at the
  // start, confirm, send to client, we're done."
  //
  // We hold the optional companion PDFs (crew booklet, sample menu,
  // vessel brochure, principal passport) in browser memory during
  // the upload step. They are NOT sent to the server here — each
  // one requires a cabin_id (the cabin doesn't exist yet). When
  // George clicks "Create cabin", the submit handler:
  //   1. POSTs the form to /api/cabins to create the row
  //   2. Then sequentially POSTs each held PDF to its existing
  //      cabin-scoped extraction endpoint
  //   3. Redirects when all extractions land
  //
  // From George's point of view there's ONE button click. The
  // server-side orchestration is invisible.
  type HeldFiles = {
    crew?: File;
    menu?: File;
    brochure?: File;
    passport?: File;
  };
  const [heldFiles, setHeldFiles] = useState<HeldFiles>({});
  const [postCreateStatus, setPostCreateStatus] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setCrew(i: number, key: keyof FormState["crew_display"][0], value: string) {
    setForm((f) => ({
      ...f,
      crew_display: f.crew_display.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)),
    }));
  }

  function addCrewRow() {
    setForm((f) => ({
      ...f,
      crew_display: [...f.crew_display, { first_name: "", role: "Other", bio: "" }],
    }));
  }

  function removeCrewRow(i: number) {
    setForm((f) => ({
      ...f,
      crew_display: f.crew_display.filter((_, idx) => idx !== i),
    }));
  }

  // 2026-05-21 — Slim a multi-page MYBA contract PDF to page 1 only.
  // Page 1 carries every Charter Particulars field; pages 2-10 are
  // boilerplate clauses we don't need to send to Gemini, and slimming
  // keeps the upload comfortably inside Vercel's 4.5 MB body limit.
  async function slimToPageOne(file: File): Promise<File> {
    const buf = await file.arrayBuffer();
    const src = await PDFDocument.load(buf);
    if (src.getPageCount() <= 1) return file;
    const out = await PDFDocument.create();
    const [page1] = await out.copyPages(src, [0]);
    out.addPage(page1);
    const slimBytes = await out.save();
    const slimBlob = new Blob([slimBytes as BlobPart], {
      type: "application/pdf",
    });
    return new File([slimBlob], file.name.replace(/\.pdf$/i, "-p1.pdf"), {
      type: "application/pdf",
    });
  }

  // Map the verbatim extraction shape onto the FormState we already
  // had. We do NOT validate or transform values here — Roberto's
  // brief is faithful extraction; if Gemini misreads a field, the
  // human review step is where it gets fixed.
  function applyExtraction(extracted: {
    safe?: Record<string, unknown>;
    internal?: Record<string, unknown>;
  }) {
    const safe = (extracted?.safe || {}) as Record<string, unknown>;
    const internal = (extracted?.internal || {}) as Record<string, unknown>;
    const str = (v: unknown) =>
      typeof v === "string" ? v : v == null ? "" : String(v);
    const num = (v: unknown) =>
      typeof v === "number" || typeof v === "string" ? String(v) : "";

    setForm((f) => ({
      ...f,
      vessel_name: str(safe.vessel_name) || f.vessel_name,
      vessel_make_model: str(safe.vessel_make_model) || f.vessel_make_model,
      vessel_length: str(safe.vessel_length) || f.vessel_length,
      vessel_capacity:
        num(safe.max_guests_sleeping) ||
        num(safe.max_guests_cruising) ||
        f.vessel_capacity,
      // 2026-05-20 — Pass 6 ruling: customer-facing homeport is the
      // embarkation port (where they actually board), NOT the legal
      // Port of Registry. We pre-fill from safe.port_embarkation
      // for the same reason.
      homeport: str(safe.port_embarkation) || str(safe.homeport) || f.homeport,
      myba_contract_number:
        str(internal.contract_number) || f.myba_contract_number,
      charter_period_from: str(safe.charter_period_from) || f.charter_period_from,
      charter_period_to: str(safe.charter_period_to) || f.charter_period_to,
      port_embarkation: str(safe.port_embarkation) || f.port_embarkation,
      port_disembarkation: str(safe.port_disembarkation) || f.port_disembarkation,
      cruising_area: str(safe.cruising_area) || f.cruising_area,
      principal_charterer_name:
        str(safe.principal_charterer_name) || f.principal_charterer_name,
      // principal_charterer_email + mobile NOT in the contract —
      // George (or the real customer) fills them at review.
      charter_fee_eur: num(internal.charter_fee_eur) || f.charter_fee_eur,
      apa_eur: num(internal.apa_eur) || f.apa_eur,
    }));
    setExtractedInternal(internal);
    setExtractedRaw(extracted);
  }

  async function onMybaDropped(file: File) {
    setExtractError(null);
    setExtractBusy(true);
    try {
      if (file.type !== "application/pdf") {
        throw new Error("Please upload a PDF.");
      }
      const slim = await slimToPageOne(file);
      const fd = new FormData();
      fd.append("file", slim);
      const r = await fetch("/api/cabins/extract-myba-preview", {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        const msg =
          j?.error || j?.message || `Extraction failed (${r.status}).`;
        throw new Error(msg);
      }
      applyExtraction(j.extracted);
      setStep("form");
    } catch (e) {
      setExtractError((e as Error).message);
    } finally {
      setExtractBusy(false);
    }
  }

  function skipExtraction() {
    setExtractError(null);
    setStep("form");
  }

  function validate(): string | null {
    if (!form.vessel_name.trim()) return "Vessel name is required.";
    if (!form.charter_period_from) return "Charter start date is required.";
    if (!form.charter_period_to) return "Charter end date is required.";
    if (form.charter_period_to < form.charter_period_from)
      return "End date must be after start date.";
    if (!form.principal_charterer_name.trim()) return "Principal charterer name is required.";
    if (!form.principal_charterer_email.trim()) return "Principal charterer email is required.";
    if (!form.principal_charterer_email.includes("@")) return "Email looks invalid.";
    if (form.charter_fee_eur && Number.isNaN(Number(form.charter_fee_eur)))
      return "Charter fee must be a number.";
    if (form.apa_eur && Number.isNaN(Number(form.apa_eur))) return "APA must be a number.";
    if (form.vessel_capacity && Number.isNaN(Number(form.vessel_capacity)))
      return "Capacity must be a number.";
    return null;
  }

  function buildPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      vessel_name: form.vessel_name.trim(),
      charter_period_from: form.charter_period_from,
      charter_period_to: form.charter_period_to,
      principal_charterer_name: form.principal_charterer_name.trim(),
      principal_charterer_email: form.principal_charterer_email.trim().toLowerCase(),
    };
    const opt = (k: string, v: string) => { if (v.trim()) out[k] = v.trim(); };
    opt("vessel_make_model", form.vessel_make_model);
    opt("vessel_length", form.vessel_length);
    opt("homeport", form.homeport);
    opt("myba_contract_number", form.myba_contract_number);
    opt("port_embarkation", form.port_embarkation);
    opt("port_disembarkation", form.port_disembarkation);
    opt("cruising_area", form.cruising_area);
    opt("principal_charterer_mobile", form.principal_charterer_mobile);
    opt("captain_name_internal", form.captain_name_internal);
    opt("chef_name_internal", form.chef_name_internal);
    opt("hostess_name_internal", form.hostess_name_internal);
    // central_agent_internal + vessel_owner_internal intentionally
    // omitted from the form per George: he doesn't want the client
    // even to suspect those entities exist. The DB columns remain
    // nullable for future API-only population if ever needed.
    if (form.vessel_capacity) out.vessel_capacity = Number(form.vessel_capacity);
    if (form.charter_fee_eur) out.charter_fee_eur = Number(form.charter_fee_eur);
    if (form.apa_eur) out.apa_eur = Number(form.apa_eur);
    const crew = form.crew_display.filter((c) => c.first_name.trim());
    if (crew.length) out.crew_display = crew;
    return out;
  }

  // 2026-05-21 — Submit handler orchestrates the full "one-click
  // cabin from George's stack of PDFs" workflow:
  //   1. Create the cabin row from the form payload (existing path).
  //   2. For each held PDF (crew booklet, sample menu, vessel
  //      brochure, passport), POST to its cabin-scoped extraction
  //      endpoint in series. Series matters: keeps Gemini load
  //      gentle and surfaces individual failures cleanly.
  //   3. Redirect to the cabin detail page once everything lands.
  //
  // If a companion extraction fails, we don't roll back the cabin —
  // the cabin exists, the MYBA data is in, and George can re-upload
  // the failed PDF from the cabin detail page. The error is shown
  // inline so he knows what didn't land.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPostCreateStatus(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      const payload = showJsonMode ? JSON.parse(jsonText) : buildPayload();
      const r = await fetch("/api/cabins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "create-failed");
      const cabinId = j.id as string;

      // Run held-PDF extractions sequentially. Each call writes to
      // its own column / table so the order is purely cosmetic
      // (progress feedback). Errors per file are surfaced inline
      // but do NOT abort the chain — the cabin already exists and
      // the user can retry individual uploads from /content.
      const extractionFailures: string[] = [];

      async function applyExtractFile(
        kind: "crew" | "menu" | "vessel",
        file: File,
      ) {
        setPostCreateStatus(
          `Applying ${kind === "vessel" ? "vessel brochure" : kind}…`,
        );
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("kind", kind);
          const rr = await fetch(`/api/cabins/${cabinId}/extract-brochure`, {
            method: "POST",
            body: fd,
          });
          if (!rr.ok) {
            const jj = await rr.json().catch(() => ({}));
            throw new Error(
              jj?.error || jj?.message || `Failed (${rr.status})`,
            );
          }
        } catch (xx) {
          extractionFailures.push(`${kind}: ${(xx as Error).message}`);
        }
      }

      async function applyPassportFile(file: File) {
        setPostCreateStatus("Compressing the passport scan…");
        try {
          // 2026-05-21 — Vercel caps the request body at ~4.5 MB.
          // Tricia's 22 MB phone-scanned passport PDF triggered HTTP
          // 413 on the first attempt. Compress to a ~1 MB JPEG in
          // the browser before upload — the MRZ and visual bio
          // remain perfectly readable at 1800px on the long edge,
          // and Gemini accepts image/jpeg the same way it accepts
          // application/pdf.
          const compressed = await compressPassportForUpload(file);
          setPostCreateStatus("Reading the principal's passport…");
          const fd = new FormData();
          fd.append("file", compressed);
          fd.append("guest_order", "1");
          const rr = await fetch(`/api/cabins/${cabinId}/extract-passport`, {
            method: "POST",
            body: fd,
          });
          if (!rr.ok) {
            const jj = await rr.json().catch(() => ({}));
            throw new Error(
              jj?.error || jj?.message || `Failed (${rr.status})`,
            );
          }
        } catch (xx) {
          extractionFailures.push(`passport: ${(xx as Error).message}`);
        }
      }

      if (heldFiles.crew) await applyExtractFile("crew", heldFiles.crew);
      if (heldFiles.menu) await applyExtractFile("menu", heldFiles.menu);
      if (heldFiles.brochure)
        await applyExtractFile("vessel", heldFiles.brochure);
      if (heldFiles.passport) await applyPassportFile(heldFiles.passport);

      if (extractionFailures.length > 0) {
        setPostCreateStatus(null);
        setError(
          `Cabin created, but some extractions failed:\n• ${extractionFailures.join("\n• ")}\nYou can re-upload them from the cabin's content panel.`,
        );
        setBusy(false);
        // Still navigate after a short pause so George can read the
        // error AND end up on the cabin page.
        setTimeout(() => router.push(`/dashboard/cabins/${cabinId}`), 4000);
        return;
      }

      setPostCreateStatus("Done. Opening the cabin…");
      router.push(`/dashboard/cabins/${cabinId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setPostCreateStatus(null);
    }
  }

  return (
    <div
      // Fixed full-viewport overlay sits ABOVE every dashboard
      // chrome layer (matrix bg, CRT, scan-beam, sidebar). George
      // can't see those while this form is open — we're not
      // competing with z-index, we're stacking on top.
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
        /* Belt-and-suspenders: also hide the matrix chrome via class,
           so when the overlay closes the dashboard is intact. */
        body.cabin-form-mode .crt-overlay,
        body.cabin-form-mode .scan-beam {
          display: none !important;
        }
        /* Close button top-right */
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

        /* ─── NUKE ALL INHERITED CYAN — force navy/gold palette ─── */
        /* The dashboard's electric-cyan CSS variables were leaking
           into every text element. We reset everything to navy with
           !important, then paint gold on the specific accents below. */
        .cabin-form,
        .cabin-form * {
          color: #0D1B2A !important;
        }
        /* Gold accents — these win specificity by adding !important too */
        .cabin-form h1 em,
        .cabin-form em,
        .cabin-form .label-text,
        .cabin-form label > span,
        .cabin-form .req,
        .cabin-form .lede-eyebrow,
        .cabin-form summary {
          color: #C9A84C !important;
        }
        /* Required-field dot */
        .cabin-form .req::after {
          color: #C9A84C !important;
        }
        /* Placeholders should be soft grey, not cyan */
        .cabin-form input::placeholder,
        .cabin-form textarea::placeholder {
          color: rgba(13,27,42,0.35) !important;
          opacity: 1;
        }
        /* Input/select/textarea fields: white bg, navy text, no neon glow */
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
        /* Eyebrow line — small uppercase header "THE CABIN · ADMIN" */
        .cabin-form .eyebrow {
          color: #C9A84C !important;
        }
        /* Lede (italic paragraph below headings) — softer navy */
        .cabin-form .lede,
        .cabin-form .field-hint {
          color: rgba(13,27,42,0.6) !important;
        }
        /* Primary CTA: navy bg, ivory text */
        .cabin-form .primary {
          background: #0D1B2A !important;
          color: #F8F5F0 !important;
        }
        .cabin-form .primary:hover:not(:disabled) {
          background: #142233 !important;
        }
        /* Section cards on ivory bg */
        .cabin-form .section {
          background: #FFFFFF !important;
        }

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
          background: #FFFFFF;
          border: 1px solid rgba(13,27,42,0.18);
          padding: 11px 12px;
          font-size: 15px;
          font-family: Georgia, serif;
          color: #0D1B2A;
          outline: none;
          transition: border-color 160ms ease;
          border-radius: 0;
        }
        .cabin-form input:focus,
        .cabin-form select:focus,
        .cabin-form textarea:focus { border-color: #C9A84C; }
        .cabin-form input::placeholder { color: rgba(13,27,42,0.35); font-style: italic; }
        .cabin-form .req::after { content: " ●"; color: #C9A84C; font-size: 10px; vertical-align: super; }
        .cabin-form .field-hint {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 12px;
          color: rgba(13,27,42,0.55);
          margin: 4px 0 0 0;
        }
        .cabin-form .section {
          background: #fff;
          border: 1px solid rgba(13,27,42,0.08);
          padding: 24px;
          margin-bottom: 16px;
        }
        .cabin-form .section h2 {
          font-family: Georgia, serif;
          font-size: 20px;
          font-weight: 300;
          margin: 0 0 6px;
          color: #0D1B2A;
        }
        .cabin-form .section .lede {
          font-family: Georgia, serif;
          font-style: italic;
          font-size: 13.5px;
          color: rgba(13,27,42,0.6);
          margin: 0 0 20px 0;
        }
        .cabin-form .grid2 {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }
        @media (min-width: 720px) {
          .cabin-form .grid2 { grid-template-columns: 1fr 1fr; }
          .cabin-form .grid3 { grid-template-columns: 1fr 1fr 1fr; }
        }
        .cabin-form .grid3 {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }
        .cabin-form .toggle {
          background: transparent;
          border: 1px solid rgba(13,27,42,0.18);
          padding: 10px 18px;
          font-family: -apple-system, sans-serif;
          font-size: 10.5px;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #0D1B2A;
          cursor: pointer;
          width: 100%;
          text-align: left;
        }
        .cabin-form .toggle:hover { border-color: #C9A84C; }
        .cabin-form .primary {
          background: #0D1B2A;
          color: #F8F5F0;
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
          color: #0D1B2A;
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
          color: #991B1B;
          padding: 12px 16px;
          font-family: Georgia, serif;
          font-style: italic;
          margin: 16px 0 0;
        }
        .cabin-form .crew-row {
          display: grid;
          grid-template-columns: 1fr 1fr 2fr auto;
          gap: 12px;
          align-items: end;
          margin-bottom: 12px;
        }
        @media (max-width: 720px) {
          .cabin-form .crew-row { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* Close → back to cabins list */}
      <button
        type="button"
        className="cabin-form-close"
        aria-label="Close"
        onClick={() => router.push("/dashboard/cabins")}
      >
        ×
      </button>

      <div className="cabin-form" style={{ maxWidth: 920, margin: "0 auto", padding: "32px 20px 80px" }}>
        <header style={{ borderBottom: "1px solid rgba(201,168,76,0.4)", paddingBottom: 20, marginBottom: 28 }}>
          <div className="eyebrow" style={{ fontFamily: "-apple-system, sans-serif", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", fontWeight: 500 }}>
            The Cabin · Admin
          </div>
          <h1 style={{ margin: "8px 0 4px", fontSize: 32, fontWeight: 300, fontFamily: "Georgia, serif" }}>
            Create a new <em style={{ color: "#C9A84C", fontStyle: "italic" }}>cabin</em>
          </h1>
          <p style={{ margin: 0, fontStyle: "italic", color: "rgba(13,27,42,0.6)", fontSize: 14, fontFamily: "Georgia, serif" }}>
            {step === "upload"
              ? "Drop the signed MYBA contract — we'll auto-fill the cabin from it. You'll get a chance to review every field before saving."
              : "Fields marked with a small gold dot are required. Everything else can wait. You can edit anything after saving."}
          </p>
        </header>

        {step === "upload" && (
          <MybaUploadStep
            busy={extractBusy}
            error={extractError}
            onFile={onMybaDropped}
            onSkip={skipExtraction}
          />
        )}

        {step === "form" && (
        <form onSubmit={submit}>
          {/* ────── Vessel ────── */}
          <div className="section">
            <h2>The vessel</h2>
            <p className="lede">What your client will see on the home screen of their Cabin.</p>
            <div className="grid2">
              <label>
                <span className="req">Vessel name</span>
                <input
                  type="text"
                  value={form.vessel_name}
                  onChange={(e) => set("vessel_name", e.target.value)}
                  placeholder="M/Y Alena"
                  required
                />
              </label>
              <label>
                <span>Make / model</span>
                <input
                  type="text"
                  value={form.vessel_make_model}
                  onChange={(e) => set("vessel_make_model", e.target.value)}
                  placeholder="Sunreef 50 Power"
                />
              </label>
              <label>
                <span>Length</span>
                <input
                  type="text"
                  value={form.vessel_length}
                  onChange={(e) => set("vessel_length", e.target.value)}
                  placeholder="51 ft"
                />
              </label>
              <label>
                <span>Capacity (guests)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={form.vessel_capacity}
                  onChange={(e) => set("vessel_capacity", e.target.value)}
                  placeholder="10"
                  min="1"
                  max="50"
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span>Homeport</span>
                <input
                  type="text"
                  value={form.homeport}
                  onChange={(e) => set("homeport", e.target.value)}
                  placeholder="Piraeus"
                />
              </label>
            </div>
          </div>

          {/* ────── Charter window ────── */}
          <div className="section">
            <h2>Charter window</h2>
            <p className="lede">When and where. Dates use your local format on the device — server stores ISO.</p>
            <div className="grid2">
              <label>
                <span className="req">From</span>
                <input
                  type="date"
                  value={form.charter_period_from}
                  onChange={(e) => set("charter_period_from", e.target.value)}
                  required
                />
              </label>
              <label>
                <span className="req">To</span>
                <input
                  type="date"
                  value={form.charter_period_to}
                  onChange={(e) => set("charter_period_to", e.target.value)}
                  min={form.charter_period_from || undefined}
                  required
                />
              </label>
              <label>
                <span>Embarkation port</span>
                <input
                  type="text"
                  value={form.port_embarkation}
                  onChange={(e) => set("port_embarkation", e.target.value)}
                  placeholder="Piraeus"
                />
              </label>
              <label>
                <span>Disembarkation port</span>
                <input
                  type="text"
                  value={form.port_disembarkation}
                  onChange={(e) => set("port_disembarkation", e.target.value)}
                  placeholder="Mykonos"
                />
              </label>
              <label>
                <span>Cruising area</span>
                <select
                  value={form.cruising_area}
                  onChange={(e) => set("cruising_area", e.target.value)}
                >
                  <option value="">— choose —</option>
                  {CRUISING_AREAS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>MYBA contract #</span>
                <input
                  type="text"
                  value={form.myba_contract_number}
                  onChange={(e) => set("myba_contract_number", e.target.value)}
                  placeholder="MYBA-2027-0001"
                />
              </label>
            </div>
          </div>

          {/* ────── Principal charterer ────── */}
          <div className="section">
            <h2>Principal charterer</h2>
            <p className="lede">The person who signs the contract. They get the magic link first.</p>
            <div className="grid2">
              <label style={{ gridColumn: "1 / -1" }}>
                <span className="req">Full name</span>
                <input
                  type="text"
                  value={form.principal_charterer_name}
                  onChange={(e) => set("principal_charterer_name", e.target.value)}
                  placeholder="Alessandra Visconti"
                  autoComplete="name"
                  required
                />
              </label>
              <label>
                <span className="req">Email</span>
                <input
                  type="email"
                  value={form.principal_charterer_email}
                  onChange={(e) => set("principal_charterer_email", e.target.value)}
                  placeholder="alessandra@example.com"
                  autoComplete="email"
                  required
                />
                <p className="field-hint">This is the email the magic-link invite is sent to.</p>
              </label>
              <label>
                <span>Mobile</span>
                <input
                  type="tel"
                  value={form.principal_charterer_mobile}
                  onChange={(e) => set("principal_charterer_mobile", e.target.value)}
                  placeholder="+39 333 555 1212"
                  inputMode="tel"
                />
              </label>
            </div>
          </div>

          {/* ────── Internal (collapsed) ────── */}
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
                  <input type="text" value={form.captain_name_internal} onChange={(e) => set("captain_name_internal", e.target.value)} placeholder="Stavros Manolakis" />
                </label>
                <label>
                  <span>Chef</span>
                  <input type="text" value={form.chef_name_internal} onChange={(e) => set("chef_name_internal", e.target.value)} placeholder="Nikos Papadopoulos" />
                </label>
                <label>
                  <span>Hostess</span>
                  <input type="text" value={form.hostess_name_internal} onChange={(e) => set("hostess_name_internal", e.target.value)} placeholder="Eleni Aravantinou" />
                </label>
                <label>
                  <span>Charter fee (€)</span>
                  <input type="number" inputMode="decimal" value={form.charter_fee_eur} onChange={(e) => set("charter_fee_eur", e.target.value)} placeholder="38000" min="0" />
                </label>
                <label>
                  <span>APA (€)</span>
                  <input type="number" inputMode="decimal" value={form.apa_eur} onChange={(e) => set("apa_eur", e.target.value)} placeholder="9500" min="0" />
                </label>
                <p className="field-hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
                  These fields are NEVER shown to the client. They live only in the operator’s
                  internal print sheet.
                </p>
              </div>
            )}
          </div>

          {/* ────── Crew display (collapsed) ────── */}
          <div className="section" style={{ padding: showCrew ? 24 : 0 }}>
            <button
              type="button"
              onClick={() => setShowCrew((v) => !v)}
              className="toggle"
              style={{ width: "100%", padding: showCrew ? "0 0 14px" : "16px 24px", borderBottom: showCrew ? "1px solid rgba(13,27,42,0.08)" : "none", border: showCrew ? "none" : "1px solid rgba(13,27,42,0.18)" }}
            >
              {showCrew ? "− Hide" : "+ Show"} crew profiles (what the charterer sees)
            </button>
            {showCrew && (
              <div style={{ marginTop: 18 }}>
                <p className="lede" style={{ margin: "0 0 14px" }}>
                  First names + role + a short bio per crew member. This is what your client
                  reads on /cabin/crew — keep it warm, no surnames. You can leave rows blank.
                </p>
                {form.crew_display.map((c, i) => (
                  <div key={i} className="crew-row">
                    <label>
                      <span>First name</span>
                      <input
                        type="text"
                        value={c.first_name}
                        onChange={(e) => setCrew(i, "first_name", e.target.value)}
                        placeholder="Stavros"
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <select
                        value={c.role}
                        onChange={(e) => setCrew(i, "role", e.target.value)}
                      >
                        {CREW_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Short bio</span>
                      <input
                        type="text"
                        value={c.bio}
                        onChange={(e) => setCrew(i, "bio", e.target.value)}
                        placeholder="Twenty-two years across Greek waters."
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeCrewRow(i)}
                      style={{
                        background: "transparent",
                        border: "1px solid rgba(13,27,42,0.18)",
                        color: "rgba(13,27,42,0.6)",
                        padding: "11px 14px",
                        cursor: "pointer",
                        fontFamily: "-apple-system, sans-serif",
                        fontSize: 10,
                        letterSpacing: 1.5,
                        textTransform: "uppercase",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCrewRow}
                  className="toggle"
                  style={{ marginTop: 6 }}
                >
                  + Add another crew member
                </button>
              </div>
            )}
          </div>

          {/* ────── Power user: JSON paste ────── */}
          <details style={{ marginBottom: 16 }}>
            <summary style={{ fontFamily: "-apple-system, sans-serif", fontSize: 10.5, letterSpacing: 2, textTransform: "uppercase", color: "rgba(13,27,42,0.55)", cursor: "pointer", padding: "12px 0" }}>
              Power user · paste JSON instead
            </summary>
            <div style={{ marginTop: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "-apple-system, sans-serif", fontSize: 12 }}>
                <input type="checkbox" checked={showJsonMode} onChange={(e) => setShowJsonMode(e.target.checked)} />
                Submit raw JSON instead of the form above
              </label>
              {showJsonMode && (
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  rows={14}
                  placeholder={`{ "vessel_name": "M/Y …", "charter_period_from": "2027-07-15", ... }`}
                  style={{ marginTop: 10, width: "100%", fontFamily: "ui-monospace, SF Mono, Menlo, monospace", fontSize: 12.5, padding: 12, border: "1px solid rgba(13,27,42,0.18)", background: "#fff" }}
                />
              )}
            </div>
          </details>

          {/* ────── Companion PDFs (queued for post-creation) ────── */}
          {/* 2026-05-21 — George's UX directive: "If I upload all PDFs
              at the start, confirm, send to client, we're done."
              The four companion PDFs (crew booklet, sample menu,
              vessel brochure, principal passport) are HELD in browser
              memory while George reviews the MYBA-derived form.
              When he clicks "Create cabin", the submit handler
              creates the row then sequentially uploads each held PDF
              to its existing cabin-scoped extraction endpoint. From
              George's view: one button click, full cabin populated. */}
          <div className="section">
            <h2>Companion PDFs</h2>
            <p className="lede">
              Drop everything else you have for this charter — crew booklet,
              sample menu, vessel brochure, principal&apos;s passport. They&apos;ll
              be applied automatically right after the cabin is created. All
              optional; you can also add them later from the cabin&apos;s
              content panel.
            </p>
            <div className="grid2">
              <CompanionFileSlot
                label="Crew booklet"
                hint="Captain + chef + hostess bios with photos."
                file={heldFiles.crew}
                onPick={(f) => setHeldFiles((h) => ({ ...h, crew: f }))}
              />
              <CompanionFileSlot
                label="Sample menu"
                hint="Chef's repertoire by course. Title Case preserved."
                file={heldFiles.menu}
                onPick={(f) => setHeldFiles((h) => ({ ...h, menu: f }))}
              />
              <CompanionFileSlot
                label="Vessel brochure"
                hint="Specs, amenities, water toys, photos."
                file={heldFiles.brochure}
                onPick={(f) => setHeldFiles((h) => ({ ...h, brochure: f }))}
              />
              <CompanionFileSlot
                label="Principal passport"
                hint="Name from passport · DOB stored for Filotimo · never shown in cabin."
                file={heldFiles.passport}
                onPick={(f) => setHeldFiles((h) => ({ ...h, passport: f }))}
              />
            </div>
          </div>

          {postCreateStatus && (
            <p
              role="status"
              style={{
                fontFamily: "Georgia, serif",
                fontStyle: "italic",
                fontSize: 14,
                color: "#0D1B2A",
                background: "#FEF8E6",
                border: "1px solid rgba(201,168,76,0.4)",
                padding: "10px 14px",
                marginTop: 16,
              }}
            >
              {postCreateStatus}
            </p>
          )}

          {error && (
            <p
              className="err"
              role="alert"
              style={{ whiteSpace: "pre-line" }}
            >
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 14, marginTop: 24, flexWrap: "wrap" }}>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Creating…" : "Create cabin"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => { setForm(EMPTY); setJsonText(""); setShowJsonMode(false); setError(null); setHeldFiles({}); }}
            >
              Clear all
            </button>
          </div>
          <p className="field-hint" style={{ marginTop: 14 }}>
            After saving you&apos;ll land on the cabin detail page. From there you can edit
            anything, send the magic-link invite, and trigger concierge mode.
          </p>
        </form>
        )}
      </div>
    </div>
  );
}

// =============================================================
// MybaUploadStep — Step 1 of the extract-first creation flow.
// Dropzone + "skip extraction" escape hatch. The dropzone accepts
// a single MYBA contract PDF, slims it to page 1 client-side
// (where every Charter Particulars field lives), and forwards to
// the parent's onFile callback.
// =============================================================
// =============================================================
// CompanionFileSlot — a small file picker for the optional PDFs
// queued at creation time (crew booklet, menu, brochure,
// passport). We don't extract here — the file is just held in
// state until the parent's submit handler runs the cabin-scoped
// extraction endpoints after the cabin is created.
// =============================================================
function CompanionFileSlot({
  label,
  hint,
  file,
  onPick,
}: {
  label: string;
  hint: string;
  file: File | undefined;
  onPick: (f: File | undefined) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(13,27,42,0.12)",
        padding: 14,
        background: "#FBFAF7",
      }}
    >
      <div
        style={{
          fontFamily: "-apple-system, sans-serif",
          fontSize: 10,
          letterSpacing: 1.8,
          textTransform: "uppercase",
          color: "#C9A84C",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <p
        className="field-hint"
        style={{ margin: "4px 0 10px 0", fontSize: 11.5 }}
      >
        {hint}
      </p>
      {file ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "#fff",
            border: "1px solid rgba(13,27,42,0.12)",
            padding: "8px 10px",
            fontFamily: "Georgia, serif",
            fontSize: 13,
          }}
        >
          <span style={{ color: "#16a34a" }}>
            ✓ {file.name} · queued
          </span>
          <button
            type="button"
            onClick={() => onPick(undefined)}
            style={{
              background: "transparent",
              border: 0,
              color: "rgba(13,27,42,0.55)",
              fontFamily: "-apple-system, sans-serif",
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <label
          style={{
            display: "inline-block",
            background: "transparent",
            color: "#0D1B2A",
            border: "1px dashed rgba(13,27,42,0.25)",
            padding: "10px 14px",
            fontFamily: "-apple-system, sans-serif",
            fontSize: 10.5,
            letterSpacing: 2,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Choose PDF
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </label>
      )}
    </div>
  );
}

function MybaUploadStep({
  busy,
  error,
  onFile,
  onSkip,
}: {
  busy: boolean;
  error: string | null;
  onFile: (f: File) => void;
  onSkip: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  }
  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = ""; // reset so the same file can be re-picked
  }

  return (
    <div className="section" style={{ padding: "36px 32px" }}>
      <h2 style={{ margin: "0 0 6px" }}>Upload the MYBA contract</h2>
      <p className="lede" style={{ margin: "0 0 18px" }}>
        Page one of the signed MYBA Charter Agreement contains every cabin
        detail we need — vessel, dates, ports, principal charterer, fees,
        contract number. Drop it here and we&apos;ll fill the form for you.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${dragOver ? "#C9A84C" : "rgba(13,27,42,0.25)"}`,
          background: dragOver ? "rgba(201,168,76,0.04)" : "#FBFAF7",
          padding: "44px 24px",
          textAlign: "center",
          fontFamily: "Georgia, serif",
          color: "rgba(13,27,42,0.78)",
          transition: "border-color 140ms ease, background 140ms ease",
        }}
      >
        {busy ? (
          <>
            <div style={{ fontStyle: "italic", fontSize: 16, marginBottom: 6 }}>
              Reading the contract…
            </div>
            <div
              style={{
                fontFamily: "-apple-system, sans-serif",
                fontSize: 11,
                letterSpacing: 1.5,
                color: "rgba(13,27,42,0.5)",
              }}
            >
              extracting · usually takes 8–15 seconds
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 16, marginBottom: 14 }}>
              Drag the MYBA PDF here
            </div>
            <label
              style={{
                display: "inline-block",
                background: "#0D1B2A",
                color: "#F8F5F0",
                border: "1px solid #C9A84C",
                padding: "12px 22px",
                fontFamily: "-apple-system, sans-serif",
                fontSize: 11,
                letterSpacing: 2.5,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Or click to choose a file
              <input
                type="file"
                accept="application/pdf"
                onChange={handlePick}
                style={{ display: "none" }}
              />
            </label>
            <p
              style={{
                margin: "16px 0 0 0",
                fontStyle: "italic",
                fontSize: 12,
                color: "rgba(13,27,42,0.55)",
              }}
            >
              We send only page 1 to extraction — the rest stays on your
              machine. The contract is never persisted by the preview step.
            </p>
          </>
        )}
      </div>

      {error && (
        <p
          className="err"
          role="alert"
          style={{ marginTop: 16 }}
        >
          {error}
        </p>
      )}

      <div
        style={{
          marginTop: 22,
          paddingTop: 18,
          borderTop: "1px solid rgba(13,27,42,0.08)",
          textAlign: "center",
        }}
      >
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          style={{
            background: "transparent",
            border: 0,
            color: "rgba(13,27,42,0.55)",
            fontFamily: "-apple-system, sans-serif",
            fontSize: 11,
            letterSpacing: 1.8,
            textTransform: "uppercase",
            cursor: busy ? "default" : "pointer",
            padding: "8px 16px",
            textDecoration: "underline",
          }}
        >
          Skip extraction · fill the form manually
        </button>
      </div>
    </div>
  );
}
