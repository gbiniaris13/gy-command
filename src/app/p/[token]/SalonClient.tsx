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
const FORBES_URL = "https://www.forbes.com/sites/jacquesledbetter/2026/05/01/how-the-wealthy-are-hedging-for-instability/";
const GEORGE_PHOTO = "https://georgeyachts.com/images/george-syros-quay.jpg";
// George's ACTUAL logo - the gold-and-silver yacht-wave-and-hull mark
// (gy-logo-real.svg, same asset the Cabin header uses; 2026-05-22 lesson:
// the logo-full-*.svg files are simplified abstractions, never use them).
const GY_LOGO = "https://georgeyachts.com/images/gy-logo-real.svg";

export default function SalonClient({ view }: { view: SalonView }) {
  const sentView = useRef(false);
  const [interested, setInterested] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [turning, setTurning] = useState<"next" | "prev" | null>(null);
  // The leaf being turned over: during a turn the OLD page is rendered on top
  // and rotates away like a paper leaf, revealing the new page beneath.
  const [leaf, setLeaf] = useState<number | null>(null);
  const leafTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    { kind: "broker" },
    { kind: "house" },
    { kind: "closing" },
  ];
  const last = pages.length - 1;

  const go = useCallback((dir: 1 | -1) => {
    setPage((p) => {
      const n = Math.min(last, Math.max(0, p + dir));
      if (n !== p) {
        setLeaf(p);
        setTurning(dir === 1 ? "next" : "prev");
        if (leafTimer.current) clearTimeout(leafTimer.current);
        leafTimer.current = setTimeout(() => { setLeaf(null); setTurning(null); }, 930);
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
          <p style={{ ...label, fontSize: 11, letterSpacing: "0.42em", color: INK }}>GEORGE YACHTS BROKERAGE HOUSE</p>
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
          <p style={{ fontFamily: "var(--salon-ui)", fontSize: 10.5, color: INK_DIM, marginTop: 30, lineHeight: 1.9, letterSpacing: "0.06em" }}>
            Prepared by <b style={{ color: INK }}>George P. Biniaris</b>, Founder &amp; Managing Broker<br />
            IYBA Charter Active Member · <a href={FORBES_URL} target="_blank" rel="noopener noreferrer" style={{ color: GOLD, textDecoration: "none", borderBottom: `1px solid rgba(168,135,59,0.4)` }}>Featured in Forbes</a>
          </p>
          <p style={{ ...label, fontSize: 8.5, color: INK_FAINT, marginTop: 22 }}>
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
        <p style={{ fontFamily: "var(--salon-serif)", fontSize: 23, color: GOLD, margin: "28px 0 2px" }}>George P. Biniaris</p>
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
        {y.voyage && <p style={{ ...label, fontSize: 9, textAlign: "center", marginBottom: 8 }}>{y.voyage}</p>}
        {/* the price is never a mystery: headline figure up top, full
            breakdown in The Investment box below */}
        {(y.money.allIn || y.money.headline) && (
          <p style={{ textAlign: "center", margin: "0 0 20px" }}>
            <span style={{ fontFamily: "var(--salon-serif)", fontSize: 24, color: INK, fontVariantNumeric: "tabular-nums" }}>
              {y.money.allIn ?? y.money.headline}
            </span>
            <span style={{ ...label, fontSize: 8.5, display: "block", marginTop: 3, color: INK_FAINT }}>
              {y.money.allIn ? (y.money.allInclusive ? "all-inclusive · full breakdown below" : "estimated all-in · full breakdown below") : "charter fee · details below"}
            </span>
          </p>
        )}

        {/* protagonist: distinctions lead when the yacht has them */}
        {y.distinctions.length > 0 && (
          <div style={{ border: GOLD_HAIR, padding: "18px 20px", margin: "0 0 20px", textAlign: "center", background: "rgba(168,135,59,0.05)" }}>
            <p style={{ ...label, fontSize: 8.5, marginBottom: 10 }}>Distinctions</p>
            {y.distinctions.map((d, k) => (
              <p key={k} style={{ fontFamily: "var(--salon-serif)", fontSize: 18.5, color: INK, margin: "0 0 6px", lineHeight: 1.5 }}>{d}</p>
            ))}
          </div>
        )}

        <Carousel photos={[y.main, ...y.gallery].filter(Boolean) as string[]} alt={y.name} onZoom={setLightbox} />

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
          <p style={{ ...label, fontSize: 9, marginBottom: 14 }}>The investment · in full transparency</p>
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
        </div>
        {/* The PDF is the LAST resort by design (George: "αν πατήσουν
            download PDF, είναι αποτυχία") — a whisper, not a button. */}
        {view.hasPdf && (
          <p style={{ marginTop: 26 }}>
            <a href={`/p/${view.token}/pdf`} onClick={() => beacon("pdf")}
              style={{ fontFamily: "var(--salon-ui)", fontSize: 10.5, color: INK_FAINT, textDecoration: "none", borderBottom: `1px solid rgba(23,38,58,0.2)` }}>
              Prefer paper? Download the classic PDF
            </a>
          </p>
        )}
        <div style={{ width: 54, height: 1, background: GOLD, margin: "56px auto 22px" }} />
        <p style={{ ...label, fontSize: 9, color: INK_FAINT, lineHeight: 2.2 }}>
          Confidential · prepared solely for the named recipient<br />
          George Yachts Brokerage House LLC · WhatsApp +1 786 798 8798
        </p>
        {/* GHOST_ build credit — same attribution as every page of the site
            (Boss owns both entities; lead-gen channel for the agency). */}
        <p style={{ marginTop: 30 }}>
          <a href="https://ghostwebdesign.dev" target="_blank" rel="noopener noreferrer"
            style={{
              fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
              fontSize: 10.5, letterSpacing: "0.12em", color: GOLD, textDecoration: "none",
            }}>
            This edition was designed and built by <b style={{ letterSpacing: "0.22em" }}>GHOST_</b> · <i style={{ opacity: 0.9 }}>premium digital agency for the discerning few</i> ↗
          </a>
        </p>
      </div>
    );
  }

  // THE BROKER — approved site bio (about/george-p-biniaris), condensed.
  function renderBroker() {
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>The broker behind this edition</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(26px, 5vw, 36px)", letterSpacing: "0.1em", margin: "0 0 22px" }}>
          George P. Biniaris
        </h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={GEORGE_PHOTO} alt="George P. Biniaris on the quay in Syros, Cyclades" onClick={() => setLightbox(GEORGE_PHOTO)}
          style={{ width: "100%", maxHeight: 430, objectFit: "cover", objectPosition: "center 22%", display: "block", cursor: "zoom-in" }} />
        <p style={{ ...label, fontSize: 8, color: INK_FAINT, textAlign: "right", marginTop: 4 }}>On the quay in Syros, where his family is from</p>
        <div style={{ marginTop: 22 }}>
          <p style={{ ...serifBody, margin: "0 0 14px" }}>
            His connection to these waters is not professional first, it is ancestral. His mother is from Syros, the administrative heart
            of the Cyclades, and he grew up crossing the Aegean on his uncle&apos;s Ferretti, Athens to Syros to Mykonos, to wherever the
            islands called.
          </p>
          <p style={{ ...serifBody, margin: "0 0 14px" }}>
            A former captain: licensed skipper seasons out of Corfu and charter operations across the Ionian, the Cyclades and the
            Saronic. When he recommends an anchorage, it is because he has held a wheel there.
          </p>
          <p style={{ ...serifBody, margin: "0 0 14px" }}>
            Before yachting, a decade at the top of Mykonos hospitality, directing operations for a five-star hotel, a fine-dining
            restaurant and one of the island&apos;s great beach clubs, leading teams of over two hundred for an international, high-profile
            clientele.
          </p>
        </div>
        <div style={{ borderTop: GOLD_HAIR, marginTop: 24, paddingTop: 18 }}>
          {[
            "BSc Shipping Management & Operations, London Metropolitan University & Business College of Athens",
            "IYBA Charter Active Member · MYBA-standard practitioner",
          ].map((c, k) => (
            <p key={k} style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, margin: "0 0 8px", lineHeight: 1.6 }}>
              <span style={{ color: GOLD, marginRight: 10 }}>◆</span>{c}
            </p>
          ))}
          <p style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, margin: "0 0 8px", lineHeight: 1.6 }}>
            <span style={{ color: GOLD, marginRight: 10 }}>◆</span>
            <a href={FORBES_URL} target="_blank" rel="noopener noreferrer" style={{ color: INK, textDecoration: "none", borderBottom: GOLD_HAIR }}>
              Featured in Forbes, May 2026
            </a>
          </p>
        </div>
      </div>
    );
  }

  // THE HOUSE — the company page: logo, and the romance George asked for
  // (boutique, white glove, before/during/after, "your guy in Greece",
  // filotimo). Built on the approved about-us copy, never invented facts.
  function renderHouse() {
    return (
      <div style={{ ...col, textAlign: "center", paddingTop: 70 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={GY_LOGO} alt="George Yachts Brokerage House" style={{ height: 74, margin: "0 auto 22px", display: "block" }} />
        <div style={{ width: 54, height: 1, background: GOLD, margin: "0 auto 30px" }} />
        <p style={{ ...serifBody, maxWidth: 560, margin: "0 auto 16px", textAlign: "left" }}>
          George Yachts Brokerage House is a boutique American brokerage, headquartered in Wyoming, USA, and operated from Athens,
          with an office in Kifisia and boots on the ground in Greek waters all season long. Small on purpose: few clients, whole
          attention, excellence as the only acceptable standard.
        </p>
        <p style={{ ...serifBody, maxWidth: 560, margin: "0 auto 16px", textAlign: "left" }}>
          White glove, to us, is not a slogan; it is a calendar. We are there long before you step aboard, shaping the week around
          the people you love. We are on the quay at your check-in. We are a message away every day you are on the water. And we are
          still here after your check-out, because by then you are no longer a booking, you are a relationship.
        </p>
        <p style={{ ...serifBody, maxWidth: 560, margin: "0 auto 16px", textAlign: "left" }}>
          Our clients describe it simply: <i>our guy in Greece</i>. A team that came from the water and from five-star floors, a fleet
          where every yacht has been personally vetted, and every request answered by the Managing Broker himself, through the full
          MYBA charter cycle, from the first proposal to the captain&apos;s briefing.
        </p>
        <p style={{ ...serifBody, maxWidth: 560, margin: "0 auto", textAlign: "left" }}>
          Above all we are guided by one Greek word that does not translate, <i>filotimo</i>: the quiet duty to treat every guest with
          honour, to give more than was asked, and to do right by them, always.
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
      case "broker": return renderBroker();
      case "house": return renderHouse();
      default: return renderClosing();
    }
  }

  return (
    <main style={{ background: PAPER, height: "100dvh", color: INK, overflow: "hidden", position: "relative" }}>
      <style>{`
        /* A paper leaf turning over a book, WITH the bend of a real page under
           a thumb: the leaf rotates around the spine while an inner FOLD
           layer lags a further ~26 degrees mid-flight (nested rotations =
           visible curvature), and a band of light rolls across the paper. */
        @keyframes salonLeafNext {
          0%   { transform: rotateY(0deg); box-shadow: 34px 0 80px rgba(23,38,58,0.3); }
          100% { transform: rotateY(-102deg); box-shadow: 6px 0 14px rgba(23,38,58,0.08); }
        }
        @keyframes salonLeafPrev {
          0%   { transform: rotateY(0deg); box-shadow: -34px 0 80px rgba(23,38,58,0.3); }
          100% { transform: rotateY(102deg); box-shadow: -6px 0 14px rgba(23,38,58,0.08); }
        }
        @keyframes salonFoldNext {
          0%   { transform: rotateY(0deg); }
          38%  { transform: rotateY(-26deg); }
          72%  { transform: rotateY(-14deg); }
          100% { transform: rotateY(-4deg); }
        }
        @keyframes salonFoldPrev {
          0%   { transform: rotateY(0deg); }
          38%  { transform: rotateY(26deg); }
          72%  { transform: rotateY(14deg); }
          100% { transform: rotateY(4deg); }
        }
        @keyframes salonCurlNext {
          0%   { opacity: 0; background-position: 120% 0; }
          40%  { opacity: 1; }
          100% { opacity: 0; background-position: -40% 0; }
        }
        @keyframes salonCurlPrev {
          0%   { opacity: 0; background-position: -40% 0; }
          40%  { opacity: 1; }
          100% { opacity: 0; background-position: 120% 0; }
        }
        @keyframes salonUnderK { from { opacity: 0.82; } to { opacity: 1; } }
        .salon-stage { position: absolute; inset: 0; perspective: 1500px; z-index: 5; pointer-events: none; }
        .salon-leaf { position: absolute; inset: 0; background: ${PAPER}; overflow: hidden; will-change: transform; transform-style: preserve-3d; }
        .salon-leaf.next { transform-origin: left center; animation: salonLeafNext 0.9s cubic-bezier(0.34, 0.1, 0.14, 1) forwards; }
        .salon-leaf.prev { transform-origin: right center; animation: salonLeafPrev 0.9s cubic-bezier(0.34, 0.1, 0.14, 1) forwards; }
        .salon-fold { height: 100%; will-change: transform; }
        .salon-leaf.next .salon-fold { transform-origin: left center; animation: salonFoldNext 0.9s cubic-bezier(0.34, 0.1, 0.14, 1) forwards; }
        .salon-leaf.prev .salon-fold { transform-origin: right center; animation: salonFoldPrev 0.9s cubic-bezier(0.34, 0.1, 0.14, 1) forwards; }
        .salon-leaf::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 2;
          background: linear-gradient(100deg, rgba(23,38,58,0) 30%, rgba(23,38,58,0.10) 46%, rgba(255,255,255,0.55) 52%, rgba(23,38,58,0.14) 60%, rgba(23,38,58,0) 76%);
          background-size: 220% 100%; }
        .salon-leaf.next::after { animation: salonCurlNext 0.9s ease forwards; }
        .salon-leaf.prev::after { animation: salonCurlPrev 0.9s ease forwards; }
        @media (prefers-reduced-motion: reduce) {
          .salon-leaf.next, .salon-leaf.prev, .salon-fold, .salon-leaf.next::after, .salon-leaf.prev::after { animation-duration: 0.01s !important; }
        }
        .salon-under { animation: salonUnderK 0.9s ease; }
        @media (prefers-reduced-motion: reduce) {
          .salon-leaf.next, .salon-leaf.prev, .salon-leaf.next::after, .salon-leaf.prev::after { animation-duration: 0.01s; }
          .salon-under { animation: none; }
        }
      `}</style>

      <div
        ref={pageRef}
        key={page}
        className={leaf !== null ? "salon-under" : undefined}
        style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", background: PAPER }}
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

      {/* the leaf being turned (the previous page, rotating away) */}
      {leaf !== null && turning && (
        <div className="salon-stage" aria-hidden>
          <div className={`salon-leaf ${turning}`}>
            <div className="salon-fold">
              <div style={{ height: "100%", overflow: "hidden" }}>{renderPage(pages[leaf])}</div>
            </div>
          </div>
        </div>
      )}

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

// ─── Photo carousel: one big frame, arrows, swipe, counter, tap to zoom.
// George's spec: "να σκρολάρει τις φωτογραφίες με βελάκια και να του βάζω
// όσες θέλω" — up to 24 per yacht from the panel. Its own touch handlers
// stop propagation so swiping photos never turns the magazine page.
function Carousel({ photos, alt, onZoom }: { photos: string[]; alt: string; onZoom: (u: string) => void }) {
  const [i, setI] = useState(0);
  const tx = useRef<number | null>(null);
  if (!photos.length) return null;
  const go = (d: number) => setI((p) => (p + d + photos.length) % photos.length);
  const arrow = (side: "left" | "right"): React.CSSProperties => ({
    position: "absolute", top: "50%", [side]: 10, transform: "translateY(-50%)",
    width: 42, height: 42, borderRadius: "50%", border: "none", cursor: "pointer",
    background: "rgba(251,250,246,0.88)", color: INK, fontSize: 24, lineHeight: 1,
    display: "grid", placeItems: "center", boxShadow: "0 1px 8px rgba(23,38,58,0.22)",
  });
  return (
    <div
      style={{ position: "relative", userSelect: "none" }}
      onTouchStart={(e) => { tx.current = e.touches[0].clientX; e.stopPropagation(); }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        if (tx.current === null) return;
        const dx = e.changedTouches[0].clientX - tx.current;
        tx.current = null;
        if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[i]} alt={alt} onClick={() => onZoom(photos[i])}
        style={{ width: "100%", height: "min(52vh, 460px)", objectFit: "cover", display: "block", cursor: "zoom-in", background: "#EDEAE2" }} />
      {photos.length > 1 && (
        <>
          <button type="button" aria-label="Previous photo" style={arrow("left")}
            onClick={(e) => { e.stopPropagation(); go(-1); }}>‹</button>
          <button type="button" aria-label="Next photo" style={arrow("right")}
            onClick={(e) => { e.stopPropagation(); go(1); }}>›</button>
          <span style={{
            position: "absolute", right: 12, bottom: 10, fontFamily: "var(--salon-ui)",
            fontSize: 10, letterSpacing: "0.2em", color: "#FFF", background: "rgba(23,38,58,0.55)",
            padding: "4px 10px", borderRadius: 999,
          }}>{i + 1} / {photos.length}</span>
        </>
      )}
    </div>
  );
}
