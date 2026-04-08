export default function OutreachPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
          Outreach Bot
        </h1>
        <p className="mt-1 text-sm text-ivory/50">
          Automated prospecting from Google Sheets
        </p>
      </div>

      <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-navy-lighter bg-navy-light">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-lighter">
            <svg className="h-7 w-7 text-ivory/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </div>
          <p className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory/50">
            Google Sheet sync coming in Phase 1b
          </p>
          <p className="mt-2 text-sm text-ivory/30">
            Auto-import prospects and manage outreach campaigns
          </p>
        </div>
      </div>
    </div>
  );
}
