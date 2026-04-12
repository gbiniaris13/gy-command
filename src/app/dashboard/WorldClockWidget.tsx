"use client";

import { useEffect, useState } from "react";

const ZONES = [
  { city: "ATHENS", tz: "Europe/Athens", flag: "\uD83C\uDDEC\uD83C\uDDF7" },
  { city: "LONDON", tz: "Europe/London", flag: "\uD83C\uDDEC\uD83C\uDDE7" },
  { city: "DUBAI", tz: "Asia/Dubai", flag: "\uD83C\uDDE6\uD83C\uDDEA" },
  { city: "NEW YORK", tz: "America/New_York", flag: "\uD83C\uDDFA\uD83C\uDDF8" },
  { city: "MONACO", tz: "Europe/Monaco", flag: "\uD83C\uDDF2\uD83C\uDDE8" },
];

export default function WorldClockWidget() {
  const [times, setTimes] = useState<string[]>([]);

  useEffect(() => {
    const update = () => {
      setTimes(
        ZONES.map((z) =>
          new Date().toLocaleTimeString("en-GB", {
            timeZone: z.tz,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        )
      );
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  if (times.length === 0) return null;

  return (
    <div className="mb-6 sm:mb-8 glass-card p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-electric-cyan animate-pulse" />
        <h2 className="font-[family-name:var(--font-mono)] text-xs sm:text-sm font-bold tracking-[2px] text-electric-cyan uppercase">
          WORLD TIME SYNC
        </h2>
        <span className="ml-auto font-[family-name:var(--font-mono)] text-[9px] text-muted-blue/50 tracking-wider uppercase">
          LIVE
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {ZONES.map((z, i) => (
          <div
            key={z.city}
            className="rounded border border-border-glow bg-glass-light/20 p-3 text-center"
          >
            <p className="text-sm mb-1">{z.flag}</p>
            <p className="font-[family-name:var(--font-mono)] text-[9px] font-bold tracking-[2px] text-muted-blue/60 uppercase">
              {z.city}
            </p>
            <p className="font-[family-name:var(--font-mono)] text-lg font-bold text-electric-cyan">
              {times[i]}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
