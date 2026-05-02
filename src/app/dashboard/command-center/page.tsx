// /dashboard/command-center — Tron-style aggregated overview.
//
// Server component: fetches the live snapshot from the helper (which
// reuses the cached cockpit briefing when available) and passes it as
// props to the client component. If the snapshot fails, we render with
// the empty-state default so the page never blanks out.
//
// Newsletter operations live at /dashboard/newsletter and are NOT
// surfaced here — that's by design.

import { createServiceClient } from "@/lib/supabase-server";
import {
  buildCommandCenterSnapshot,
  emptySnapshot,
  type CommandCenterSnapshot,
} from "@/lib/command-center-snapshot";
import CommandCenter from "./CommandCenter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadSnapshot(): Promise<CommandCenterSnapshot> {
  try {
    const sb = createServiceClient();
    return await buildCommandCenterSnapshot(sb);
  } catch (e) {
    console.error("[command-center/page] snapshot failed:", e);
    return emptySnapshot();
  }
}

export default async function CommandCenterPage() {
  const snapshot = await loadSnapshot();
  return <CommandCenter snapshot={snapshot} />;
}
