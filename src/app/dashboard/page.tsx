export default function DashboardPage() {
  const stats = [
    { label: "New Leads", value: "12", change: "+3 today", color: "text-emerald-400" },
    { label: "Replies", value: "8", change: "+2 today", color: "text-blue-400" },
    { label: "Meetings", value: "3", change: "this week", color: "text-purple-400" },
    { label: "Pipeline Value", value: "$2.4M", change: "6 active", color: "text-gold" },
  ];

  const tasks = [
    { text: "Follow up with Monaco client", time: "9:00 AM", done: false },
    { text: "Send M/Y Azure proposal", time: "11:30 AM", done: false },
    { text: "Review Virtuoso partner request", time: "2:00 PM", done: false },
  ];

  return (
    <div className="flex h-full">
      {/* Main area */}
      <div className="flex-1 p-8">
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
              className="rounded-xl border border-navy-lighter bg-navy-light p-5"
            >
              <p className="text-xs font-medium tracking-wider text-ivory/40">
                {stat.label}
              </p>
              <p className={`mt-2 font-[family-name:var(--font-montserrat)] text-3xl font-bold ${stat.color}`}>
                {stat.value}
              </p>
              <p className="mt-1 text-xs text-ivory/30">{stat.change}</p>
            </div>
          ))}
        </div>

        {/* Pipeline placeholder */}
        <div className="rounded-xl border border-navy-lighter bg-navy-light p-8">
          <h2 className="mb-4 font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
            Pipeline
          </h2>
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-navy-lighter">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-navy-lighter">
                <svg className="h-6 w-6 text-ivory/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-ivory/40">
                Pipeline board coming soon
              </p>
              <p className="mt-1 text-xs text-ivory/25">
                Drag-and-drop Kanban for charter leads
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <aside className="w-72 shrink-0 border-l border-navy-lighter bg-navy-light/50 p-6">
        <h3 className="mb-4 font-[family-name:var(--font-montserrat)] text-sm font-semibold tracking-wider text-ivory/60">
          TODAY&apos;S TASKS
        </h3>
        <div className="space-y-3">
          {tasks.map((task, i) => (
            <div
              key={i}
              className="rounded-lg border border-navy-lighter bg-navy-light p-3.5"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-4 w-4 shrink-0 rounded border border-ivory/20" />
                <div className="min-w-0">
                  <p className="text-sm text-ivory/80">{task.text}</p>
                  <p className="mt-1 text-xs text-ivory/30">{task.time}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-dashed border-navy-lighter p-3 text-center">
          <p className="text-xs text-ivory/25">+ Add task</p>
        </div>
      </aside>
    </div>
  );
}
