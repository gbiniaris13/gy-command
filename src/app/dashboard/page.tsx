import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import DashboardClient from "./DashboardClient";
import Link from "next/link";
import type { PipelineStage, Contact } from "@/lib/types";

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

  // ─── Today's Tasks: idle Warm/Hot leads ─────────────────────────────────

  const warmHotStageIds = stages
    .filter((s) => s.name === "Warm" || s.name === "Hot")
    .map((s) => s.id);

  let idleTasks: { id: string; name: string; company: string | null; stage: string; daysIdle: number }[] = [];

  if (warmHotStageIds.length > 0) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: idleContacts } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, company, last_activity_at, pipeline_stage:pipeline_stages(name)")
      .in("pipeline_stage_id", warmHotStageIds)
      .lt("last_activity_at", sevenDaysAgo)
      .order("last_activity_at", { ascending: true })
      .limit(5);

    idleTasks = (idleContacts ?? []).map((c) => ({
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed",
      company: c.company,
      stage: (() => {
        const s = c.pipeline_stage as unknown as { name: string } | { name: string }[] | null;
        return Array.isArray(s) ? s[0]?.name ?? "?" : s?.name ?? "?";
      })(),
      daysIdle: Math.floor(
        (Date.now() - new Date(c.last_activity_at!).getTime()) / (1000 * 60 * 60 * 24)
      ),
    }));
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
      {idleTasks.length > 0 && (
        <div className="mb-8 rounded-xl border border-white/5 bg-navy-light p-6">
          <h2 className="mb-4 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
            Today&apos;s Tasks
          </h2>
          <div className="space-y-2">
            {idleTasks.map((task) => (
              <Link
                key={task.id}
                href={`/dashboard/contacts/${task.id}`}
                className="flex items-center gap-4 rounded-lg border border-white/5 bg-navy-lighter/50 px-4 py-3 transition-colors hover:border-gold/30 hover:bg-navy-lighter"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
                  <svg
                    className="h-4 w-4 text-amber-400"
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
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ivory">
                    Follow up with {task.name}
                  </p>
                  <p className="text-xs text-ivory/40">
                    {task.company ? `${task.company} \u00B7 ` : ""}
                    {task.stage} \u00B7 {task.daysIdle}d idle
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400">
                  {task.stage}
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
