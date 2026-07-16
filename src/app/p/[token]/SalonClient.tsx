"use client";

// The Private Salon — MAGAZINE edition (2026-07-16, George's direction after
// seeing v1: white ground like the supplier brochures and Vogue, gold + navy
// lettering, a real COVER, and page-TURNS instead of one long scroll —
// "scroll down κάνουν όλοι"). Structure: cover → George's letter (+video) →
// the selection → one spread per yacht (distinctions lead when present: an
// awarded chef beats a paddleboard) → George's weeks → the closing page.
// Arrows, keyboard and swipe turn the pages with a quiet 3D curl
// (reduced-motion falls back to a fade). Every page scrolls vertically
// inside itself when taller than the screen (phones).

import { useCallback, useEffect, useRef, useState } from "react";

export type SalonYachtView = {
  name: string;
  tier: string | null;
  spec: string | null;
  voyage: string | null;
  dateNote: string | null;
  main: string | null;
  gallery: string[];
  brochure: string | null;
  description: string | null;
  insideInfo: string | null;
  crewLine: string | null;
  money: {
    discountNote: string | null;
    rows: [string, string][];
    allIn: string | null;
    allInclusive: boolean;
    headline: string | null;
    perGuest4: string | null;
    perGuest6: string | null;
    periods: { label: string; dates: string; fee: string; note: string }[];
  };
  payableAtBase: { label: string; amount: string }[];
  deposit: string | null;
  freeOnboard: string[];
  highlights: string[];
  waterToys: string[];
  accommodation: [string, string][];
  distinctions: string[];
  testimonials: string[];
};

export type SalonView = {
  token: string;
  clientName: string | null;
  coverLine: string | null;
  period: string | null;
  guests: string | null;
  area: string | null;
  editionName: string | null;
  introParas: string[];
  video: { kind: "iframe" | "video"; src: string } | null;
  yachts: SalonYachtView[];
  weeks: { title: string; days: { leg: string; note: string }[] }[];
  crewNote: string | null;
  hasPdf: boolean;
};

const INK = "#17263A";
const INK_DIM = "rgba(23,38,58,0.68)";
const INK_FAINT = "rgba(23,38,58,0.42)";
const GOLD = "#A8873B";
const PAPER = "#FBFAF6";
const HAIR = "1px solid rgba(23,38,58,0.14)";
const GOLD_HAIR = "1px solid rgba(168,135,59,0.4)";
const WA = "https://api.whatsapp.com/send/?phone=17867988798&text=";

