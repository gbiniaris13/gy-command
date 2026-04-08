import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import DashboardClient from "./DashboardClient";
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
