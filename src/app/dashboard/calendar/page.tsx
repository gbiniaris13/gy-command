export default function CalendarPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
          Calendar
        </h1>
        <p className="mt-1 text-sm text-ivory/50">
          Meetings, showings, and charter schedule
        </p>
      </div>

      <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-navy-lighter bg-navy-light">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-lighter">
            <svg className="h-7 w-7 text-ivory/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory/50">
            Google Calendar integration coming in Phase 2
          </p>
          <p className="mt-2 text-sm text-ivory/30">
            View and manage your schedule alongside charter timelines
          </p>
        </div>
      </div>
    </div>
  );
}
