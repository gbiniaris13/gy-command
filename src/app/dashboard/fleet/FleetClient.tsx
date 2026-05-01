"use client";

import { useState, useEffect, useMemo } from "react";

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

// Pull a numeric weekly rate (€) out of free-form price strings like
// "€85,000/week" or "$120,000". Returns null if no number found.
function parsePriceEur(price: string | undefined): number | null {
  if (!price) return null;
  const m = price.replace(/[, ]/g, "").match(/(\d{4,})/);
  if (!m) return null;
  return Number(m[1]);
}

function formatEur(n: number): string {
  return `€${n.toLocaleString("en-US")}`;
}

export default function FleetClient() {
  const [fleet, setFleet] = useState<Vessel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [tierFilter, setTierFilter] = useState("All");
  const [copied, setCopied] = useState("");
  const [openVessel, setOpenVessel] = useState<Vessel | null>(null);

  useEffect(() => {
    fetch("/api/fleet")
      .then((r) => r.json())
      .then((d) => {
        setFleet(d.yachts || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const types = ["All", ...Array.from(new Set(fleet.map((v) => v.type)))];
  const tiers = ["All", "private", "explorer"];

  const filtered = fleet.filter((v) => {
    const matchSearch =
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      (v.subtitle || "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "All" || v.type === typeFilter;
    const matchTier = tierFilter === "All" || v.tier === tierFilter;
    return matchSearch && matchType && matchTier;
  });

  // Inventory KPI strip (computed once per fleet update)
  const stats = useMemo(() => {
    const total = fleet.length;
    const byType: Record<string, number> = {};
    for (const v of fleet) byType[v.type] = (byType[v.type] ?? 0) + 1;
    const prices = fleet.map((v) => parsePriceEur(v.price)).filter(Boolean) as number[];
    const avgPrice = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : 0;
    const medianPrice = prices.length
      ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
      : 0;
    const explorerCount = fleet.filter((v) => v.tier === "explorer").length;
    return { total, byType, avgPrice, medianPrice, explorerCount };
  }, [fleet]);

  const buildProposal = (v: Vessel) => {
    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return `GEORGE YACHTS — CHARTER PROPOSAL
${today}

Dear Guest,

Thank you for your interest in chartering with George Yachts. We are delighted
to present the following vessel for your consideration:

VESSEL
  Name:     ${v.name}
  Type:     ${v.type}
  Length:   ${v.length}
  Guests:   Sleeps ${v.sleeps}
  Tier:     ${v.tier === "explorer" ? "Explorer Fleet" : "Private Fleet"}
${v.subtitle ? `\n  "${v.subtitle}"\n` : ""}
INDICATIVE WEEKLY CHARTER RATE
  ${v.price}

  Rate excludes APA (Advance Provisioning Allowance, typically 25-30%),
  VAT where applicable, and any delivery/redelivery fees.

WHAT'S INCLUDED
  • Professional crew (captain, chef, stewardess, deckhand as applicable)
  • Use of the yacht for up to ${v.sleeps} guests
  • All onboard equipment and water toys
  • Fully fuelled at the start of the charter

NEXT STEPS
  1. Confirm preferred dates and embarkation port
  2. We draft the MYBA charter agreement
  3. 50% deposit on signing, 50% one month before embarkation
  4. APA wired to captain 5 days before the charter

For availability and a tailored itinerary, simply reply to this email or
call George directly.

Warm regards,
George P. Biniaris
George Yachts Brokerage House LLC
https://georgeyachts.com`;
  };

  const handleCopy = (v: Vessel) => {
    navigator.clipboard.writeText(buildProposal(v));
    setCopied(v.name);
    setTimeout(() => setCopied(""), 2500);
  };

  const handlePDF = (v: Vessel) => {
    const content = buildProposal(v);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${v.name} — Charter Proposal</title>
<style>
  body { font-family: 'Courier New', monospace; background: #010810; color: #a0ffe0; padding: 60px; line-height: 1.8; }
  h1 { color: #00ffc8; font-size: 18px; letter-spacing: 3px; border-bottom: 1px solid rgba(0,255,200,0.3); padding-bottom: 10px; }
  pre { white-space: pre-wrap; font-size: 13px; }
  @media print { body { background: #fff; color: #000; } h1 { color: #000; } }
</style></head><body>
<h1>GEORGE YACHTS</h1>
<pre>${content.replace(/</g, "&lt;")}</pre>
</body></html>`);
    win.document.close();
    setTimeout(() => {
      win.print();
    }, 300);
  };

  const typeColor: Record<string, string> = {
    Sailing: "#00ffc8",
    Catamaran: "#8B5CF6",
    Motor: "#F59E0B",
    "Power Cat": "#10B981",
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p style={{ color: "rgba(255,255,255,0.4)" }}>
          Loading fleet from Sanity...
        </p>
      </div>
    );
  }

  return (
    <div className="animate-page-enter p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 inline-flex rounded border border-hot-red/30 bg-hot-red/10 px-2 py-0.5">
            <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[3px] text-hot-red uppercase">
              AUTHORIZED
            </span>
          </div>
          <h1 className="font-[family-name:var(--font-mono)] text-lg sm:text-2xl font-black tracking-[3px] text-electric-cyan uppercase">
            FLEET COMMAND
          </h1>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-muted-blue tracking-wider uppercase">
            {fleet.length} VESSELS IN REGISTRY
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vessels..."
          className="rounded-lg border px-4 py-2.5 text-sm outline-none"
          style={{
            background: "#0A1628",
            borderColor: "rgba(0,255,200,0.1)",
            color: "#fff",
            minHeight: "44px",
            width: "100%",
            maxWidth: "300px",
          }}
        />
      </div>

      {/* KPI strip — at-a-glance fleet composition */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-muted-blue uppercase">
            Total Fleet
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-black text-electric-cyan">
            {stats.total}
          </p>
          <p className="mt-1 text-[10px] text-muted-blue/70">
            {stats.explorerCount} explorer · {stats.total - stats.explorerCount}{" "}
            private
          </p>
        </div>
        <div className="glass-card p-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-muted-blue uppercase">
            Avg Weekly Rate
          </p>
          <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-black text-gold">
            {stats.avgPrice ? formatEur(stats.avgPrice) : "—"}
          </p>
          <p className="mt-1 text-[10px] text-muted-blue/70">
            median {stats.medianPrice ? formatEur(stats.medianPrice) : "—"}
          </p>
        </div>
        {Object.entries(stats.byType)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([type, count]) => (
            <div key={type} className="glass-card p-4">
              <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold tracking-[2px] text-muted-blue uppercase">
                {type}
              </p>
              <p
                className="mt-1 font-[family-name:var(--font-display)] text-2xl font-black"
                style={{ color: typeColor[type] || "#00ffc8" }}
              >
                {count}
              </p>
              <p className="mt-1 text-[10px] text-muted-blue/70">
                {Math.round((count / Math.max(1, stats.total)) * 100)}% of fleet
              </p>
            </div>
          ))}
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className="rounded-full px-4 py-2 text-xs font-medium transition-all"
            style={{
              background:
                typeFilter === t ? (typeColor[t] || "#00ffc8") + "20" : "transparent",
              border: `1px solid ${
                typeFilter === t ? typeColor[t] || "#00ffc8" : "rgba(255,255,255,0.1)"
              }`,
              color:
                typeFilter === t
                  ? typeColor[t] || "#00ffc8"
                  : "rgba(255,255,255,0.5)",
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
              background: tierFilter === t ? "#00ffc820" : "transparent",
              border: `1px solid ${
                tierFilter === t ? "#00ffc8" : "rgba(255,255,255,0.1)"
              }`,
              color: tierFilter === t ? "#00ffc8" : "rgba(255,255,255,0.5)",
              minHeight: "36px",
            }}
          >
            {t === "All"
              ? "All Tiers"
              : t === "private"
                ? "Private Fleet"
                : "Explorer Fleet"}
          </button>
        ))}
      </div>

      <p className="mb-4 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
        Showing {filtered.length} of {fleet.length} vessels
      </p>

      {/* Grid — click opens detail modal (no more silent copy) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((v) => (
          <button
            key={v.slug || v.name}
            onClick={() => setOpenVessel(v)}
            className="glass-card group cursor-pointer rounded-xl p-4 text-left transition-all hover:scale-[1.01]"
            style={{
              border: copied === v.name ? "1px solid #10B981" : undefined,
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span
                className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: (typeColor[v.type] || "#00ffc8") + "20",
                  color: typeColor[v.type] || "#00ffc8",
                }}
              >
                {v.type}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] uppercase"
                style={{
                  background: v.tier === "explorer" ? "#10B98120" : "#F59E0B20",
                  color: v.tier === "explorer" ? "#10B981" : "#F59E0B",
                }}
              >
                {v.tier}
              </span>
            </div>

            <h3 className="mb-1 text-sm font-semibold" style={{ color: "#fff" }}>
              {v.name}
            </h3>
            <p
              className="mb-3 text-xs"
              style={{ color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}
            >
              {v.subtitle || ""}
            </p>

            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              <span>📏 {v.length}</span>
              <span>👥 {v.sleeps} guests</span>
            </div>

            <p
              className="mt-2 text-xs font-medium"
              style={{
                color: "#00ffc8",
                fontFamily: "var(--font-jetbrains-mono)",
              }}
            >
              {v.price}
            </p>

            <p
              className="mt-3 text-[10px] uppercase tracking-wider"
              style={{ color: "rgba(0,255,200,0.5)" }}
            >
              Click for proposal →
            </p>
          </button>
        ))}
      </div>

      {/* Detail modal — explicit copy/PDF/website actions */}
      {openVessel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpenVessel(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-border-glow bg-glass-dark p-5 sm:p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <span
                  className="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                  style={{
                    background: (typeColor[openVessel.type] || "#00ffc8") + "20",
                    color: typeColor[openVessel.type] || "#00ffc8",
                  }}
                >
                  {openVessel.type}
                </span>
                <h2 className="mt-2 font-[family-name:var(--font-montserrat)] text-xl font-bold text-soft-white">
                  {openVessel.name}
                </h2>
                {openVessel.subtitle && (
                  <p className="mt-1 text-sm text-muted-blue italic">
                    "{openVessel.subtitle}"
                  </p>
                )}
              </div>
              <button
                onClick={() => setOpenVessel(null)}
                className="rounded-lg p-1.5 text-muted-blue hover:bg-glass-light hover:text-soft-white"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg border border-border-glow bg-glass-light px-3 py-2">
                <p className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue uppercase">
                  Length
                </p>
                <p className="mt-0.5 text-sm font-bold text-soft-white">
                  {openVessel.length}
                </p>
              </div>
              <div className="rounded-lg border border-border-glow bg-glass-light px-3 py-2">
                <p className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue uppercase">
                  Sleeps
                </p>
                <p className="mt-0.5 text-sm font-bold text-soft-white">
                  {openVessel.sleeps} guests
                </p>
              </div>
              <div className="rounded-lg border border-border-glow bg-glass-light px-3 py-2">
                <p className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue uppercase">
                  Tier
                </p>
                <p
                  className="mt-0.5 text-sm font-bold"
                  style={{
                    color: openVessel.tier === "explorer" ? "#10B981" : "#F59E0B",
                  }}
                >
                  {openVessel.tier === "explorer" ? "Explorer" : "Private"}
                </p>
              </div>
              <div className="rounded-lg border border-border-glow bg-glass-light px-3 py-2">
                <p className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue uppercase">
                  Weekly Rate
                </p>
                <p
                  className="mt-0.5 text-sm font-bold"
                  style={{ color: "#00ffc8" }}
                >
                  {openVessel.price || "—"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  handleCopy(openVessel);
                }}
                className="flex-1 min-w-[140px] rounded-lg bg-electric-cyan px-4 py-2.5 font-[family-name:var(--font-display)] text-sm font-semibold text-deep-space hover:bg-electric-cyan/90 min-h-[44px]"
              >
                {copied === openVessel.name ? "✓ Copied!" : "Copy Proposal"}
              </button>
              <button
                onClick={() => handlePDF(openVessel)}
                className="rounded-lg border border-electric-cyan/40 bg-electric-cyan/10 px-4 py-2.5 text-sm text-electric-cyan hover:bg-electric-cyan/20 min-h-[44px]"
              >
                📄 PDF
              </button>
              {openVessel.slug && (
                <a
                  href={`https://georgeyachts.com/yachts/${openVessel.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-border-glow bg-glass-light px-4 py-2.5 text-sm text-muted-blue hover:text-ivory min-h-[44px] inline-flex items-center"
                >
                  ↗ Public page
                </a>
              )}
            </div>
            <p className="mt-3 text-[10px] text-muted-blue/60">
              Tip: Copy paste-ready charter proposal text. Use PDF for an
              email attachment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
