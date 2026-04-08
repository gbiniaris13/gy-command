export default function VisitorsPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
          Site Visitors
        </h1>
        <p className="mt-1 text-sm text-ivory/50">
          Real-time activity on georgeyachts.com
        </p>
      </div>

      <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-navy-lighter bg-navy-light">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-lighter">
            <svg className="h-7 w-7 text-ivory/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory/50">
            Real-time feed coming in Phase 1b
          </p>
          <p className="mt-2 text-sm text-ivory/30">
            See who is browsing yachts, where they are from, and what they view
          </p>
        </div>
      </div>
    </div>
  );
}
