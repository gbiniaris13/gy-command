import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import DashboardClient from "./DashboardClient";
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
      label: "New Leads (7d)",
      value: String(newLeadsCount),
      sub: "this week",
      color: "text-emerald-400",
    },
    {
      label: "Total Contacts",
      value: String(totalContacts),
      sub: "in CRM",
      color: "text-blue-400",
    },
    {
      label: "Hot Leads",
      value: String(hotLeadsCount),
      sub: "ready to close",
      color: "text-red-400",
    },
    {
      label: "Pipeline Stages",
      value: String(stagesCount),
      sub: "active stages",
      color: "text-gold",
    },
  ];

  // ─── Today's Tasks: build unified task list ────────────────────────────

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
        badgeColor: "bg-amber-500/15 text-amber-400",
        iconBg: "bg-amber-500/15",
        iconColor: "text-amber-400",
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
        badgeColor: "bg-blue-500/15 text-blue-400",
        iconBg: "bg-blue-500/15",
        iconColor: "text-blue-400",
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
          badgeColor: "bg-emerald-500/15 text-emerald-400",
          iconBg: "bg-emerald-500/15",
          iconColor: "text-emerald-400",
        });
      }
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-ivory/50">
          Welcome back, George. Here is your overview.
        </p>
      </div>

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/5 bg-navy-light p-5"
          >
            <p className="text-xs font-medium tracking-wider text-ivory/40 uppercase">
              {stat.label}
            </p>
            <p
              className={`mt-2 font-[family-name:var(--font-montserrat)] text-3xl font-bold ${stat.color}`}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-ivory/30">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Today's Tasks */}
      {tasks.length > 0 && (
        <div className="mb-8 rounded-xl border border-gold/10 bg-navy-light p-6 shadow-lg shadow-gold/5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/20">
              <svg
                className="h-4 w-4 text-gold"
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
            <h2 className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
              Today&apos;s Tasks
            </h2>
            <span className="ml-auto rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-semibold text-gold">
              {tasks.length}
            </span>
          </div>
          <div className="space-y-2">
            {tasks.map((task, idx) => (
              <Link
                key={`${task.type}-${task.id}-${idx}`}
                href={`/dashboard/contacts/${task.id}`}
                className="flex items-center gap-4 rounded-lg border border-white/5 bg-navy-lighter/50 px-4 py-3 transition-colors hover:border-gold/30 hover:bg-navy-lighter"
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
                  <p className="text-sm font-medium text-ivory">
                    {task.type === "idle" && `Follow up with ${task.name}`}
                    {task.type === "pre_call" && `Pre-call brief ready for ${task.name}`}
                    {task.type === "post_charter" && `Post-charter email due for ${task.name}`}
                  </p>
                  <p className="text-xs text-ivory/40">
                    {task.company ? `${task.company} \u00B7 ` : ""}
                    {task.detail}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${task.badgeColor}`}
                >
                  {task.badge}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline Kanban */}
      <div className="rounded-xl border border-white/5 bg-navy-light p-6">
        <h2 className="mb-5 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
          Pipeline
        </h2>
        <DashboardClient stages={stages} contacts={contacts} />
      </div>
    </div>
  );
}
