// src/lib/passport-compress.ts
// =============================================================
// Client-side passport compression. Bulletproof to whatever
// George's 70-year-old clients send: phone photos, scanned PDFs,
// HEIC from iPhones, PNGs, JPEGs, multi-page contracts mislabelled
// as passports, files with no MIME type, files with wrong MIME
// type. The whole point: George never sees a 413 again.
//
// Goal: produce a JPEG ≤ 3.5 MB. Vercel's serverless body cap is
// ~4.5 MB; we keep a 1 MB safety margin for multipart overhead.
//
// Strategy:
//   1. Detect by content, not by MIME alone (sniff the file
//      header so a misnamed .pdf-with-image-payload still works).
//   2. Render to canvas at a generous initial resolution.
//   3. If the encoded JPEG is still over the cap, RE-encode at
//      progressively lower resolutions until it fits, then
//      progressively lower quality. Caps the loop so it never
//      runs forever.
//   4. Log every step to the console — if it ever fails again
//      George can paste the log and we'll know exactly where.
//   5. Verify the final size BEFORE returning. If we still can't
//      get under the cap, throw a clear human-readable error so
//      the surrounding UI can surface it.
// =============================================================

const TARGET_MAX_BYTES = 3.5 * 1024 * 1024; // 3.5 MB ceiling
const INITIAL_LONG_EDGE = 1800;
const MIN_LONG_EDGE = 600; // below this we'd lose MRZ legibility
const INITIAL_QUALITY = 0.88;
const MIN_QUALITY = 0.55;

function log(...args: unknown[]) {
  // Keep the prefix so it's easy to find in DevTools.
  // eslint-disable-next-line no-console
  console.log("[passport-compress]", ...args);
}

// =============================================================
// Sniff the first few bytes of the file. Used as a fallback when
// the browser doesn't set a useful MIME type (HEIC from iPhone
// photos sometimes arrives as "" or "image/heic", and the App
// Files picker is famously inconsistent).
// =============================================================
async function sniffKind(file: File): Promise<"pdf" | "image" | "unknown"> {
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";

  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    // PDF magic: %PDF
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
      return "pdf";
    }
    // JPEG magic: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image";
    // PNG magic: 89 50 4E 47
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image";
    // HEIC / HEIF: bytes 4-11 contain "ftypheic", "ftypheix", "ftypmif1", "ftypmsf1"
    const ascii = String.fromCharCode(...head.slice(4, 12));
    if (
      ascii.startsWith("ftypheic") ||
      ascii.startsWith("ftypheix") ||
      ascii.startsWith("ftypmif1") ||
      ascii.startsWith("ftypmsf1") ||
      ascii.startsWith("ftyphevc")
    ) {
      // HEIC isn't supported by canvas in most browsers — but the
      // page might handle it via createImageBitmap on Safari/iOS.
      return "image";
    }
  } catch (e) {
    log("sniff failed", e);
  }
  return "unknown";
}

// =============================================================
// PDF.js lazy loader. We deliberately avoid the top-level
// import — pdfjs touches DOMMatrix on module load, which crashes
// Next.js server-side prerender.
// =============================================================
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      log("loading pdf.js…");
      const mod = await import("pdfjs-dist");
      log("pdf.js version", mod.version);
      if (typeof window !== "undefined") {
        // Self-host the worker so we don't depend on a CDN reaching
        // the user's browser. /pdfjs/pdf.worker.min.mjs ships as a
        // static asset (see scripts/copy-pdfjs-worker.mjs which runs
        // in the prebuild step).
        (
          mod as unknown as { GlobalWorkerOptions: { workerSrc: string } }
        ).GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      }
      return mod;
    })();
  }
  return pdfjsPromise;
}

// =============================================================
// Canvas → JPEG Blob. Promisified wrapper around toBlob.
// =============================================================
function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      "image/jpeg",
      quality,
    );
  });
}

