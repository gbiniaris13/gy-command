// @ts-nocheck
/**
 * Cron execution observer.
 *
 * Lightweight instrumentation that wraps each IG cron's GET handler,
 * records START and END outcome into the `settings` KV table, and
 * lets the Thursday weekly-ops-report cron compute success / failure
 * / timeout counts + uptime %.
 *
 * Zero-DDL: uses the settings table with a `cron_run_<id>` key pattern.
 * Auto-prunes rows older than 21 days on every call.
 *
 * Pattern to wrap an existing cron (minimal edit, 4 lines):
 *
 *   // Before:
 *   export async function GET(req) { ... }
 *
 *   // After:
 *   async function _impl(req) { ... }                    // rename
 *   export async function GET(req?: any) {
 *     return observeCron("instagram-my-cron", () => _impl(req));
 *   }
 *
 * The wrapper is best-effort: if the settings writes fail, the actual
 * cron still runs and returns its response normally — observability
 * never blocks a real publish or reply.
 *
 * Timeout detection: we write a START row when the cron begins. If
 * the cron completes (any outcome), we write an END row with the
 * same run_id. If the function times out (Vercel 504 before we finish),
 * no END row is written — the weekly report sees a START without an
 * END and classifies it as "timed out".
 */

import { createServiceClient } from "./supabase-server";

type Outcome = "success" | "error" | "skipped" | "exception";

const START_PREFIX = "cron_start_";
const END_PREFIX = "cron_end_";
const PRUNE_AFTER_DAYS = 21;

function generateRunId(): string {
  return (
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10)
  );
}

async function recordStart(
  sb: any,
  runId: string,
  name: string,
): Promise<void> {
  try {
    await sb.from("settings").insert({
      key: `${START_PREFIX}${runId}`,
      value: JSON.stringify({
        run_id: runId,
        name,
        started_at: new Date().toISOString(),
      }),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // fail-open
  }
}

async function recordEnd(
  sb: any,
  runId: string,
  name: string,
  startedAt: number,
  endedAt: number,
  outcome: Outcome,
  detail?: string,
): Promise<void> {
  try {
    await sb.from("settings").insert({
      key: `${END_PREFIX}${runId}`,
      value: JSON.stringify({
        run_id: runId,
        name,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        duration_ms: endedAt - startedAt,
        outcome,
        detail: detail ? String(detail).slice(0, 200) : null,
      }),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // fail-open
  }
}

async function pruneOld(sb: any): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - PRUNE_AFTER_DAYS * 86400000,
    ).toISOString();
    await sb.from("settings").delete().like("key", `${START_PREFIX}%`).lt("updated_at", cutoff);
    await sb.from("settings").delete().like("key", `${END_PREFIX}%`).lt("updated_at", cutoff);
  } catch {
    // fail-open
  }
}

/**
 * Wrap a cron handler with observability. The handler's Response is
 * cloned to peek at the JSON body without consuming the original, so
 * we can classify the outcome from the response shape:
 *   { error: "..." }   → "error"
 *   { skipped: "..." } → "skipped"
 *   { ok: true, ... }  → "success"
 *   anything else      → "success" (best-effort)
 */
export async function observeCron(
  name: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const sb = createServiceClient();
  const runId = generateRunId();
  const startedAt = Date.now();

  // Fire-and-forget: start record + prune.
  recordStart(sb, runId, name).catch(() => {});
  pruneOld(sb).catch(() => {});

  try {
    const response = await handler();
    const endedAt = Date.now();

    // Peek at body without consuming the original response.
    let outcome: Outcome = "success";
    let detail: string | undefined;
    try {
      const clone = response.clone();
      const body = (await clone.json()) as any;
      if (body?.error) {
        outcome = "error";
        detail = String(body.error);
      } else if (body?.skipped) {
        outcome = "skipped";
        detail = String(body.skipped);
      }
    } catch {
      // Non-JSON response (HTML, empty, etc.) — default to success.
    }

    await recordEnd(sb, runId, name, startedAt, endedAt, outcome, detail);
    return response;
  } catch (err: any) {
    const endedAt = Date.now();
    await recordEnd(
      sb,
      runId,
      name,
      startedAt,
      endedAt,
      "exception",
      err?.message ?? String(err),
    );
    throw err;
  }
}
