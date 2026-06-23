// scripts/_terms_sample.ts — THROWAWAY render fixture for the OWNER-SELECTABLE
// last-page TERMS engine. NOT for commit. Builds a BAREBOAT sample from the real
// stored offer (/tmp/proposal_full.json) populated with REAL data from a pasted
// supplier email, so the owner sees a fully-populated last page. Also renders a
// WEEKLY no-terms sample to confirm byte-identical output vs the pre-change
// baseline. Uses system Chrome exactly like _charter_type_samples.ts.
//
//   npx tsx scripts/_terms_sample.ts
//
// Outputs:
//   /tmp/sample_terms.pdf   bareboat + populated terms + crew_note
//   /tmp/sample_terms.html  (the HTML for the above)
//   /tmp/weekly_noterms.html  weekly, no terms (for the byte-identical diff)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FULL_JSON = "/tmp/proposal_full.json";

function findChrome(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium", "chromium-browser",
  ];
  for (const c of candidates) {
    try {
      if (c.startsWith("/")) { if (existsSync(c)) return c; }
      else { execFileSync("which", [c], { stdio: "ignore" }); return c; }
    } catch { /* keep looking */ }
  }
  throw new Error("No system Chrome/Chromium found.");
}

async function renderPdf(html: string, htmlPath: string, pdfPath: string) {
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

  // REAL data from a pasted supplier email — drives a fully-populated last page.
  const terms = {
    included: [
      "Use of the yacht and her equipment",
      "Marine insurance",
      "VAT 12% (included in the charter price)",
    ],
    not_included: ["Fuel", "Port fees", "Food and beverages"],
    obligatory_extras: [
      "Charter Pack EUR 250 — end cleaning, bed linen & towels, gas, outboard fuel, first/last night mooring",
    ],
    free_onboard: ["1 SUP", "Welcome Pack (Greek products)", "Espresso coffee maker", "Snorkelling equipment"],
    security_deposit: "EUR 3,000 refundable, payable at base by Visa/Mastercard",
    payment: "50% within 5 days of booking confirmation; balance 30 days before embarkation",
    skipper: "Skipper licence required for bareboat; a professional skipper can be arranged on request",
  };

  // BAREBOAT + populated terms + crew_note. NOTE: base is white_label:true; force
  // it OFF here so the owner sees the George-branded © legal footer too.
  const bareboat = {
    ...base,
    white_label: false,
    charter_type: "bareboat",
    crew_note: "Private skipper — not charged",
    terms,
  };
  await renderPdf(buildProposalHtml(bareboat), "/tmp/sample_terms.html", "/tmp/sample_terms.pdf");

  // WEEKLY, no terms — for the byte-identical diff vs the pre-change baseline.
  const weekly = { ...base, charter_type: "weekly" };
  writeFileSync("/tmp/weekly_noterms.html", buildProposalHtml(weekly));
  console.log("[html] /tmp/weekly_noterms.html");
}

main().catch((err) => { console.error(err); process.exit(1); });
