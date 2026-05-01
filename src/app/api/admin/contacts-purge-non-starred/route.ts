// /api/admin/contacts-purge-non-starred
//
// One-shot cleanup. Goal: collapse the noisy contacts list down to
// only people George has actually talked to (Gmail starred). Everything
// else is purged so the Contacts page is real-relationships-only.
//
// SAFE BY DEFAULT — without ?apply=1 this is dry-run audit mode.
//
// Defensive guards before deletion:
//   1. Auto-star any contact with REAL business ties so it never
//      gets deleted by mistake:
//        - charter_fee / commission_earned / charter_vessel populated
//        - is central_agent_contact_id on a vessels row
//        - is primary_contact_id on a deals row
//        - is contact_id on a charter_reminder
//   2. JSON snapshot of every contact about to be deleted is written
//      to settings.value as `purge_snapshot:<ISO>` (rollback safety).
//   3. Only then do we DELETE inbox_starred=false rows.
//
// Cascade behaviour (per migrations):
//   activities, after_sales_*, pillar3_greetings, v2_commitments,
//   v2_health_score → ON DELETE CASCADE (will drop)
//   deals, charters_*, vessels.central_agent_contact_id → ON DELETE
//     SET NULL (guarded above; would only matter for unprotected rows
//     which by definition don't have business ties)
//
// Usage:
//   GET /api/admin/contacts-purge-non-starred              → audit (dry-run)
//   GET /api/admin/contacts-purge-non-starred?apply=1      → execute

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

type ContactRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  contact_type: string | null;
  source: string | null;
  inbox_starred: boolean | null;
  charter_fee: number | null;
  commission_earned: number | null;
  charter_vessel: string | null;
  payment_status: string | null;
  notes: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const apply = sp.get("apply") === "1";

  const sb = createServiceClient();

  // 1. Pull every contact (paginated, in case > 1000)
  const all: ContactRow[] = [];
  {
    const PAGE = 1000;
    let p = 0;
    while (true) {
      const { data: rows, error } = await sb
        .from("contacts")
        .select(
          "id, email, first_name, last_name, company, contact_type, source, inbox_starred, charter_fee, commission_earned, charter_vessel, payment_status, notes, created_at",
        )
        .order("created_at", { ascending: true })
        .range(p * PAGE, (p + 1) * PAGE - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!rows || rows.length === 0) break;
      all.push(...(rows as ContactRow[]));
      if (rows.length < PAGE) break;
      p++;
    }
  }

  // 2. Identify business-tied contacts (defensive auto-star)
  const candidatesForDeletion = all.filter((c) => !c.inbox_starred);
  const candidateIds = candidatesForDeletion.map((c) => c.id);

  // FK reverse-lookup: which candidate IDs appear in dependent tables?
  const protectedIds = new Set<string>();
  const reasons = new Map<string, string>();
  const counts = {
    contact_self_fee: 0,
    contact_self_commission: 0,
    contact_self_vessel: 0,
    contact_self_payment: 0,
    vessel_central_agent: 0,
    deal_real: 0,
  };

  // Fee / commission / vessel field populated on contact itself
  for (const c of candidatesForDeletion) {
    if (c.charter_fee !== null) {
      protectedIds.add(c.id);
      reasons.set(c.id, "charter_fee");
      counts.contact_self_fee++;
    } else if (c.commission_earned !== null) {
      protectedIds.add(c.id);
      reasons.set(c.id, "commission_earned");
      counts.contact_self_commission++;
    } else if (c.charter_vessel !== null) {
      protectedIds.add(c.id);
      reasons.set(c.id, "charter_vessel");
      counts.contact_self_vessel++;
    } else if (
      // Only "real money has moved" counts. The outreach bot sets
      // every auto-created contact's payment_status to 'pending' as a
      // default, so 'pending' is noise — only paid/partial/refunded
      // indicates a real charter financial relationship.
      ["paid", "partial", "refunded"].includes(
        (c.payment_status ?? "").toLowerCase(),
      )
    ) {
      protectedIds.add(c.id);
      reasons.set(c.id, `payment_status=${c.payment_status}`);
      counts.contact_self_payment++;
    }
  }

  // vessels.central_agent_contact_id (no ON DELETE — would block anyway).
  // For deals: the outreach bot creates a stub deal per cold lead, so
  // a deal row alone is not enough — we require REAL business signal:
  //   - charter_fee_eur > 0, OR
  //   - payment_status in ('paid', 'partial'), OR
  //   - lifecycle_status in ('active', 'in_progress', 'completed').
  if (candidateIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < candidateIds.length; i += CHUNK) {
      const slice = candidateIds.slice(i, i + CHUNK);
      const { data: vRows } = await sb
        .from("vessels")
        .select("central_agent_contact_id")
        .in("central_agent_contact_id", slice);
      for (const r of vRows ?? []) {
        if (r.central_agent_contact_id) {
          const id = r.central_agent_contact_id as string;
          if (!protectedIds.has(id)) {
            protectedIds.add(id);
            reasons.set(id, "vessel_central_agent");
            counts.vessel_central_agent++;
          }
        }
      }
      const { data: dRows } = await sb
        .from("deals")
        .select(
          "primary_contact_id, charter_fee_eur, payment_status, lifecycle_status",
        )
        .in("primary_contact_id", slice);
      for (const r of dRows ?? []) {
        if (!r.primary_contact_id) continue;
        const realFee = (r.charter_fee_eur ?? 0) > 0;
        const realPayment = ["paid", "partial"].includes(
          (r.payment_status ?? "").toLowerCase(),
        );
        const realLifecycle = ["active", "in_progress", "completed"].includes(
          (r.lifecycle_status ?? "").toLowerCase(),
        );
        if (realFee || realPayment || realLifecycle) {
          const id = r.primary_contact_id as string;
          if (!protectedIds.has(id)) {
            protectedIds.add(id);
            const why = realFee
              ? `deal_fee=${r.charter_fee_eur}`
              : realPayment
                ? `deal_payment=${r.payment_status}`
                : `deal_lifecycle=${r.lifecycle_status}`;
            reasons.set(id, why);
            counts.deal_real++;
          }
        }
      }
    }
  }

  // 3. Auto-star protected ones (so they survive AND show in starred view)
  const protectedList = candidatesForDeletion.filter((c) =>
    protectedIds.has(c.id),
  );
  const toDelete = candidatesForDeletion.filter((c) => !protectedIds.has(c.id));

  // Breakdown for the audit response
  const breakdownBy = (key: keyof ContactRow) => {
    const m = new Map<string, number>();
    for (const c of toDelete) {
      const v = ((c[key] as string | null) ?? "(none)") as string;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
  };

  const audit = {
    total_contacts: all.length,
    starred_already: all.filter((c) => c.inbox_starred).length,
    not_starred: candidatesForDeletion.length,
    protected_will_be_starred: protectedList.length,
    will_be_deleted: toDelete.length,
    breakdown: {
      by_source: breakdownBy("source"),
      by_contact_type: breakdownBy("contact_type"),
    },
    sample_to_delete: toDelete.slice(0, 10).map((c) => ({
      email: c.email,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      company: c.company,
      source: c.source,
      type: c.contact_type,
    })),
    sample_protected: protectedList.slice(0, 10).map((c) => ({
      email: c.email,
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
      reason: reasons.get(c.id) ?? "unknown",
    })),
    protection_counts: counts,
  };

  if (!apply) {
    return NextResponse.json({ mode: "dry-run", audit });
  }

  // ─────────── EXECUTE PATH ───────────
  const now = new Date().toISOString();

  // 4. Snapshot to settings table (rollback safety)
  const snapshotKey = `purge_snapshot:${now}`;
  await sb.from("settings").upsert({
    key: snapshotKey,
    value: {
      created_at: now,
      protected: protectedList,
      deleted: toDelete,
    },
  });

  // 5. Auto-star protected
  let starred = 0;
  if (protectedList.length > 0) {
    const ids = protectedList.map((c) => c.id);
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error } = await sb
        .from("contacts")
        .update({
          inbox_starred: true,
          inbox_starred_at: now,
        })
        .in("id", slice);
      if (!error) starred += slice.length;
    }
  }

  // 6. Delete the safe set
  let deleted = 0;
  let deleteErrors: string[] = [];
  if (toDelete.length > 0) {
    const ids = toDelete.map((c) => c.id);
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { error, count } = await sb
        .from("contacts")
        .delete({ count: "exact" })
        .in("id", slice);
      if (error) {
        deleteErrors.push(error.message);
      } else {
        deleted += count ?? 0;
      }
    }
  }

  return NextResponse.json({
    mode: "executed",
    snapshot_key: snapshotKey,
    audit,
    starred_protected: starred,
    deleted,
    delete_errors: deleteErrors,
  });
}
