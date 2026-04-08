"use client";

import { useState } from "react";

interface Vessel {
  name: string;
  type: "Sailing" | "Catamaran" | "Motor";
  length: string;
  sleeps: number;
  price: string;
  year?: number;
  builder?: string;
}

const FLEET: Vessel[] = [
  { name: "S/Y Allegra", type: "Sailing", length: "56ft", sleeps: 10, price: "\u20AC12,500/week", year: 2019, builder: "Beneteau" },
  { name: "S/CAT Ad Astra", type: "Catamaran", length: "52ft", sleeps: 12, price: "\u20AC18,000/week", year: 2021, builder: "Lagoon" },
  { name: "S/CAT ALTEYA", type: "Catamaran", length: "60ft", sleeps: 12, price: "\u20AC22,000/week", year: 2022, builder: "Fountaine Pajot" },
  { name: "M/Y La Pellegrina", type: "Motor", length: "164ft", sleeps: 12, price: "\u20AC235,000/week", year: 2012, builder: "Couach" },
  { name: "S/Y Fo\u2019s", type: "Sailing", length: "48ft", sleeps: 8, price: "\u20AC8,500/week", year: 2017, builder: "Dufour" },
  { name: "M/Y Eros", type: "Motor", length: "130ft", sleeps: 10, price: "\u20AC95,000/week", year: 2009, builder: "Maiora" },
  { name: "S/CAT Thetis", type: "Catamaran", length: "55ft", sleeps: 10, price: "\u20AC19,500/week", year: 2023, builder: "Bali" },
  { name: "S/Y Anemone", type: "Sailing", length: "62ft", sleeps: 10, price: "\u20AC15,000/week", year: 2020, builder: "Jeanneau" },
  { name: "M/Y Celeste", type: "Motor", length: "85ft", sleeps: 8, price: "\u20AC52,000/week", year: 2018, builder: "Azimut" },
  { name: "S/CAT Poseidon", type: "Catamaran", length: "50ft", sleeps: 10, price: "\u20AC16,000/week", year: 2021, builder: "Lagoon" },
  { name: "M/Y Neptune Star", type: "Motor", length: "110ft", sleeps: 10, price: "\u20AC75,000/week", year: 2015, builder: "Benetti" },
  { name: "S/Y Aegean Wind", type: "Sailing", length: "52ft", sleeps: 8, price: "\u20AC10,500/week", year: 2018, builder: "Bavaria" },
  { name: "S/CAT Blue Horizon", type: "Catamaran", length: "58ft", sleeps: 12, price: "\u20AC20,000/week", year: 2022, builder: "Fountaine Pajot" },
  { name: "M/Y Aphrodite", type: "Motor", length: "142ft", sleeps: 12, price: "\u20AC145,000/week", year: 2016, builder: "Feadship" },
  { name: "S/Y Calypso", type: "Sailing", length: "44ft", sleeps: 6, price: "\u20AC7,000/week", year: 2016, builder: "Beneteau" },
  { name: "M/Y Olympia", type: "Motor", length: "95ft", sleeps: 10, price: "\u20AC65,000/week", year: 2020, builder: "Sunseeker" },
  { name: "S/CAT Elysium", type: "Catamaran", length: "65ft", sleeps: 12, price: "\u20AC25,000/week", year: 2024, builder: "Sunreef" },
  { name: "S/Y Mistral", type: "Sailing", length: "70ft", sleeps: 10, price: "\u20AC18,000/week", year: 2021, builder: "Swan" },
  { name: "M/Y Triton", type: "Motor", length: "120ft", sleeps: 12, price: "\u20AC85,000/week", year: 2017, builder: "Sanlorenzo" },
  { name: "S/CAT Artemis", type: "Catamaran", length: "48ft", sleeps: 8, price: "\u20AC14,000/week", year: 2020, builder: "Bali" },
];

function typeColor(type: string): string {
  switch (type) {
    case "Sailing":
      return "bg-electric-cyan/15 text-electric-cyan border-electric-cyan/20";
    case "Motor":
      return "bg-amber/15 text-amber border-amber/20";
    case "Catamaran":
      return "bg-neon-purple/15 text-neon-purple border-neon-purple/20";
    default:
      return "bg-muted-blue/15 text-muted-blue border-muted-blue/20";
  }
}

function typeGlow(type: string): string {
  switch (type) {
    case "Sailing":
      return "hover:border-electric-cyan/30 hover:shadow-[0_0_20px_rgba(0,240,255,0.08)]";
    case "Motor":
      return "hover:border-amber/30 hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]";
    case "Catamaran":
      return "hover:border-neon-purple/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.08)]";
    default:
      return "";
  }
}

export default function FleetClient() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("All");
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = FLEET.filter((v) => {
    const matchesSearch =
      search === "" ||
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.builder?.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === "All" || v.type === typeFilter;
    return matchesSearch && matchesType;
  });

  async function copyName(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      setCopied(name);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback
    }
  }

  const types = ["All", "Sailing", "Catamaran", "Motor"];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-soft-white">
          Fleet
        </h1>
        <p className="mt-1 text-sm text-muted-blue">
          {FLEET.length} vessels available -- click to copy name
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-blue"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vessels..."
            className="w-full rounded-lg border border-border-glow bg-glass-dark px-10 py-2.5 text-sm text-soft-white placeholder:text-muted-blue/50 focus:border-electric-cyan/30 focus:outline-none min-h-[44px]"
          />
        </div>
        {/* Type filter */}
        <div className="flex gap-1.5">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors min-h-[44px] ${
                typeFilter === t
                  ? "bg-electric-cyan/10 text-electric-cyan border border-electric-cyan/20"
                  : "text-muted-blue hover:bg-glass-light border border-transparent"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((vessel) => (
          <button
            key={vessel.name}
            onClick={() => copyName(vessel.name)}
            className={`glass-card relative flex flex-col p-4 text-left transition-all ${typeGlow(
              vessel.type
            )} min-h-[44px]`}
          >
            {/* Type badge */}
            <span
              className={`self-start rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${typeColor(
                vessel.type
              )}`}
            >
              {vessel.type}
            </span>

            {/* Name */}
            <h3 className="mt-3 font-[family-name:var(--font-display)] text-base font-semibold text-soft-white">
              {vessel.name}
            </h3>

            {/* Specs */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-blue">
              <span>{vessel.length}</span>
              <span>Sleeps {vessel.sleeps}</span>
              {vessel.year && <span>{vessel.year}</span>}
              {vessel.builder && <span>{vessel.builder}</span>}
            </div>

            {/* Price */}
            <p className="mt-3 font-[family-name:var(--font-mono)] text-sm font-semibold text-electric-cyan">
              {vessel.price}
            </p>

            {/* Copy indicator */}
            {copied === vessel.name && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-deep-space/80 backdrop-blur-sm">
                <span className="flex items-center gap-1.5 text-sm font-medium text-electric-cyan">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  Copied!
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-8 text-center text-sm text-muted-blue">
          No vessels match your search.
        </div>
      )}
    </div>
  );
}
