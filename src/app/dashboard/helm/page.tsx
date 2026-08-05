// gy-command dashboard — The Helm: George's CRM pipeline (rebuilt 2026-07-17).
// Server component prepares plain rows (ref code, country flag, year, nights);
// HelmCrmTable renders the searchable, filterable at-a-glance table.

import Link from "next/link";
import { listHelmCrm } from "@/lib/helm-admin";
import { refCode } from "@/lib/helm/refcode";
import { phoneCountry } from "@/lib/phone-country";
import { isFlexibleWindow } from "@/lib/helm/pipeline";
import HelmCrmTable, { type CrmRow } from "./HelmCrmTable";

export const dynamic = "force-dynamic";

function nightsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const n = Math.round((b - a) / 86400000);
  return n >= 0 ? n : null;
}

export default async function HelmListPage() {
  const requests = await listHelmCrm();

  // Lost sinks to the bottom (George 2026-07-08); alive stays on top, newest first.
  const sorted = [...requests].sort((a, b) => {
    const aLost = a.status === "lost" ? 1 : 0;
    const bLost = b.status === "lost" ? 1 : 0;
    if (aLost !== bLost) return aLost - bLost;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });

  const rows: CrmRow[] = sorted.map((r) => {
    const nights = nightsBetween(r.dates_from, r.dates_to);
    const pc = phoneCountry(r.client_whatsapp);
    const due = !!r.follow_up_at
      && ["sent", "in_conversation", "negotiating"].includes(r.status)
      && new Date(r.follow_up_at).getTime() <= Date.now();
    // Engagement from the Salon (the client actually opened / pressed interest).
    // The single strongest "call this one" signal a broker can have.
    const salonViews = r.salon?.views ?? 0;
    const salonLastAt = r.salon?.last_at ?? null;
    const interest = r.salon?.yachts
      ? Object.entries(r.salon.yachts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      : null;
    // How long an un-worked request has been sitting (new/drafted only). Lets
    // George see at a glance which leads are going cold (George 2026-07-17).
    const waitingDays = ["new", "drafted"].includes(r.status) && r.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000))
      : null;
    // 2026-07-24 pipeline upgrade: sent moment, the 3-step follow-up plan,
    // George's notes and the flexible-window duration all come from
    // extraction.pipeline (already selected as a narrow JSON path).
    const p = r.pipeline || {};
    return {
      id: r.id,
      ref: refCode(r.created_at),
      name: r.client_name || r.client_email || "(unnamed)",
      email: r.client_email || "",
      whatsapp: r.client_whatsapp || "",
      flag: pc?.flag || "",
      country: pc?.country || "",
      party: r.party_size || "",
      budget: r.budget || "",
      area: r.area || "",
      datesFrom: r.dates_from,
      datesTo: r.dates_to,
      year: r.dates_from ? new Date(r.dates_from).getUTCFullYear() : null,
      nights,
      isDay: nights !== null && nights <= 1,
      status: r.status,
      due,
      followUpAt: r.follow_up_at,
      isAgent: r.request_type === "travel_agent",
      createdAt: r.created_at,
      salonViews,
      salonLastAt,
      interest,
      waitingDays,
      onNewsletter: r.on_newsletter,
      sentAt: p.sent_at ?? null,
      // Any length, not just three (2026-08-04): plans are now scaled to how far
      // away the charter is, so a long-lead request legitimately carries five or
      // six steps. The old `=== 3` test threw those away and the cell drew the
      // "Suggest dates" button instead of the plan George had just made.
      fu: Array.isArray(p.fu) && p.fu.length > 0
        ? p.fu.map((s) => ({ due: s.due, done_at: s.done_at ?? null, how: s.how ?? null, kind: s.kind }))
        : null,
      notes: p.notes ?? "",
      yachts: r.yacht_labels,
      wantedNights: p.wanted_nights ?? null,
      flexWindow: isFlexibleWindow(nights),
    };
  });

  const dueCount = rows.filter((r) => r.due).length;

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
            The Helm · Requests
          </div>
          <h1 style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 300 }}>Charter pipeline</h1>
          {dueCount > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#b45309", fontWeight: 600 }}>
              ● {dueCount} request{dueCount === 1 ? "" : "s"} need{dueCount === 1 ? "s" : ""} a follow-up today
            </div>
          )}
        </div>
        <Link href="/dashboard/helm/new" style={{
          background: "#0D1B2A", color: "#F8F5F0", padding: "10px 18px", textDecoration: "none",
          fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", border: "1px solid #C9A84C",
        }}>
          + New request
        </Link>
      </header>

      <HelmCrmTable rows={rows} />
    </div>
  );
}
