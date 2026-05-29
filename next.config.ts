import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://lquxemsonehfltdzdbhq.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_165zpH2bBgEXwy8ZQYL2sg_zUpEyrrn",
  },
  // The Helm proposal renderer: keep the headless-Chromium packages
  // out of the webpack/Turbopack bundle so they're required at runtime
  // from node_modules (the chromium binary itself is fetched at cold
  // start from CHROMIUM_PACK_URL, never bundled — keeps us under the
  // 250MB function limit).
  serverExternalPackages: ["@sparticuz/chromium-min", "puppeteer-core"],
};

export default nextConfig;
