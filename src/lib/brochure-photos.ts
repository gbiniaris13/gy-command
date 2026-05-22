// src/lib/brochure-photos.ts
// =============================================================
// 2026-05-22 — George's directive after the EFFIE STAR preview:
//   "Οι φωτογραφίες αυτές δεν είναι του σκάφους — είναι από
//    το site μου, παλιές, random. Στο GY Command υπάρχει η
//    μπροσούρα του σκάφους, άρα από εκεί δεν θα πρέπει να
//    είναι όλες τις φωτογραφίες?"
//
// Until today the vessel brochure flow only extracted TEXT
// (year, builder, length, features) via Gemini. The PDF
// itself was discarded after the request. This module is the
// client-side half of the new "auto-extract photos from
// brochure" flow:
//
//   1. Render every page of the PDF to a hi-res canvas.
//   2. Read each page's text-content. Pages with little text
//      are typically photo spreads (gallery shots, lifestyle
//      images, full-bleed yacht profiles). Pages with heavy
//      text are typically specs / floorplans / contact pages,
//      which we want to filter OUT — the customer cabin shows
//      a photo wall, not a deck plan.
//   3. Encode the survivors as JPEG at ~85% quality with a
//      1600px long edge — quality the customer wants to see
//      but small enough that 12 photos × ~500 KB ≈ 6 MB total
//      doesn't punish the Vercel function body.
//   4. Return Promise<File[]> ready to be POSTed multipart.
//
// We deliberately do this client-side rather than server-side
// because:
//   • pdfjs-dist is already a CRM dep (passport compression
//     uses it). No new bundle weight on the public site.
//   • The PDF was just in the operator's browser — sending it
//     back to the server only to render N pages would burn
//     Vercel function time for free.
//   • Each rendered page is a separate small JPEG; the multi-
//     part upload streams them past Vercel's 4.5 MB body cap.
// =============================================================

// 2026-05-22 — Render at 1600px long edge for crisp customer
// display. Quality at 0.85 → ~400-700 KB per yacht photo.
const LONG_EDGE = 1600;
const QUALITY = 0.85;
// Pages with fewer than this many characters of extracted text
// are kept as photos. Brochure photo pages typically have 0-30
// chars (a small caption); specs / floorplan pages have 250+.
const PHOTO_PAGE_TEXT_THRESHOLD = 80;
// Never return more than this many photos — even visually
// "thin" brochures can have 20+ photo spreads. The customer
// cabin shows a hero + 3-tile teaser + the full /cabin/vessel
// gallery; we don't need 30 images.
const MAX_PHOTOS = 12;

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[brochure-photos]", ...args);
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = await import("pdfjs-dist");
      if (typeof window !== "undefined") {
        (
          mod as unknown as { GlobalWorkerOptions: { workerSrc: string } }
        ).GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      }
      return mod;
    })();
  }
  return pdfjsPromise;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null")),
      "image/jpeg",
      quality,
    );
  });
}

export interface ExtractedBrochurePhoto {
  /** Page number (1-indexed) in the source PDF. */
  page: number;
  /** Rendered JPEG ready to upload. */
  file: File;
  /** Number of text chars on that page — lower means more visual. */
  textChars: number;
  /** Pixel width of the rendered canvas (for diagnostics). */
  width: number;
  /** Pixel height of the rendered canvas. */
  height: number;
}

export interface ExtractBrochurePhotosResult {
  photos: ExtractedBrochurePhoto[];
  /** Total pages walked — informational; some may have been
   *  skipped as text-heavy. */
  totalPages: number;
  /** Pages skipped because they exceeded PHOTO_PAGE_TEXT_THRESHOLD. */
  skippedTextHeavyPages: number;
}

/**
 * Extract photo pages from a vessel brochure PDF. Quiet on
 * failure — returns `{photos: [], …}` rather than throwing so
 * callers can fall back to text-only extraction without
 * surfacing a scary error to the operator.
 */
