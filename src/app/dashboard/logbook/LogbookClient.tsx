"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayCounts, DaySnapshot, GscDay, LogbookData, SeoMover, TopVisitor } from "@/lib/logbook";

// THE LOGBOOK. George's brief (6/11/2026): "με μια ματιά να βλέπω πώς
// πήγε η προηγούμενη μέρα, να κρατάει όλο το ιστορικό και κάθε μήνα να
// το μαζεύει, πολύ όμορφο, πολύ αληθινό και εύκολο". So, top to bottom:
// the day at a glance, the chart of every day (tap a day to open it),
// what happened that day, the months added up, and what people typed
// into Google. One column, calm, in the manner of The Lighthouse.
//
// Colour does one job everywhere on the page: gold is the United States
// (the goal), blue is every other country. Checked for colour-blind
// separation before it was chosen.

const NAVY = "#0D1B2A";
const INK2 = "rgba(13,27,42,0.64)";
const INK3 = "rgba(13,27,42,0.46)";
const RULE = "rgba(13,27,42,0.10)";
const GRID = "rgba(13,27,42,0.07)";
const US_GOLD = "#B58A0A";
const OTHER_BLUE = "#2E6A9E";
const GOOD = "#3A6B47";
const BAD = "#B14A3A";
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_VISITOR_DAY = "2026-05-15";
// The Helm opened on this day; requests before it were never recorded.
const HELM_FIRST_DAY = "2026-05-30";
// The first months counted from their first day to their last. A month
// is only compared with the one before it when that one was whole.
const FIRST_FULL_MONTH = "2026-06-01";
const FIRST_FULL_GOOGLE_MONTH = "2025-12-01";

// ── Formatting ───────────────────────────────────────────────────
const num = (n: number) => Math.round(n).toLocaleString("el-GR");
const pos = (n: number) => n.toLocaleString("el-GR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayLong = (date: string) => atNoon(date).toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayShort = (date: string) => atNoon(date).toLocaleDateString("el-GR", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
const dayTiny = (date: string) => atNoon(date).toLocaleDateString("el-GR", { day: "numeric", month: "numeric", timeZone: "UTC" });
const monthName = (ym: string) => {
  const s = atNoon(`${ym}-15`).toLocaleDateString("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const many = (n: number, one: string, more: string) => `${num(n)} ${n === 1 ? one : more}`;

function duration(sec: number) {
  if (sec < 60) return `${Math.round(sec)} δευτ.`;
  const m = Math.round(sec / 60);
  if (m < 60) return m === 1 ? "1 λεπτό" : `${m} λεπτά`;
  return "πάνω από 1 ώρα";
}
function clock(iso: string | number, timeZone: string) {
  try {
    return new Date(iso).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  } catch {
    return null;
  }
}

// ── Small pieces ─────────────────────────────────────────────────
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl bg-white p-5 sm:p-7 ${className}`} style={{ border: `1px solid ${RULE}` }}>
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase" style={{ letterSpacing: "0.18em", color: "#8A6A0A" }}>
      {children}
    </p>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full px-4 py-2 text-sm font-semibold transition-colors"
      style={active ? { background: NAVY, color: "#F8F5F0" } : { background: "rgba(13,27,42,0.06)", color: NAVY }}
    >
      {children}
    </button>
  );
}

// A 14-point trend under a number: the days before in soft ink, the day
// itself as a dot.
function Spark({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 3) return <div style={{ height: 26 }} />;
  const w = 120;
  const h = 26;
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 3 + (i / Math.max(1, values.length - 1)) * (w - 6);
  const y = (v: number) => 4 + (1 - (v - min) / span) * (h - 8);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="mt-2 block">
      <path d={d} fill="none" stroke="rgba(13,27,42,0.28)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={NAVY} stroke="#FFFFFF" strokeWidth={2} />
    </svg>
  );
}

type Delta = { text: string; tone: "good" | "bad" | "flat" } | null;

// How the day compares with the seven before it. `lowerIsBetter` is for
// the Google position, where a smaller number is the win.
function deltaOf(value: number | null, before: (number | null)[], opts: { lowerIsBetter?: boolean; decimals?: boolean } = {}): Delta {
  const prior = before.filter((v): v is number => v !== null);
  if (value === null || prior.length < 3) return null;
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  const diff = value - avg;
  const show = (n: number) => (opts.decimals ? pos(n) : num(n));
  if (Math.abs(diff) < Math.max(opts.decimals ? 0.3 : 0.5, Math.abs(avg) * 0.1)) {
    return { text: `όσο ο μέσος όρος 7 ημερών (${show(avg)})`, tone: "flat" };
  }
  const up = diff > 0;
  const good = opts.lowerIsBetter ? !up : up;
  return {
    text: `${up ? "▲" : "▼"} ${show(Math.abs(diff))} ${up ? "πάνω από" : "κάτω από"} τον μέσο όρο 7 ημερών (${show(avg)})`,
    tone: good ? "good" : "bad",
  };
}

function Tile({ label, value, delta, note, spark, big = false }: { label: string; value: string; delta?: Delta; note?: string; spark?: (number | null)[]; big?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${big ? "sm:col-span-2" : ""}`} style={{ background: "#FBF9F5", border: `1px solid ${RULE}` }}>
      <p className="text-[13px]" style={{ color: INK2 }}>{label}</p>
      <p className={`mt-1 font-semibold leading-none ${big ? "text-[56px]" : "text-[30px]"}`} style={{ color: NAVY }}>{value}</p>
      {delta ? (
        <p className="mt-2 text-xs font-medium" style={{ color: delta.tone === "good" ? GOOD : delta.tone === "bad" ? BAD : INK3 }}>{delta.text}</p>
      ) : null}
      {note ? <p className="mt-1 text-xs" style={{ color: INK3 }}>{note}</p> : null}
      {spark ? <Spark values={spark} /> : null}
    </div>
  );
}

// The small line under a figure: how it moved against the period before.
// Deliberately quiet (George, 6/11: "πιο μικρά τα ποσοστά, πιο θολά, πιο
// bold τα άλλα"): the figure is what the eye lands on, the change is there
// for whoever looks for it.
const GOOD_SOFT = "rgba(58,107,71,0.78)";
const BAD_SOFT = "rgba(177,74,58,0.78)";
function Move({ move, places = false }: { move: number | null; places?: boolean }) {
  if (move === null || !Number.isFinite(move)) return <span className="mt-0.5 block text-[10px]">&nbsp;</span>;
  const flat = Math.abs(move) < (places ? 0.05 : 0.5);
  return (
    <span className="mt-0.5 block whitespace-nowrap text-[10px] font-normal" style={{ color: flat ? "rgba(13,27,42,0.34)" : move > 0 ? GOOD_SOFT : BAD_SOFT, letterSpacing: "0.01em" }}>
      {flat ? "ίδιο" : `${move > 0 ? "▲" : "▼"} ${places ? pos(Math.abs(move)) : `${num(Math.abs(move))}%`}`}
    </span>
  );
}

const pct2 = (n: number) => `${n.toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
// A percentage on a handful is noise ("+740%" from 3 to 27), so a count is
// only compared when the period before had at least ten. Rates (CTR) are
// compared whenever there was one.
const MIN_BASE = 10;
const rel = (now: number | null, before: number | null, minBase = MIN_BASE) =>
  now === null || before === null || before <= 0 || before < minBase ? null : ((now - before) / before) * 100;

// Ranked horizontal bars, one hue: sources, countries.
function RankBars({ rows, total, color = OTHER_BLUE, max = 8 }: { rows: { name: string; n: number; tag?: string }[]; total: number; color?: string; max?: number }) {
  const shown = rows.slice(0, max);
  const top = Math.max(1, ...shown.map((r) => r.n));
  if (!shown.length) return <p className="text-sm" style={{ color: INK3 }}>Τίποτα αυτή τη μέρα.</p>;
  return (
    <div className="space-y-2.5">
      {shown.map((r) => (
        <div key={r.name} className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(0,38%) minmax(0,1fr) 78px" }}>
          <p className="truncate text-sm" style={{ color: NAVY }} title={r.name}>
            {r.name}
            {r.tag ? <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(13,27,42,0.07)", color: INK2 }}>{r.tag}</span> : null}
          </p>
          <div className="h-2 rounded-full" style={{ background: "rgba(13,27,42,0.06)" }}>
            <div className="h-2 rounded-full" style={{ width: `${Math.max(3, (r.n / top) * 100)}%`, background: color }} />
          </div>
          <p className="text-right text-sm tabular-nums" style={{ color: NAVY }}>
            {num(r.n)} <span style={{ color: INK3 }}>({Math.round((r.n / Math.max(1, total)) * 100)}%)</span>
          </p>
        </div>
      ))}
      {rows.length > shown.length ? <p className="text-xs" style={{ color: INK3 }}>και {rows.length - shown.length} ακόμα</p> : null}
    </div>
  );
}

function PlainList({ rows, max = 6 }: { rows: [string, number][]; max?: number }) {
  if (!rows.length) return <p className="text-sm" style={{ color: INK3 }}>Τίποτα αυτή τη μέρα.</p>;
  return (
    <div>
      {rows.slice(0, max).map(([name, n]) => (
        <div key={name} className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: `1px solid ${GRID}` }}>
          <p className="min-w-0 break-words text-sm" style={{ color: NAVY }}>{name}</p>
          <p className="shrink-0 text-sm tabular-nums" style={{ color: NAVY }}>{num(n)}</p>
        </div>
      ))}
      {rows.length > max ? <p className="mt-2 text-xs" style={{ color: INK3 }}>και {rows.length - max} ακόμα</p> : null}
    </div>
  );
}

function VisitorCard({ p }: { p: TopVisitor }) {
  const athens = clock(p.at, "Europe/Athens");
  const local = p.tz && p.tz !== "Europe/Athens" ? clock(p.at, p.tz) : null;
  return (
    <div className="rounded-2xl p-4" style={{ background: "#FBF9F5", border: `1px solid ${RULE}`, borderLeft: `3px solid ${p.hot ? US_GOLD : RULE}` }}>
      <p className="text-[15px] font-semibold" style={{ color: NAVY }}>
        {p.place}
        {p.hot ? <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "rgba(181,138,10,0.14)", color: "#7A5C06", letterSpacing: "0.08em" }}>ζεστός</span> : null}
      </p>
      <p className="mt-1 text-sm" style={{ color: INK2 }}>
        Ήρθε στις {athens} ώρα Αθήνας{local ? ` (${local} δική του ώρα)` : ""}, από <span style={{ color: NAVY }}>{p.source}</span>. {p.device}. {p.returning ? "Έχει ξαναέρθει." : "Πρώτη επίσκεψη."}
      </p>
      <p className="mt-1 text-sm" style={{ color: INK2 }}>
        Έμεινε {duration(p.time)} και είδε {p.pageCount === 1 ? "1 σελίδα" : `${p.pageCount} σελίδες`}{p.visits > 1 ? `, σε ${p.visits} επισκέψεις` : ""}.
      </p>
      {p.yachts.length ? <p className="mt-1 text-sm" style={{ color: INK2 }}>Σκάφη: <span style={{ color: NAVY }}>{p.yachts.join(", ")}</span></p> : null}
      {p.tools.length ? <p className="mt-1 text-sm" style={{ color: INK2 }}>Χρησιμοποίησε: {p.tools.join(", ")}</p> : null}
      {p.cta ? <p className="mt-1 text-sm" style={{ color: INK2 }}>Πάτησε κουμπί επικοινωνίας{p.cta !== "ναι" ? `: ${p.cta}` : ""}</p> : null}
      <p className="mt-2 break-words text-xs" style={{ color: INK3 }}>
        {p.pages.join(" → ")}{p.pageCount > p.pages.length ? ` → και ${p.pageCount - p.pages.length} ακόμα` : ""}
      </p>
      {p.network ? <p className="mt-1 text-[11px]" style={{ color: INK3 }}>Δίκτυο: {p.network}</p> : null}
    </div>
  );
}

// ── The chart ────────────────────────────────────────────────────
type Bucket = { id: string; title: string; tick: string; values: (number | null)[]; selectable: boolean; partial?: boolean };
type Series = { name: string; color: string };

function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  const cleanStep = max <= 4 ? 1 : step;
  const out: number[] = [];
  for (let v = 0; v < max + cleanStep; v += cleanStep) out.push(Math.round(v * 100) / 100);
  return out;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + k} Q${x},${y} ${x + k},${y} L${x + w - k},${y} Q${x + w},${y} ${x + w},${y + k} L${x + w},${y + h} Z`;
}

