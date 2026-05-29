// GET /api/helm/render-test — Step 2 RISK-GATE ONLY (temporary).
//
// Proves that @sparticuz/chromium-min + puppeteer-core launch on
// Vercel, render a branded test page (navy background + metallic-gold
// gradient text via -webkit-background-clip + printBackground), and
// return a PDF — all under the 250MB serverless function limit. This
// is the one unknown for The Helm's proposal renderer; everything
// downstream (Generate/Send) is gated on this passing.
//
// Delete this route once the real renderer ships in Step 3.
//
// Auth: requires a signed-in admin session (same cookie as the
// dashboard) so it is not an open PDF generator. Visit the URL while
// logged into the CRM.

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

// Minimal page that exercises the two things that can silently break:
//   1. printBackground — without it the navy bg + gradient vanish.
//   2. -webkit-background-clip:text gradient — the "metallic gold".
// (Custom base64 @font-face is the real renderer's job in Step 3;
//  this gate only needs to prove Chromium launches + paints.)
const TEST_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; width: 210mm; height: 297mm; background: #0D1B2A; color: #F4F1EA;
         font-family: Georgia, "Times New Roman", serif;
         display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .gold {
    font-size: 42pt; letter-spacing: .12em; font-weight: 700;
    background: linear-gradient(180deg,#FBF0C4 0%,#E8CD86 40%,#CBA456 58%,#A07C32 100%);
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,.40));
  }
  .sub { margin-top: 8mm; font-size: 11pt; letter-spacing: .3em; color: #C9A84C; text-transform: uppercase; }
</style></head><body>
  <div class="gold">GEORGE YACHTS</div>
  <div class="sub">render gate &#9670; chromium-min OK</div>
</body></html>`;

export async function GET() {
  const email = await adminEmail();
  if (!email) return new Response("unauthorized", { status: 401 });

  // Default to the public v149 x64 pack so this gate works on a fresh
  // preview with ZERO env setup. CHROMIUM_PACK_URL overrides it (e.g. a
  // Supabase Storage / Vercel Blob mirror) for production hardening.
  const packUrl =
    process.env.CHROMIUM_PACK_URL ||
    "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

  // We don't need WebGL/graphics for a static page — saves memory.
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
    // HTML is fully self-contained (inline CSS, and in the real
    // renderer base64-embedded fonts/images) — there is no network to
    // idle on, so "load" is the correct and sufficient wait condition.
    await page.setContent(TEST_HTML, { waitUntil: "load" });
    await page.evaluateHandle("document.fonts.ready");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="helm-render-test.pdf"',
      },
    });
  } catch (e) {
    return new Response("render failed: " + (e as Error).message, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
}