export async function extractBrochurePhotos(
  file: File,
): Promise<ExtractBrochurePhotosResult> {
  if (typeof window === "undefined") {
    return { photos: [], totalPages: 0, skippedTextHeavyPages: 0 };
  }

  log("starting extraction; size", file.size, "type", file.type);

  let pdfjsLib;
  try {
    pdfjsLib = await getPdfJs();
  } catch (e) {
    log("pdf.js failed to load", e);
    return { photos: [], totalPages: 0, skippedTextHeavyPages: 0 };
  }

  let pdf;
  try {
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    pdf = await pdfjsLib.getDocument({ data }).promise;
  } catch (e) {
    log("could not open PDF", e);
    return { photos: [], totalPages: 0, skippedTextHeavyPages: 0 };
  }

  const totalPages = pdf.numPages;
  log("pdf has", totalPages, "pages");

  const photos: ExtractedBrochurePhoto[] = [];
  let skippedTextHeavyPages = 0;

  for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
    if (photos.length >= MAX_PHOTOS) {
      log("reached max", MAX_PHOTOS, "photos; stopping");
      break;
    }

    let page;
    try {
      page = await pdf.getPage(pageNo);
    } catch (e) {
      log("page", pageNo, "failed to load:", e);
      continue;
    }

    // 2026-05-22 — Text-density filter. We grab the page's
    // text content via pdf.js's textContent API; concatenate
    // the str fields; count characters. < 80 chars → almost
    // certainly a photo page. ≥ 80 chars → specs / floorplan
    // / contact page that the customer doesn't need to see.
    let textChars = 0;
    try {
      const textContent = await page.getTextContent();
      type TextItem = { str?: string };
      const items = textContent.items as TextItem[];
      const flat = items
        .map((it) => (typeof it?.str === "string" ? it.str : ""))
        .join(" ")
        .trim();
      textChars = flat.length;
    } catch (e) {
      log("page", pageNo, "textContent failed (treating as photo):", e);
      textChars = 0;
    }

    if (textChars > PHOTO_PAGE_TEXT_THRESHOLD) {
      log("page", pageNo, "skip — text-heavy", textChars, "chars");
      skippedTextHeavyPages++;
      continue;
    }

    // Render the page to a canvas, scaled so the long edge is
    // ~LONG_EDGE pixels.
    let canvas: HTMLCanvasElement;
    try {
      const baseViewport = page.getViewport({ scale: 1 });
      const longEdgePx = Math.max(baseViewport.width, baseViewport.height);
      // Cap scale at 3.0 in case of tiny source pages; we never
      // want to render a 6000px canvas accidentally.
      const scale = Math.min(3.0, LONG_EDGE / longEdgePx);
      const viewport = page.getViewport({ scale });
      canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        log("page", pageNo, "no 2D context — skip");
        continue;
      }
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    } catch (e) {
      log("page", pageNo, "render failed:", e);
      continue;
    }

    let blob: Blob;
    try {
      blob = await canvasToJpeg(canvas, QUALITY);
    } catch (e) {
      log("page", pageNo, "toBlob failed:", e);
      continue;
    }

    const photoFile = new File(
      [blob],
      `brochure-page-${String(pageNo).padStart(2, "0")}.jpg`,
      { type: "image/jpeg" },
    );
    photos.push({
      page: pageNo,
      file: photoFile,
      textChars,
      width: canvas.width,
      height: canvas.height,
    });
    log(
      "page",
      pageNo,
      "kept · text",
      textChars,
      "chars · size",
      (photoFile.size / 1024).toFixed(0),
      "KB",
    );
  }

  log(
    "done · kept",
    photos.length,
    "of",
    totalPages,
    "(",
    skippedTextHeavyPages,
    "skipped text-heavy )",
  );

  return { photos, totalPages, skippedTextHeavyPages };
}
