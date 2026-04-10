"use client";

import { useEffect, useState } from "react";

interface Location {
  name: string;
  lat: number;
  lon: number;
}

interface WeatherData {
  location: string;
  temp: number;
  wind: number;
  code: number;
}

const LOCATIONS: Location[] = [
  { name: "Athens", lat: 37.97, lon: 23.73 },
  { name: "Mykonos", lat: 37.45, lon: 25.33 },
  { name: "Santorini", lat: 36.39, lon: 25.46 },
  { name: "Corfu", lat: 39.62, lon: 19.92 },
  { name: "Lefkada", lat: 38.83, lon: 20.71 },
  { name: "Hydra", lat: 37.35, lon: 23.47 },
  { name: "Skiathos", lat: 39.16, lon: 23.49 },
];

const REVALIDATE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

// WMO weather codes → emoji + short description
function describeCode(code: number): { icon: string; desc: string } {
  if (code === 0) return { icon: "\u2600\uFE0F", desc: "Clear" };
  if (code <= 2) return { icon: "\u{1F324}\uFE0F", desc: "Mostly Sunny" };
  if (code === 3) return { icon: "\u2601\uFE0F", desc: "Overcast" };
  if (code <= 48) return { icon: "\u{1F32B}\uFE0F", desc: "Fog" };
  if (code <= 57) return { icon: "\u{1F327}\uFE0F", desc: "Drizzle" };
  if (code <= 67) return { icon: "\u{1F327}\uFE0F", desc: "Rain" };
  if (code <= 77) return { icon: "\u2744\uFE0F", desc: "Snow" };
  if (code <= 82) return { icon: "\u{1F326}\uFE0F", desc: "Showers" };
  if (code <= 86) return { icon: "\u2744\uFE0F", desc: "Snow Showers" };
  if (code <= 99) return { icon: "\u26C8\uFE0F", desc: "Thunderstorm" };
  return { icon: "\u26C5", desc: "Fair" };
}

async function fetchLocation(loc: Location): Promise<WeatherData> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,wind_speed_10m,weather_code`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const cur = json?.current;
  if (!cur || typeof cur.temperature_2m !== "number") {
    throw new Error("Invalid payload");
  }
  return {
    location: loc.name,
    temp: Math.round(cur.temperature_2m),
    wind: Math.round(cur.wind_speed_10m ?? 0),
    code: cur.weather_code ?? 0,
  };
}

export default function WeatherWidget() {
  const [data, setData] = useState<WeatherData[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let lastSuccess = 0;

    const load = async () => {
      try {
        const results = await Promise.all(LOCATIONS.map(fetchLocation));
        if (cancelled) return;
        lastSuccess = Date.now();
        setData(results);
        setHidden(false);
      } catch {
        if (cancelled) return;
        const stale = lastSuccess === 0 || Date.now() - lastSuccess > MAX_STALE_MS;
        if (stale) {
          setData(null);
          setHidden(true);
        }
      }
    };

    load();
    const interval = setInterval(load, REVALIDATE_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (hidden || !data) return null;

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber/10">
          <span className="text-sm">{"\u2600\uFE0F"}</span>
        </div>
        <h2 className="font-[family-name:var(--font-display)] text-base sm:text-lg font-semibold text-soft-white">
          Greek Charter Weather
        </h2>
        <span className="ml-auto text-[10px] text-muted-blue/50">
          Live &middot; Open-Meteo &middot; updates every 30 min
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-3">
        {data.map((w) => {
          const { icon, desc } = describeCode(w.code);
          return (
            <div
              key={w.location}
              className="rounded-lg border border-border-glow bg-glass-light/30 p-3 text-center"
            >
              <p className="text-lg">{icon}</p>
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-soft-white">
                {w.location}
              </p>
              <p className="font-[family-name:var(--font-mono)] text-2xl font-bold text-electric-cyan">
                {w.temp}&deg;C
              </p>
              <p className="text-[10px] text-muted-blue">{desc}</p>
              <p className="text-[10px] text-muted-blue/60">
                {"\uD83D\uDCA8"} {w.wind} km/h
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
