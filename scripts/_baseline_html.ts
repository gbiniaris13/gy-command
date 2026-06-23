// scripts/_baseline_html.ts — THROWAWAY. Emits the weekly proposal HTML for the
// real stored offer to a path given as argv[2]. Used to prove byte-identical
// output before vs after the terms change.
//   npx tsx scripts/_baseline_html.ts /tmp/weekly_baseline.html
import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: _baseline_html.ts <out.html>");
  const { buildProposalHtml } = await import("../src/lib/helm/proposal-template");
  const base = JSON.parse(readFileSync("/tmp/proposal_full.json", "utf8"));
  const weekly = { ...base, charter_type: "weekly" };
  writeFileSync(out, buildProposalHtml(weekly));
  console.log(`[html] ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
