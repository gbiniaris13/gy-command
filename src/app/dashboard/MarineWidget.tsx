"use client";

import { useEffect, useState } from "react";

interface MarineData {
  name: string;
  wave: number;
  wind: number;
  temp: number;
}

const SECTORS = [
  { name: "Mykonos", lat: 37.45, lon: 25.35 },
  { name: "Santorini", lat: 36.39, lon: 25.46 },
  { name: "Corfu", lat: 39.62, lon: 19.92 },
  { name: "Lefkada", lat: 38.83, lon: 20.71 },
  { name: "Hydra", lat: 37.35, lon: 23.47 },
  { name: "Skiathos", lat: 39.16, lon: 23.49 },
];

export default function MarineWidget() {
  const [data, setData] = useState<MarineData[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const lats = SECTORS.map((s) => s.lat).join(",");
    const lons = SECTORS.map((s) => s.lon).join(",");
    fetch(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_period`
    )
      .then((r) => r.json())
      .then((json) => {
        // Open-Meteo returns array for multiple locations
        const results: MarineData[] = [];
        if (Array.isArray(json)) {
          json.forEach((loc: { current?: { wave_height?: number } }, i: number) => {
            results.push({
              name: SECTORS[i].name,
              wave: loc.current?.wave_height ?? 0,
              wind: 0,
              temp: 0,
            });
          });
        } else if (json.current) {
          // Single location response
          results.push({
            name: SECTORS[0].name,
            wave: json.current.wave_height ?? 0,
            wind: 0,
            temp: 0,
          });
        }
        setData(results);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="glass-card p-4 sm:p-6">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="h-2 w-2 rounded-full bg-electric-cyan" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          MARITIME INTEL
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[9px] text-muted-blue/50 tracking-wider">
          SEA CONDITIONS
        </span>
        <svg className={`h-4 w-4 text-muted-blue transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {!collapsed && data.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-3 font-[family-name:var(--font-mono)] text-xs">
              <span className="w-20 text-muted-blue/60">{d.name.toUpperCase()}</span>
              <span className="text-electric-cyan">{d.wave.toFixed(1)}m</span>
              <span className={`ml-auto text-[9px] ${d.wave > 0.7 ? "text-amber" : "text-emerald"}`}>
                {d.wave > 0.7 ? "ADVISORY" : "CLEAR"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
