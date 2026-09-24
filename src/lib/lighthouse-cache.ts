// The Lighthouse snapshot lives in settings.lighthouse_cache_v1 and is served
// as-is on every GET (George's law: "τα τραβάει ΜΙΑ φορά, τα έχει και έτοιμα").
// Any mutation that changes WHO the Lighthouse should know about, or how,
// must flag that snapshot stale so the next open recomputes in the
// background. The booking panel in The Helm is one such mutation: turning
// "white label" on removes a whole family from the Lighthouse.
//
// Same behaviour as bustCache() inside /api/lighthouse/route.ts, exported so
// other routes can call it without importing the route module.

import { getSetting, setSetting } from "@/lib/google-api";

export const LIGHTHOUSE_CACHE_KEY = "lighthouse_cache_v1";

export async function markLighthouseStale(): Promise<void> {
  try {
    const raw = await getSetting(LIGHTHOUSE_CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached?.payload) {
        await setSetting(LIGHTHOUSE_CACHE_KEY, JSON.stringify({ ...cached, stale: true }));
        return;
      }
    }
    await setSetting(LIGHTHOUSE_CACHE_KEY, "");
  } catch {
    /* a stale flag that fails to write only delays the refresh */
  }
}
