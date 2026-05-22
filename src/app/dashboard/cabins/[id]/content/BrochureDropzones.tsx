// gy-command — three PDF dropzones at the top of the content
// editor. Drop a PDF, Claude Haiku extracts structured JSON, the
// matching cabin field is updated, and George refreshes to see
// the rendered client view.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Kind = "contract" | "crew" | "menu" | "vessel";

// 2026-05-20 — Friend-test pass 4 +: contract added FIRST in the
// grid because that's the primary source-of-truth document. Once
// signed, it auto-fills vessel name, model, ports, charter dates,
// principal charterer name, cruising area on the cabin record.
// George's principle: client never sees the contract's internal
// half (owner, stakeholder, fees, bank) — those live in
// cabins.contract_internal JSONB and don't surface client-side.
const ZONE_META: Record<Kind, { title: string; subtitle: string; hint: string }> = {
  contract: {
    title: "MYBA contract PDF",
    subtitle: "The signed source of truth",
    hint: "Drop the signed MYBA E-Charter agreement. We extract vessel + dates + ports + charterer details onto the cabin record automatically. Owner, stakeholder, fees and bank details are captured separately — never shown to the client.",
  },
  crew: {
    title: "Crew profile PDF",
    subtitle: "Captain · Cook · Hostess bios",
    hint: "Drop the multi-page crew booklet. We extract first name + role + bio per person, ready for the client to read on /cabin/crew.",
  },
  menu: {
    title: "Sample menu PDF",
    subtitle: "Breakfast · mains · desserts",
    hint: "Drop the chef's sample menu. We pull every section + dish into a typographic display the client sees on /cabin/menu.",
  },
  vessel: {
    title: "Vessel brochure PDF",
    subtitle: "Specs · amenities · water toys",
    hint: "Drop the yacht brochure. We extract specifications, accommodation, amenities, tender + toys list for /cabin/vessel.",
  },
};

