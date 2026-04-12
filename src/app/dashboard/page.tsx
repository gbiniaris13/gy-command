import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import DashboardClient from "./DashboardClient";
import WeatherWidget from "./WeatherWidget";
import IntelWidget from "./IntelWidget";
import WorldClockWidget from "./WorldClockWidget";
import CurrencyWidget from "./CurrencyWidget";
import PageSpeedWidget from "./PageSpeedWidget";
import Link from "next/link";
import type { PipelineStage, Contact } from "@/lib/types";

interface TaskItem {
  id: string;
  type: "idle" | "pre_call" | "post_charter";
  name: string;
  company: string | null;
  detail: string;
  badge: string;
  badgeColor: string;
  iconBg: string;
  iconColor: string;
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // Fetch all data in parallel
  const [contactsRes, stagesRes, newLeadsRes, hotRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, pipeline_stage:pipeline_stages(*)")
      .order("last_activity_at", { ascending: false }),
    supabase
      .from("pipeline_stages")
      .select("*")
      .order("position", { ascending: true }),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    supabase
      .from("contacts")
      .select("id, pipeline_stage:pipeline_stages!inner(name)", { count: "exact", head: true })
      .eq("pipeline_stages.name", "Hot"),
  ]);

  const contacts = (contactsRes.data ?? []) as Contact[];
  const stages = (stagesRes.data ?? []) as PipelineStage[];
  const totalContacts = contacts.length;
  const newLeadsCount = newLeadsRes.count ?? 0;
  const hotLeadsCount = hotRes.count ?? 0;
  const stagesCount = stages.length;

  const stats = [
    {
      label: "INTEL DEPLOYED",
      value: String(newLeadsCount),
      sub: "last 7 days",
      color: "text-emerald",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
        </svg>
      ),
    },
    {
      label: "ASSETS IN DATABASE",
      value: String(totalContacts),
      sub: "indexed",
      color: "text-electric-cyan",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      label: "PRIORITY TARGETS",
      value: String(hotLeadsCount),
      sub: "ready to close",
      color: "text-hot-red",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
        </svg>
      ),
    },
    {
      label: "ACTIVE OPERATIONS",
      value: String(stagesCount),
      sub: "live stages",
      color: "text-neon-purple",
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z" />
        </svg>
      ),
    },
  ];

  // ─── Today's Tasks ────────────────────────────────────────────────

  const tasks: TaskItem[] = [];

  // 1. Idle Warm/Hot leads
  const warmHotStageIds = stages
    .filter((s) => s.name === "Warm" || s.name === "Hot")
    .map((s) => s.id);

  if (warmHotStageIds.length > 0) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: idleContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company, last_activity_at, pipeline_stage:pipeline_stages(name)")
      .in("pipeline_stage_id", warmHotStageIds)
      .lt("last_activity_at", sevenDaysAgo)
      .order("last_activity_at", { ascending: true })
      .limit(5);

    for (const c of idleContacts ?? []) {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed";
      const stageData = c.pipeline_stage as unknown as { name: string } | { name: string }[] | null;
      const stage = Array.isArray(stageData) ? stageData[0]?.name ?? "?" : stageData?.name ?? "?";
      const daysIdle = Math.floor(
        (Date.now() - new Date(c.last_activity_at!).getTime()) / (1000 * 60 * 60 * 24)
      );
      tasks.push({
        id: c.id,
        type: "idle",
        name,
        company: c.company,
        detail: `${stage} -- idle ${daysIdle} days`,
        badge: stage,
        badgeColor: "bg-amber/15 text-amber",
        iconBg: "bg-amber/15",
        iconColor: "text-amber",
      });
    }
  }

  // 2. Pre-call briefs ready today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: briefActivities } = await supabase
    .from("activities")
    .select("contact_id, metadata, created_at")
    .eq("type", "meeting")
    .gte("created_at", todayStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(5);

  if (briefActivities && briefActivities.length > 0) {
    const contactIds = [...new Set(briefActivities.map((a) => a.contact_id))];
    const { data: briefContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company")
      .in("id", contactIds);

    const contactMap = new Map(
      (briefContacts ?? []).map((c) => [c.id, c])
    );

    for (const activity of briefActivities) {
      const c = contactMap.get(activity.contact_id);
      if (!c) continue;
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
      const meta = activity.metadata as Record<string, unknown>;
      const eventStart = meta?.event_start as string | undefined;
      const timeStr = eventStart
        ? new Date(eventStart).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "today";

      tasks.push({
        id: c.id,
        type: "pre_call",
        name,
        company: c.company,
        detail: `Pre-call brief ready -- meeting at ${timeStr}`,
        badge: "Brief",
        badgeColor: "bg-electric-cyan/15 text-electric-cyan",
        iconBg: "bg-electric-cyan/15",
        iconColor: "text-electric-cyan",
      });
    }
  }

  // 3. Post-charter emails due
  const closedWonStage = stages.find((s) => s.name === "Closed Won");
  if (closedWonStage) {
    const { data: charterContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company, charter_end_date, post_charter_step")
      .eq("pipeline_stage_id", closedWonStage.id)
      .not("charter_end_date", "is", null)
      .lt("post_charter_step", 3)
      .limit(5);

    const stepDays = [1, 30, 90];
    for (const c of charterContacts ?? []) {
      if (!c.charter_end_date) continue;
      const daysSince = Math.floor(
        (Date.now() - new Date(c.charter_end_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      const step = c.post_charter_step ?? 0;
      if (step < 3 && daysSince >= stepDays[step]) {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
        tasks.push({
          id: c.id,
          type: "post_charter",
          name,
          company: c.company,
          detail: `Post-charter email ${step + 1}/3 due (day ${daysSince})`,
          badge: "Charter",
          badgeColor: "bg-emerald/15 text-emerald",
          iconBg: "bg-emerald/15",
          iconColor: "text-emerald",
        });
      }
    }
  }

  const sessionTs = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* ── CLASSIFIED HEADER ──────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
        <div className="mb-2 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
          <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[3px] text-hot-red uppercase animate-blink">
            CLASSIFIED
          </span>
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-xl sm:text-2xl font-black tracking-[4px] text-electric-cyan uppercase" style={{ textShadow: "-2px 0 #ff0064, 2px 0 #0064ff, 0 0 20px rgba(0,255,200,0.4)" }}>
          GY COMMAND — BRIDGE
        </h1>
        <div className="mt-3 space-y-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue">
          <p><span className="text-emerald">●</span> SYSTEM ONLINE <span className="inline-block w-2 h-3 bg-electric-cyan/60 animate-blink ml-1 align-middle" /></p>
          <p>COMMANDER: George P. Biniaris</p>
          <p>CLEARANCE: <span className="text-electric-cyan">LEVEL 5</span></p>
          <p>SESSION: <span className="text-electric-cyan/60">{sessionTs}</span></p>
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-6 sm:mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="glass-card relative overflow-hidden p-4 sm:p-5"
          >
            {/* Faded icon top-right */}
            <div className="absolute top-3 right-3 opacity-10">
              {stat.icon}
            </div>
            <p className="font-[family-name:var(--font-sans)] text-[11px] font-medium tracking-wider text-muted-blue uppercase">
              {stat.label}
            </p>
            <p
              className={`mt-2 font-[family-name:var(--font-mono)] text-2xl sm:text-3xl font-bold ${stat.color}`}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-[11px] text-muted-blue/60">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Today's Tasks */}
      {tasks.length > 0 && (
        <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-electric-cyan/10">
              <svg
                className="h-4 w-4 text-electric-cyan"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
              MISSION QUEUE
            </h2>
            <span className="ml-auto rounded-full bg-electric-cyan/10 px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-xs font-semibold text-electric-cyan">
              {tasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {tasks.map((task, idx) => (
              <Link
                key={`${task.type}-${task.id}-${idx}`}
                href={`/dashboard/contacts/${task.id}`}
                className="flex items-center gap-3 sm:gap-4 rounded-lg border border-border-glow bg-glass-light/30 px-3 sm:px-4 py-3 transition-all hover:border-electric-cyan/20 hover:bg-glass-light/50 min-h-[44px]"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${task.iconBg}`}
                >
                  {task.type === "idle" && (
                    <svg
                      className={`h-4 w-4 ${task.iconColor}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  )}
                  {task.type === "pre_call" && (
                    <svg
                      className={`h-4 w-4 ${task.iconColor}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                  )}
                  {task.type === "post_charter" && (
                    <svg
                      className={`h-4 w-4 ${task.iconColor}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                      />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-soft-white">
                    {task.type === "idle" && `Follow up with ${task.name}`}
                    {task.type === "pre_call" && `Pre-call brief ready for ${task.name}`}
                    {task.type === "post_charter" && `Post-charter email due for ${task.name}`}
                  </p>
                  <p className="text-xs text-muted-blue">
                    {task.company ? `${task.company} \u00B7 ` : ""}
                    {task.detail}
                  </p>
                </div>
                <span
                  className={`hidden sm:inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${task.badgeColor}`}
                >
                  {task.badge}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── ENVIRONMENTAL SCAN ──────────────────────────────────── */}
      <WeatherWidget />

      {/* ── SIGNAL INTELLIGENCE ──────────────────────────────────── */}
      <IntelWidget />

      {/* ── WORLD TIME + CURRENCY ────────────────────────────── */}
      <WorldClockWidget />
      <CurrencyWidget />

      {/* ── SITE PERFORMANCE ──────────────────────────────────── */}
      <PageSpeedWidget />

      {/* ── SYSTEMS ARRAY ─────────────────────────────────────── */}
      <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald animate-pulse" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
            SYSTEMS ARRAY
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {[
            { name: "CRM Matrix", status: "ONLINE" },
            { name: "Email Relay", status: "ONLINE" },
            { name: "Fleet Tracker", status: "ONLINE" },
            { name: "Sat Uplink", status: "ONLINE" },
            { name: "Neural Net", status: "TRAINING" },
          ].map((sys) => (
            <div key={sys.name} className="flex items-center gap-2 rounded border border-border-glow bg-glass-light/20 px-3 py-2">
              <span className={`h-1.5 w-1.5 rounded-full ${sys.status === "ONLINE" ? "bg-emerald" : sys.status === "TRAINING" ? "bg-amber animate-pulse" : "bg-hot-red"}`} />
              <div>
                <p className="font-[family-name:var(--font-mono)] text-[10px] text-muted-blue">{sys.name}</p>
                <p className={`font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-wider ${sys.status === "ONLINE" ? "text-emerald" : sys.status === "TRAINING" ? "text-amber" : "text-hot-red"}`}>{sys.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── MISSION PIPELINE ──────────────────────────────────────── */}
      <div className="glass-card p-4 sm:p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-electric-cyan" />
          <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
            MISSION PIPELINE
          </h2>
        </div>
        <DashboardClient stages={stages} contacts={contacts} />
      </div>
    </div>
  );
}
