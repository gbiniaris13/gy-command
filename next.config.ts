import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ojpcmnnqohxlfsudvxcz.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable__yNJKcssEsLPHv0Xuh-f7A_HW447VM0",
  },
  // The Helm proposal renderer: keep the headless-Chromium packages
  // out of the webpack/Turbopack bundle so they're required at runtime
  // from node_modules (the chromium binary itself is fetched at cold
  // start from CHROMIUM_PACK_URL, never bundled — keeps us under the
  // 250MB function limit).
  // sharp ships prebuilt native binaries, so it must be required at runtime
  // rather than bundled. The proposal generator uses it to normalise every
  // inlined photo before the PDF render (see generate/route.ts fitForPdf).
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core", "sharp"],
};

export default nextConfig;
