export default function EmailPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
          Email Hub
        </h1>
        <p className="mt-1 text-sm text-ivory/50">
          Unified inbox for all charter communications
        </p>
      </div>

      <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-navy-lighter bg-navy-light">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-lighter">
            <svg className="h-7 w-7 text-ivory/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory/50">
            Gmail integration coming in Phase 2
          </p>
          <p className="mt-2 text-sm text-ivory/30">
            Send, receive, and track emails directly from GY Command
          </p>
        </div>
      </div>
    </div>
  );
}