export default function BrochureDropzones({ cabinId }: { cabinId: string }) {
  const router = useRouter();
  const [busyKind, setBusyKind] = useState<Kind | null>(null);
  const [result, setResult] = useState<Record<Kind, string | null>>({
    contract: null, crew: null, menu: null, vessel: null,
  });
  const [error, setError] = useState<Record<Kind, string | null>>({
    contract: null, crew: null, menu: null, vessel: null,
  });

  async function handleFile(kind: Kind, file: File) {
    setBusyKind(kind);
    setError((e) => ({ ...e, [kind]: null }));
    setResult((r) => ({ ...r, [kind]: null }));

    if (file.type !== "application/pdf") {
      setError((e) => ({ ...e, [kind]: "Must be a PDF." }));
      setBusyKind(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError((e) => ({ ...e, [kind]: "PDF too large (10 MB max). Try compressing it." }));
      setBusyKind(null);
      return;
    }

    try {
      // 2026-05-20 — Friend-test pass 4 +: Vercel serverless
      // functions cap body size at 4.5 MB. George's MYBA contract
      // PDF is 5.2 MB (8 pages of boilerplate clauses around the
      // 1-page Charter Particulars block we actually need). Slim
      // contract PDFs to page 1 only in the browser BEFORE upload
      // — every field we extract lives there. ~300 KB instead of
      // 5.2 MB, no body-limit error.
      //
      // Crew / menu / vessel brochures DO need all pages (multi-
      // page crew bios, multi-day menus, full vessel specs spread
      // across the brochure), so the slim path is contract-only.
      let uploadFile: File | Blob = file;
      if (kind === "contract") {
        try {
          const { PDFDocument } = await import("pdf-lib");
          const buf = await file.arrayBuffer();
          const src = await PDFDocument.load(buf);
          if (src.getPageCount() > 1) {
            const slim = await PDFDocument.create();
            const [first] = await slim.copyPages(src, [0]);
            slim.addPage(first);
            const bytes = await slim.save();
            uploadFile = new Blob([bytes as BlobPart], { type: "application/pdf" });
          }
        } catch (e) {
          // Best effort — if pdf-lib chokes, fall back to original
          // and let the server return the body-limit error so we
          // see it cleanly in logs rather than silently failing.
          console.warn("[contract-slim] pdf-lib failed:", e);
        }
      }

      const form = new FormData();
      form.append("file", uploadFile, "contract.pdf");
      form.append("kind", kind);

      const r = await fetch(`/api/cabins/${cabinId}/extract-brochure`, {
        method: "POST",
        body: form,
      });
      // 2026-05-20 — friend-test pass 4 +: defend against Vercel
      // edge HTML errors (Request Entity Too Large etc.) — read
      // the body as text first, then attempt JSON. Bad parse
      // surfaces a meaningful error instead of "Unexpected token R".
      const text = await r.text();
      let j: { ok?: boolean; error?: string; persisted?: unknown; summary?: unknown };
      try {
        j = JSON.parse(text);
      } catch {
        const trimmed = text.length > 200 ? text.slice(0, 200) + "…" : text;
        throw new Error(
          r.status === 413
            ? "PDF too large for our serverless functions. Try compressing the PDF and retry — contracts are auto-trimmed to page 1, but other PDFs may need manual compression."
            : `Server responded with non-JSON (${r.status}): ${trimmed}`
        );
      }
      if (!r.ok || !j.ok) {
        const msg = j.error === "ai-cap-or-disabled"
          ? "Monthly AI budget reached — try again next month or raise the cap."
          : j.error || "Extraction failed. Check the PDF and try again.";
        throw new Error(msg);
      }
      setResult((rs) => ({
        ...rs,
        [kind]: kind === "crew"
          ? `✓ Extracted ${(j.persisted as unknown[])?.length ?? 0} crew members`
          : kind === "menu"
          ? `✓ Extracted ${((j.persisted as { sections?: unknown[] })?.sections?.length) ?? 0} menu sections`
          : kind === "contract"
          ? (() => {
              const s = (j.summary as Record<string, unknown> | undefined) || {};
              const applied = Array.isArray(s.applied_columns) ? (s.applied_columns as string[]).length : 0;
              const vessel = (s.vessel_name as string | null) || "—";
              const window = (s.charter_window as string | null) || "";
              return `✓ Applied ${applied} fields to ${vessel}${window ? ` · ${window}` : ""}`;
            })()
          : `✓ Extracted vessel brochure`,
      }));

      // 2026-05-22 — George's directive on the EFFIE STAR preview:
      //   "Στο GY Command υπάρχει η μπροσούρα του σκάφους, άρα
      //    από εκεί δεν θα πρέπει να είναι όλες τις φωτογραφίες?"
      //
      // When the vessel brochure has just been text-extracted
      // successfully, ALSO extract its visual pages as JPEGs and
      // upload them as cabin.vessel_photos. We do this in the
      // browser via pdfjs-dist (already on this page for passport
      // compression) so the operator gets all the brochure value
      // in a single drop — text + photos.
      //
      // Quietly best-effort: if photo extraction fails we leave
      // the text extraction's success message in place and report
      // the photo error inline. The cabin still works without
      // auto-photos — the operator can always paste URLs in the
      // VesselPhotosForm below.
      if (kind === "vessel") {
        try {
          const { extractBrochurePhotos } = await import(
            "@/lib/brochure-photos"
          );
          const out = await extractBrochurePhotos(file);
          if (out.photos.length === 0) {
            setResult((rs) => ({
              ...rs,
              vessel:
                (rs.vessel ?? "✓ Extracted vessel brochure") +
                " · no photo pages detected (all pages text-heavy)",
            }));
          } else {
            const photoForm = new FormData();
            photoForm.append("replace_existing", "true");
            for (const p of out.photos) {
              photoForm.append("photo", p.file);
              photoForm.append("captions[]", "");
              photoForm.append("pages[]", String(p.page));
            }
            const pr = await fetch(
              `/api/cabins/${cabinId}/brochure-photos`,
              { method: "POST", body: photoForm },
            );
            const pj = await pr.json().catch(() => ({}));
            if (!pr.ok || !pj.ok) {
              setError((e) => ({
                ...e,
                vessel:
                  (pj?.error as string) ||
                  `Photo upload failed (status ${pr.status})`,
              }));
            } else {
              setResult((rs) => ({
                ...rs,
                vessel:
                  (rs.vessel ?? "✓ Extracted vessel brochure") +
                  ` · ${pj.uploaded_count ?? 0} photos uploaded` +
                  (out.skippedTextHeavyPages > 0
                    ? ` (${out.skippedTextHeavyPages} text-heavy pages skipped)`
                    : ""),
              }));
            }
          }
        } catch (photoErr) {
          // Don't blow up the whole flow on a photo extraction
          // failure — text extraction already succeeded.
          setError((e) => ({
            ...e,
            vessel:
              "Photo extraction failed: " +
              ((photoErr as Error).message ?? String(photoErr)),
          }));
        }
      }

      // Refresh the underlying server-rendered editors below so they
      // pick up the new values.
      router.refresh();
    } catch (err) {
      setError((e) => ({ ...e, [kind]: (err as Error).message }));
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <section style={{
      background: "#0D1B2A",
      color: "#F8F5F0",
      padding: 24,
      borderRadius: 0,
      marginBottom: 18,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500, marginBottom: 6 }}>
        ⚡ Auto-fill from PDF
      </div>
      <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 300, fontFamily: "Georgia, serif" }}>
        Drop a brochure, we extract everything for you
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 13, color: "rgba(248,245,240,0.7)", fontStyle: "italic", lineHeight: 1.6 }}>
        Each dropzone takes one PDF. Claude reads it and fills the matching
        section below in the brand-correct shape. Review the result in the
        form editors below, edit anything that looks off, and it saves
        instantly. Cost per PDF ≈ $0.05 — protected by the €10/month cap.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {/* 2026-05-21 — George's UX directive: MYBA is uploaded at
            cabin creation (extract-first flow in /dashboard/cabins/new
            since Phase 4). Showing it again here is redundant and
            confused him during testing — he thought he had to upload
            it twice. Filter "contract" out of the kinds rendered on
            this page. If a re-extraction is ever needed (e.g. a
            revised MYBA), it can run via the edit flow or a future
            dedicated affordance — but the everyday path is one upload
            at creation, period. */}
        {(Object.keys(ZONE_META) as Kind[]).filter((k) => k !== "contract").map((kind) => {
          const meta = ZONE_META[kind];
          const isBusy = busyKind === kind;
          const ok = result[kind];
          const err = error[kind];
          return (
            <label
              key={kind}
              style={{
                background: "rgba(248,245,240,0.05)",
                border: "1px dashed rgba(201,168,76,0.45)",
                padding: 18,
                cursor: isBusy ? "default" : "pointer",
                display: "block",
                opacity: busyKind && !isBusy ? 0.4 : 1,
                transition: "background 160ms ease, border-color 160ms ease",
              }}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f && !busyKind) void handleFile(kind, f);
              }}
            >
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500, marginBottom: 4 }}>
                {meta.title}
              </div>
              <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 13, color: "rgba(248,245,240,0.8)", marginBottom: 10 }}>
                {meta.subtitle}
              </div>
              <p style={{ fontSize: 12, color: "rgba(248,245,240,0.6)", lineHeight: 1.55, margin: "0 0 12px" }}>
                {meta.hint}
              </p>
              <input
                type="file"
                accept="application/pdf"
                disabled={!!busyKind}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleFile(kind, f);
                }}
                style={{ display: "none" }}
              />
              <div style={{
                background: isBusy ? "rgba(201,168,76,0.18)" : "#C9A84C",
                color: isBusy ? "rgba(248,245,240,0.7)" : "#0D1B2A",
                padding: "9px 14px",
                fontFamily: "-apple-system, sans-serif",
                fontSize: 10,
                letterSpacing: 2,
                textTransform: "uppercase",
                fontWeight: 600,
                display: "inline-block",
              }}>
                {isBusy ? "Extracting…" : "Drop or browse PDF"}
              </div>
              {ok && (
                <p style={{ marginTop: 10, fontSize: 12, color: "#86efac", fontStyle: "italic" }}>{ok}</p>
              )}
              {err && (
                <p style={{ marginTop: 10, fontSize: 12, color: "#fca5a5", fontStyle: "italic" }}>{err}</p>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
