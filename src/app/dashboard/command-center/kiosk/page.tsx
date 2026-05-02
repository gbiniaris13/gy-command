// /dashboard/command-center/kiosk — mobile/kiosk-first big-number view.
//
// Lives inside /dashboard/* so the auth middleware guards it the same
// way as the rest of the CRM. Same snapshot helper as the main
// Command Center; the layout just trades the Tron HUD theatre for
// readability at arm's length on a phone or pinned-screen.
//
// Auto-refresh every 60s (client-side) so it stays current on a
// kiosk display without manual reload.

import { createServiceClient } from "@/lib/supabase-server";
import {
  buildCommandCenterSnapshot,
  emptySnapshot,
  type CommandCenterSnapshot,
} from "@/lib/command-center-snapshot";
import KioskView from "./KioskView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadSnapshot(): Promise<CommandCenterSnapshot> {
  try {
    const sb = createServiceClient();
    return await buildCommandCenterSnapshot(sb);
  } catch (e) {
    console.error("[command-center/kiosk] snapshot failed:", e);
    return emptySnapshot();
  }
}

export default async function KioskPage() {
  const snapshot = await loadSnapshot();
  return <KioskView snapshot={snapshot} />;
}
