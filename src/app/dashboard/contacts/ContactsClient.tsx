"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Contact, PipelineStage } from "@/lib/types";
import { getFlagFromCountry } from "@/lib/flags";

interface Props {
  contacts: Contact[];
  stages: PipelineStage[];
  countries: string[];
  sources: string[];
}

const SOURCE_LABELS: Record<string, string> = {
  website_lead: "Website Lead",
  website_inquiry: "Website Inquiry",
  outreach_bot: "Outreach",
  manual: "Manual",
  referral: "Referral",
  partner: "Partner",
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export default function ContactsClient({
  contacts: initialContacts,
  stages,
  countries,
  sources,
}: Props) {
  const router = useRouter();
  const [contacts, setContacts] = useState(initialContacts);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company: "",
    country: "",
    source: "manual",
    pipeline_stage_id: stages[0]?.id ?? "",
  });

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q);

      const matchesStage =
        !filterStage || c.pipeline_stage_id === filterStage;
      const matchesSource = !filterSource || c.source === filterSource;
      const matchesCountry = !filterCountry || c.country === filterCountry;

      return matchesSearch && matchesStage && matchesSource && matchesCountry;
    });
  }, [contacts, search, filterStage, filterSource, filterCountry]);

  async function handleCreate() {
    setSaving(true);
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const newContact = await res.json();
        // Attach stage info for display
        const stage = stages.find((s) => s.id === newContact.pipeline_stage_id);
        newContact.pipeline_stage = stage || null;
        newContact.contact_tags = [];
        setContacts((prev) => [newContact, ...prev]);
        setShowModal(false);
        setForm({
          first_name: "",
          last_name: "",
          email: "",
          phone: "",
          company: "",
          country: "",
          source: "manual",
          pipeline_stage_id: stages[0]?.id ?? "",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-montserrat)] text-2xl font-bold text-ivory">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-ivory/50">
            {filtered.length} of {contacts.length} contacts
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-gold px-4 py-2.5 font-[family-name:var(--font-montserrat)] text-sm font-semibold text-navy transition-colors hover:bg-gold/90"
        >
          + Add Contact
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ivory/30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-white/5 bg-navy-lighter py-2.5 pl-10 pr-4 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none focus:ring-1 focus:ring-gold/20"
          />
        </div>

        {/* Stage filter */}
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory/70 focus:border-gold/30 focus:outline-none"
        >
          <option value="">All Stages</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {/* Source filter */}
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory/70 focus:border-gold/30 focus:outline-none"
        >
          <option value="">All Sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s] ?? s}
            </option>
          ))}
        </select>

        {/* Country filter */}
        <select
          value={filterCountry}
          onChange={(e) => setFilterCountry(e.target.value)}
          className="rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory/70 focus:border-gold/30 focus:outline-none"
        >
          <option value="">All Countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {getFlagFromCountry(c)} {c}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-white/5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5 bg-navy-light">
              {["Name", "Company", "Country", "Email", "Stage", "Source", "Last Activity"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-5 py-3.5 text-left text-xs font-semibold tracking-wider text-ivory/40 uppercase"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-ivory/30">
                  No contacts found
                </td>
              </tr>
            )}
            {filtered.map((contact) => {
              const stage = contact.pipeline_stage;
              const srcLabel = SOURCE_LABELS[contact.source ?? ""] ?? contact.source ?? "—";
              return (
                <tr
                  key={contact.id}
                  onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
                  className="cursor-pointer transition-colors hover:bg-navy-lighter/30"
                >
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-ivory">
                      {contact.first_name} {contact.last_name}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-sm text-ivory/60">
                    {contact.company ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-sm text-ivory/60">
                    {getFlagFromCountry(contact.country)} {contact.country ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-sm text-ivory/50">
                    {contact.email ?? "—"}
                  </td>
                  <td className="px-5 py-4">
                    {stage ? (
                      <span
                        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${stage.color}20`,
                          color: stage.color,
                        }}
                      >
                        {stage.name}
                      </span>
                    ) : (
                      <span className="text-xs text-ivory/30">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs text-ivory/50">{srcLabel}</td>
                  <td className="px-5 py-4 text-xs text-ivory/40">
                    {timeAgo(contact.last_activity_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Contact Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-white/10 bg-navy-light p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-montserrat)] text-lg font-semibold text-ivory">
                Add New Contact
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-ivory/40 transition-colors hover:bg-white/5 hover:text-ivory"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-ivory/40">First Name</label>
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none"
                    placeholder="Elena"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ivory/40">Last Name</label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none"
                    placeholder="Vasquez"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-ivory/40">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none"
                  placeholder="elena@example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-ivory/40">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none"
                    placeholder="+33 6 12 34 56 78"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ivory/40">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none"
                    placeholder="Riviera Charters"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-ivory/40">Country</label>
                  <input
                    type="text"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/30 focus:border-gold/30 focus:outline-none"
                    placeholder="Monaco"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ivory/40">Source</label>
                  <select
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    className="w-full rounded-lg border border-white/5 bg-navy-lighter px-3 py-2.5 text-sm text-ivory/70 focus:border-gold/30 focus:outline-none"
                  >
                    <option value="manual">Manual</option>
                    <option value="website_lead">Website Lead</option>
                    <option value="website_inquiry">Website Inquiry</option>
                    <option value="outreach_bot">Outreach Bot</option>
                    <option value="referral">Referral</option>
                    <option value="partner">Partner</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-ivory/60 transition-colors hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !form.first_name.trim()}
                className="rounded-lg bg-gold px-5 py-2 font-[family-name:var(--font-montserrat)] text-sm font-semibold text-navy transition-colors hover:bg-gold/90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Add Contact"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