// =============================================================
// Get a renderable bitmap from the file. Three paths:
//   PDF      → pdf.js renders page 1 to canvas
//   image    → Image() + drawImage, or createImageBitmap as
//              fallback (handles HEIC on Safari)
// Returns a canvas at the source resolution; downscaling happens
// later in iterativeCompress.
// =============================================================
async function fileToSourceCanvas(file: File): Promise<HTMLCanvasElement> {
  const kind = await sniffKind(file);
  log("sniffed kind", kind, "size", file.size, "type", file.type || "(empty)");

  if (kind === "pdf") {
    const pdfjsLib = await getPdfJs();
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    log("pdf pages", pdf.numPages);
    if (pdf.numPages < 1) throw new Error("PDF has no pages");
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    log("pdf base viewport", baseViewport.width, "x", baseViewport.height);
    // Render at a high-ish scale here; iterativeCompress will
    // shrink as needed. Cap at 3.0× to avoid runaway canvas
    // dimensions on landscape passports.
    const longEdge = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(3.0, INITIAL_LONG_EDGE / longEdge);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D context");
    log("pdf render canvas", canvas.width, "x", canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  if (kind === "image" || kind === "unknown") {
    // Try createImageBitmap first — handles HEIC on Safari, faster
    // than Image() + drawImage. Fall back to Image() if it throws.
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      log("image (createImageBitmap)", canvas.width, "x", canvas.height);
      return canvas;
    } catch (e) {
      log("createImageBitmap failed, falling back to Image()", e);
    }

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = (ev) =>
          reject(
            new Error(
              "Image() load failed — your browser may not support this file format. Try saving the passport as JPG or PNG and re-upload.",
            ),
          );
        i.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      ctx.drawImage(img, 0, 0);
      log("image (Image())", canvas.width, "x", canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  throw new Error(
    "Unrecognised file format. Please upload the passport as PDF, JPG, PNG or HEIC.",
  );
}

// =============================================================
// Downscale a source canvas to a target long edge. Returns a new
// canvas at the new dimensions, drawn with smooth interpolation.
// =============================================================
function downscaleCanvas(src: HTMLCanvasElement, longEdge: number): HTMLCanvasElement {
  const srcLong = Math.max(src.width, src.height);
  if (srcLong <= longEdge) return src; // already small enough
  const ratio = longEdge / srcLong;
  const w = Math.round(src.width * ratio);
  const h = Math.round(src.height * ratio);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return out;
}

// =============================================================
// Iteratively shrink the canvas + quality until the encoded JPEG
// is under TARGET_MAX_BYTES. Logs every attempt.
// =============================================================
async function iterativeCompress(source: HTMLCanvasElement): Promise<Blob> {
  let longEdge = Math.min(
    INITIAL_LONG_EDGE,
    Math.max(source.width, source.height),
  );
  let quality = INITIAL_QUALITY;

  // First pass: shrink dimensions while keeping quality.
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = downscaleCanvas(source, longEdge);
    const blob = await canvasToJpeg(canvas, quality);
    log(
      `attempt #${attempt + 1} · ${canvas.width}x${canvas.height} @ q=${quality} → ${blob.size} bytes`,
    );
    if (blob.size <= TARGET_MAX_BYTES) return blob;
    if (longEdge <= MIN_LONG_EDGE) break;
    longEdge = Math.max(MIN_LONG_EDGE, Math.round(longEdge * 0.78));
  }

  // Second pass (only if still too big after pixel shrinks):
  // hold dimensions at MIN_LONG_EDGE, lower quality.
  while (quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.08);
    const canvas = downscaleCanvas(source, MIN_LONG_EDGE);
    const blob = await canvasToJpeg(canvas, quality);
    log(
      `quality pass · ${canvas.width}x${canvas.height} @ q=${quality} → ${blob.size} bytes`,
    );
    if (blob.size <= TARGET_MAX_BYTES) return blob;
  }

  throw new Error(
    `Could not compress passport below ${(TARGET_MAX_BYTES / 1024 / 1024).toFixed(1)} MB after exhaustive attempts. The source may be unusually large or non-photographic. Try saving as a regular JPG and re-upload.`,
  );
}

// =============================================================
// Public entry point.
// =============================================================
export async function compressPassportForUpload(file: File): Promise<File> {
  log(
    "begin compression",
    file.name,
    `${(file.size / 1024 / 1024).toFixed(2)} MB`,
    `type=${file.type || "(empty)"}`,
  );
  const source = await fileToSourceCanvas(file);
  const jpeg = await iterativeCompress(source);
  const out = new File([jpeg], (file.name || "passport").replace(/\.[^.]+$/, "") + ".jpg", {
    type: "image/jpeg",
  });
  log(
    "compression done",
    out.name,
    `${(out.size / 1024 / 1024).toFixed(2)} MB · ${jpeg.size} bytes`,
  );
  return out;
}
