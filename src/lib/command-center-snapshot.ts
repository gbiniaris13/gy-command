// @ts-nocheck
//
// Command Center snapshot — feeds the /dashboard/command-center surface.
//
// Reuses the cached cockpit briefing (settings.cockpit_briefing_<date>) when
// available so we don't hammer Supabase on every page load. Augments with a
// few cheap live counts + recent activity rows for the live terminal feed.
//
// Newsletter is intentionally OUT OF SCOPE — that surface lives at
// /dashboard/newsletter and George wants it untouched here.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CCMetric {
  id: string;
  label: string;
  value: number;
  suffix: string;
  route: string;
}

export interface CCExecutive {
  id: string;
  name: string;
  role: string;
  route: string;
  status: "ONLINE" | "STANDBY" | "OFFLINE";
}

export interface CCPipelineItem {
  name: string;
  status: "green" | "amber" | "red";
  phase: string;
}

export interface CCSystemItem {
  name: string;
  status: "ONLINE" | "STANDBY" | "TRAINING";
  load: number;
}

export interface CCThreatItem {
  vector: string;
  severity: "LOW" | "MED" | "HIGH" | "CRIT";
  detail: string;
}

export interface CCLogEntry {
  tag: string;        // [OK] / [>>] / [!!]
  color: string;      // hex
  msg: string;
  when: string;       // ISO timestamp
}

// Tier 2 — Today's Priorities. Pulled from the cached cockpit briefing
// (top-ranked actions + commitments + charter milestones) plus a couple
// of cheap pulse-derived counters.
export interface CCPriorityAction {
  id: string;
  title: string;
  contact_name: string;
  reason: string;
  expected_commission_eur: number;
  priority: "critical" | "high" | "medium" | "low";
  contact_id: string;       // for drill-down route /dashboard/contacts/<id>
}

export interface CCCounter {
  id: string;
  label: string;
  value: number;
  tone: "good" | "warn" | "bad";  // colors the number
  hint: string;                   // one-line context
  route: string;                  // drill-down target
}

export interface CCPriorities {
  actions: CCPriorityAction[];    // up to 3
  counters: CCCounter[];          // exactly 4 — keeps the layout stable
  has_briefing: boolean;          // false if cockpit cache miss
}

export interface CommandCenterSnapshot {
  metrics: CCMetric[];
  executives: CCExecutive[];
  pipeline: CCPipelineItem[];
  systems: CCSystemItem[];
  threats: CCThreatItem[];
  activity: CCLogEntry[];
  priorities: CCPriorities;       // Tier 2
  generated_at: string;
  source: "briefing_cache" | "live" | "degraded";
}

const ACTIVE_STAGES_FOR_PIPELINE = [
  "Hot",
  "Negotiation",
  "Proposal Sent",
  "Meeting Booked",
  "Contract Sent",
  "Closed Won",
];

function statusForStage(stage: string | null, daysStale: number): "green" | "amber" | "red" {
  if (!stage) return "amber";
  if (stage === "Closed Won" || stage === "Contract Sent") return "green";
  if (daysStale > 14) return "red";
  if (daysStale > 7) return "amber";
  return "green";
}

