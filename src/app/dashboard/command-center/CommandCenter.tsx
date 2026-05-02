"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { CommandCenterSnapshot } from "@/lib/command-center-snapshot";

/* ═══════════════════════════════════════════════════════════════════════════
   PROPS
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  snapshot: CommandCenterSnapshot;
}

// Deterministic gradient color from an id seed — used to paint the
// initials-avatar for each executive. Replaces the previous fictional-
// person photos (Tim Cook / Gary Vee / etc.) with a content-safe,
// brand-neutral identity tile.
function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  const b = (a + 60) % 360;
  return `linear-gradient(135deg, hsl(${a}deg 70% 35%), hsl(${b}deg 70% 25%))`;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function statusDotColor(s: string): string {
  if (s === "ONLINE") return "#00ff88";
  if (s === "STANDBY") return "#ffaa00";
  return "#ff3366";
}


/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function CommandCenter({ snapshot }: Props) {
  const router = useRouter();
  const { metrics, executives, pipeline, systems, threats, activity } = snapshot;

  // Refs for canvases
  const matrixRef = useRef<HTMLCanvasElement>(null);
  const hexRef = useRef<HTMLCanvasElement>(null);
  const particleRef = useRef<HTMLCanvasElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ambientTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // State
  const [metricCounts, setMetricCounts] = useState<number[]>(() => metrics.map(() => 0));
  const [logLines, setLogLines] = useState<{ ts: string; tag: string; color: string; msg: string }[]>([]);
  const [glowCard, setGlowCard] = useState<number | null>(null);
  const [hoveredExec, setHoveredExec] = useState<string | null>(null);

  // ─── Audio helpers ──────────────────────────────────────────────────────
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {
        // Audio not supported
      }
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback(
    (freq: number, duration: number, vol: number = 0.06) => {
      const ctx = getAudioCtx();
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + duration);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        // Ignore audio errors
      }
    },
    [getAudioCtx]
  );

  const playBlip = useCallback(() => {
    playTone(1400, 0.08, 0.04);
  }, [playTone]);

  const playExecHover = useCallback(
    (index: number) => {
      playTone(300 + index * 80, 0.15, 0.05);
    },
    [playTone]
  );

  // ─── Metric count-up animation ─────────────────────────────────────────
  useEffect(() => {
    const start = performance.now();
    const duration = 2000;
    let raf: number;
    function tick(now: number) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setMetricCounts(metrics.map((m) => Math.round(m.value * eased)));
      if (p < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [metrics]);

  // ─── Terminal log cycling ──────────────────────────────────────────────
  // Cycles through the real activity feed coming from the server snapshot
  // (Supabase activities table, latest first) instead of the previous
  // hardcoded mock log entries. Timestamps display the activity's actual
  // created_at — not synthetic "00:00:0X".
  useEffect(() => {
    if (!activity || activity.length === 0) return;
    let idx = 0;
    const fmtTs = (iso: string) => {
      try {
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
      } catch {
        return "--:--:--";
      }
    };
    const addLine = () => {
      const entry = activity[idx % activity.length];
      setLogLines((prev) => [
        ...prev.slice(-30),
        { ts: fmtTs(entry.when), tag: entry.tag, color: entry.color, msg: entry.msg },
      ]);
      idx++;
    };
    // Seed with first 5 entries so the terminal isn't blank on first paint
    const seed = activity.slice(0, Math.min(5, activity.length)).map((e) => ({
      ts: fmtTs(e.when),
      tag: e.tag,
      color: e.color,
      msg: e.msg,
    }));
    setLogLines(seed);
    idx = seed.length;
    const timer = setInterval(addLine, 2500);
    return () => clearInterval(timer);
  }, [activity]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logLines]);

  // ─── Ambient sound ─────────────────────────────────────────────────────
  useEffect(() => {
    ambientTimerRef.current = setInterval(() => {
      playTone(80, 1.5, 0.015);
    }, 8000);
    return () => {
      if (ambientTimerRef.current) clearInterval(ambientTimerRef.current);
    };
  }, [playTone]);

  // ─── Matrix Rain Canvas ────────────────────────────────────────────────
  useEffect(() => {
    const canvas = matrixRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w = 0;
    let h = 0;
    const fontSize = 14;
    let columns = 0;
    let drops: number[] = [];

    const chars = "ABGDEZHQIKLMNXOPRSTYFCYWabgdezhqiklmnxoprstyfcyw" +
      "\u0391\u0392\u0393\u0394\u0395\u0396\u0397\u0398\u0399\u039A\u039B\u039C\u039D\u039E\u039F\u03A0\u03A1\u03A3\u03A4\u03A5\u03A6\u03A7\u03A8\u03A9" +
      "\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD\u30BF\u30C1\u30C4\u30C6\u30C8\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D2\u30D5\u30D8\u30DB\u30DE\u30DF\u30E0\u30E1\u30E2\u30E4\u30E6\u30E8\u30E9\u30EA\u30EB\u30EC\u30ED\u30EF\u30F2\u30F3" +
      "\u2200\u2202\u2203\u2205\u2207\u2208\u2209\u220B\u2211\u221A\u221E\u2227\u2228\u2229\u222A\u222B";

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      columns = Math.floor(w / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -100);
    }

    function draw() {
      ctx!.fillStyle = "rgba(1, 8, 16, 0.06)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.fillStyle = "rgba(0, 255, 200, 0.1)";
      ctx!.font = `${fontSize}px monospace`;

      for (let i = 0; i < columns; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        ctx!.fillText(char, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > h && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i] += 0.5;
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ─── Hex Grid Canvas ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = hexRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w = 0;
    let h = 0;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }

    function drawHex(cx: number, cy: number, r: number) {
      ctx!.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.closePath();
      ctx!.stroke();
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      ctx!.strokeStyle = "rgba(0, 255, 200, 0.04)";
      ctx!.lineWidth = 0.5;
      const size = 30;
      const hDist = size * Math.sqrt(3);
      const vDist = size * 1.5;

      for (let row = -1; row < h / vDist + 1; row++) {
        for (let col = -1; col < w / hDist + 1; col++) {
          const offset = row % 2 === 0 ? 0 : hDist / 2;
          drawHex(col * hDist + offset, row * vDist, size);
        }
      }
      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ─── Particle Neural Network Canvas ────────────────────────────────────
  useEffect(() => {
    const canvas = particleRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let w = 0;
    let h = 0;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
    }

    const particles: Particle[] = [];
    const COUNT = 150;
    const MAX_DIST = 120;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }

    function init() {
      particles.length = 0;
      for (let i = 0; i < COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
        });
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx!.fillStyle = "rgba(0, 255, 200, 0.3)";
        ctx!.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(0, 255, 200, ${0.15 * (1 - dist / MAX_DIST)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    init();
    draw();

    const handleResize = () => {
      resize();
      init();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // ─── Metric click → glow + drill-down ──────────────────────────────────
  const handleMetricClick = (idx: number) => {
    playBlip();
    setGlowCard(idx);
    const route = metrics[idx]?.route;
    setTimeout(() => {
      setGlowCard(null);
      if (route) router.push(route);
    }, 350);
  };

  // ─── Status color helper ───────────────────────────────────────────────
  const statusDot = (s: string) => {
    if (s === "green") return "#00ff88";
    if (s === "amber") return "#ffaa00";
    if (s === "red") return "#ff3366";
    return "#00ffc8";
  };

  const severityColor = (s: string) => {
    if (s === "LOW") return "#00ff88";
    if (s === "MED") return "#ffaa00";
    if (s === "HIGH") return "#ff6644";
    if (s === "CRIT") return "#ff0064";
    return "#00ffc8";
  };

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */

  return (
    <>
      {/* ── STYLE TAG ────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes cc-scanline {
          0% { background-position: 0 0; }
          100% { background-position: 0 4px; }
        }
        @keyframes cc-scan-beam-1 {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes cc-scan-beam-2 {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes cc-scan-beam-3 {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes cc-noise {
          0% { opacity: 0.02; }
          10% { opacity: 0.04; }
          20% { opacity: 0.01; }
          30% { opacity: 0.03; }
          40% { opacity: 0.02; }
          50% { opacity: 0.05; }
          60% { opacity: 0.01; }
          70% { opacity: 0.03; }
          80% { opacity: 0.02; }
          90% { opacity: 0.04; }
          100% { opacity: 0.02; }
        }
        @keyframes cc-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes cc-cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes cc-shimmer {
          0% { left: -100%; }
          100% { left: 200%; }
        }
        @keyframes cc-fill-bar {
          0% { width: 0%; }
          100% { width: var(--bar-w); }
        }
        @keyframes cc-glow-explode {
          0% { box-shadow: 0 0 0px #00ffc8, inset 0 0 0px #00ffc8; }
          50% { box-shadow: 0 0 40px #00ffc8, inset 0 0 20px rgba(0,255,200,0.3); }
          100% { box-shadow: 0 0 0px #00ffc8, inset 0 0 0px #00ffc8; }
        }
        @keyframes cc-wave-1 {
          0% { d: path("M0 30 Q 60 10, 120 30 T 240 30 T 360 30 T 480 30"); }
          50% { d: path("M0 30 Q 60 50, 120 30 T 240 30 T 360 30 T 480 30"); }
          100% { d: path("M0 30 Q 60 10, 120 30 T 240 30 T 360 30 T 480 30"); }
        }
        @keyframes cc-radar-sweep {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes cc-orbit {
          0% { transform: rotate(0deg) translateX(28px) rotate(0deg); }
          100% { transform: rotate(360deg) translateX(28px) rotate(-360deg); }
        }
        @keyframes cc-pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        .cc-card-glow {
          animation: cc-glow-explode 0.6s ease-out;
        }
      `}</style>

      {/* ── MAIN CONTAINER ───────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "#010810",
          fontFamily: "monospace",
          color: "#a0ffe0",
          overflow: "hidden",
        }}
      >
        {/* ── CANVAS LAYERS ──────────────────────────────────────────────── */}
        <canvas
          ref={matrixRef}
          style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 1, pointerEvents: "none", opacity: 0.8 }}
        />
        <canvas
          ref={hexRef}
          style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 2, pointerEvents: "none" }}
        />
        <canvas
          ref={particleRef}
          style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" }}
        />

        {/* ── CRT SCANLINES ──────────────────────────────────────────────── */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4,
            pointerEvents: "none",
            background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 3px)",
            animation: "cc-scanline 0.1s linear infinite",
          }}
        />

        {/* ── SCAN BEAMS ─────────────────────────────────────────────────── */}
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            height: "2px",
            background: "linear-gradient(90deg, transparent 0%, #00ffc8 50%, transparent 100%)",
            opacity: 0.4,
            zIndex: 5,
            pointerEvents: "none",
            animation: "cc-scan-beam-1 4s linear infinite",
          }}
        />
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(255,0,100,0.6) 50%, transparent 100%)",
            opacity: 0.3,
            zIndex: 5,
            pointerEvents: "none",
            animation: "cc-scan-beam-2 6s linear infinite",
          }}
        />
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(0,100,255,0.6) 50%, transparent 100%)",
            opacity: 0.3,
            zIndex: 5,
            pointerEvents: "none",
            animation: "cc-scan-beam-3 8s linear infinite",
          }}
        />

        {/* ── TV NOISE OVERLAY ───────────────────────────────────────────── */}
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 6,
            pointerEvents: "none",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E\")",
            backgroundSize: "200px 200px",
            animation: "cc-noise 0.3s steps(5) infinite",
          }}
        />

        {/* ── CORNER BRACKETS (HUD CORNERS) ──────────────────────────────── */}
        {/* Top-left */}
        <svg
          style={{ position: "fixed", top: 8, left: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M0 15 L0 0 L15 0" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>
        {/* Top-right */}
        <svg
          style={{ position: "fixed", top: 8, right: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M25 0 L40 0 L40 15" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>
        {/* Bottom-left */}
        <svg
          style={{ position: "fixed", bottom: 8, left: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M0 25 L0 40 L15 40" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>
        {/* Bottom-right */}
        <svg
          style={{ position: "fixed", bottom: 8, right: 8, zIndex: 7, pointerEvents: "none" }}
          width="40"
          height="40"
          viewBox="0 0 40 40"
        >
          <path d="M25 40 L40 40 L40 25" fill="none" stroke="#00ffc8" strokeWidth="1.5" opacity="0.5" />
        </svg>

        {/* ── CONTENT ────────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            zIndex: 10,
            maxWidth: 1200,
            margin: "0 auto",
            padding: "24px 16px 60px",
          }}
        >
          {/* ── HEADER ──────────────────────────────────────────────────── */}
          <header style={{ textAlign: "center", marginBottom: 40 }}>
            {/* CLASSIFIED tag */}
            <div
              style={{
                display: "inline-block",
                padding: "2px 16px",
                border: "1px solid rgba(255,0,100,0.5)",
                fontSize: 10,
                letterSpacing: 4,
                color: "rgba(255,0,100,0.9)",
                textTransform: "uppercase",
                marginBottom: 12,
                animation: "cc-blink 1s steps(1) infinite",
              }}
            >
              CLASSIFIED
            </div>

            {/* Title with chromatic aberration */}
            <h1
              style={{
                fontSize: "clamp(18px, 3vw, 32px)",
                fontWeight: 900,
                letterSpacing: 6,
                color: "#00ffc8",
                textTransform: "uppercase",
                textShadow: "-2px 0 #ff0064, 2px 0 #0064ff, 0 0 20px rgba(0,255,200,0.5)",
                lineHeight: 1.3,
                margin: "8px 0",
              }}
            >
              GEORGE YACHTS COMMAND CENTER
            </h1>

            {/* Typing cursor */}
            <div
              style={{
                display: "inline-block",
                fontSize: 12,
                color: "#00ffc8",
                opacity: 0.6,
              }}
            >
              SYSTEM ONLINE
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 14,
                  background: "#00ffc8",
                  marginLeft: 4,
                  verticalAlign: "middle",
                  animation: "cc-cursor-blink 1s steps(1) infinite",
                }}
              />
            </div>
          </header>

          {/* ── METRIC CARDS ────────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 40,
            }}
          >
            {metrics.map((m, idx) => (
              <div
                key={m.id}
                onClick={() => handleMetricClick(idx)}
                onMouseEnter={playBlip}
                className={glowCard === idx ? "cc-card-glow" : ""}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  background: "rgba(0, 20, 40, 0.6)",
                  border: "1px solid rgba(0, 255, 200, 0.15)",
                  borderRadius: 8,
                  padding: "20px 16px",
                  cursor: "pointer",
                  transition: "border-color 0.3s, box-shadow 0.3s",
                  ...(glowCard === idx
                    ? {}
                    : {}),
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0, 255, 200, 0.4)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 20px rgba(0,255,200,0.15)";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0, 255, 200, 0.15)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                }}
              >
                {/* Shimmer sweep */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "-100%",
                    width: "50%",
                    height: "100%",
                    background: "linear-gradient(90deg, transparent, rgba(0,255,200,0.06), transparent)",
                    animation: "cc-shimmer 3s ease-in-out infinite",
                    pointerEvents: "none",
                  }}
                />
                <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(160,255,224,0.5)", textTransform: "uppercase", marginBottom: 8 }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 36, fontWeight: 900, color: "#00ffc8", textShadow: "0 0 15px rgba(0,255,200,0.4)" }}>
                  {metricCounts[idx]}{m.suffix}
                </div>
                {/* Energy bar */}
                <div style={{ marginTop: 12, height: 3, background: "rgba(0,255,200,0.1)", borderRadius: 2, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "linear-gradient(90deg, #00ffc8, #0064ff)",
                      borderRadius: 2,
                      ["--bar-w" as string]: `${(m.value / 50) * 100}%`,
                      animation: "cc-fill-bar 2s ease-out forwards",
                      width: 0,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* ── TODAY'S PRIORITIES (Tier 2) ─────────────────────────────── */}
          {/* Top AI-ranked actions (left) + 4 urgent counters (right). The
              actions come from the cached cockpit briefing — same money-
              first ranking the morning Telegram brief uses. Click an
              action → drills into the contact. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
              gap: 16,
              marginBottom: 40,
            }}
          >
            {/* LEFT — Top 3 actions */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.55)",
                border: "1px solid rgba(0, 255, 200, 0.18)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.6)", textTransform: "uppercase" }}>
                  TODAY&apos;S PRIORITIES
                </span>
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: 2,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: snapshot.priorities.has_briefing ? "rgba(0,255,136,0.15)" : "rgba(255,170,0,0.18)",
                    color: snapshot.priorities.has_briefing ? "#00ff88" : "#ffaa00",
                    border: `1px solid ${snapshot.priorities.has_briefing ? "rgba(0,255,136,0.35)" : "rgba(255,170,0,0.4)"}`,
                  }}
                >
                  {snapshot.priorities.has_briefing ? "AI-RANKED" : "BRIEFING PENDING"}
                </span>
              </div>
              {snapshot.priorities.actions.length === 0 && (
                <div style={{ fontSize: 12, color: "rgba(160,255,224,0.5)", padding: "12px 0" }}>
                  No prioritised actions in today&apos;s briefing.
                  <button
                    onClick={() => router.push("/dashboard")}
                    style={{
                      marginLeft: 8,
                      background: "transparent",
                      border: "1px solid rgba(0,255,200,0.3)",
                      color: "#00ffc8",
                      padding: "3px 10px",
                      fontSize: 10,
                      letterSpacing: 1,
                      cursor: "pointer",
                      borderRadius: 3,
                    }}
                  >
                    OPEN COCKPIT
                  </button>
                </div>
              )}
              {snapshot.priorities.actions.map((a, i) => {
                const priColor =
                  a.priority === "critical" ? "#ff0064"
                  : a.priority === "high" ? "#ff6644"
                  : a.priority === "medium" ? "#ffaa00"
                  : "#00ff88";
                return (
                  <div
                    key={a.id}
                    onClick={() => {
                      playBlip();
                      if (a.contact_id) router.push(`/dashboard/contacts/${a.contact_id}`);
                      else router.push("/dashboard");
                    }}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "10px 0",
                      borderTop: i === 0 ? "none" : "1px solid rgba(0,255,200,0.06)",
                      cursor: "pointer",
                    }}
                    onMouseOver={(e) => ((e.currentTarget as HTMLDivElement).style.background = "rgba(0,255,200,0.04)")}
                    onMouseOut={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                  >
                    <div
                      style={{
                        marginTop: 4,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: priColor,
                        boxShadow: `0 0 6px ${priColor}`,
                        flexShrink: 0,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#a0ffe0", fontWeight: 600, lineHeight: 1.4 }}>
                        {a.title}
                      </div>
                      {a.reason && (
                        <div style={{ fontSize: 10, color: "rgba(160,255,224,0.45)", marginTop: 2, lineHeight: 1.5 }}>
                          {a.reason}
                        </div>
                      )}
                    </div>
                    {a.expected_commission_eur > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#00ffc8",
                          textShadow: "0 0 8px rgba(0,255,200,0.4)",
                          flexShrink: 0,
                          letterSpacing: 0.5,
                        }}
                      >
                        €{Math.round(a.expected_commission_eur).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* RIGHT — 4 counters */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {snapshot.priorities.counters.map((c) => {
                const numColor =
                  c.tone === "bad" ? "#ff3366"
                  : c.tone === "warn" ? "#ffaa00"
                  : "#00ff88";
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      playBlip();
                      router.push(c.route);
                    }}
                    style={{
                      position: "relative",
                      background: "rgba(0, 20, 40, 0.55)",
                      border: "1px solid rgba(0, 255, 200, 0.12)",
                      borderRadius: 6,
                      padding: "10px 12px",
                      cursor: "pointer",
                      transition: "border-color 0.2s",
                      overflow: "hidden",
                    }}
                    onMouseOver={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0,255,200,0.4)")}
                    onMouseOut={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(0,255,200,0.12)")}
                  >
                    <div style={{ fontSize: 9, letterSpacing: 1.5, color: "rgba(160,255,224,0.55)", textTransform: "uppercase", marginBottom: 4 }}>
                      {c.label}
                    </div>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 900,
                        color: numColor,
                        textShadow: `0 0 10px ${numColor}66`,
                        lineHeight: 1,
                      }}
                    >
                      {c.value}
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(160,255,224,0.4)", marginTop: 4, letterSpacing: 0.3 }}>
                      {c.hint}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── EXECUTIVE GRID ──────────────────────────────────────────── */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", textTransform: "uppercase", marginBottom: 12 }}>
              EXECUTIVE COUNCIL
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {executives.map((exec, idx) => (
                <div
                  key={exec.id}
                  onClick={() => {
                    if (exec.route) router.push(exec.route);
                  }}
                  onMouseEnter={() => {
                    setHoveredExec(exec.id);
                    playExecHover(idx);
                  }}
                  onMouseLeave={() => setHoveredExec(null)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    background: "rgba(0, 20, 40, 0.5)",
                    border: `1px solid ${hoveredExec === exec.id ? "rgba(0, 255, 200, 0.5)" : "rgba(0, 255, 200, 0.1)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    transition: "all 0.3s",
                    boxShadow: hoveredExec === exec.id ? "0 0 25px rgba(0,255,200,0.2)" : "none",
                    overflow: "hidden",
                  }}
                >
                  {/* Avatar — initials tile (replaces previous photo of fictional persona) */}
                  <div
                    style={{
                      position: "relative",
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: gradientFor(exec.id),
                      flexShrink: 0,
                      border: "1.5px solid rgba(0,255,200,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      color: "rgba(255,255,255,0.92)",
                      fontSize: 14,
                      letterSpacing: 1,
                      textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                    }}
                  >
                    {initialsFrom(exec.name)}
                    {/* Status dot — bottom-right */}
                    <div
                      style={{
                        position: "absolute",
                        right: -1,
                        bottom: -1,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: statusDotColor(exec.status),
                        boxShadow: `0 0 6px ${statusDotColor(exec.status)}`,
                        border: "1.5px solid #010810",
                      }}
                    />
                    {/* Orbiting particle on hover */}
                    {hoveredExec === exec.id && (
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          width: 4,
                          height: 4,
                          marginLeft: -2,
                          marginTop: -2,
                          borderRadius: "50%",
                          background: "#00ffc8",
                          boxShadow: "0 0 6px #00ffc8",
                          animation: "cc-orbit 1.5s linear infinite",
                        }}
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a0ffe0" }}>{exec.name}</div>
                    <div style={{ fontSize: 10, color: "rgba(0,255,200,0.5)", letterSpacing: 1 }}>{exec.role.toUpperCase()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── WAVEFORM + RADAR ────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 140px",
              gap: 16,
              marginBottom: 40,
              alignItems: "center",
            }}
          >
            {/* Waveform */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.4)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
                overflow: "hidden",
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(160,255,224,0.4)", marginBottom: 8 }}>
                SIGNAL WAVEFORM
              </div>
              <svg width="100%" height="60" viewBox="0 0 480 60" preserveAspectRatio="none">
                {[
                  { color: "rgba(0,255,200,0.4)", dur: "3s", amp: 12 },
                  { color: "rgba(255,0,100,0.3)", dur: "4s", amp: 8 },
                  { color: "rgba(0,100,255,0.3)", dur: "5s", amp: 15 },
                  { color: "rgba(0,255,200,0.2)", dur: "7s", amp: 6 },
                ].map((wave, i) => {
                  const points: string[] = [];
                  for (let x = 0; x <= 480; x += 4) {
                    const y = 30 + Math.sin((x / 480) * Math.PI * (3 + i) + i * 1.2) * wave.amp;
                    points.push(`${x},${y}`);
                  }
                  return (
                    <polyline
                      key={i}
                      points={points.join(" ")}
                      fill="none"
                      stroke={wave.color}
                      strokeWidth="1.5"
                    >
                      <animate
                        attributeName="points"
                        dur={wave.dur}
                        repeatCount="indefinite"
                        values={`${points.join(" ")};${points.map((p) => {
                          const [px, py] = p.split(",");
                          return `${px},${60 - parseFloat(py)}`;
                        }).join(" ")};${points.join(" ")}`}
                      />
                    </polyline>
                  );
                })}
              </svg>
            </div>

            {/* Mini Radar */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.4)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="110" height="110" viewBox="0 0 110 110">
                {/* Radar circles */}
                {[20, 35, 50].map((r) => (
                  <circle key={r} cx="55" cy="55" r={r} fill="none" stroke="rgba(0,255,200,0.1)" strokeWidth="0.5" />
                ))}
                {/* Cross lines */}
                <line x1="55" y1="5" x2="55" y2="105" stroke="rgba(0,255,200,0.06)" strokeWidth="0.5" />
                <line x1="5" y1="55" x2="105" y2="55" stroke="rgba(0,255,200,0.06)" strokeWidth="0.5" />
                {/* Sweep line */}
                <line
                  x1="55"
                  y1="55"
                  x2="55"
                  y2="5"
                  stroke="rgba(0,255,200,0.6)"
                  strokeWidth="1.5"
                  style={{
                    transformOrigin: "55px 55px",
                    animation: "cc-radar-sweep 4s linear infinite",
                  }}
                />
                {/* Random blips */}
                {[
                  { cx: 35, cy: 30 },
                  { cx: 70, cy: 45 },
                  { cx: 50, cy: 75 },
                  { cx: 80, cy: 70 },
                  { cx: 25, cy: 60 },
                ].map((b, i) => (
                  <circle key={i} cx={b.cx} cy={b.cy} r="2" fill="#00ffc8" opacity={0.5 + Math.random() * 0.3}>
                    <animate attributeName="opacity" values="0.2;0.8;0.2" dur={`${2 + i * 0.5}s`} repeatCount="indefinite" />
                  </circle>
                ))}
              </svg>
            </div>
          </div>

          {/* ── 3 PANELS ────────────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
              marginBottom: 40,
            }}
          >
            {/* Mission Pipeline */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.5)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 12 }}>
                MISSION PIPELINE
              </div>
              {pipeline.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: i < pipeline.length - 1 ? "1px solid rgba(0,255,200,0.05)" : "none",
                    fontSize: 11,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: statusDot(p.status),
                      boxShadow: `0 0 6px ${statusDot(p.status)}`,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, color: "#a0ffe0" }}>{p.name}</span>
                  <span style={{ color: "rgba(160,255,224,0.4)", fontSize: 9, letterSpacing: 1 }}>{p.phase.toUpperCase()}</span>
                </div>
              ))}
            </div>

            {/* Systems Array */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.5)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 12 }}>
                SYSTEMS ARRAY
              </div>
              {systems.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: i < systems.length - 1 ? "1px solid rgba(0,255,200,0.05)" : "none",
                    fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1, color: "#a0ffe0" }}>{s.name}</span>
                  <span
                    style={{
                      fontSize: 9,
                      color: s.status === "ONLINE" ? "#00ff88" : s.status === "STANDBY" ? "#ffaa00" : "#0064ff",
                      letterSpacing: 1,
                    }}
                  >
                    {s.status}
                  </span>
                  <div style={{ width: 40, height: 3, background: "rgba(0,255,200,0.1)", borderRadius: 2, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${s.load}%`,
                        height: "100%",
                        background: s.load > 90 ? "#00ff88" : s.load > 60 ? "#00ffc8" : "#0064ff",
                        borderRadius: 2,
                        transition: "width 1s",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Threat Monitor */}
            <div
              style={{
                background: "rgba(0, 20, 40, 0.5)",
                border: "1px solid rgba(0, 255, 200, 0.1)",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 12 }}>
                THREAT MONITOR
              </div>
              {threats.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: i < threats.length - 1 ? "1px solid rgba(0,255,200,0.05)" : "none",
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: severityColor(t.severity),
                      minWidth: 30,
                      letterSpacing: 1,
                    }}
                  >
                    {t.severity}
                  </span>
                  <span style={{ fontWeight: 700, color: "#a0ffe0", minWidth: 70 }}>{t.vector}</span>
                  <span style={{ color: "rgba(160,255,224,0.4)", fontSize: 10, flex: 1 }}>{t.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── LIVE TERMINAL LOG ────────────────────────────────────────── */}
          <div
            style={{
              background: "rgba(0, 10, 20, 0.8)",
              border: "1px solid rgba(0, 255, 200, 0.1)",
              borderRadius: 8,
              padding: 16,
              marginBottom: 40,
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(160,255,224,0.4)", marginBottom: 8 }}>
              LIVE TERMINAL
            </div>
            <div
              ref={terminalRef}
              style={{
                height: 200,
                overflowY: "auto",
                fontSize: 11,
                lineHeight: 1.8,
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(0,255,200,0.2) transparent",
              }}
            >
              {logLines.map((line, i) => (
                <div key={i}>
                  <span style={{ color: "rgba(160,255,224,0.3)" }}>{line.ts} </span>
                  <span style={{ color: line.color, fontWeight: 700 }}>{line.tag} </span>
                  <span style={{ color: "#a0ffe0" }}>{line.msg}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── FOOTER ──────────────────────────────────────────────────── */}
          <footer style={{ textAlign: "center", paddingBottom: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "rgba(160,255,224,0.3)", marginBottom: 4 }}>
              GEORGE YACHTS BROKERAGE HOUSE LLC
            </div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(160,255,224,0.2)", marginBottom: 4 }}>
              AES-256 QUANTUM ENCRYPTED
            </div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(160,255,224,0.15)" }}>
              37.8034N 23.7644E
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}