function Chart({ buckets, series, kind, selected, onSelect, format, lowerIsBetter = false }: {
  buckets: Bucket[];
  series: Series[];
  kind: "stack" | "line";
  selected: string | null;
  onSelect: (id: string) => void;
  format: (n: number) => string;
  lowerIsBetter?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(280, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const H = 280;
  const m = { l: 44, r: 14, t: 14, b: 30 };
  const iw = width - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = buckets.length;
  const band = iw / Math.max(1, n);
  const cx = (i: number) => m.l + band * i + band / 2;

  const totals = buckets.map((b) => (kind === "stack" ? b.values.reduce<number>((a, v) => a + (v || 0), 0) : 0));
  const flat = buckets.flatMap((b) => b.values).filter((v): v is number => v !== null && v > 0);
  const maxV = kind === "stack" ? Math.max(1, ...totals) : Math.max(1, ...flat);
  const ticks = niceTicks(maxV);
  const top = ticks[ticks.length - 1];
  // For a ranking the best place (1) sits at the top of the plot.
  const y = (v: number) => (lowerIsBetter ? m.t + (v / top) * ih : m.t + ih - (v / top) * ih);

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  const barW = Math.max(1, Math.min(24, band - (band > 6 ? 2 : 0.5)));
  const hv = hover !== null ? buckets[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(cx(hover) - 110, 0), width - 220) : 0;

  return (
    <div ref={wrap} className="relative" style={{ height: H }}>
      <svg width={width} height={H} role="img" aria-label="Γράφημα ανά ημέρα" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK3} style={{ fontVariantNumeric: "tabular-nums" }}>
              {lowerIsBetter && t === 0 ? "" : num(t)}
            </text>
          </g>
        ))}

        {selected && buckets.some((b) => b.id === selected) ? (
          <rect x={m.l + band * buckets.findIndex((b) => b.id === selected)} y={m.t} width={band} height={ih} fill="rgba(13,27,42,0.06)" />
        ) : null}

        {kind === "stack"
          ? buckets.map((b, i) => {
              let base = m.t + ih;
              const parts = b.values.map((v, s) => ({ v: v || 0, s })).filter((p) => p.v > 0);
              return (
                <g key={b.id} opacity={(hover === null || hover === i ? 1 : 0.7) * (b.partial ? 0.45 : 1)}>
                  {parts.map((p, k) => {
                    const hgt = (p.v / top) * ih;
                    const gap = k > 0 && barW >= 4 ? 2 : 0;
                    const yTop = base - hgt;
                    const drawH = Math.max(0.5, hgt - gap);
                    const isTop = k === parts.length - 1;
                    const x = cx(i) - barW / 2;
                    base = yTop;
                    return isTop ? (
                      <path key={p.s} d={roundedTop(x, yTop, barW, drawH, 4)} fill={series[p.s].color} />
                    ) : (
                      <rect key={p.s} x={x} y={yTop} width={barW} height={drawH} fill={series[p.s].color} />
                    );
                  })}
                </g>
              );
            })
          : series.map((s, si) => {
              const segs: string[] = [];
              let open = false;
              buckets.forEach((b, i) => {
                const v = b.values[si];
                if (v === null || v <= 0) { open = false; return; }
                segs.push(`${open ? "L" : "M"}${cx(i).toFixed(1)},${y(v).toFixed(1)}`);
                open = true;
              });
              let lastIdx = -1;
              buckets.forEach((b, i) => { const v = b.values[si]; if (v !== null && v > 0) lastIdx = i; });
              return (
                <g key={s.name}>
                  <path d={segs.join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {lastIdx >= 0 ? <circle cx={cx(lastIdx)} cy={y(buckets[lastIdx].values[si] as number)} r={4} fill={s.color} stroke="#FFFFFF" strokeWidth={2} /> : null}
                  {hover !== null && buckets[hover].values[si] ? (
                    <circle cx={cx(hover)} cy={y(buckets[hover].values[si] as number)} r={4} fill={s.color} stroke="#FFFFFF" strokeWidth={2} />
                  ) : null}
                </g>
              );
            })}

        {kind === "line" && hover !== null ? <line x1={cx(hover)} x2={cx(hover)} y1={m.t} y2={m.t + ih} stroke="rgba(13,27,42,0.25)" strokeWidth={1} /> : null}

        <line x1={m.l} x2={width - m.r} y1={lowerIsBetter ? m.t : m.t + ih} y2={lowerIsBetter ? m.t : m.t + ih} stroke="rgba(13,27,42,0.22)" strokeWidth={1} />

        {buckets.map((b, i) =>
          i % every === 0 || i === n - 1 ? (
            (i === n - 1 && (n - 1) % every !== 0 && (n - 1) % every < every / 2) ? null : (
              <text key={b.id} x={cx(i)} y={H - 9} textAnchor="middle" fontSize={11} fill={INK3}>{b.tick}</text>
            )
          ) : null,
        )}

        {buckets.map((b, i) => (
          <rect
            key={b.id}
            x={m.l + band * i}
            y={m.t}
            width={band}
            height={ih + 4}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${b.title}: ${series.map((s, si) => `${s.name} ${b.values[si] === null ? "χωρίς στοιχεία" : format(b.values[si] as number)}`).join(", ")}`}
            style={{ cursor: b.selectable ? "pointer" : "default", outline: "none" }}
            onMouseEnter={() => setHover(i)}
            onMouseMove={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => b.selectable && onSelect(b.id)}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && b.selectable) { e.preventDefault(); onSelect(b.id); } }}
          />
        ))}
      </svg>

      {hv ? (
        <div className="pointer-events-none absolute rounded-xl px-3 py-2 shadow-lg" style={{ left: tipLeft, top: 6, width: 220, background: NAVY, color: "#F8F5F0" }}>
          <p className="text-xs" style={{ color: "rgba(248,245,240,0.7)" }}>{hv.title}</p>
          {kind === "stack" && series.length > 1 ? (
            <p className="mt-1 text-sm"><span className="font-semibold">{format(hv.values.reduce<number>((a, v) => a + (v || 0), 0))}</span> <span style={{ color: "rgba(248,245,240,0.7)" }}>σύνολο</span></p>
          ) : null}
          {series.map((s, si) => (
            <p key={s.name} className="mt-0.5 flex items-center gap-2 text-sm">
              <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: s.color === NAVY ? "#F8F5F0" : s.color }} />
              <span className="font-semibold">{hv.values[si] === null ? "χωρίς στοιχεία" : format(hv.values[si] as number)}</span>
              <span style={{ color: "rgba(248,245,240,0.7)" }}>{s.name}</span>
            </p>
          ))}
          {hv.selectable ? <p className="mt-1 text-[11px]" style={{ color: "rgba(248,245,240,0.55)" }}>Πάτησε για την ανάλυση της μέρας</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────
type Metric = "people" | "clicks" | "impressions" | "position" | "requests";
type Range = "30" | "90" | "all";

const METRICS: { id: Metric; label: string }[] = [
  { id: "people", label: "Άνθρωποι" },
  { id: "clicks", label: "Κλικ από Google" },
  { id: "position", label: "Θέση στη Google" },
  { id: "impressions", label: "Εμφανίσεις στη Google" },
  { id: "requests", label: "Αιτήματα" },
];

export default function LogbookClient({ data }: { data: LogbookData }) {
  const latest = Object.keys(data.index?.days || {}).sort().pop() || null;
  if (!latest) {
    return (
      <div lang="el" className="mx-auto max-w-3xl p-6 sm:p-10">
        <Eyebrow>The Logbook</Eyebrow>
        <h1 className="mt-2 text-3xl font-semibold" style={{ color: NAVY }}>Το ημερολόγιο δεν έχει γεμίσει ακόμα</h1>
        <p className="mt-3 text-base" style={{ color: INK2 }}>
          Γεμίζει μόνο του κάθε πρωί, λίγο μετά τις 07:00. Αν το βλέπεις άδειο μετά από εκείνη την ώρα, η πρωινή ανανέωση δεν έτρεξε.
        </p>
      </div>
    );
  }
  return <Logbook data={data} latest={latest} />;
}

function Logbook({ data, latest }: { data: LogbookData; latest: string }) {
  const days: Record<string, DayCounts> = useMemo(() => data.index?.days || {}, [data.index]);
  const gsc: Record<string, GscDay> = useMemo(() => data.gsc?.days || {}, [data.gsc]);
  const visitorDates = useMemo(() => Object.keys(days).sort(), [days]);
  const gscDates = useMemo(() => Object.keys(gsc).sort(), [gsc]);

  const [metric, setMetric] = useState<Metric>("people");
  const [range, setRange] = useState<Range>("30");
  const [selected, setSelected] = useState<string>(latest);
  const [cache, setCache] = useState<Record<string, DaySnapshot>>(data.latest ? { [data.latest.date]: data.latest } : {});
  const [loadError, setLoadError] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [moreQueries, setMoreQueries] = useState(false);
  const [yachtScope, setYachtScope] = useState<string>("all");
  const [moreYachts, setMoreYachts] = useState(false);

  useEffect(() => {
    if (!selected || cache[selected]) return;
    let off = false;
    setLoadError(false);
    fetch(`/api/logbook/day?date=${selected}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!off && j?.day) setCache((c) => ({ ...c, [selected]: j.day })); })
      .catch(() => { if (!off) setLoadError(true); });
    return () => { off = true; };
  }, [selected, cache]);

  const c = days[selected];
  const g = gsc[selected] || null;
  const snap = cache[selected] || null;
  const isLatest = selected === latest;
  const finalThrough = data.gsc?.final_through || null;
  const gscProvisional = !!g && !!finalThrough && selected > finalThrough;

  // The seven days before the selected one, and the fourteen ending on it.
  const before = (pick: (d: string) => number | null) => Array.from({ length: 7 }, (_, i) => pick(addDays(selected, -(i + 1))));
  const trail = (pick: (d: string) => number | null) => Array.from({ length: 14 }, (_, i) => pick(addDays(selected, i - 13)));
  const v = (k: keyof DayCounts) => (d: string) => (days[d] ? days[d][k] : null);
  const gv = (i: number) => (d: string) => (gsc[d] ? gsc[d][i] : null);

  const share = c.people ? Math.round((c.us / c.people) * 100) : 0;
  const summary = c.people === 0
    ? "Δεν καταγράφηκε κανένας άνθρωπος στο site αυτή τη μέρα."
    : `${c.people === 1 ? "Μπήκε 1 άνθρωπος" : `Μπήκαν ${num(c.people)} άνθρωποι`}, ${c.us === 1 ? "ένας" : num(c.us)} από τις ΗΠΑ (${share}%). ` +
      `${c.engaged === 1 ? "Ένας έμεινε και διάβασε" : `${num(c.engaged)} έμειναν και διάβασαν`}, ${c.yachtViewers === 1 ? "ένας άνοιξε" : `${num(c.yachtViewers)} άνοιξαν`} σελίδα σκάφους. ` +
      (c.requests ? (c.requests === 1 ? "Ήρθε 1 αίτημα." : `Ήρθαν ${num(c.requests)} αιτήματα.`) : "Δεν ήρθε αίτημα.");

  // ── Chart data ──
  const metricDates = metric === "people" || metric === "requests" ? visitorDates : gscDates;
  const lastDate = metricDates[metricDates.length - 1];
  const firstDate = metricDates[0];
  const valuesFor = (d: string): (number | null)[] => {
    if (metric === "people") return days[d] ? [days[d].us, days[d].people - days[d].us] : [null, null];
    if (metric === "requests") return days[d] ? [days[d].requests] : [null];
    const r = gsc[d];
    if (!r) return metric === "position" ? [null, null] : [null, null];
    if (metric === "clicks") return [r[3], Math.max(0, r[0] - r[3])];
    if (metric === "impressions") return [r[4], Math.max(0, r[1] - r[4])];
    return [r[2] || null, r[5] || null];
  };
  const series: Series[] =
    metric === "requests"
      ? [{ name: "Αιτήματα", color: NAVY }]
      : metric === "position"
        ? [{ name: "Όλες οι χώρες", color: OTHER_BLUE }, { name: "ΗΠΑ", color: US_GOLD }]
        : [{ name: "ΗΠΑ", color: US_GOLD }, { name: "Άλλες χώρες", color: OTHER_BLUE }];

  const buckets: Bucket[] = useMemo(() => {
    if (!lastDate) return [];
    if (range !== "all") {
      const nDays = Number(range);
      const out: Bucket[] = [];
      for (let i = nDays - 1; i >= 0; i--) {
        const d = addDays(lastDate, -i);
        if (d < firstDate) continue;
        out.push({ id: d, title: dayLong(d), tick: dayTiny(d), values: valuesFor(d), selectable: !!days[d] });
      }
      return out;
    }
    // Everything: one mark per week (Monday to Sunday).
    const weeks = new Map<string, string[]>();
    for (let d = firstDate; d <= lastDate; d = addDays(d, 1)) {
      const dow = (atNoon(d).getUTCDay() + 6) % 7;
      const monday = addDays(d, -dow);
      if (!weeks.has(monday)) weeks.set(monday, []);
      weeks.get(monday)!.push(d);
    }
    return [...weeks.entries()].map(([monday, ds]) => {
      let values: (number | null)[];
      if (metric === "position") {
        // Average position weighted by how often we were shown.
        const w = (posIdx: number, imprIdx: number) => {
          let sum = 0, weight = 0;
          ds.forEach((d) => { const r = gsc[d]; if (r && r[posIdx] > 0 && r[imprIdx] > 0) { sum += r[posIdx] * r[imprIdx]; weight += r[imprIdx]; } });
          return weight ? Math.round((sum / weight) * 10) / 10 : null;
        };
        values = [w(2, 1), w(5, 4)];
      } else {
        const rows = ds.map(valuesFor);
        values = rows[0].map((_, si) => {
          const got = rows.map((r) => r[si]).filter((x): x is number => x !== null);
          return got.length ? got.reduce((a, b) => a + b, 0) : null;
        });
      }
      // A week with fewer than seven recorded days (the first one, and the
      // one still running) is drawn lighter so it does not read as a fall.
      const partial = ds.length < 7 || ds.some((d) => valuesFor(d).every((x) => x === null));
      return { id: monday, title: `Εβδομάδα από ${dayShort(monday)}${partial ? " (όχι ολόκληρη)" : ""}`, tick: dayTiny(monday), values, selectable: false, partial: partial && metric !== "position" };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, range, lastDate, firstDate, days, gsc]);

  const fmt = metric === "position" ? pos : num;

  // ── Months ──
  // Each month's numbers, and under each one how it moved against the
  // month before. The month still running is compared with the same days
  // of the month before, never with the whole of it.
  const months = useMemo(() => {
    const endOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const prevOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 0)).toISOString().slice(0, 7);
    const visitorSum = (from: string, to: string, k: keyof DayCounts) =>
      visitorDates.filter((d) => d >= from && d <= to).reduce((n, d) => n + days[d][k], 0);
    const google = (from: string, to: string) => {
      const ds = gscDates.filter((d) => d >= from && d <= to);
      let ps = 0, pw = 0;
      ds.forEach((d) => { if (gsc[d][2] > 0 && gsc[d][1] > 0) { ps += gsc[d][2] * gsc[d][1]; pw += gsc[d][1]; } });
      return { n: ds.length, clicks: ds.reduce((n, d) => n + gsc[d][0], 0), impressions: ds.reduce((n, d) => n + gsc[d][1], 0), position: pw ? ps / pw : null };
    };
    const pct = (now: number | null, before: number | null) => rel(now, before);

    const set = new Set<string>([...visitorDates, ...gscDates].map((d) => d.slice(0, 7)));
    return [...set].sort().reverse().map((ym) => {
      const first = `${ym}-01`;
      const end = endOf(ym);
      const prev = prevOf(ym);
      const vd = visitorDates.filter((d) => d.startsWith(ym));
      const g = google(first, end);
      const rec = data.index?.months?.[ym] || null;
      const prevRec = data.index?.months?.[prev] || null;
      const lastVisitorDay = vd[vd.length - 1] || null;
      const lastGoogleDay = gscDates.filter((d) => d.startsWith(ym)).pop() || null;
      const running = ym === latest.slice(0, 7) && !!lastVisitorDay && lastVisitorDay < end;

      const notes: string[] = [];
      if (ym === FIRST_VISITOR_DAY.slice(0, 7)) notes.push(`επισκέπτες από ${dayTiny(FIRST_VISITOR_DAY)}`);
      if (running && lastVisitorDay) notes.push(`ως ${dayTiny(lastVisitorDay)}`);

      // What the month is measured against.
      const sameDay = (day: string | null) => {
        if (!day) return null;
        const d = `${prev}-${day.slice(8, 10)}`;
        return d > endOf(prev) ? endOf(prev) : d;
      };
      const vTo = running ? sameDay(lastVisitorDay) : endOf(prev);
      const gTo = running ? sameDay(lastGoogleDay) : endOf(prev);
      const visitorsComparable = `${prev}-01` >= FIRST_FULL_MONTH && vd.length > 0;
      const requestsComparable = `${prev}-01` >= FIRST_FULL_MONTH && vd.length > 0;
      const googleComparable = `${prev}-01` >= FIRST_FULL_GOOGLE_MONTH && g.n > 0;
      const uniqueBefore = running ? rec?.prevSame || null : prevRec;
      const gBefore = gTo ? google(`${prev}-01`, gTo) : null;
      const vBefore = (k: keyof DayCounts) => (vTo && visitorsComparable ? visitorSum(`${prev}-01`, vTo, k) : null);

      const engaged = visitorSum(first, end, "engaged");
      const yachtViewers = visitorSum(first, end, "yachtViewers");
      const requests = visitorSum(first, end, "requests");
      return {
        ym,
        notes,
        running,
        hasVisitors: vd.length > 0,
        hasGoogle: g.n > 0,
        people: rec ? rec.people : null,
        us: rec ? rec.us : null,
        ai: rec && typeof rec.ai === "number" ? rec.ai : null,
        engaged,
        yachtViewers,
        requests,
        clicks: g.clicks,
        impressions: g.impressions,
        position: g.position,
        change: {
          people: visitorsComparable && uniqueBefore ? pct(rec ? rec.people : null, uniqueBefore.people) : null,
          us: visitorsComparable && uniqueBefore ? pct(rec ? rec.us : null, uniqueBefore.us) : null,
          ai: visitorsComparable && uniqueBefore && typeof uniqueBefore.ai === "number" ? pct(rec && typeof rec.ai === "number" ? rec.ai : null, uniqueBefore.ai) : null,
          engaged: pct(engaged, vBefore("engaged")),
          yachtViewers: pct(yachtViewers, vBefore("yachtViewers")),
          requests: requestsComparable ? pct(requests, vBefore("requests")) : null,
          clicks: googleComparable && gBefore ? pct(g.clicks, gBefore.clicks) : null,
          impressions: googleComparable && gBefore ? pct(g.impressions, gBefore.impressions) : null,
          // Places gained (a smaller position is higher up), not a percentage.
          position: googleComparable && gBefore && gBefore.position !== null && g.position !== null ? gBefore.position - g.position : null,
        },
      };
    });
  }, [visitorDates, gscDates, days, gsc, data.index, latest]);

  // ── Yachts ──
  const yachtMonths = useMemo(() => Object.keys(data.index?.months || {}).filter((m) => (data.index?.months?.[m]?.yachts || []).length).sort(), [data.index]);
  const yachtRows = useMemo(() => {
    const total = new Map<string, number>();
    const use = yachtScope === "all" ? yachtMonths : yachtMonths.filter((m) => m === yachtScope);
    use.forEach((m) => (data.index?.months?.[m]?.yachts || []).forEach(([name, n]) => total.set(name, (total.get(name) || 0) + n)));
    return [...total.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([name, n]) => ({ name, n }));
  }, [data.index, yachtMonths, yachtScope]);

  const totals = useMemo(() => ({
    people: months.reduce((a, r) => a + (r.people || 0), 0),
    requests: months.reduce((a, r) => a + r.requests, 0),
    clicks: months.reduce((a, r) => a + r.clicks, 0),
    impressions: months.reduce((a, r) => a + r.impressions, 0),
  }), [months]);

  const queries = data.queries?.rows || [];
  const updated = data.index?.updated_at ? new Date(data.index.updated_at) : null;

  return (
    <div lang="el" className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>The Logbook</Eyebrow>
          <h1 className="mt-1 text-3xl font-semibold" style={{ color: NAVY }}>Το ημερολόγιο του site</h1>
          <p className="mt-1 text-sm" style={{ color: INK2 }}>Οι πραγματικοί επισκέπτες και η θέση μας στη Google, μέρα με τη μέρα.</p>
        </div>
        {updated ? (
          <p className="text-xs" style={{ color: INK3 }}>
            Τελευταία ανανέωση: {updated.toLocaleDateString("el-GR", { day: "numeric", month: "long", timeZone: "Europe/Athens" })}, {clock(updated.getTime(), "Europe/Athens")}
          </p>
        ) : null}
      </header>

      {/* The day at a glance */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>{isLatest ? "Χθες, με μια ματιά" : "Η μέρα που διάλεξες"}</Eyebrow>
            <h2 className="mt-1 text-2xl font-semibold capitalize" style={{ color: NAVY }}>{dayLong(selected)}</h2>
          </div>
          {!isLatest ? (
            <button type="button" onClick={() => setSelected(latest)} className="rounded-full px-4 py-2 text-sm font-semibold" style={{ background: NAVY, color: "#F8F5F0" }}>
              Πίσω στη χθεσινή μέρα
            </button>
          ) : null}
        </div>
        <p className="mt-3 max-w-3xl text-[17px] leading-relaxed" style={{ color: NAVY }}>{summary}</p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile big label="Άνθρωποι στο site" value={num(c.people)} delta={deltaOf(c.people, before(v("people")))} spark={trail(v("people"))} />
          <Tile label="Από ΗΠΑ" value={num(c.us)} note={c.people ? `${share}% των ανθρώπων` : undefined} delta={deltaOf(c.us, before(v("us")))} />
          <Tile label="Αιτήματα" value={num(c.requests)} note={c.requests ? undefined : "κανένα αυτή τη μέρα"} />
          <Tile label="Έμειναν και διάβασαν" value={num(c.engaged)} delta={deltaOf(c.engaged, before(v("engaged")))} />
          <Tile label="Άνοιξαν σκάφος" value={num(c.yachtViewers)} delta={deltaOf(c.yachtViewers, before(v("yachtViewers")))} />
          <Tile label="Ζεστοί επισκέπτες" value={num(c.hot)} note="έμειναν ώρα ή είδαν πολλά σκάφη" />
          <Tile label="Ήρθαν από AI" value={num(c.ai)} note="ChatGPT, Perplexity και παρόμοια" />
        </div>

        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${RULE}` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold" style={{ color: NAVY }}>Στη Google την ίδια μέρα</p>
            {gscProvisional ? <p className="text-xs" style={{ color: INK3 }}>Προσωρινά νούμερα: η Google τα οριστικοποιεί σε δύο με τρεις μέρες.</p> : null}
          </div>
          {g ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Κλικ από Google" value={num(g[0])} note={`${num(g[3])} από ΗΠΑ`} delta={deltaOf(g[0], before(gv(0)))} spark={trail(gv(0))} />
              <Tile label="Φορές που μας έδειξε" value={num(g[1])} note={`${num(g[4])} στις ΗΠΑ`} delta={deltaOf(g[1], before(gv(1)))} spark={trail(gv(1))} />
              <Tile label="Μέση θέση" value={pos(g[2])} note="όσο πιο μικρό, τόσο πιο ψηλά" delta={deltaOf(g[2], before(gv(2)), { lowerIsBetter: true, decimals: true })} spark={trail(gv(2))} />
              <Tile label="Μέση θέση στις ΗΠΑ" value={g[5] ? pos(g[5]) : "·"} note={g[5] ? "όσο πιο μικρό, τόσο πιο ψηλά" : "δεν μας έδειξε στις ΗΠΑ"} delta={g[5] ? deltaOf(g[5], before(gv(5)), { lowerIsBetter: true, decimals: true }) : null} />
            </div>
          ) : (
            <p className="mt-2 text-sm" style={{ color: INK3 }}>Η Google δεν έχει δώσει ακόμα στοιχεία για αυτή τη μέρα. Συνήθως έρχονται την επόμενη.</p>
          )}
        </div>
      </Card>

      {/* Every day */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>Κάθε μέρα</Eyebrow>
            <h2 className="mt-1 text-xl font-semibold" style={{ color: NAVY }}>{METRICS.find((x) => x.id === metric)?.label}{range === "all" ? ", ανά εβδομάδα" : ", ανά ημέρα"}</h2>
          </div>
          <div className="flex gap-2">
            <Pill active={range === "30"} onClick={() => setRange("30")}>30 μέρες</Pill>
            <Pill active={range === "90"} onClick={() => setRange("90")}>90 μέρες</Pill>
            <Pill active={range === "all"} onClick={() => setRange("all")}>Όλα</Pill>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {METRICS.map((x) => (
            <Pill key={x.id} active={metric === x.id} onClick={() => setMetric(x.id)}>{x.label}</Pill>
          ))}
        </div>

        {series.length > 1 ? (
          <div className="mt-4 flex flex-wrap gap-5">
            {series.map((s) => (
              <p key={s.name} className="flex items-center gap-2 text-sm" style={{ color: INK2 }}>
                <span className={metric === "position" ? "inline-block h-[3px] w-4 rounded-full" : "inline-block h-3 w-3 rounded-[3px]"} style={{ background: s.color }} />
                {s.name}
              </p>
            ))}
          </div>
        ) : null}

        <div className="mt-3">
          <Chart
            buckets={buckets}
            series={series}
            kind={metric === "position" ? "line" : "stack"}
            selected={range === "all" ? null : selected}
            onSelect={(id) => setSelected(id)}
            format={fmt}
            lowerIsBetter={metric === "position"}
          />
        </div>
        <p className="mt-2 text-xs" style={{ color: INK3 }}>
          {metric === "position"
            ? "Η θέση 1 είναι πάνω: όσο ανεβαίνει η γραμμή, τόσο πιο ψηλά μας δείχνει η Google."
            : range === "all"
              ? "Κάθε στήλη είναι μια εβδομάδα, Δευτέρα με Κυριακή. Οι πιο αχνές στήλες είναι εβδομάδες που δεν είναι ολόκληρες."
              : "Πάτησε μια μέρα για να δεις την ανάλυσή της πιο κάτω."}
          {metric === "people" ? ` Οι επισκέπτες μετριούνται αξιόπιστα από ${dayTiny(FIRST_VISITOR_DAY)}.` : ""}
          {metric === "requests" ? ` Τα αιτήματα είναι όσα έχει το Helm, που άνοιξε στις ${dayTiny(HELM_FIRST_DAY)}.` : ""}
        </p>

        <button type="button" onClick={() => setShowTable((s) => !s)} className="mt-3 text-sm font-semibold underline" style={{ color: NAVY }}>
          {showTable ? "Κρύψε τα νούμερα" : "Δες τα νούμερα σε πίνακα"}
        </button>
        {showTable ? (
          <div className="mt-3 max-h-80 overflow-auto rounded-2xl" style={{ border: `1px solid ${RULE}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#FBF9F5" }}>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: INK2, textTransform: "none", letterSpacing: "normal" }}>{range === "all" ? "Εβδομάδα" : "Ημέρα"}</th>
                  {series.map((s) => <th key={s.name} className="px-3 py-2 text-right font-semibold" style={{ color: INK2, textTransform: "none", letterSpacing: "normal" }}>{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...buckets].reverse().map((b) => (
                  <tr key={b.id} style={{ borderTop: `1px solid ${GRID}` }}>
                    <td className="px-3 py-1.5" style={{ color: NAVY }}>{b.title}</td>
                    {b.values.map((val, i) => <td key={i} className="px-3 py-1.5 text-right tabular-nums" style={{ color: NAVY }}>{val === null ? "·" : fmt(val)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {/* What happened that day */}
      <Card>
        <Eyebrow>Τι έγινε</Eyebrow>
        <h2 className="mt-1 text-xl font-semibold capitalize" style={{ color: NAVY }}>{dayLong(selected)}</h2>
        {!snap ? (
          <p className="mt-3 text-sm" style={{ color: INK3 }}>{loadError ? "Η ανάλυση αυτής της μέρας δεν φορτώθηκε. Δοκίμασε να ξαναπατήσεις τη μέρα." : "Φορτώνει η ανάλυση της μέρας."}</p>
        ) : (
          <div className="mt-5 space-y-8">
            <div>
              <p className="text-sm font-semibold" style={{ color: NAVY }}>Αιτήματα</p>
              <p className="mb-3 text-xs" style={{ color: INK3 }}>Όπως είναι στο Helm. Πάτησε ένα όνομα για να ανοίξει.</p>
              {snap.requests.length ? snap.requests.map((r, i) => (
                <p key={i} className="py-1 text-sm" style={{ color: NAVY }}>
                  <span className="tabular-nums" style={{ color: INK3 }}>{clock(r.at, "Europe/Athens")}</span>&nbsp;&nbsp;
                  {r.id ? <a href={`/dashboard/helm/${r.id}`} className="font-semibold underline">{r.label}</a> : r.label}
                </p>
              )) : <p className="text-sm" style={{ color: INK3 }}>Κανένα αίτημα αυτή τη μέρα.</p>}
            </div>

            <div>
              <p className="text-sm font-semibold" style={{ color: NAVY }}>Ποιοι κοίταξαν σοβαρά</p>
              <p className="mb-3 text-xs" style={{ color: INK3 }}>Οι επισκέπτες με τη μεγαλύτερη δραστηριότητα, από τον πιο ζεστό προς τα κάτω.</p>
              {snap.top.length ? (
                <div className="grid gap-3 md:grid-cols-2">{snap.top.map((p, i) => <VisitorCard key={i} p={p} />)}</div>
              ) : <p className="text-sm" style={{ color: INK3 }}>Κανείς δεν έμεινε αρκετά ώστε να αφήσει ίχνος.</p>}
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold" style={{ color: NAVY }}>Από πού ήρθαν</p>
                <p className="mb-3 text-xs" style={{ color: INK3 }}>«Απευθείας»: έγραψαν τη διεύθυνση, είχαν σελιδοδείκτη, ή πάτησαν link σε email, WhatsApp ή εφαρμογή.</p>
                <RankBars rows={snap.sources.map((s) => ({ name: s.name, n: s.n, tag: s.ai ? "AI" : undefined }))} total={c.people} />
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold" style={{ color: NAVY }}>Χώρες</p>
                <RankBars rows={snap.countries.map(([name, n]) => ({ name, n }))} total={c.people} />
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>Σκάφη που άνοιξαν</p>
                <PlainList rows={snap.yachts} max={8} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>Πόλεις στις ΗΠΑ</p>
                <PlainList rows={snap.usPlaces} max={8} />
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>Από αυτές τις σελίδες μπήκαν</p>
                <PlainList rows={snap.landing} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>Σε αυτές έφερε κόσμο η Google</p>
                <PlainList rows={snap.googleLanding} />
              </div>
            </div>

            <p className="text-xs leading-relaxed" style={{ color: INK3 }}>
              {c.people ? `${Math.round((c.mobile / c.people) * 100)}% από κινητό ή tablet. ` : ""}
              {c.returning === 1 ? "Ένας είχε ξαναέρθει" : `${num(c.returning)} είχαν ξαναέρθει`} στο παρελθόν. {c.longStay === 1 ? "Ένας έμεινε" : `${num(c.longStay)} έμειναν`} πάνω από 3 λεπτά.{" "}
              {c.machines
                ? `Έμειναν εκτός ${many(c.machines, "επίσκεψη", "επισκέψεις")} από μηχανές (${snap.machinesBy.map(([n, k]) => `${n} ${k}`).join(", ")}): προγράμματα που διαβάζουν το site για μηχανές αναζήτησης, AI και κοινωνικά δίκτυα, όχι πελάτες.`
                : ""}
            </p>
          </div>
        )}
      </Card>

      {/* Month by month */}
      <Card>
        <Eyebrow>Ανά μήνα</Eyebrow>
        <h2 className="mt-1 text-xl font-semibold" style={{ color: NAVY }}>Ο κάθε μήνας, μαζεμένος</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Άνθρωποι από την αρχή" value={num(totals.people)} note={`από ${dayTiny(FIRST_VISITOR_DAY)}, άθροισμα μηνών`} />
          <Tile label="Αιτήματα από την αρχή" value={num(totals.requests)} note={`όσα έχει το Helm, από ${dayTiny(HELM_FIRST_DAY)}`} />
          <Tile label="Κλικ από Google" value={num(totals.clicks)} note={gscDates[0] ? `από ${dayTiny(gscDates[0])}/${gscDates[0].slice(2, 4)}` : undefined} />
          <Tile label="Φορές που μας έδειξε" value={num(totals.impressions)} note={gscDates[0] ? `από ${dayTiny(gscDates[0])}/${gscDates[0].slice(2, 4)}` : undefined} />
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                {["Μήνας", "Άνθρωποι", "Από ΗΠΑ", "Διάβασαν", "Άνοιξαν σκάφος", "Αιτήματα", "Από AI", "Κλικ Google", "Εμφανίσεις", "Μέση θέση"].map((h, i) => (
                  <th key={h} className={`px-2 py-2 text-xs font-semibold ${i === 0 ? "text-left" : "text-right"}`} style={{ color: INK2, borderBottom: `1px solid ${RULE}`, textTransform: "none", letterSpacing: "normal", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((r) => {
                // The number, and under it how it moved against the month before.
                const cell = (val: number | null, show: boolean, move: number | null, opts: { f?: (n: number) => string; places?: boolean } = {}) => {
                  const f = opts.f || num;
                  return (
                    <td className="px-2 py-3 text-right align-top tabular-nums" style={{ color: show && val !== null ? NAVY : INK3 }}>
                      <span className={`block text-[15px] ${show && val !== null ? "font-semibold" : ""}`}>{show && val !== null ? f(val) : "·"}</span>
                      {show && val !== null ? <Move move={move} places={opts.places} /> : null}
                    </td>
                  );
                };
                return (
                  <tr key={r.ym} style={{ borderBottom: `1px solid ${GRID}` }}>
                    <td className="px-2 py-3 align-top" style={{ color: NAVY }}>
                      <span className="block whitespace-nowrap text-[15px] font-semibold">{monthName(r.ym)}</span>
                      {r.notes.length ? <span className="block text-xs" style={{ color: INK3 }}>{r.notes.join(", ")}</span> : null}
                    </td>
                    {cell(r.people, r.hasVisitors, r.change.people)}
                    {cell(r.us, r.hasVisitors, r.change.us)}
                    {cell(r.engaged, r.hasVisitors, r.change.engaged)}
                    {cell(r.yachtViewers, r.hasVisitors, r.change.yachtViewers)}
                    {cell(r.requests, r.hasVisitors, r.change.requests)}
                    {cell(r.ai, r.hasVisitors, r.change.ai)}
                    {cell(r.clicks, r.hasGoogle, r.change.clicks)}
                    {cell(r.impressions, r.hasGoogle, r.change.impressions)}
                    {cell(r.position, r.hasGoogle, r.change.position, { f: pos, places: true })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed" style={{ color: INK3 }}>
          Κάτω από κάθε νούμερο, με μικρά αχνά γράμματα, γράφει πόσο ανέβηκε ή έπεσε σε σχέση με τον προηγούμενο μήνα. Όπου ο προηγούμενος είχε λιγότερα από 10, δεν γράφεται ποσοστό. Ο μήνας που τρέχει συγκρίνεται με τις ίδιες μέρες του προηγούμενου, όχι με ολόκληρο. Στη μέση θέση μετράμε θέσεις και όχι ποσοστό, και το πράσινο σημαίνει ότι ανεβήκαμε. Όπου ο προηγούμενος μήνας δεν ήταν ολόκληρος, δεν γίνεται σύγκριση.
        </p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: INK3 }}>
          «Άνθρωποι», «Από ΗΠΑ» και «Από AI» είναι διαφορετικοί άνθρωποι μέσα στον μήνα: όποιος ήρθε δύο μέρες μετράει μία φορά. «Από AI» είναι όσοι ήρθαν από ChatGPT, Perplexity, Copilot, Gemini, Claude και παρόμοια, και είναι το λιγότερο: όποιος ανοίγει το link μέσα από εφαρμογή που δεν αφήνει ίχνος δεν μπορεί να μετρηθεί. Τα αιτήματα είναι όσα έχει το Helm, ένα για κάθε άνθρωπο (ένα email, ένα αίτημα), χωρίς τα δοκιμαστικά, και το Helm άνοιξε στις 30 Μαΐου 2026. Οι υπόλοιπες στήλες είναι άθροισμα των ημερών. Μια τελεία σημαίνει ότι εκείνο τον μήνα δεν υπήρχε ακόμα μέτρηση.
        </p>
      </Card>

      {/* The yachts people open */}
      {yachtMonths.length ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Eyebrow>Σκάφη</Eyebrow>
              <h2 className="mt-1 text-xl font-semibold" style={{ color: NAVY }}>Τα σκάφη που ανοίγουν περισσότερο</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Pill active={yachtScope === "all"} onClick={() => setYachtScope("all")}>Από την αρχή</Pill>
              {yachtMonths.slice(-3).reverse().map((m) => (
                <Pill key={m} active={yachtScope === m} onClick={() => setYachtScope(m)}>{monthName(m).split(" ")[0]}</Pill>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm" style={{ color: INK2 }}>
            Πόσες επισκέψεις ανθρώπων άνοιξαν τη σελίδα κάθε σκάφους{yachtScope === "all" ? `, από ${dayTiny(FIRST_VISITOR_DAY)}` : ""}. {num(yachtRows.length)} σκάφη έχουν ανοιχτεί έστω μία φορά.
          </p>
          <div className="mt-5 space-y-2">
            {yachtRows.slice(0, moreYachts ? 60 : 20).map((r, i) => (
              <div key={r.name} className="grid items-center gap-3" style={{ gridTemplateColumns: "28px minmax(0,34%) minmax(0,1fr) 52px" }}>
                <p className="text-right text-xs tabular-nums" style={{ color: INK3 }}>{i + 1}</p>
                <p className="truncate text-sm" style={{ color: NAVY }} title={r.name}>{r.name}</p>
                <div className="h-2 rounded-full" style={{ background: "rgba(13,27,42,0.06)" }}>
                  <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (r.n / Math.max(1, yachtRows[0].n)) * 100)}%`, background: OTHER_BLUE }} />
                </div>
                <p className="text-right text-sm tabular-nums" style={{ color: NAVY }}>{num(r.n)}</p>
              </div>
            ))}
          </div>
          {yachtRows.length > 20 ? (
            <button type="button" onClick={() => setMoreYachts((v) => !v)} className="mt-4 text-sm font-semibold underline" style={{ color: NAVY }}>
              {moreYachts ? "Δείξε τα πρώτα 20" : "Δείξε περισσότερα"}
            </button>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed" style={{ color: INK3 }}>
            Μετράνε μόνο άνθρωποι, όχι μηχανές. Αν κάποιος άνοιξε το ίδιο σκάφος πέντε φορές μέσα στην ίδια επίσκεψη, μετράει μία. Αν ξαναήρθε άλλη μέρα και το άνοιξε πάλι, μετράει ξανά.
          </p>
        </Card>
      ) : null}

      {/* What people typed into Google */}
      {queries.length ? (
        <Card>
          <Eyebrow>Google</Eyebrow>
          <h2 className="mt-1 text-xl font-semibold" style={{ color: NAVY }}>Τι έγραψαν και μας βρήκαν</h2>
          <p className="mt-1 text-sm" style={{ color: INK2 }}>
            Οι τελευταίες 28 μέρες ({dayTiny(data.queries!.start)} έως {dayTiny(data.queries!.end)}), δίπλα στις 28 πριν από αυτές.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr>
                  {["Αναζήτηση", "Κλικ", "Μας έδειξε", "Θέση", "Αλλαγή θέσης"].map((h, i) => (
                    <th key={h} className={`px-2 py-2 text-xs font-semibold ${i === 0 ? "text-left" : "text-right"}`} style={{ color: INK2, borderBottom: `1px solid ${RULE}`, textTransform: "none", letterSpacing: "normal", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queries.slice(0, moreQueries ? 40 : 12).map((q) => {
                  const d = q.prevPosition === null ? null : q.prevPosition - q.position;
                  return (
                    <tr key={q.q} style={{ borderBottom: `1px solid ${GRID}` }}>
                      <td className="px-2 py-2" style={{ color: NAVY }}>{q.q}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: NAVY }}>{num(q.clicks)}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: NAVY }}>{num(q.impressions)}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: NAVY }}>{pos(q.position)}</td>
                      <td className="px-2 py-2 text-right text-xs font-medium tabular-nums" style={{ color: d === null ? INK3 : Math.abs(d) < 0.5 ? INK3 : d > 0 ? GOOD : BAD }}>
                        {d === null ? "νέα" : Math.abs(d) < 0.5 ? "ίδια" : d > 0 ? `▲ ${pos(d)} πιο ψηλά` : `▼ ${pos(-d)} πιο χαμηλά`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {queries.length > 12 ? (
            <button type="button" onClick={() => setMoreQueries((s) => !s)} className="mt-3 text-sm font-semibold underline" style={{ color: NAVY }}>
              {moreQueries ? "Δείξε λιγότερες" : "Δείξε περισσότερες"}
            </button>
          ) : null}
        </Card>
      ) : null}

      <SeoSection data={data} gsc={gsc} gscDates={gscDates} days={days} visitorDates={visitorDates} />

      {/* How it is counted */}
      <p className="px-2 pb-6 text-xs leading-relaxed" style={{ color: INK3 }}>
        Πώς μετράμε. Μια μέρα του ημερολογίου κρατάει 24 ώρες, από τις 07:00 το πρωί ώρα Αθήνας, που τον χειμώνα είναι μεσάνυχτα στη Νέα Υόρκη: είναι η ίδια μέρα με το πρωινό email. «Άνθρωπος» είναι κάθε διαφορετική συσκευή που δεν μοιάζει με πρόγραμμα. «Έμεινε και διάβασε» σημαίνει ότι κουνήθηκε το ποντίκι, άνοιξε δεύτερη σελίδα ή πέρασαν τουλάχιστον 5 δευτερόλεπτα. Ο διαχωρισμός ανθρώπου και μηχανής είναι εκτίμηση, και οι δικές σου επισκέψεις μετράνε κι αυτές. Τα νούμερα της Google έρχονται από το Search Console, με τη μέρα όπως τη μετράει εκείνο (ώρα Καλιφόρνιας). Από 4 έως 8 Ιουνίου 2026 δεν υπάρχουν επισκέπτες, γιατί εκείνες τις μέρες η καταγραφή ήταν εκτός λειτουργίας.
      </p>
    </div>
  );
}


// ── SEO, GEO and AI search ───────────────────────────────────────
// George, 6/11: the whole history since the site started, by week or by
// month, every period in a table that can be sorted, what rose and what
// fell, and the AI side next to it. Everything here is read from Search
// Console, from the website's own count of people, and from The Helm.

type SeoRow = {
  id: string;
  label: string;
  tick: string;
  partial: boolean;
  v: Record<string, number | null>;
  move: Record<string, number | null>;
};

const SEO_METRICS: { id: string; label: string; monthOnly?: boolean }[] = [
  { id: "clicks", label: "Κλικ" },
  { id: "impressions", label: "Εμφανίσεις" },
  { id: "ctr", label: "Πόσοι πάτησαν (CTR)" },
  { id: "position", label: "Μέση θέση" },
  { id: "top10", label: "Αναζητήσεις στην 1η σελίδα", monthOnly: true },
  { id: "pages", label: "Σελίδες που έδειξε", monthOnly: true },
  { id: "ai", label: "Άνθρωποι από AI", monthOnly: true },
];

function SeoSection({ data, gsc, gscDates, days, visitorDates }: {
  data: LogbookData;
  gsc: Record<string, GscDay>;
  gscDates: string[];
  days: Record<string, DayCounts>;
  visitorDates: string[];
}) {
  const seo = data.seo;
  const idx = useMemo(() => data.index?.months || {}, [data.index]);
  const [group, setGroup] = useState<"month" | "week">("month");
  const [metric, setMetric] = useState<string>("clicks");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "period", dir: -1 });
  const [allRows, setAllRows] = useState(false);

  const firstDate = gscDates[0];
  const lastDate = gscDates[gscDates.length - 1];

  const rows: SeoRow[] = useMemo(() => {
    if (!firstDate) return [];
    const agg = (ds: string[]) => {
      let clicks = 0, impressions = 0, us = 0, usImpr = 0, ps = 0, pw = 0, ups = 0, upw = 0;
      ds.forEach((d) => {
        const r = gsc[d];
        if (!r) return;
        clicks += r[0]; impressions += r[1]; us += r[3]; usImpr += r[4];
        if (r[2] > 0 && r[1] > 0) { ps += r[2] * r[1]; pw += r[1]; }
        if (r[5] > 0 && r[4] > 0) { ups += r[5] * r[4]; upw += r[4]; }
      });
      return {
        clicks, impressions, usClicks: us, usImpressions: usImpr,
        ctr: impressions ? (clicks / impressions) * 100 : null,
        position: pw ? ps / pw : null,
        usPosition: upw ? ups / upw : null,
      } as Record<string, number | null>;
    };
    const moves = (now: Record<string, number | null>, before: Record<string, number | null> | null) => {
      const out: Record<string, number | null> = {};
      Object.keys(now).forEach((k) => {
        const a = now[k];
        const b = before ? before[k] : null;
        out[k] = k === "position" || k === "usPosition" ? (a !== null && b !== null && b !== undefined ? b - a : null) : rel(a, b ?? null, k === "ctr" ? 0 : MIN_BASE);
      });
      return out;
    };

    if (group === "month") {
      const yms = [...new Set(gscDates.map((d) => d.slice(0, 7)))].sort();
      return yms.map((ym, i) => {
        const end = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
        const ds = gscDates.filter((d) => d.startsWith(ym));
        const running = i === yms.length - 1 && lastDate < end;
        const prev = i > 0 ? yms[i - 1] : null;
        const sm = seo?.months?.[ym] || null;
        const rec = idx[ym] || null;
        const v: Record<string, number | null> = {
          ...agg(ds),
          queries: sm ? sm.queries : null,
          top10: sm ? sm.top10 : null,
          top3: sm ? sm.top3 : null,
          pages: sm ? sm.pages : null,
          ai: rec && typeof rec.ai === "number" ? rec.ai : null,
          googlePeople: rec && typeof rec.google === "number" ? rec.google : null,
          aiRequests: seo?.aiRequests ? seo.aiRequests[ym] || 0 : null,
        };
        // The month before, whole, or its same days when this one is still running.
        let before: Record<string, number | null> | null = null;
        if (prev && i > 1) {
          const cut = running ? `${prev}-${lastDate.slice(8, 10)}` : `${prev}-31`;
          const psm = running ? (seo?.prevSame && seo.prevSame.ym === prev ? seo.prevSame : null) : seo?.months?.[prev] || null;
          const prec = idx[prev] || null;
          const visitorsWhole = `${prev}-01` >= FIRST_FULL_MONTH;
          before = {
            ...agg(gscDates.filter((d) => d.startsWith(prev) && d <= cut)),
            queries: psm ? psm.queries : null,
            top10: psm ? psm.top10 : null,
            top3: psm ? psm.top3 : null,
            pages: psm ? psm.pages : null,
            ai: !visitorsWhole ? null : running ? rec?.prevSame?.ai ?? null : prec && typeof prec.ai === "number" ? prec.ai : null,
            googlePeople: !visitorsWhole || running ? null : prec && typeof prec.google === "number" ? prec.google : null,
            aiRequests: null,
          };
        }
        const tick = atNoon(`${ym}-15`).toLocaleDateString("el-GR", { month: "short", year: "2-digit", timeZone: "UTC" });
        return { id: ym, label: monthName(ym) + (running ? ` (ως ${dayTiny(lastDate)})` : i === 0 ? ` (από ${dayTiny(firstDate)})` : ""), tick, partial: running || i === 0, v, move: moves(v, before) };
      });
    }

    // Weeks, Monday to Sunday.
    const weeks = new Map<string, string[]>();
    for (let d = firstDate; d <= lastDate; d = addDays(d, 1)) {
      const monday = addDays(d, -((atNoon(d).getUTCDay() + 6) % 7));
      if (!weeks.has(monday)) weeks.set(monday, []);
      weeks.get(monday)!.push(d);
    }
    const list = [...weeks.entries()];
    return list.map(([monday, ds], i) => {
      const partial = ds.length < 7;
      const v = agg(ds);
      let before: Record<string, number | null> | null = null;
      if (i > 1 || (i === 1 && list[0][1].length === 7)) {
        const prevDays = list[i - 1][1];
        before = agg(partial ? prevDays.slice(0, ds.length) : prevDays);
      }
      return { id: monday, label: `Εβδομάδα από ${dayShort(monday)}${partial ? " (όχι ολόκληρη)" : ""}`, tick: dayTiny(monday), partial, v, move: moves(v, before) };
    });
  }, [group, gsc, gscDates, firstDate, lastDate, seo, idx]);

  // The last four weeks against the four before them, straight from the days.
  const fourWeeks = useMemo(() => {
    if (!lastDate) return null;
    const span = (to: string) => Array.from({ length: 28 }, (_, i) => addDays(to, -i));
    const sum = (ds: string[]) => {
      let c = 0, im = 0, us = 0, ps = 0, pw = 0;
      ds.forEach((d) => { const r = gsc[d]; if (!r) return; c += r[0]; im += r[1]; us += r[3]; if (r[2] > 0 && r[1] > 0) { ps += r[2] * r[1]; pw += r[1]; } });
      return { clicks: c, impressions: im, us, ctr: im ? (c / im) * 100 : 0, position: pw ? ps / pw : 0 };
    };
    const aiSum = (ds: string[]) => ds.reduce((n, d) => n + (days[d] ? days[d].ai : 0), 0);
    const now = span(lastDate);
    const before = span(addDays(lastDate, -28));
    const lastVisitor = visitorDates[visitorDates.length - 1];
    return {
      now: sum(now), before: sum(before),
      ai: lastVisitor ? aiSum(span(lastVisitor)) : null,
      aiBefore: lastVisitor ? aiSum(span(addDays(lastVisitor, -28))) : null,
    };
  }, [gsc, lastDate, days, visitorDates]);

  if (!firstDate || !fourWeeks) return null;

  const activeMetric = group === "week" && SEO_METRICS.find((m) => m.id === metric)?.monthOnly ? "clicks" : metric;
  const chartRows = activeMetric === "ai" ? rows.filter((r) => r.v.ai !== null) : rows;
  const chartSeries: Series[] =
    activeMetric === "clicks" || activeMetric === "impressions"
      ? [{ name: "ΗΠΑ", color: US_GOLD }, { name: "Άλλες χώρες", color: OTHER_BLUE }]
      : activeMetric === "position"
        ? [{ name: "Όλες οι χώρες", color: OTHER_BLUE }, { name: "ΗΠΑ", color: US_GOLD }]
        : [{ name: SEO_METRICS.find((m) => m.id === activeMetric)?.label || "", color: OTHER_BLUE }];
  const chartBuckets: Bucket[] = chartRows.map((r) => {
    const v = r.v;
    const values: (number | null)[] =
      activeMetric === "clicks" ? [v.usClicks, Math.max(0, (v.clicks || 0) - (v.usClicks || 0))]
      : activeMetric === "impressions" ? [v.usImpressions, Math.max(0, (v.impressions || 0) - (v.usImpressions || 0))]
      : activeMetric === "position" ? [v.position, v.usPosition]
      : [v[activeMetric]];
    return { id: r.id, title: r.label, tick: r.tick, values, selectable: false, partial: r.partial && activeMetric !== "position" && activeMetric !== "ctr" };
  });
  const chartFormat = activeMetric === "ctr" ? pct2 : activeMetric === "position" ? pos : num;
  const chartKind: "stack" | "line" = activeMetric === "position" || activeMetric === "ctr" ? "line" : "stack";

  const columns: { id: string; label: string; f?: (n: number) => string; places?: boolean }[] =
    group === "month"
      ? [
          { id: "clicks", label: "Κλικ" },
          { id: "impressions", label: "Εμφανίσεις" },
          { id: "ctr", label: "CTR", f: pct2 },
          { id: "position", label: "Μέση θέση", f: pos, places: true },
          { id: "usClicks", label: "Κλικ ΗΠΑ" },
          { id: "queries", label: "Αναζητήσεις" },
          { id: "top10", label: "Στην 1η σελίδα" },
          { id: "top3", label: "Στις 3 πρώτες" },
          { id: "pages", label: "Σελίδες" },
        ]
      : [
          { id: "clicks", label: "Κλικ" },
          { id: "impressions", label: "Εμφανίσεις" },
          { id: "ctr", label: "CTR", f: pct2 },
          { id: "position", label: "Μέση θέση", f: pos, places: true },
          { id: "usClicks", label: "Κλικ ΗΠΑ" },
          { id: "usImpressions", label: "Εμφανίσεις ΗΠΑ" },
          { id: "usPosition", label: "Θέση ΗΠΑ", f: pos, places: true },
        ];

  const sorted = [...rows].sort((a, b) => {
    if (sort.col === "period") return sort.dir * a.id.localeCompare(b.id);
    const x = a.v[sort.col], y = b.v[sort.col];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return sort.dir * (x - y);
  });
  const shownRows = allRows ? sorted : sorted.slice(0, group === "month" ? 24 : 12);
  const sortBy = (col: string) => setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: col === "position" || col === "usPosition" ? 1 : -1 }));
  const th = (col: string, label: string, left = false) => (
    <th key={col} className={`px-2 py-2 text-xs font-semibold ${left ? "text-left" : "text-right"}`} style={{ color: INK2, borderBottom: `1px solid ${RULE}`, textTransform: "none", letterSpacing: "normal", whiteSpace: "nowrap" }}>
      <button type="button" onClick={() => sortBy(col)} className="font-semibold" style={{ color: sort.col === col ? NAVY : INK2 }} aria-label={`Ταξινόμηση κατά ${label}`}>
        {label}{sort.col === col ? (sort.dir === -1 ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );

  const fw = fourWeeks;
  const tileDelta = (now: number, before: number, opts: { lowerIsBetter?: boolean; places?: boolean } = {}): Delta => {
    if (!before) return null;
    const move = opts.places ? before - now : ((now - before) / before) * 100;
    const flat = Math.abs(move) < (opts.places ? 0.05 : 0.5);
    if (flat) return { text: "ίδιο με τις 28 μέρες πριν", tone: "flat" };
    return {
      text: `${move > 0 ? "▲" : "▼"} ${opts.places ? `${pos(Math.abs(move))} θέσεις` : `${num(Math.abs(move))}%`} από τις 28 μέρες πριν`,
      tone: move > 0 ? "good" : "bad",
    };
  };

  const mv = seo?.movers || null;
  const moverList = (title: string, list: SeoMover[], kind: "page" | "query", up: boolean) => (
    <div>
      <p className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>{title}</p>
      {list.length ? list.map((m) => (
        <div key={m.key} className="py-2" style={{ borderBottom: `1px solid ${GRID}` }}>
          <p className="break-words text-sm" style={{ color: NAVY }}>{m.key}</p>
          <p className="mt-0.5 text-xs" style={{ color: INK2 }}>
            {kind === "page" ? (
              <>κλικ <span className="tabular-nums">{num(m.prevClicks)} → <span className="font-semibold" style={{ color: up ? GOOD : BAD }}>{num(m.clicks)}</span></span>, εμφανίσεις <span className="tabular-nums">{num(m.prevImpressions)} → {num(m.impressions)}</span></>
            ) : (
              <>εμφανίσεις <span className="tabular-nums">{num(m.prevImpressions)} → <span className="font-semibold" style={{ color: up ? GOOD : BAD }}>{num(m.impressions)}</span></span>
                {m.position !== null ? <>, θέση <span className="tabular-nums">{m.prevPosition !== null ? `${pos(m.prevPosition)} → ` : ""}{pos(m.position)}</span></> : m.prevPosition !== null ? <>, ήταν στη θέση <span className="tabular-nums">{pos(m.prevPosition)}</span> και δεν εμφανίστηκε</> : null}
              </>
            )}
          </p>
        </div>
      )) : <p className="text-sm" style={{ color: INK3 }}>Τίποτα αξιοσημείωτο.</p>}
    </div>
  );

  // The AI side.
  const aiMonths = Object.keys(idx).filter((m) => typeof idx[m].ai === "number").sort().reverse();
  const assistants = ["ChatGPT", "Perplexity", "Copilot", "Gemini", "Claude"];
  const panel = seo?.aiPanel?.length ? seo.aiPanel[seo.aiPanel.length - 1] : null;
  const bing = seo?.bingAi?.length ? seo.bingAi[seo.bingAi.length - 1] : null;
  const aiRequestsTotal = Object.values(seo?.aiRequests || {}).reduce((a, b) => a + b, 0);

  return (
    <Card>
      <Eyebrow>SEO, GEO και AI αναζήτηση</Eyebrow>
      <h2 className="mt-1 text-xl font-semibold" style={{ color: NAVY }}>Πώς πάμε στη Google και στα AI, από την αρχή</h2>
      <p className="mt-1 text-sm" style={{ color: INK2 }}>
        Όλο το ιστορικό που κρατάει η Google για το site, από {dayLong(firstDate).split(" ").slice(1).join(" ")} {firstDate.slice(0, 4)} έως {dayLong(lastDate).split(" ").slice(1).join(" ")} {lastDate.slice(0, 4)}.
      </p>

      <p className="mt-6 text-sm font-semibold" style={{ color: NAVY }}>Οι τελευταίες 28 μέρες</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Κλικ από Google" value={num(fw.now.clicks)} delta={tileDelta(fw.now.clicks, fw.before.clicks)} />
        <Tile label="Φορές που μας έδειξε" value={num(fw.now.impressions)} delta={tileDelta(fw.now.impressions, fw.before.impressions)} />
        <Tile label="Πόσοι πάτησαν (CTR)" value={pct2(fw.now.ctr)} note="στους 100 που μας είδαν" delta={tileDelta(fw.now.ctr, fw.before.ctr)} />
        <Tile label="Μέση θέση" value={pos(fw.now.position)} note="όσο πιο μικρό, τόσο πιο ψηλά" delta={tileDelta(fw.now.position, fw.before.position, { places: true })} />
        <Tile label="Κλικ από ΗΠΑ" value={num(fw.now.us)} delta={tileDelta(fw.now.us, fw.before.us)} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold" style={{ color: NAVY }}>Όλη η πορεία</p>
        <div className="flex gap-2">
          <Pill active={group === "month"} onClick={() => { setGroup("month"); setAllRows(false); }}>Ανά μήνα</Pill>
          <Pill active={group === "week"} onClick={() => { setGroup("week"); setAllRows(false); }}>Ανά εβδομάδα</Pill>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {SEO_METRICS.filter((m) => group === "month" || !m.monthOnly).map((m) => (
          <Pill key={m.id} active={activeMetric === m.id} onClick={() => setMetric(m.id)}>{m.label}</Pill>
        ))}
      </div>
      {chartSeries.length > 1 ? (
        <div className="mt-4 flex flex-wrap gap-5">
          {chartSeries.map((sr) => (
            <p key={sr.name} className="flex items-center gap-2 text-sm" style={{ color: INK2 }}>
              <span className={chartKind === "line" ? "inline-block h-[3px] w-4 rounded-full" : "inline-block h-3 w-3 rounded-[3px]"} style={{ background: sr.color }} />
              {sr.name}
            </p>
          ))}
        </div>
      ) : null}
      <div className="mt-3">
        <Chart buckets={chartBuckets} series={chartSeries} kind={chartKind} selected={null} onSelect={() => {}} format={chartFormat} lowerIsBetter={activeMetric === "position"} />
      </div>
      <p className="mt-2 text-xs" style={{ color: INK3 }}>
        {activeMetric === "position" ? "Η θέση 1 είναι πάνω: όσο ανεβαίνει η γραμμή, τόσο πιο ψηλά μας δείχνει η Google. " : ""}
        {activeMetric === "ctr" ? "Στους 100 ανθρώπους που μας είδαν στη Google, πόσοι πάτησαν. " : ""}
        {activeMetric === "top10" ? "Πόσες διαφορετικές αναζητήσεις μάς είχαν στην πρώτη σελίδα της Google εκείνο τον μήνα. " : ""}
        {activeMetric === "pages" ? "Πόσες διαφορετικές σελίδες του site εμφάνισε η Google έστω μία φορά. " : ""}
        {activeMetric === "ai" ? "Διαφορετικοί άνθρωποι που ήρθαν από ChatGPT, Perplexity, Copilot, Gemini και παρόμοια. Μετριούνται από τον Μάιο του 2026. " : ""}
        {chartKind === "stack" ? "Οι πιο αχνές στήλες είναι περίοδοι που δεν είναι ολόκληρες." : ""}
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr>
              {th("period", group === "month" ? "Μήνας" : "Εβδομάδα", true)}
              {columns.map((c) => th(c.id, c.label))}
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${GRID}` }}>
                <td className="px-2 py-3 align-top text-[15px] font-semibold" style={{ color: NAVY, whiteSpace: "nowrap" }}>{r.label}</td>
                {columns.map((c) => {
                  const val = r.v[c.id];
                  return (
                    <td key={c.id} className="px-2 py-3 text-right align-top tabular-nums" style={{ color: val !== null ? NAVY : INK3 }}>
                      <span className={`block text-[15px] ${val !== null ? "font-semibold" : ""}`}>{val !== null ? (c.f || num)(val) : "·"}</span>
                      {val !== null ? <Move move={r.move[c.id] ?? null} places={c.places} /> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shownRows.length || allRows ? (
        <button type="button" onClick={() => setAllRows((x) => !x)} className="mt-3 text-sm font-semibold underline" style={{ color: NAVY }}>
          {allRows ? "Δείξε λιγότερες" : `Δείξε και τις ${sorted.length} ${group === "month" ? "μήνες" : "εβδομάδες"}`}
        </button>
      ) : null}
      <p className="mt-3 text-xs leading-relaxed" style={{ color: INK3 }}>
        Πάτησε τον τίτλο μιας στήλης για να ταξινομήσεις. Κάτω από κάθε νούμερο, με αχνά γράμματα, η αλλαγή από την προηγούμενη περίοδο. Όπου η προηγούμενη περίοδος είχε λιγότερα από 10, δεν γράφεται ποσοστό, γιατί δεν θα έλεγε κάτι. Η περίοδος που τρέχει συγκρίνεται με τις ίδιες μέρες της προηγούμενης. Στη μέση θέση μετράμε θέσεις, και το πράσινο σημαίνει ότι ανεβήκαμε.
        {group === "month" ? " «Αναζητήσεις» είναι όσες διαφορετικές αναζητήσεις δείχνει η Google ότι μας εμφάνισαν. Η Google κρύβει τις περισσότερες για λόγους ιδιωτικότητας, άρα είναι λιγότερες από τις πραγματικές, αλλά μετριούνται με τον ίδιο τρόπο κάθε μήνα και δείχνουν σωστά την τάση." : ""}
        {seo?.sitemapPages ? ` Στον χάρτη του site που δίνουμε στη Google υπάρχουν ${num(seo.sitemapPages)} σελίδες.` : ""}
      </p>

      {mv ? (
        <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${RULE}` }}>
          <p className="text-sm font-semibold" style={{ color: NAVY }}>Τι ανέβηκε και τι έπεσε</p>
          <p className="mt-1 text-xs" style={{ color: INK3 }}>
            Οι τελευταίες 28 μέρες ({dayTiny(mv.start)} έως {dayTiny(mv.end)}) δίπλα στις 28 πριν από αυτές. Αυτές οι σελίδες και αυτές οι αναζητήσεις εξηγούν το μεγαλύτερο μέρος της αλλαγής.
          </p>
          <div className="mt-4 grid gap-8 md:grid-cols-2">
            {moverList("Σελίδες που ανέβηκαν", mv.pagesUp, "page", true)}
            {moverList("Σελίδες που έπεσαν", mv.pagesDown, "page", false)}
          </div>
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            {moverList("Αναζητήσεις που μας δείχνει περισσότερο", mv.queriesUp, "query", true)}
            {moverList("Αναζητήσεις που μας δείχνει λιγότερο", mv.queriesDown, "query", false)}
          </div>
        </div>
      ) : null}

      <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${RULE}` }}>
        <p className="text-sm font-semibold" style={{ color: NAVY }}>AI: πόσοι ήρθαν από εκεί και πόσο μας αναφέρουν</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {fw.ai !== null ? <Tile label="Άνθρωποι από AI, 28 μέρες" value={num(fw.ai)} delta={fw.aiBefore ? tileDelta(fw.ai, fw.aiBefore) : null} /> : null}
          <Tile label="Αιτήματα που ήρθαν από AI" value={num(aiRequestsTotal)} note="όσα το είπε ο πελάτης ή το έδειξε η επίσκεψη" />
          {panel && panel.chatgpt !== null ? <Tile label="Μας ανέφερε το ChatGPT" value={`${panel.chatgpt} στις ${panel.prompts}`} note={`ερωτήσεις, μέτρηση ${dayTiny(panel.date)}`} /> : null}
          {panel && panel.google !== null ? <Tile label="Μας ανέφερε η Google AI" value={`${panel.google} στις ${panel.prompts}`} note={`ερωτήσεις, μέτρηση ${dayTiny(panel.date)}`} /> : null}
          {panel && panel.copilot !== null ? <Tile label="Μας ανέφερε το Copilot" value={`${panel.copilot} στις ${panel.prompts}`} note={`ερωτήσεις, μέτρηση ${dayTiny(panel.date)}`} /> : null}
          {bing ? <Tile label="Αναφορές από το AI της Bing" value={num(bing.total)} note={`${bing.window.replace(/(\d+)\s*D\b/, "$1 μέρες")}, ${num(bing.buying)} σε σελίδες αγοράς (${Math.round(bing.share * 100)}%)`} /> : null}
        </div>

        {aiMonths.length ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  {["Μήνας", "Από AI", ...assistants, "Άλλα AI", "Από Google", "Αιτήματα από AI"].map((h, i) => (
                    <th key={h} className={`px-2 py-2 text-xs font-semibold ${i === 0 ? "text-left" : "text-right"}`} style={{ color: INK2, borderBottom: `1px solid ${RULE}`, textTransform: "none", letterSpacing: "normal", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aiMonths.map((ym) => {
                  const rec = idx[ym];
                  const by = new Map(rec.aiBy || []);
                  const others = (rec.aiBy || []).filter(([n]) => !assistants.includes(n)).reduce((a, [, k]) => a + k, 0);
                  const row = rows.find((r) => r.id === ym);
                  const cellN = (n: number | null, move: number | null = null, strong = false) => (
                    <td className="px-2 py-3 text-right align-top tabular-nums" style={{ color: n === null ? INK3 : NAVY }}>
                      <span className={`block text-[15px] ${strong && n !== null ? "font-semibold" : ""}`}>{n === null ? "·" : num(n)}</span>
                      {strong && n !== null ? <Move move={move} /> : null}
                    </td>
                  );
                  return (
                    <tr key={ym} style={{ borderBottom: `1px solid ${GRID}` }}>
                      <td className="px-2 py-3 align-top text-[15px] font-semibold" style={{ color: NAVY, whiteSpace: "nowrap" }}>{monthName(ym)}</td>
                      {cellN(rec.ai ?? null, group === "month" && row ? row.move.ai ?? null : null, true)}
                      {assistants.map((a) => <td key={a} className="px-2 py-3 text-right align-top text-[15px] tabular-nums" style={{ color: rec.aiBy ? NAVY : INK3 }}>{rec.aiBy ? num(by.get(a) || 0) : "·"}</td>)}
                      <td className="px-2 py-3 text-right align-top text-[15px] tabular-nums" style={{ color: rec.aiBy ? NAVY : INK3 }}>{rec.aiBy ? num(others) : "·"}</td>
                      {cellN(typeof rec.google === "number" ? rec.google : null, group === "month" && row ? row.move.googlePeople ?? null : null, true)}
                      <td className="px-2 py-3 text-right align-top text-[15px] tabular-nums" style={{ color: NAVY }}>{num(seo?.aiRequests?.[ym] || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {seo && seo.aiPanel.length > 1 ? (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold" style={{ color: NAVY }}>Πόσο μας αναφέρουν, μέτρηση με τη μέτρηση</p>
            {[...seo.aiPanel].reverse().map((p) => (
              <p key={p.date} className="py-1 text-sm tabular-nums" style={{ color: NAVY, borderBottom: `1px solid ${GRID}` }}>
                <span style={{ color: INK3 }}>{dayShort(p.date)}</span>&nbsp;&nbsp;
                {[p.chatgpt !== null ? `ChatGPT ${p.chatgpt}/${p.prompts}` : "", p.google !== null ? `Google AI ${p.google}/${p.prompts}` : "", p.copilot !== null ? `Copilot ${p.copilot}/${p.prompts}` : ""].filter(Boolean).join(" · ")}
              </p>
            ))}
          </div>
        ) : null}

        <p className="mt-4 text-xs leading-relaxed" style={{ color: INK3 }}>
          «Από AI» και «Από Google» είναι διαφορετικοί άνθρωποι που ήρθαν στο site μέσα στον μήνα, μετρημένοι από το ίδιο το site (όχι κλικ). Οι άνθρωποι από AI είναι το λιγότερο: όποιος ανοίγει το link από εφαρμογή που δεν αφήνει ίχνος δεν φαίνεται. Αν κάποιος ήρθε από δύο βοηθούς, μετράει μία φορά στον καθένα. Το «μας ανέφερε» είναι η δοκιμή που κάνεις κάθε Δευτέρα με τις ίδιες ερωτήσεις. Κρατιέται ιστορικό από τις 3/11/2026, και κάθε νέα μέτρηση προστίθεται εδώ.
        </p>
      </div>
    </Card>
  );
}
