export default function ContactsPage() {
  const contacts = [
    { name: "Elena Vasquez", email: "elena@example.com", company: "Riviera Charters", stage: "Warm", country: "Monaco" },
    { name: "James Thornton", email: "james@example.com", company: "Thornton Family Office", stage: "Hot", country: "United Kingdom" },
    { name: "Sofia Andersen", email: "sofia@example.com", company: "Nordic Luxury Travel", stage: "New", country: "Norway" },
    { name: "Marco De Luca", email: "marco@example.com", company: "Virtuoso Advisor", stage: "Meeting Booked", country: "Italy" },
    { name: "Sarah Chen", email: "sarah@example.com", company: "Pacific Concierge", stage: "Contacted", country: "Singapore" },
  ];

  const stageBadgeColor: Record<string, string> = {
    New: "bg-gray-500/20 text-gray-400",
    Contacted: "bg-blue-500/20 text-blue-400",
    Warm: "bg-amber-500/20 text-amber-400",
    Hot: "bg-red-500/20 text-red-400",
    "Meeting Booked": "bg-purple-500/20 text-purple-400",
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-ivory/50">
            {contacts.length} contacts in your CRM
          </p>
        </div>
        <button className="rounded-lg bg-gold px-4 py-2 font-[family-name:var(--font-montserrat)] text-sm font-semibold text-navy transition-colors hover:bg-gold/90">
          + Add Contact
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-navy-lighter">
        <table className="w-full">
          <thead>
            <tr className="border-b border-navy-lighter bg-navy-light">
              <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wider text-ivory/40">
                NAME
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wider text-ivory/40">
                COMPANY
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wider text-ivory/40">
                COUNTRY
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-semibold tracking-wider text-ivory/40">
                STAGE
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-lighter">
            {contacts.map((contact) => (
              <tr
                key={contact.email}
                className="transition-colors hover:bg-navy-lighter/30"
              >
                <td className="px-5 py-4">
                  <p className="text-sm font-medium text-ivory">{contact.name}</p>
                  <p className="text-xs text-ivory/40">{contact.email}</p>
                </td>
                <td className="px-5 py-4 text-sm text-ivory/60">
                  {contact.company}
                </td>
                <td className="px-5 py-4 text-sm text-ivory/60">
                  {contact.country}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      stageBadgeColor[contact.stage] ?? "bg-gray-500/20 text-gray-400"
                    }`}
                  >
                    {contact.stage}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
