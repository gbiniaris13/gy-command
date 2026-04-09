"use client";
import { useEffect, useRef } from "react";

export default function AlienBackground() {
  const matrixRef = useRef<HTMLCanvasElement>(null);
  const particleRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const mc = matrixRef.current;
    if (!mc) return;
    const mx = mc.getContext("2d");
    if (!mx) return;

    const resize = () => {
      mc.width = window.innerWidth;
      mc.height = window.innerHeight;
      if (particleRef.current) {
        particleRef.current.width = window.innerWidth;
        particleRef.current.height = window.innerHeight;
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const chars = "ΓΥΘΩΣΔΛΞΠΦΨαβγδεζηθ01アイウエオ∞∑∂∆√";
    const cols = Math.floor(mc.width / 13);
    const drops: number[] = Array(cols).fill(0).map(() => (Math.random() * mc.height / 13) | 0);

    const drawMatrix = () => {
      mx.fillStyle = "rgba(1,8,16,.04)";
      mx.fillRect(0, 0, mc.width, mc.height);
      for (let i = 0; i < cols; i++) {
        const c = chars[(Math.random() * chars.length) | 0];
        const bright = Math.random() > 0.96;
        mx.fillStyle = bright ? "rgba(0,255,200,.6)" : "rgba(0,255,200,.25)";
        mx.font = `${11 + ((Math.random() * 3) | 0)}px monospace`;
        mx.fillText(c, i * 13, drops[i] * 13);
        if (drops[i] * 13 > mc.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      requestAnimationFrame(drawMatrix);
    };
    drawMatrix();

    const pc = particleRef.current;
    if (!pc) return;
    const px = pc.getContext("2d");
    if (!px) return;

    const pts: Array<{ x: number; y: number; vx: number; vy: number; r: number; ph: number; bright: boolean }> = [];
    for (let i = 0; i < 120; i++) {
      pts.push({
        x: Math.random() * pc.width, y: Math.random() * pc.height,
        vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 1.3 + 0.3, ph: Math.random() * 6.28, bright: Math.random() > 0.93,
      });
    }
    let tick = 0;
    const drawParticles = () => {
      tick += 0.008;
      px.clearRect(0, 0, pc.width, pc.height);
      pts.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > pc.width) p.vx *= -1;
        if (p.y < 0 || p.y > pc.height) p.vy *= -1;
        const a = p.bright ? 0.35 : 0.08 + Math.sin(tick * 2 + p.ph) * 0.05;
        px.beginPath(); px.arc(p.x, p.y, p.r, 0, 6.28);
        px.fillStyle = `rgba(0,255,200,${a})`; px.fill();
        if (p.bright) {
          px.beginPath(); px.arc(p.x, p.y, p.r * 3, 0, 6.28);
          px.fillStyle = "rgba(0,255,200,.02)"; px.fill();
        }
      });
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (d < 90) {
            px.beginPath(); px.moveTo(pts[i].x, pts[i].y); px.lineTo(pts[j].x, pts[j].y);
            px.strokeStyle = `rgba(0,255,200,${0.02 * (1 - d / 90)})`; px.lineWidth = 0.3; px.stroke();
          }
        }
      }
      requestAnimationFrame(drawParticles);
    };
    drawParticles();

    // Ambient hum
    const interval = setInterval(() => {
      try {
        const a = new AudioContext();
        const o = a.createOscillator();
        const g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = "sine"; o.frequency.value = 180 + Math.random() * 80;
        g.gain.setValueAtTime(0.006, a.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 1);
        o.start(); o.stop(a.currentTime + 1);
      } catch {}
    }, 10000);

    return () => { window.removeEventListener("resize", resize); clearInterval(interval); };
  }, []);

  return (
    <>
      <canvas ref={matrixRef} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", opacity: 0.1 }} />
      <canvas ref={particleRef} style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none", background: "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,255,200,.012) 1px, rgba(0,255,200,.012) 2px)", animation: "alienFlicker 10s infinite" }} />
      <div style={{ position: "fixed", left: 0, width: "100%", height: "1.5px", zIndex: 3, pointerEvents: "none", background: "linear-gradient(90deg, transparent, rgba(0,255,200,.7), transparent)", boxShadow: "0 0 30px 8px rgba(0,255,200,.1)", animation: "alienScan 5s linear infinite" }} />
      <div style={{ position: "fixed", left: 0, width: "100%", height: "1px", zIndex: 3, pointerEvents: "none", background: "linear-gradient(90deg, transparent, rgba(255,0,100,.3), transparent)", boxShadow: "0 0 20px 4px rgba(255,0,100,.05)", animation: "alienScan 7s linear infinite 2s" }} />
      {[15, 30, 50, 70, 85].map((pct) => (
        <div key={pct} style={{ position: "fixed", top: 0, left: `${pct}%`, height: "100%", width: "0.5px", zIndex: 1, pointerEvents: "none", background: "linear-gradient(180deg, transparent 10%, rgba(0,255,200,.04) 50%, transparent 90%)" }} />
      ))}
      <svg style={{ position: "fixed", top: 4, left: 4, zIndex: 4, pointerEvents: "none" }} width="24" height="24"><path d="M0 24V6L6 0H24" fill="none" stroke="rgba(0,255,200,.2)" strokeWidth="1" /></svg>
      <svg style={{ position: "fixed", top: 4, right: 4, zIndex: 4, pointerEvents: "none", transform: "scaleX(-1)" }} width="24" height="24"><path d="M0 24V6L6 0H24" fill="none" stroke="rgba(0,255,200,.2)" strokeWidth="1" /></svg>
      <svg style={{ position: "fixed", bottom: 4, left: 4, zIndex: 4, pointerEvents: "none", transform: "scaleY(-1)" }} width="24" height="24"><path d="M0 24V6L6 0H24" fill="none" stroke="rgba(0,255,200,.2)" strokeWidth="1" /></svg>
      <svg style={{ position: "fixed", bottom: 4, right: 4, zIndex: 4, pointerEvents: "none", transform: "scale(-1)" }} width="24" height="24"><path d="M0 24V6L6 0H24" fill="none" stroke="rgba(0,255,200,.2)" strokeWidth="1" /></svg>
      <div style={{ position: "fixed", top: 6, left: 30, zIndex: 5, fontSize: "6px", color: "rgba(0,255,200,.1)", letterSpacing: "1px", fontFamily: "monospace", pointerEvents: "none" }}>37.8034N 23.7644E</div>
      <div style={{ position: "fixed", top: 6, right: 30, zIndex: 5, fontSize: "6px", color: "rgba(0,255,200,.1)", letterSpacing: "1px", fontFamily: "monospace", pointerEvents: "none" }}>SESSION::GY-COMMAND</div>
    </>
  );
}
