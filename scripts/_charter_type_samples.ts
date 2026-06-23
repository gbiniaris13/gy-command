// scripts/_charter_type_samples.ts — THROWAWAY render fixture for the
// CHARTER-TYPE engine. NOT for commit. Renders the SAME real stored offer
// (/tmp/proposal_full.json — a combined/weekly offer) three times, once per
// charter_type, so the owner can eyeball weekly vs bareboat vs daily on his
// actual yachts. Uses system Chrome exactly like _redesign_render.ts.
//
//   npx tsx scripts/_charter_type_samples.ts
//
// Outputs:
//   /tmp/sample_weekly.pdf    charter_type = weekly  (must equal the baseline render)
//   /tmp/sample_bareboat.pdf  charter_type = bareboat + a sample crew_note
//   /tmp/sample_daily.pdf     charter_type = daily

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FULL_JSON = "/tmp/proposal_full.json";

function findChrome(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ];
  for (const c of candidates) {
    try {
      if (c.startsWith("/")) { if (existsSync(c)) return c; }
      else { execFileSync("which", [c], { stdio: "ignore" }); return c; }
    } catch { /* keep looking */ }
  }
  throw new Error("No system Chrome/Chromium found.");
}

async function render(pj: any, htmlPath: string, pdfPath: string, build: (d: any) => string) {
  const html = build(pj);
  writeFileSync(htmlPath, html);
  const chrome = findChrome();
  execFileSync(
    chrome,
    ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, htmlPath],
    { stdio: "ignore" },
  );
  const stat = readFileSync(pdfPath);
  console.log(`[pdf] ${pdfPath} (${(stat.length / 1024).toFixed(0)} KB)`);
}

async function main() {
  if (!existsSync(FULL_JSON)) throw new Error(`Need ${FULL_JSON} (the real stored offer).`);
  const { buildProposalHtml } = await import("../src/lib/helm/proposal-template");
  const base = JSON.parse(readFileSync(FULL_JSON, "utf8"));

  // WEEKLY — charter_type explicitly weekly (defaults the same).
  const weekly = { ...base, charter_type: "weekly" };
  await render(weekly, "/tmp/sample_weekly.html", "/tmp/sample_weekly.pdf", buildProposalHtml);

  // BAREBOAT — with a sample crew_note.
  const bareboat = { ...base, charter_type: "bareboat", crew_note: "Private skipper — not charged" };
  await render(bareboat, "/tmp/sample_bareboat.html", "/tmp/sample_bareboat.pdf", buildProposalHtml);

  // DAILY.
  const daily = { ...base, charter_type: "daily" };
  await render(daily, "/tmp/sample_daily.html", "/tmp/sample_daily.pdf", buildProposalHtml);
}

main().catch((err) => { console.error(err); process.exit(1); });