function daysSince(iso: string | null): number {
  if (!iso) return 999;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 999;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function activityToLogEntry(row: any): CCLogEntry {
  const type = String(row.type || "activity").toLowerCase();
  let tag = "[OK]";
  let color = "#00ff88";
  if (type.includes("email") && type.includes("inbound")) {
    tag = "[>>]";
    color = "#00ffc8";
  } else if (type.includes("error") || type.includes("bounce") || type.includes("fail")) {
    tag = "[!!]";
    color = "#ffaa00";
  } else if (type.includes("note") || type.includes("call")) {
    tag = "[>>]";
    color = "#00ffc8";
  }
  const desc = (row.description || row.type || "activity").toString().slice(0, 90);
  return {
    tag,
    color,
    msg: desc,
    when: row.created_at || new Date().toISOString(),
  };
}

export async function buildCommandCenterSnapshot(
  sb: SupabaseClient,
): Promise<CommandCenterSnapshot> {
  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Pull cached briefing (fast path) ───────────────────────────
  let pulse: any = null;
  let opportunities: any[] = [];
  let inboxSummary: any = null;
  let commitments: any = null;
  let chartersReady: any = null;
  let briefingActions: any[] = [];
  let source: "briefing_cache" | "live" | "degraded" = "live";

  try {
    const { data: cached } = await sb
      .from("settings")
      .select("value")
      .eq("key", `cockpit_briefing_${today}`)
      .maybeSingle();
    if (cached?.value) {
      const parsed = typeof cached.value === "string" ? JSON.parse(cached.value) : cached.value;
      pulse = parsed.pulse ?? null;
      opportunities = parsed.opportunities ?? [];
      inboxSummary = parsed.inbox_summary ?? null;
      commitments = parsed.commitments_ready ?? null;
      chartersReady = parsed.charters_ready ?? null;
      briefingActions = Array.isArray(parsed.actions) ? parsed.actions : [];
      source = "briefing_cache";
    }
  } catch (e) {
    console.error("[command-center-snapshot] briefing read failed:", e);
  }

  // ── 2. Live counts (cheap, always run) ────────────────────────────
  let starredCount = 0;
  let contactsTotal = 0;
  let topDeals: any[] = [];
  let recentActivities: any[] = [];

  try {
    const [starredRes, contactsRes, dealsRes, activitiesRes] = await Promise.all([
      sb.from("contacts").select("id", { count: "exact", head: true }).eq("inbox_starred", true),
      sb.from("contacts").select("id", { count: "exact", head: true }),
      sb
        .from("contacts")
        .select(
          "id, first_name, last_name, charter_vessel, charter_fee, charter_start_date, payment_status, last_activity_at, pipeline_stage_id, pipeline_stages(name)",
        )
        .not("charter_vessel", "is", null)
        .order("charter_start_date", { ascending: true, nullsFirst: false })
        .limit(6),
      sb
        .from("activities")
        .select("type, description, created_at, message_class")
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    starredCount = starredRes.count ?? 0;
    contactsTotal = contactsRes.count ?? 0;
    topDeals = dealsRes.data ?? [];
    recentActivities = activitiesRes.data ?? [];
  } catch (e) {
    console.error("[command-center-snapshot] live counts failed:", e);
    source = "degraded";
  }

  // ── 3. METRICS — 4 real KPIs ──────────────────────────────────────
  const metrics: CCMetric[] = [
    {
      id: "active_deals",
      label: "Active Deals",
      value: pulse?.active_deals_count ?? topDeals.length,
      suffix: "",
      route: "/dashboard/charters",
    },
    {
      id: "pipeline_value",
      label: "Pipeline (€K)",
      value: Math.round((pulse?.total_pipeline_value_eur ?? 0) / 1000),
      suffix: "K",
      route: "/dashboard/revenue",
    },
    {
      id: "starred",
      label: "Starred Contacts",
      value: starredCount,
      suffix: "",
      route: "/dashboard/contacts",
    },
    {
      id: "contacts_total",
      label: "Total Contacts",
      value: contactsTotal,
      suffix: "",
      route: "/dashboard/contacts",
    },
  ];

  // ── 4. EXECUTIVES — real subsystems (NO newsletter) ───────────────
  const executives: CCExecutive[] = [
    { id: "ck", name: "Cockpit", role: "BRIEFING", route: "/dashboard", status: "ONLINE" },
    { id: "gb", name: "George Bot", role: "OUTREACH", route: "/dashboard/outreach", status: "ONLINE" },
    { id: "eb", name: "Elleanna Bot", role: "OUTREACH", route: "/dashboard/outreach", status: "ONLINE" },
    { id: "ch", name: "Charter Lifecycle", role: "FLEET OPS", route: "/dashboard/charters", status: "ONLINE" },
    { id: "in", name: "Inbox Triage", role: "EMAIL", route: "/dashboard/email", status: "ONLINE" },
    { id: "br", name: "Brand Radar", role: "INTEL", route: "/dashboard/brand-radar", status: "STANDBY" },
    { id: "vi", name: "Visitor Analytics", role: "TRAFFIC", route: "/dashboard/visitors", status: "ONLINE" },
    { id: "nw", name: "Network Map", role: "PARTNERS", route: "/dashboard/network", status: "ONLINE" },
    { id: "rv", name: "Revenue Tracker", role: "FINANCE", route: "/dashboard/revenue", status: "ONLINE" },
    { id: "cl", name: "Calendar Sync", role: "SCHEDULE", route: "/dashboard/calendar", status: "ONLINE" },
  ];

  // ── 5. PIPELINE — real top deals ──────────────────────────────────
  const pipeline: CCPipelineItem[] = topDeals.slice(0, 6).map((d: any) => {
    const fullName = [d.first_name, d.last_name].filter(Boolean).join(" ") || "Unnamed";
    const vessel = d.charter_vessel ? ` · ${d.charter_vessel}` : "";
    const stage = d.pipeline_stages?.name ?? null;
    const stale = daysSince(d.last_activity_at);
    return {
      name: `${fullName}${vessel}`,
      status: statusForStage(stage, stale),
      phase: (stage || (stale > 14 ? "Stale" : "Active")).toUpperCase(),
    };
  });
  // pad with placeholders only if absolutely empty so layout doesn't collapse
  if (pipeline.length === 0) {
    pipeline.push({ name: "No active deals — open Charters", status: "amber", phase: "EMPTY" });
  }

  // ── 6. SYSTEMS — real subsystem health ────────────────────────────
  const systems: CCSystemItem[] = [
    {
      name: "Inbox Triage",
      status: "ONLINE",
      load: Math.min(100, (inboxSummary?.owed_reply ?? 0) * 10 + 30),
    },
    {
      name: "Charter Pipeline",
      status: "ONLINE",
      load: Math.min(100, (pulse?.active_deals_count ?? 0) * 8 + 40),
    },
    {
      name: "Commitments",
      status: (commitments?.overdue_count ?? 0) > 0 ? "STANDBY" : "ONLINE",
      load: Math.min(100, (commitments?.total_open ?? 0) * 5 + 30),
    },
    {
      name: "Charter Milestones",
      status: "ONLINE",
      load: Math.min(100, (chartersReady?.due_this_week_count ?? 0) * 12 + 35),
    },
    {
      name: "Hot Leads",
      status: (pulse?.hot_leads_count ?? 0) > 0 ? "ONLINE" : "STANDBY",
      load: Math.min(100, (pulse?.hot_leads_count ?? 0) * 15 + 25),
    },
    {
      name: "AI Briefing",
      status: source === "briefing_cache" ? "ONLINE" : "TRAINING",
      load: source === "briefing_cache" ? 92 : 55,
    },
  ];

  // ── 7. THREATS — real risks ───────────────────────────────────────
  const threats: CCThreatItem[] = [];
  const overdue = commitments?.overdue_count ?? 0;
  threats.push({
    vector: "OVERDUE",
    severity: overdue >= 5 ? "CRIT" : overdue >= 2 ? "HIGH" : overdue >= 1 ? "MED" : "LOW",
    detail: overdue > 0 ? `${overdue} promise(s) past deadline` : "No broken promises",
  });
  const staleWarm = pulse?.stale_warm_leads_count ?? 0;
  threats.push({
    vector: "STALE",
    severity: staleWarm >= 10 ? "HIGH" : staleWarm >= 4 ? "MED" : "LOW",
    detail: staleWarm > 0 ? `${staleWarm} warm lead(s) > 7d cold` : "Warm leads fresh",
  });
  const pendingPay = pulse?.pending_payments_eur ?? 0;
  threats.push({
    vector: "PAYMENTS",
    severity: pendingPay > 50_000 ? "HIGH" : pendingPay > 10_000 ? "MED" : "LOW",
    detail: pendingPay > 0
      ? `€${pendingPay.toLocaleString()} pending`
      : "All payments cleared",
  });
  const owed = inboxSummary?.owed_reply ?? 0;
  threats.push({
    vector: "INBOX",
    severity: owed >= 8 ? "HIGH" : owed >= 3 ? "MED" : "LOW",
    detail: owed > 0 ? `${owed} thread(s) owe a reply` : "Inbox is zero-owed",
  });
  const dueToday = chartersReady?.due_today_count ?? 0;
  threats.push({
    vector: "CHARTERS",
    severity: dueToday >= 3 ? "HIGH" : dueToday >= 1 ? "MED" : "LOW",
    detail: dueToday > 0 ? `${dueToday} milestone(s) due today` : "No charter touchpoints today",
  });
  const hot = pulse?.hot_leads_count ?? 0;
  threats.push({
    vector: "HOT LEADS",
    severity: hot >= 1 ? "MED" : "LOW",  // opportunity, not danger
    detail: hot > 0 ? `${hot} hot lead(s) — strike now` : "No hot leads in queue",
  });

  // ── 8. ACTIVITY LOG — real recent events ──────────────────────────
  let activity: CCLogEntry[] = recentActivities.map(activityToLogEntry);
  if (activity.length === 0) {
    activity = [
      {
        tag: "[!!]",
        color: "#ffaa00",
        msg: "No recent activity rows — verify Supabase connection",
        when: new Date().toISOString(),
      },
    ];
  }

  // ── 9. PRIORITIES (Tier 2) ────────────────────────────────────────
  // Top 3 actions from the cached briefing — these are the AI-ranked
  // money-first items the cockpit already surfaces every morning. Plus
  // 4 stable counters that mirror the most-actionable danger/opportunity
  // signals so George can see "what to do next" in 2 seconds.
  const topActions: CCPriorityAction[] = (briefingActions || [])
    .slice(0, 3)
    .map((a: any) => ({
      id: String(a.id ?? a.contact_id ?? Math.random()),
      title: String(a.title ?? "Untitled action").slice(0, 110),
      contact_name: String(a.contact_name ?? "—"),
      reason: String(a.reason ?? "").slice(0, 140),
      expected_commission_eur: Number(a.expected_commission_eur ?? 0),
      priority: (a.priority as CCPriorityAction["priority"]) ?? "medium",
      contact_id: String(a.contact_id ?? ""),
    }));

  const counters: CCCounter[] = [
    {
      id: "overdue",
      label: "Overdue Promises",
      value: commitments?.overdue_count ?? 0,
      tone: (commitments?.overdue_count ?? 0) > 0 ? "bad" : "good",
      hint: (commitments?.overdue_count ?? 0) > 0
        ? "promises past deadline — fix today"
        : "no broken promises",
      route: "/dashboard",
    },
    {
      id: "due_today",
      label: "Charters Due Today",
      value: chartersReady?.due_today_count ?? 0,
      tone: (chartersReady?.due_today_count ?? 0) > 0 ? "warn" : "good",
      hint: (chartersReady?.due_today_count ?? 0) > 0
        ? "milestones need a touchpoint"
        : "no milestones today",
      route: "/dashboard/charters",
    },
    {
      id: "owed_reply",
      label: "Inbox Owes Reply",
      value: inboxSummary?.owed_reply ?? 0,
      tone: (inboxSummary?.owed_reply ?? 0) >= 5
        ? "bad"
        : (inboxSummary?.owed_reply ?? 0) > 0
        ? "warn"
        : "good",
      hint: (inboxSummary?.owed_reply ?? 0) > 0
        ? "threads waiting for you"
        : "inbox at zero",
      route: "/dashboard/email",
    },
    {
      id: "hot_leads",
      label: "Hot Leads",
      value: pulse?.hot_leads_count ?? 0,
      tone: (pulse?.hot_leads_count ?? 0) > 0 ? "good" : "warn",
      hint: (pulse?.hot_leads_count ?? 0) > 0
        ? "strike while warm"
        : "pipeline needs heat",
      route: "/dashboard/contacts",
    },
  ];

  const priorities: CCPriorities = {
    actions: topActions,
    counters,
    has_briefing: source === "briefing_cache",
  };

  return {
    metrics,
    executives,
    pipeline,
    systems,
    threats,
    activity,
    priorities,
    generated_at: new Date().toISOString(),
    source,
  };
}

// Telegram-safe HTML escape — Telegram parse_mode=HTML accepts a tiny
// subset and strict on these four. https://core.telegram.org/bots/api#html-style
function escTg(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PRIORITY_DOT: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
};

const TONE_DOT: Record<string, string> = {
  bad: "⛔",
  warn: "⚠️",
  good: "✅",
};

// Format the snapshot as a Telegram HTML message. Used by the /status
// bot command and by anyone who wants to push the snapshot manually.
export function formatSnapshotForTelegram(s: CommandCenterSnapshot): string {
  const lines: string[] = [];
  lines.push("🎛 <b>GY COMMAND CENTER</b>");
  lines.push("");

  // METRICS — 4 KPIs
  lines.push("📊 <b>Today</b>");
  for (const m of s.metrics) {
    lines.push(`• ${escTg(m.label)}: <b>${m.value}${escTg(m.suffix)}</b>`);
  }
  lines.push("");

  // PRIORITIES — top actions
  if (s.priorities.actions.length > 0) {
    lines.push("🎯 <b>Top Actions</b>");
    for (const a of s.priorities.actions) {
      const dot = PRIORITY_DOT[a.priority] ?? "🟢";
      const eur = a.expected_commission_eur > 0
        ? ` <i>(€${Math.round(a.expected_commission_eur).toLocaleString()})</i>`
        : "";
      lines.push(`${dot} ${escTg(a.title)}${eur}`);
    }
    lines.push("");
  } else if (s.priorities.has_briefing) {
    lines.push("🎯 <b>Top Actions</b>");
    lines.push("<i>Inbox is at zero — no actions ranked.</i>");
    lines.push("");
  }

  // COUNTERS
  lines.push("⚠️ <b>Counters</b>");
  for (const c of s.priorities.counters) {
    const tone = TONE_DOT[c.tone] ?? "✅";
    lines.push(`${tone} ${escTg(c.label)}: <b>${c.value}</b> — <i>${escTg(c.hint)}</i>`);
  }
  lines.push("");

  // THREATS — only show non-LOW
  const realThreats = s.threats.filter((t) => t.severity !== "LOW");
  if (realThreats.length > 0) {
    lines.push("🚨 <b>Risks</b>");
    for (const t of realThreats) {
      lines.push(`• <b>${escTg(t.vector)}</b> [${t.severity}]: ${escTg(t.detail)}`);
    }
    lines.push("");
  }

  // FOOTER
  const stamp = new Date(s.generated_at).toISOString().replace("T", " ").slice(0, 16);
  const flag = s.priorities.has_briefing ? "AI-RANKED" : "BRIEFING PENDING";
  lines.push(`<i>${flag} · ${escTg(stamp)} UTC</i>`);

  return lines.join("\n");
}

export function emptySnapshot(): CommandCenterSnapshot {
  return {
    metrics: [
      { id: "active_deals", label: "Active Deals", value: 0, suffix: "", route: "/dashboard/charters" },
      { id: "pipeline_value", label: "Pipeline (€K)", value: 0, suffix: "K", route: "/dashboard/revenue" },
      { id: "starred", label: "Starred Contacts", value: 0, suffix: "", route: "/dashboard/contacts" },
      { id: "contacts_total", label: "Total Contacts", value: 0, suffix: "", route: "/dashboard/contacts" },
    ],
    executives: [],
    pipeline: [{ name: "Snapshot unavailable", status: "red", phase: "OFFLINE" }],
    systems: [{ name: "Backend", status: "STANDBY", load: 0 }],
    threats: [{ vector: "SNAPSHOT", severity: "MED", detail: "Live data unavailable" }],
    activity: [
      { tag: "[!!]", color: "#ffaa00", msg: "Snapshot endpoint failed", when: new Date().toISOString() },
    ],
    priorities: {
      actions: [],
      counters: [
        { id: "overdue", label: "Overdue Promises", value: 0, tone: "good", hint: "data unavailable", route: "/dashboard" },
        { id: "due_today", label: "Charters Due Today", value: 0, tone: "good", hint: "data unavailable", route: "/dashboard/charters" },
        { id: "owed_reply", label: "Inbox Owes Reply", value: 0, tone: "good", hint: "data unavailable", route: "/dashboard/email" },
        { id: "hot_leads", label: "Hot Leads", value: 0, tone: "warn", hint: "data unavailable", route: "/dashboard/contacts" },
      ],
      has_briefing: false,
    },
    generated_at: new Date().toISOString(),
    source: "degraded",
  };
}
