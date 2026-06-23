// scripts/_redesign_render.ts — THROWAWAY render fixture for the proposal-template
// redesign. NOT for commit. Renders the REAL stored combined offer through the
// new buildProposalHtml so the owner can judge the look on his actual yachts.
//
//   npx tsx scripts/_redesign_render.ts
//
// Data source, in order of preference:
//   1) live Supabase via getRequest(ID) when NEXT_PUBLIC_SUPABASE_URL +
//      SUPABASE_SERVICE_ROLE_KEY are present (reads .env.local if available);
//   2) the real proposal_json already pulled from the DB to /tmp/proposal_full.json
//      (id 8941124d-59ac-4e9a-b9f3-17e4c51cea71 — the one combined offer in this
//      project's Supabase; the ID in the brief, c98d5c87…, is not in THIS db).
// Then: write /tmp/redesign.html and render /tmp/redesign.pdf with system Chrome.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REQUEST_ID = "c98d5c87-b12b-43f0-9517-2442cd7291bf"; // per the brief
const FALLBACK_ID = "8941124d-59ac-4e9a-b9f3-17e4c51cea71"; // real combined offer in this db
const FULL_JSON = "/tmp/proposal_full.json";

async function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (existsSync(p) && typeof (process as any).loadEnvFile === "function") {
    try { (process as any).loadEnvFile(p); } catch { /* ignore */ }
  }
}

async function getProposalJson(): Promise<unknown> {
  await loadEnvLocal();
  const haveEnv =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (haveEnv) {
    try {
      const { getRequest } = await import("../src/lib/helm-admin");
      const r: any = await getRequest(REQUEST_ID).catch(() => null);
      if (r?.proposal_json) {
        console.log(`[data] live Supabase getRequest(${REQUEST_ID})`);
        return r.proposal_json;
      }
      const r2: any = await getRequest(FALLBACK_ID).catch(() => null);
      if (r2?.proposal_json) {
        console.log(`[data] live Supabase getRequest(${FALLBACK_ID}) [fallback id]`);
        return r2.proposal_json;
      }
    } catch (err) {
      console.log("[data] Supabase path failed, falling back to /tmp:", (err as Error).message);
    }
  } else {
    console.log("[data] no Supabase env — using on-disk real proposal_json");
  }
  if (existsSync(FULL_JSON)) {
    console.log(`[data] reading real proposal_json from ${FULL_JSON}`);
    return JSON.parse(readFileSync(FULL_JSON, "utf8"));
  }
  throw new Error(
    `No data source: set Supabase env, or provide ${FULL_JSON} (the real stored offer).`,
  );
}

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

async function main() {
  const { buildProposalHtml } = await import("../src/lib/helm/proposal-template");
  const pj = await getProposalJson();
  const html = buildProposalHtml(pj as any);
  writeFileSync("/tmp/redesign.html", html);
  console.log(`[html] wrote /tmp/redesign.html (${(html.length / 1024).toFixed(0)} KB)`);

  const chrome = findChrome();
  console.log(`[chrome] ${chrome}`);
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--print-to-pdf=/tmp/redesign.pdf",
      "/tmp/redesign.html",
    ],
    { stdio: "inherit" },
  );
  const stat = readFileSync("/tmp/redesign.pdf");
  console.log(`[pdf] wrote /tmp/redesign.pdf (${(stat.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
