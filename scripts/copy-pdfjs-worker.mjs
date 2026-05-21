// scripts/copy-pdfjs-worker.mjs
// =============================================================
// Copy the pdf.js worker out of node_modules and into public/
// so it's served from the same origin as the app. This avoids
// the failure mode where a CDN-hosted worker either gets blocked
// by a corporate proxy, fails to load on a slow connection, or
// version-mismatches with the runtime pdf.js bundle.
//
// Runs as part of the prebuild step (npm scripts) so the file is
// always in sync with whichever pdfjs-dist version is installed.
// =============================================================

import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const src = join(
  repoRoot,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const dest = join(repoRoot, "public", "pdfjs", "pdf.worker.min.mjs");

try {
  await stat(src);
} catch {
  console.warn(`[copy-pdfjs-worker] source missing at ${src} — skipping`);
  process.exit(0);
}

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);
const s = await stat(dest);
console.log(
  `[copy-pdfjs-worker] copied → ${dest} (${(s.size / 1024).toFixed(0)} KB)`,
);
