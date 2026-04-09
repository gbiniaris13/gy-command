"use client";

import { useState, useEffect } from "react";

interface Vessel {
  name: string;
  type: string;
  length: string;
  sleeps: number;
  price: string;
  tier: string;
  slug: string;
  subtitle?: string;
  image?: string | null;
}

export default function FleetClient() {
  const [fleet, setFleet] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [tierFilter, setTierFilter] = useState("All");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/fleet")
      .then((r) => r.json())
      .then((d) => { setFleet(d.yachts || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const types = ["All", ...Array.from(new Set(fleet.map((v) => v.type)))];
  const tiers = ["All", "private", "explorer"];

  const filtered = fleet.filter((v) => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.subtitle || "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "All" || v.type === typeFilter;
    const matchTier = tierFilter === "All" || v.tier === tierFilter;
    return matchSearch && matchType && matchTier;
  });

  const handleCopy = (name: string) => {
    navigator.clipboard.writeText(name);
    setCopied(name);
    setTimeout(() => setCopied(""), 2000);
  };

  const typeColor: Record<string, string> = {
    Sailing: "#00F0FF",
    Catamaran: "#8B5CF6",
    Motor: "#F59E0B",
    "Power Cat": "#10B981",
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p style={{ color: "rgba(255,255,255,0.4)" }}>Loading fleet from Sanity...</p>
      </div>
    );
  }

  return (
    <div className="animate-page-enter p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#00F0FF", fontFamily: "var(--font-space-grotesk)" }}>
            Fleet
          </h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px" }}>
            {fleet.length} vessels from Sanity CMS
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vessels..."
          className="rounded-lg border px-4 py-2.5 text-sm outline-none"
          style={{ background: "#0A1628", borderColor: "rgba(0,240,255,0.1)", color: "#fff", minHeight: "44px", width: "100%", maxWidth: "300px" }}
        />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className="rounded-full px-4 py-2 text-xs font-medium transition-all"
            style={{
              background: typeFilter === t ? (typeColor[t] || "#00F0FF") + "20" : "transparent",
              border: `1px solid ${typeFilter === t ? (typeColor[t] || "#00F0FF") : "rgba(255,255,255,0.1)"}`,
              color: typeFilter === t ? (typeColor[t] || "#00F0FF") : "rgba(255,255,255,0.5)",
              minHeight: "36px",
            }}
          >
            {t}
          </button>
        ))}
        <span style={{ color: "rgba(255,255,255,0.2)", padding: "8px" }}>|</span>
        {tiers.map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className="rounded-full px-4 py-2 text-xs font-medium transition-all"
            style={{
              background: tierFilter === t ? "#00F0FF20" : "transparent",
              border: `1px solid ${tierFilter === t ? "#00F0FF" : "rgba(255,255,255,0.1)"}`,
              color: tierFilter === t ? "#00F0FF" : "rgba(255,255,255,0.5)",
              minHeight: "36px",
            }}
          >
            {t === "All" ? "All Tiers" : t === "private" ? "Private Fleet" : "Explorer Fleet"}
          </button>
        ))}
      </div>

      <p className="mb-4 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
        Showing {filtered.length} of {fleet.length} vessels
      </p>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((v) => (
          <button
            key={v.slug || v.name}
            onClick={() => handleCopy(v.name)}
            className="glass-card group cursor-pointer rounded-xl p-4 text-left transition-all hover:scale-[1.01]"
            style={{ border: copied === v.name ? "1px solid #10B981" : undefined }}
          >
            {/* Type badge */}
            <div className="mb-3 flex items-center justify-between">
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: (typeColor[v.type] || "#00F0FF") + "20", color: typeColor[v.type] || "#00F0FF" }}
              >
                {v.type}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                style={{ background: v.tier === "explorer" ? "#10B98120" : "#F59E0B20", color: v.tier === "explorer" ? "#10B981" : "#F59E0B" }}
              >
                {v.tier}
              </span>
            </div>

            {/* Name */}
            <h3 className="mb-1 text-sm font-semibold" style={{ color: "#fff" }}>
              {v.name}
            </h3>
            <p className="mb-3 text-xs" style={{ color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
              {v.subtitle || ""}
            </p>

            {/* Specs */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
              <span>📏 {v.length}</span>
              <span>👥 {v.sleeps} guests</span>
            </div>

            {/* Price */}
            <p className="mt-2 text-xs font-medium" style={{ color: "#00F0FF", fontFamily: "var(--font-jetbrains-mono)" }}>
              {v.price}
            </p>

            {/* Copy feedback */}
            {copied === v.name && (
              <p className="mt-2 text-center text-[10px] font-bold" style={{ color: "#10B981" }}>
                ✓ Copied to clipboard
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
