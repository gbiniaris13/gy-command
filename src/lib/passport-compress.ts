// src/lib/passport-compress.ts
// =============================================================
// Client-side compression for passport uploads.
//
// Vercel serverless functions cap the request body at ~4.5 MB on
// the default plan. A typical phone-scanned passport PDF embeds a
// 10-15 MB image, easily blowing past that ceiling and producing
// a HTTP 413 the moment George tries to upload. Tricia Stevens'
// own passport PDF in the test set is 22 MB.
//
// This module takes whatever George drops (PDF or image) and
// returns a small JPEG File that the Vercel function can accept.
// It preserves the legibility of:
//   • the visual bio panel (name, DOB, place of birth, dates)
//   • the Machine Readable Zone (MRZ) — Gemini cross-references
//     it against the visual fields
//
// Sizing rule of thumb: passport bio pages are roughly 1500×2000
// pixels at decent phone-scan resolution. Re-rendering at 1800px
// long edge keeps every glyph readable while typically landing
// the output under 1 MB at JPEG quality 0.88.
// =============================================================

// We DELIBERATELY do not static-import pdfjs-dist at module scope.
// pdfjs references DOMMatrix at the top level, and Next.js
// prerendering of any page that transitively imports this module
// will crash on the server with "ReferenceError: DOMMatrix is not
// defined" before the file even gets to its guards.
//
// Instead we lazy-import inside compressPdfFile() so pdfjs only
// loads when we're actually in the browser, about to compress.

const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.88;

// Lazy pdfjs setup — first call kicks off the import + worker wiring,
// subsequent calls reuse the same module. Memoised so we don't pay
// the bundle cost twice.
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = await import("pdfjs-dist");
      // Point at the version-matched worker on jsDelivr so we
      // don't have to ship the worker bundle ourselves. Set only
      // when running in the browser; on the server the import
      // will never actually fire (this module is only called
      // inside event handlers).
      if (typeof window !== "undefined") {
        (mod as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${mod.version}/build/pdf.worker.min.mjs`;
      }
      return mod;
    })();
  }
  return pdfjsPromise;
}

// Render a canvas to a Blob using the modern API with a polyfill
// for browsers (Safari pre-16, mainly) that only expose the
// toBlob callback form.
function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      },
      "image/jpeg",
      quality,
    );
  });
}

async function compressImageFile(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = (e) =>
        reject(new Error(`Image load failed: ${String(e)}`));
      i.src = url;
    });
    let { width, height } = img;
    if (width > MAX_EDGE || height > MAX_EDGE) {
      const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D canvas context");
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY);
    return new File(
      [blob],
      file.name.replace(/\.(png|jpe?g|gif|webp|heic)$/i, "") + "-compressed.jpg",
      { type: "image/jpeg" },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressPdfFile(file: File): Promise<File> {
  const pdfjsLib = await getPdfJs();
  const buf = await file.arrayBuffer();
  // PDF.js wants a typed array, not the raw ArrayBuffer.
  const data = new Uint8Array(buf);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  if (pdf.numPages < 1) {
    throw new Error("PDF has no pages");
  }
  const page = await pdf.getPage(1);
  // PDF.js viewport scale 1 = 72 DPI. We want enough pixels that
  // the long edge lands near MAX_EDGE without going over.
  const baseViewport = page.getViewport({ scale: 1 });
  const longEdge = Math.max(baseViewport.width, baseViewport.height);
  const scale = MAX_EDGE / longEdge;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY);
  return new File(
    [blob],
    file.name.replace(/\.pdf$/i, "") + "-p1.jpg",
    { type: "image/jpeg" },
  );
}

// 2026-05-21 — Public entry point. Returns a JPEG File compressed
// enough to fit Vercel's body cap, regardless of whether George
// dropped a high-res PDF scan or a phone-camera image.
export async function compressPassportForUpload(file: File): Promise<File> {
  if (file.type === "application/pdf") {
    return compressPdfFile(file);
  }
  if (file.type.startsWith("image/")) {
    return compressImageFile(file);
  }
  throw new Error("Unsupported file type — drop a PDF or an image.");
}
