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
  if (!dateStr) return "\u2014";
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

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    linkedin_url: "",
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
          linkedin_url: "",
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
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-soft-white">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-muted-blue">
            {filtered.length} of {contacts.length} contacts
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-electric-cyan px-4 py-2.5 font-[family-name:var(--font-display)] text-sm font-semibold text-deep-space transition-colors hover:bg-electric-cyan/90 min-h-[44px]"
        >
          + Add Contact
        </button>
      </div>

      {/* Filters — sticky on mobile */}
      <div className="mb-4 sm:mb-6 sticky top-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-2 sm:py-0 bg-deep-space/80 backdrop-blur-lg sm:bg-transparent sm:backdrop-blur-none">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-blue"
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
              className="w-full rounded-lg border border-border-glow bg-glass-dark py-2.5 pl-10 pr-4 text-sm text-soft-white placeholder:text-muted-blue/50 focus:border-electric-cyan/30 focus:outline-none focus:ring-1 focus:ring-electric-cyan/20 min-h-[44px]"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto">
            <select
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value)}
              className="rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 text-sm text-muted-blue focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
            >
              <option value="">All Stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 text-sm text-muted-blue focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
            >
              <option value="">All Sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s] ?? s}
                </option>
              ))}
            </select>

            <select
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="rounded-lg border border-border-glow bg-glass-dark px-3 py-2.5 text-sm text-muted-blue focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
            >
              <option value="">All Countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {getFlagFromCountry(c)} {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ─── Mobile: Card view ─────────────────────────────────────── */}
      <div className="block sm:hidden space-y-3">
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-blue">
            No contacts found
          </div>
        )}
        {filtered.map((contact) => {
          const stage = contact.pipeline_stage;
          return (
            <button
              key={contact.id}
              onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
              className="glass-card w-full text-left p-4 transition-all hover:border-electric-cyan/20 min-h-[44px]"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-soft-white truncate">
                    {getFlagFromCountry(contact.country)}{" "}
                    {contact.first_name} {contact.last_name}
                    {contact.linkedin_url && (
                      <a
                        href={contact.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#0a66c2] transition-colors hover:bg-[#0a66c2]/15"
                        title="Open LinkedIn profile"
                        aria-label="Open LinkedIn profile"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                      </a>
                    )}
                  </p>
                  {contact.company && (
                    <p className="mt-0.5 text-xs text-muted-blue truncate">
                      {contact.company}
                    </p>
                  )}
                </div>
                {stage && (
                  <span
                    className="ml-3 shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${(stage as PipelineStage).color}20`,
                      color: (stage as PipelineStage).color,
                    }}
                  >
                    {(stage as PipelineStage).name}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-muted-blue/60">
                  {contact.email ?? "\u2014"}
                </span>
                <span className="text-[10px] text-muted-blue/40">
                  {timeAgo(contact.last_activity_at)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── Desktop: Table view ───────────────────────────────────── */}
      <div className="hidden sm:block overflow-hidden rounded-xl border border-border-glow">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-glow bg-glass-dark">
              {["Name", "Company", "Country", "Email", "Stage", "Source", "Last Activity"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-5 py-3.5 text-left font-[family-name:var(--font-sans)] text-[11px] font-semibold tracking-wider text-muted-blue uppercase"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-glow">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-blue">
                  No contacts found
                </td>
              </tr>
            )}
            {filtered.map((contact) => {
              const stage = contact.pipeline_stage;
              const srcLabel = SOURCE_LABELS[contact.source ?? ""] ?? contact.source ?? "\u2014";
              return (
                <tr
                  key={contact.id}
                  onClick={() => router.push(`/dashboard/contacts/${contact.id}`)}
                  className="cursor-pointer transition-colors hover:bg-glass-light/30"
                >
                  <td className="px-5 py-4">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-soft-white">
                      {contact.first_name} {contact.last_name}
                      {contact.linkedin_url && (
                        <a
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-[#0a66c2] transition-colors hover:bg-[#0a66c2]/15"
                          title="Open LinkedIn profile"
                          aria-label="Open LinkedIn profile"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                          </svg>
                        </a>
                      )}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-sm text-muted-blue">
                    {contact.company ?? "\u2014"}
                  </td>
                  <td className="px-5 py-4 text-sm text-muted-blue">
                    {getFlagFromCountry(contact.country)} {contact.country ?? "\u2014"}
                  </td>
                  <td className="px-5 py-4 text-sm text-muted-blue/70">
                    {contact.email ?? "\u2014"}
                  </td>
                  <td className="px-5 py-4">
                    {stage ? (
                      <span
                        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${(stage as PipelineStage).color}20`,
                          color: (stage as PipelineStage).color,
                        }}
                      >
                        {(stage as PipelineStage).name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-blue/30">\u2014</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-xs text-muted-blue/60">{srcLabel}</td>
                  <td className="px-5 py-4 text-xs text-muted-blue/50">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border-glow bg-glass-dark p-5 sm:p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-soft-white">
                Add New Contact
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-muted-blue transition-colors hover:bg-glass-light hover:text-soft-white min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">First Name</label>
                  <input
                    type="text"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                    placeholder="Elena"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">Last Name</label>
                  <input
                    type="text"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                    placeholder="Vasquez"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  placeholder="elena@example.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">LinkedIn URL</label>
                <input
                  type="url"
                  value={form.linkedin_url}
                  onChange={(e) => setForm({ ...form, linkedin_url: e.target.value })}
                  className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                  placeholder="https://linkedin.com/in/..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                    placeholder="+33 6 12 34 56 78"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                    placeholder="Riviera Charters"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">Country</label>
                  <input
                    type="text"
                    value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/40 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
                    placeholder="Monaco"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium tracking-wider text-muted-blue uppercase">Source</label>
                  <select
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    className="w-full rounded-lg border border-border-glow bg-glass-light px-3 py-2.5 text-sm text-muted-blue focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
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
                className="rounded-lg border border-border-glow px-4 py-2 text-sm text-muted-blue transition-colors hover:bg-glass-light min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !form.first_name.trim()}
                className="rounded-lg bg-electric-cyan px-5 py-2 font-[family-name:var(--font-display)] text-sm font-semibold text-deep-space transition-colors hover:bg-electric-cyan/90 disabled:opacity-50 min-h-[44px]"
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
