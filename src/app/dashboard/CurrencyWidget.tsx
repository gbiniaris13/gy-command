"use client";

import { useEffect, useState } from "react";

interface Rates {
  USD: number;
  GBP: number;
  CHF: number;
  AED: number;
}

export default function CurrencyWidget() {
  const [rates, setRates] = useState<Rates | null>(null);
  const [lastUpdate, setLastUpdate] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        // Free API, no key needed
        const res = await fetch(
          "https://api.exchangerate-api.com/v4/latest/EUR"
        );
        if (!res.ok) return;
        const data = await res.json();
        setRates({
          USD: data.rates.USD,
          GBP: data.rates.GBP,
          CHF: data.rates.CHF,
          AED: data.rates.AED,
        });
        setLastUpdate(
          new Date().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })
        );
      } catch {
        // silent
      }
    };
    load();
    const t = setInterval(load, 30 * 60 * 1000); // refresh every 30 min
    return () => clearInterval(t);
  }, []);

  if (!rates) return null;

  const pairs = [
    { label: "EUR/USD", value: rates.USD, flag: "\uD83C\uDDFA\uD83C\uDDF8" },
    { label: "EUR/GBP", value: rates.GBP, flag: "\uD83C\uDDEC\uD83C\uDDE7" },
    { label: "EUR/CHF", value: rates.CHF, flag: "\uD83C\uDDE8\uD83C\uDDED" },
    { label: "EUR/AED", value: rates.AED, flag: "\uD83C\uDDE6\uD83C\uDDEA" },
  ];

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-amber" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          CURRENCY EXCHANGE
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[9px] text-muted-blue/50 tracking-wider uppercase">
          LAST SYNC: {lastUpdate}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {pairs.map((p) => (
          <div
            key={p.label}
            className="rounded border border-border-glow bg-glass-light/20 p-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{p.flag}</span>
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[1.5px] text-muted-blue/60">
                {p.label}
              </span>
            </div>
            <p className="font-[family-name:var(--font-mono)] text-xl font-bold text-electric-cyan">
              {p.value.toFixed(4)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
