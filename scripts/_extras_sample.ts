// scripts/_extras_sample.ts — THROWAWAY render fixture for the PER-YACHT
// bareboat EXTRAS money box. NOT for commit. Builds a BAREBOAT combined sample
// where TWO yachts carry REAL per-yacht extras from a Vernicos-style email, so
// the owner can confirm each yacht's page shows ITS OWN payable-at-base /
// deposit / on-board, stays on ONE A4 page, and shows NO commission anywhere.
// Reuses the real stored offer (/tmp/proposal_full.json) for real photos; the
// two lead yachts are overridden with the Vernicos spec. Uses system Chrome
// exactly like _charter_type_samples.ts / _terms_sample.ts.
//
//   npx tsx scripts/_extras_sample.ts
//
// Outputs:
//   /tmp/sample_extras.pdf    bareboat, 2 yachts with real per-yacht extras
//   /tmp/sample_extras.html   (the HTML for the above)
//   /tmp/weekly_noextras.html weekly, no extras (for the byte-identical diff)

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

  // Keep two yachts (for their real photos), override them with the Vernicos
  // BAREBOAT spec + per-yacht extras. list -> -% -> client fee is computed
  // deterministically by the pricing engine from { charter_fee: list,
  // discount_pct }. NO commission is ever placed on the yacht (internal only).
  const yA = {
    ...base.yachts[0],
    name: "Oceanis 46.1",
    type: "SAILING YACHT · BAREBOAT",
    tier_label: "The Considered Value",
    voyage_line: "Round trip · Lavrion · 25 June - 3 July",
    description: "A bright, contemporary 46-footer — four double cabins, an easy sail plan and a generous cockpit for long Cycladic lunches.",
    inside_info: "Ask the base for the updated chart plotter — the 2024 unit has the latest Aegean cartography pre-loaded.",
    pricing: {
      mode: "breakdown",
      currency: "EUR",
      charter_fee: 6000,     // LIST rate
      discount_pct: 18,      // -18% => client fee 4,920 (computed by the engine)
      apa_pct: null, apa_amount: null, vat_pct: null, vat_amount: null,
      extras_text: null, all_inclusive_total: null,
      relocation_fee: null, relocation_note: null, all_in_override: null,
    },
    payable_at_base: [
      { label: "Charter Pack — end cleaning, linen & towels, gas, outboard fuel, first/last night mooring", amount: "EUR 250" },
    ],
    security_deposit: "EUR 3,000 refundable (card at base)",
    free_onboard: ["1 SUP", "Welcome Pack", "Espresso maker", "Snorkelling gear"],
  };

  const yB = {
    ...base.yachts[1],
    name: "Oceanis 51.1",
    type: "SAILING YACHT · BAREBOAT",
    tier_label: "The Statement",
    voyage_line: "Round trip · Lavrion · 25 June - 3 July",
    description: "The flagship of the line — five cabins, twin helms and a beam that turns the saloon into a genuine social space.",
    inside_info: "The owner's version forward cabin is the one to take — full-height hanging lockers and an en-suite you can actually move in.",
    pricing: {
      mode: "breakdown",
      currency: "EUR",
      charter_fee: 7400,     // LIST rate
      discount_pct: 30,      // -30% => client fee 5,180 (computed by the engine)
      apa_pct: null, apa_amount: null, vat_pct: null, vat_amount: null,
      extras_text: null, all_inclusive_total: null,
      relocation_fee: null, relocation_note: null, all_in_override: null,
    },
    payable_at_base: [
      { label: "Charter Pack", amount: "EUR 290" },
    ],
    security_deposit: "EUR 3,500 refundable (card at base)",
    free_onboard: ["1 SUP", "Welcome Pack"],
  };

  // BAREBOAT combined sample. Force George-branded (not white-label) so the
  // legal © footer renders too. Two yachts, each with its OWN extras.
  const bareboat = {
    ...base,
    white_label: false,
    charter_type: "bareboat",
    crew_note: "",
    yachts: [yA, yB],
  };
  await renderPdf(buildProposalHtml(bareboat), "/tmp/sample_extras.html", "/tmp/sample_extras.pdf");

  // WEEKLY, no extras — for the byte-identical diff vs the pre-change baseline.
  const weekly = { ...base, charter_type: "weekly" };
  writeFileSync("/tmp/weekly_noextras.html", buildProposalHtml(weekly));
  console.log("[html] /tmp/weekly_noextras.html");
}

main().catch((err) => { console.error(err); process.exit(1); });