export default function SalonClient({ view }: { view: SalonView }) {
  const sentView = useRef(false);
  const [interested, setInterested] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [turning, setTurning] = useState<"next" | "prev" | null>(null);
  const touchX = useRef<number | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  function beacon(t: string, y?: string) {
    try {
      fetch(`/p/${view.token}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t, ...(y ? { y } : {}) }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* signal only */ }
  }

  useEffect(() => {
    if (sentView.current) return;
    sentView.current = true;
    beacon("view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- page plan: cover, letter, glance?, yachts…, weeks…, closing ----
  const hasGlance = view.yachts.length >= 3;
  const pages: { kind: string; idx?: number }[] = [
    { kind: "cover" },
    { kind: "letter" },
    ...(hasGlance ? [{ kind: "glance" }] : []),
    ...view.yachts.map((_, i) => ({ kind: "yacht", idx: i })),
    ...view.weeks.map((_, i) => ({ kind: "week", idx: i })),
    { kind: "closing" },
  ];
  const last = pages.length - 1;

  const go = useCallback((dir: 1 | -1) => {
    setPage((p) => {
      const n = Math.min(last, Math.max(0, p + dir));
      if (n !== p) {
        setTurning(dir === 1 ? "next" : "prev");
        setTimeout(() => setTurning(null), 620);
        if (pageRef.current) pageRef.current.scrollTop = 0;
      }
      return n;
    });
  }, [last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lightbox) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, lightbox]);

  function markInterest(name: string) {
    if (!interested[name]) beacon("yacht", name);
    setInterested((p) => ({ ...p, [name]: true }));
  }

  // ---- shared styles ----
  const label: React.CSSProperties = {
    fontFamily: "var(--salon-ui)", fontSize: 10, letterSpacing: "0.34em",
    textTransform: "uppercase", color: GOLD, fontWeight: 600,
  };
  const serifBody: React.CSSProperties = {
    fontFamily: "var(--salon-serif)", fontSize: 19, lineHeight: 1.66, color: INK_DIM,
  };
  const goldBtn: React.CSSProperties = {
    display: "inline-block", fontFamily: "var(--salon-ui)", fontSize: 11,
    letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600,
    color: "#FFF", background: INK, padding: "15px 26px", textDecoration: "none",
    border: `1px solid ${INK}`, cursor: "pointer",
  };
  const ghostBtn: React.CSSProperties = {
    ...goldBtn, color: GOLD, background: "transparent", border: GOLD_HAIR,
  };
  const col: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "56px 22px 110px" };

  // ---- page renderers ----
  function renderCover() {
    const photo = view.yachts.find((y) => y.main)?.main ?? null;
    return (
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ textAlign: "center", padding: "44px 20px 26px", background: PAPER }}>
          <p style={{ ...label, fontSize: 11, letterSpacing: "0.5em", color: INK }}>GEORGE YACHTS</p>
          <div style={{ width: 54, height: 1, background: GOLD, margin: "18px auto" }} />
          <p style={{ ...label, fontSize: 9 }}>{view.period || "A private charter publication"}</p>
        </div>
        {photo && (
          <div style={{ flex: 1, minHeight: "38vh", backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        )}
        <div style={{ textAlign: "center", padding: "36px 22px 120px", background: PAPER }}>
          {view.editionName && (
            <p style={{
              fontFamily: "var(--salon-display)", fontWeight: 700, color: GOLD,
              fontSize: "clamp(30px, 6.4vw, 52px)", letterSpacing: "0.12em", margin: "0 0 14px",
              textWrap: "balance",
            }}>{view.editionName}</p>
          )}
          <p style={{
            fontFamily: "var(--salon-display)", fontWeight: 400, color: INK,
            fontSize: "clamp(15px, 3vw, 20px)", letterSpacing: "0.14em", margin: "0 0 16px",
          }}>
            {view.clientName ? `Personally curated for ${view.clientName}` : "A personally curated selection"}
          </p>
          {view.coverLine && (
            <p style={{ ...label, color: INK_DIM, letterSpacing: "0.2em", lineHeight: 2 }}>{view.coverLine}</p>
          )}
          <p style={{ ...label, fontSize: 8.5, color: INK_FAINT, marginTop: 26 }}>
            Confidential · prepared solely for the named recipient
          </p>
        </div>
      </div>
    );
  }

  function renderLetter() {
    return (
      <div style={col}>
        <p style={{ ...label, marginBottom: 22 }}>A note from your broker</p>
        {view.video && (
          <div style={{ position: "relative", paddingTop: "56.25%", border: HAIR, marginBottom: 30, background: "#0b1420" }}>
            {view.video.kind === "iframe" ? (
              <iframe src={view.video.src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
            ) : (
              <video src={view.video.src} controls playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            )}
          </div>
        )}
        {view.introParas.map((p, i) => (
          <p key={i} style={{ ...serifBody, margin: "0 0 16px" }}>{p}</p>
        ))}
        <p style={{ fontFamily: "var(--salon-serif)", fontSize: 23, color: GOLD, margin: "28px 0 2px" }}>George Biniaris</p>
        <p style={{ ...label, fontSize: 8.5, color: INK_FAINT }}>Managing Broker · George Yachts Brokerage House LLC</p>
      </div>
    );
  }

  function renderGlance() {
    return (
      <div style={col}>
        <p style={{ ...label, marginBottom: 6 }}>In this edition</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.08em", margin: "0 0 24px" }}>
          The selection at a glance
        </h2>
        <div style={{ borderTop: GOLD_HAIR }}>
          {view.yachts.map((y, i) => (
            <button key={y.name} type="button"
              onClick={() => { setPage(pages.findIndex((p) => p.kind === "yacht" && p.idx === i)); if (pageRef.current) pageRef.current.scrollTop = 0; }}
              style={{
                display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 14,
                padding: "16px 4px", background: "none", border: "none", borderBottom: HAIR, cursor: "pointer", textAlign: "left",
              }}>
              <span style={{ fontFamily: "var(--salon-serif)", fontSize: 21, color: INK }}>
                {y.name}
                {y.tier && <span style={{ ...label, fontSize: 8.5, marginLeft: 10 }}>{y.tier}</span>}
              </span>
              <span style={{ fontFamily: "var(--salon-ui)", fontSize: 13, color: GOLD, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {y.money.allIn ? `${y.money.allIn} all-in` : y.money.headline || ""}
              </span>
            </button>
          ))}
        </div>
        <p style={{ ...label, fontSize: 8.5, color: INK_FAINT, marginTop: 22 }}>Turn the page, or tap a name</p>
      </div>
    );
  }

  function renderYacht(y: SalonYachtView, i: number) {
    return (
      <div style={{ ...col, paddingTop: 40 }}>
        {y.tier && <p style={{ ...label, textAlign: "center", marginBottom: 10 }}>{y.tier}</p>}
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(28px, 5.4vw, 40px)", letterSpacing: "0.1em", margin: "0 0 8px" }}>
          {y.name}
        </h2>
        {y.spec && <p style={{ ...label, color: INK_DIM, textAlign: "center", letterSpacing: "0.22em", marginBottom: 4 }}>{y.spec}</p>}
        {y.voyage && <p style={{ ...label, fontSize: 9, textAlign: "center", marginBottom: 20 }}>{y.voyage}</p>}

        {/* protagonist: distinctions lead when the yacht has them */}
        {y.distinctions.length > 0 && (
          <div style={{ border: GOLD_HAIR, padding: "18px 20px", margin: "0 0 20px", textAlign: "center", background: "rgba(168,135,59,0.05)" }}>
            <p style={{ ...label, fontSize: 8.5, marginBottom: 10 }}>Distinctions</p>
            {y.distinctions.map((d, k) => (
              <p key={k} style={{ fontFamily: "var(--salon-serif)", fontSize: 18.5, color: INK, margin: "0 0 6px", lineHeight: 1.5 }}>{d}</p>
            ))}
          </div>
        )}

        {y.main && (
          <img src={y.main} alt={y.name} onClick={() => setLightbox(y.main)}
            style={{ width: "100%", maxHeight: 440, objectFit: "cover", display: "block", cursor: "zoom-in" }} />
        )}
        {y.gallery.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, Math.max(2, y.gallery.length))}, 1fr)`, gap: 6, marginTop: 6 }}>
            {y.gallery.map((g) => (
              <img key={g} src={g} alt="" onClick={() => setLightbox(g)}
                style={{ width: "100%", height: 96, objectFit: "cover", cursor: "zoom-in" }} />
            ))}
          </div>
        )}

        {(y.description || y.insideInfo) && (
          <div style={{ marginTop: 26 }}>
            {y.description && <p style={{ ...serifBody, margin: "0 0 12px" }}>{y.description}</p>}
            {y.insideInfo && (
              <div style={{ borderLeft: `2px solid ${GOLD}`, padding: "4px 0 4px 18px", margin: "18px 0 0" }}>
                <p style={{ ...label, fontSize: 8.5, marginBottom: 8 }}>George&apos;s Inside Info</p>
                <p style={{ ...serifBody, fontStyle: "italic", margin: 0 }}>{y.insideInfo}</p>
              </div>
            )}
          </div>
        )}

        {y.testimonials.length > 0 && (
          <div style={{ margin: "26px 0 0", textAlign: "center" }}>
            {y.testimonials.map((t, k) => (
              <p key={k} style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 19, color: INK_DIM, lineHeight: 1.6, margin: "0 0 10px" }}>
                &ldquo;{t.replace(/^"|"$/g, "")}&rdquo;
              </p>
            ))}
            <p style={{ ...label, fontSize: 8, color: INK_FAINT }}>From the yacht&apos;s guest book</p>
          </div>
        )}

        {y.crewLine && (
          <p style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, marginTop: 22, lineHeight: 1.7 }}>
            <span style={{ ...label, fontSize: 8.5, marginRight: 10 }}>Crew</span>{y.crewLine}
            <span style={{ display: "block", fontSize: 10.5, color: INK_FAINT, marginTop: 3 }}>
              Crew composition is indicative and remains subject to the owner&apos;s final confirmation.
            </span>
          </p>
        )}
        {y.dateNote && (
          <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: INK_DIM, marginTop: 14 }}>{y.dateNote}</p>
        )}

        {y.accommodation.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p style={{ ...label, fontSize: 8.5, marginBottom: 10 }}>Accommodation</p>
            {y.accommodation.map(([cab, det], k) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: HAIR, fontFamily: "var(--salon-ui)", fontSize: 12.5 }}>
                <span style={{ color: INK }}>{cab}</span>
                <span style={{ color: INK_DIM, textAlign: "right" }}>{det}</span>
              </div>
            ))}
          </div>
        )}
        {y.waterToys.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <p style={{ ...label, fontSize: 8.5, marginBottom: 10 }}>Water toys on board</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {y.waterToys.map((t, k) => (
                <span key={k} style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: INK_DIM, border: GOLD_HAIR, borderRadius: 999, padding: "5px 12px" }}>{t}</span>
              ))}
            </div>
          </div>
        )}
        {y.highlights.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <p style={{ ...label, fontSize: 8.5, marginBottom: 10 }}>Highlights</p>
            {y.highlights.map((h, k) => (
              <p key={k} style={{ fontFamily: "var(--salon-serif)", fontSize: 16.5, color: INK_DIM, margin: "0 0 7px", lineHeight: 1.55 }}>
                <span style={{ color: GOLD, marginRight: 10 }}>◆</span>{h}
              </p>
            ))}
          </div>
        )}

        {/* money box */}
        <div style={{ border: GOLD_HAIR, padding: "22px 22px 18px", marginTop: 28, background: "#FFFFFF" }}>
          {y.money.discountNote && (
            <p style={{ fontFamily: "var(--salon-serif)", fontWeight: 600, fontSize: 17, color: GOLD, margin: "0 0 12px" }}>{y.money.discountNote}</p>
          )}
          {y.money.periods.length > 0 ? (
            <div>
              {y.money.periods.map((po, k) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: HAIR, fontFamily: "var(--salon-ui)", fontSize: 13.5 }}>
                  <span style={{ color: INK_DIM }}>{[po.label, po.dates].filter(Boolean).join(" · ")}{po.note ? ` — ${po.note}` : ""}</span>
                  <span style={{ color: INK, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{po.fee}</span>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {y.money.rows.map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontFamily: "var(--salon-ui)", fontSize: 13.5 }}>
                  <span style={{ color: INK_DIM }}>{k}</span>
                  <span style={{ color: INK, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {y.money.allIn && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 0 0", marginTop: 10, borderTop: `1px solid ${GOLD}` }}>
              <span style={label}>{y.money.allInclusive ? "All-inclusive" : "Estimated all-in"}</span>
              <span style={{ fontFamily: "var(--salon-serif)", fontSize: 25, color: INK, fontVariantNumeric: "tabular-nums" }}>{y.money.allIn}</span>
            </div>
          )}
          {(y.money.perGuest4 || y.money.perGuest6) && (
            <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11, color: INK_FAINT, margin: "8px 0 0", textAlign: "right" }}>
              {[y.money.perGuest4 ? `${y.money.perGuest4} per guest at 4` : "", y.money.perGuest6 ? `${y.money.perGuest6} at 6` : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          {(y.payableAtBase.length > 0 || y.deposit) && (
            <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: INK_DIM, margin: "12px 0 0", lineHeight: 1.7 }}>
              {y.payableAtBase.map((x) => `${x.label}: ${x.amount}`).join(" · ")}
              {y.payableAtBase.length > 0 && y.deposit ? " · " : ""}
              {y.deposit ? `Security deposit: ${y.deposit}` : ""}
              <span style={{ display: "block", color: INK_FAINT, fontSize: 10.5, marginTop: 2 }}>Payable at base — not part of the charter fee.</span>
            </p>
          )}
          {y.freeOnboard.length > 0 && (
            <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: INK_DIM, margin: "10px 0 0" }}>
              Complimentary on board: {y.freeOnboard.join(", ")}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={() => markInterest(y.name)}
            style={interested[y.name] ? { ...ghostBtn, opacity: 0.75, cursor: "default" } : goldBtn}>
            {interested[y.name] ? "George has been notified" : "This one interests us"}
          </button>
          {y.brochure && (
            <a href={y.brochure} target="_blank" rel="noopener noreferrer" style={ghostBtn}>Digital brochure</a>
          )}
        </div>
        {interested[y.name] && (
          <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: INK_DIM, marginTop: 12 }}>
            Noted — George will confirm availability personally and come back to you the same day.
          </p>
        )}
      </div>
    );
  }

  function renderWeek(wk: { title: string; days: { leg: string; note: string }[] }) {
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>A week like this</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
          {wk.title}
        </h2>
        <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 540, margin: "0 auto 26px" }}>
          A sample rhythm for the week, drawn from routes we actually run. Every day is adjusted on board around your pace, the wind and the water.
        </p>
        <div style={{ borderTop: GOLD_HAIR }}>
          {wk.days.map((x, k) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 14, padding: "14px 4px", borderBottom: HAIR }}>
              <span style={{ ...label, fontSize: 9, paddingTop: 6 }}>Day {k + 1}</span>
              <span>
                <span style={{ display: "block", fontFamily: "var(--salon-serif)", fontSize: 20, color: INK }}>{x.leg.replace(/\s*(?:->|→)\s*/g, " → ")}</span>
                {x.note && <span style={{ display: "block", fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, marginTop: 2, lineHeight: 1.6 }}>{x.note}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderClosing() {
    return (
      <div style={{ ...col, textAlign: "center", paddingTop: 90 }}>
        <p style={{ ...label, marginBottom: 18 }}>What happens next</p>
        <p style={{ ...serifBody, maxWidth: 540, margin: "0 auto 30px" }}>
          Reply with the one or two names that speak to you, and I will confirm availability with the owners the same day.
          Nothing is booked and nothing is owed until you decide.
        </p>
        {view.crewNote && <p style={{ ...serifBody, fontSize: 16, margin: "0 auto 30px", maxWidth: 540 }}>{view.crewNote}</p>}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href={`${WA}${encodeURIComponent("Hello George, we have looked through the proposal and would like to talk.")}`}
            target="_blank" rel="noopener noreferrer" style={goldBtn} onClick={() => beacon("wa")}>WhatsApp George</a>
          {view.hasPdf && (
            <a href={`/p/${view.token}/pdf`} style={ghostBtn} onClick={() => beacon("pdf")}>Download the proposal (PDF)</a>
          )}
        </div>
        <div style={{ width: 54, height: 1, background: GOLD, margin: "56px auto 22px" }} />
        <p style={{ ...label, fontSize: 9, color: INK_FAINT, lineHeight: 2.2 }}>
          Confidential · prepared solely for the named recipient<br />
          George Yachts Brokerage House LLC · WhatsApp +1 786 798 8798
        </p>
      </div>
    );
  }

  function renderPage(p: { kind: string; idx?: number }) {
    switch (p.kind) {
      case "cover": return renderCover();
      case "letter": return renderLetter();
      case "glance": return renderGlance();
      case "yacht": return renderYacht(view.yachts[p.idx!], p.idx!);
      case "week": return renderWeek(view.weeks[p.idx!]);
      default: return renderClosing();
    }
  }

  return (
    <main style={{ background: PAPER, height: "100dvh", color: INK, overflow: "hidden", position: "relative" }}>
      <style>{`
        @keyframes salonTurnNext { from { transform: perspective(2200px) rotateY(9deg) translateX(4%); opacity: 0.35; } to { transform: none; opacity: 1; } }
        @keyframes salonTurnPrev { from { transform: perspective(2200px) rotateY(-9deg) translateX(-4%); opacity: 0.35; } to { transform: none; opacity: 1; } }
        .salon-page { transform-origin: left center; }
        .salon-page.turn-next { animation: salonTurnNext 0.6s cubic-bezier(0.22, 0.7, 0.3, 1); }
        .salon-page.turn-prev { transform-origin: right center; animation: salonTurnPrev 0.6s cubic-bezier(0.22, 0.7, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) {
          .salon-page.turn-next, .salon-page.turn-prev { animation: none; }
        }
      `}</style>

      <div
        ref={pageRef}
        key={page}
        className={`salon-page${turning ? ` turn-${turning}` : ""}`}
        style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", background: PAPER, boxShadow: turning ? "0 0 60px rgba(23,38,58,0.18)" : "none" }}
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 64) go(dx < 0 ? 1 : -1);
        }}
      >
        {renderPage(pages[page])}
      </div>

      {/* pager chrome */}
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "center",
        alignItems: "center", gap: 22, padding: "12px 0 max(12px, env(safe-area-inset-bottom))",
        background: "linear-gradient(to top, rgba(251,250,246,0.96) 60%, rgba(251,250,246,0))",
        pointerEvents: "none",
      }}>
        <button type="button" onClick={() => go(-1)} disabled={page === 0} aria-label="Previous page"
          style={{ pointerEvents: "auto", background: "none", border: "none", cursor: page === 0 ? "default" : "pointer", color: page === 0 ? INK_FAINT : INK, fontSize: 26, lineHeight: 1, padding: "4px 14px" }}>‹</button>
        <span style={{ ...label, fontSize: 9.5, color: INK_DIM, letterSpacing: "0.3em" }}>
          {page + 1} / {pages.length}
        </span>
        <button type="button" onClick={() => go(1)} disabled={page === last} aria-label="Next page"
          style={{ pointerEvents: "auto", background: "none", border: "none", cursor: page === last ? "default" : "pointer", color: page === last ? INK_FAINT : INK, fontSize: 26, lineHeight: 1, padding: "4px 14px" }}>›</button>
      </div>

      {/* first-page hint */}
      {page === 0 && (
        <p style={{ position: "fixed", bottom: 54, left: 0, right: 0, textAlign: "center", ...label, fontSize: 8.5, color: INK_FAINT, pointerEvents: "none" }}>
          Turn the page ›
        </p>
      )}

      {/* lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(12,19,29,0.94)", display: "grid", placeItems: "center", cursor: "zoom-out", zIndex: 50, padding: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "92vh", objectFit: "contain" }} />
        </div>
      )}
    </main>
  );
}
