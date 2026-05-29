// src/lib/helm/render.ts
// =============================================================
// Server-side HTML -> PDF for The Helm proposal, via headless
// Chromium (@sparticuz/chromium-min + puppeteer-core). Same recipe
// proven by the Step 2 risk-gate: the chromium binary is fetched at
// cold start from the remote pack (never bundled), printBackground +
// document.fonts.ready are mandatory for the gradient + embedded fonts.
//
// Runs on Vercel Node serverless (NOT edge). Fonts are base64-embedded
// in the HTML by proposal-template.ts, so no system fonts are needed.
// =============================================================

import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

const DEFAULT_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

export async function renderProposalPdf(html: string): Promise<Uint8Array> {
  const packUrl = process.env.CHROMIUM_PACK_URL || DEFAULT_PACK_URL;

  // No WebGL/graphics needed for a static document — saves memory.
  chromium.setGraphicsMode = false;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1240, height: 1754, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(packUrl),
      headless: true,
    });
    const page = await browser.newPage();
    // HTML is fully self-contained (inline CSS + base64 fonts + base64
    // or absolute-URL images), so "load" is the correct wait condition.
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluateHandle("document.fonts.ready");
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    if (browser) await browser.close();
  }
}
