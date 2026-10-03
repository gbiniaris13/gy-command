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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
    allInAround: string | null;
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
  availabilityLine: string | null;
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
  weeks: { title: string; days: { leg: string; note: string }[]; chart: WeekChart | null }[];
  crewNote: string | null;
  hasPdf: boolean;
  /** "No. 41 · October 2026" on the cover. */
  issueLine: string | null;
  /** After the yes: the same link is "The <Surname> Week". */
  week: SalonWeekView | null;
};

export type WeekChart = {
  w: number;
  h: number;
  points: { x: number; y: number; label: string; day: number }[];
  path: string;
  scale: { x1: number; x2: number; y: number; label: string };
};

export type SalonWeekView = {
  vessel: string;
  from: string | null;
  to: string | null;
  fromLong: string | null;
  toLong: string | null;
  portEmbarkation: string | null;
  portDisembarkation: string | null;
  berth: string | null;
  crew: { role: string; years: number | null }[];
  menu: { title: string | null; tagline: string | null; sections: { name: string; items: string[] }[] } | null;
  yachtIndex: number | null;
  cabin: { id: string; percent: number; submitted: boolean; pending: string[]; guestsOnManifest: number; partySize: number | null } | null;
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
  const [holdAsked, setHoldAsked] = useState<Record<string, boolean>>({});
  // How long the reader stayed on each yacht (George, 2 October 2026: "the
  // broker who knows they stared at Aphaea three times calls about Aphaea").
  const dwell = useRef<{ yacht: string | null; since: number }>({ yacht: null, since: Date.now() });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [turning, setTurning] = useState<"next" | "prev" | null>(null);
  // The leaf being turned over: during a turn the OLD page is rendered on top
  // and rotates away like a paper leaf, revealing the new page beneath.
  const [leaf, setLeaf] = useState<number | null>(null);
  const leafTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchX = useRef<number | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  // 2026-07-23 George: "ο πελάτης δεν ξέρει ότι μπορεί να κάνει scroll down" —
  // on pages taller than the screen (every yacht spread), show a quiet gold
  // scroll cue until the reader scrolls. Measured per page, twice more after
  // mount so late-loading photos are counted; hidden the moment they scroll.
  const [pageScrolled, setPageScrolled] = useState(false);
  const [pageOverflows, setPageOverflows] = useState(false);

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

  // Scroll-cue lifecycle: reset + measure on every page turn, before paint so
  // a short page never flashes the cue. Re-measure after photos land.
  useLayoutEffect(() => {
    setPageScrolled(false);
    const measure = () => {
      const el = pageRef.current;
      if (el) setPageOverflows(el.scrollHeight > el.clientHeight + 32);
    };
    measure();
    const t1 = setTimeout(measure, 450);
    const t2 = setTimeout(measure, 1400);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", measure);
    };
  }, [page]);

  // ---- page plan: cover, letter, glance?, yachts…, weeks…, closing ----
  // After the yes the same link is the client's own week (George, 2 October
  // 2026): the booked yacht, her crew by role, the route we are planning, a
  // taste of the galley, what to know before boarding.
  const wk = view.week;
  const weekYachtIdx = wk ? (wk.yachtIndex ?? 0) : null;
  const hasGlance = view.yachts.length >= 3;
  const pages: { kind: string; idx?: number }[] = wk
    ? [
        { kind: "cover" },
        { kind: "letter" },
        ...(view.yachts.length ? [{ kind: "yacht", idx: weekYachtIdx ?? 0 }] : []),
        ...view.weeks.map((_, i) => ({ kind: "week", idx: i })),
        ...(wk.crew.length ? [{ kind: "crew" }] : []),
        ...(wk.menu && wk.menu.sections.length ? [{ kind: "galley" }] : []),
        { kind: "board" },
        ...(wk.cabin ? [{ kind: "cabin" }] : []),
        { kind: "knowhow" },
        { kind: "broker" },
        { kind: "closing" },
      ]
    : [
        { kind: "cover" },
        { kind: "letter" },
        ...(hasGlance ? [{ kind: "glance" }] : []),
        ...view.yachts.map((_, i) => ({ kind: "yacht", idx: i })),
        ...view.weeks.map((_, i) => ({ kind: "week", idx: i })),
        // 2026-10-02, George: the client must know what APA and VAT are, that the
        // itineraries are samples the weather and the captain decide, that a crew
        // can change, and exactly what happens after the yes. Two quiet pages.
        { kind: "knowhow" },
        { kind: "after" },
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

  // Dwell: when the reader leaves a yacht page (or the tab), the seconds spent
  // there go to George. Eight seconds or more counts; a flick does not.
  const flushDwell = useCallback(() => {
    const d = dwell.current;
    const secs = Math.round((Date.now() - d.since) / 1000);
    if (d.yacht && secs >= 8) {
      try {
        fetch(`/p/${view.token}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ t: "dwell", y: d.yacht, s: Math.min(secs, 1800) }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* signal only */ }
    }
    dwell.current = { yacht: null, since: Date.now() };
  }, [view.token]);
  useEffect(() => {
    flushDwell();
    const p = pages[page];
    dwell.current = { yacht: p?.kind === "yacht" && p.idx !== undefined ? view.yachts[p.idx]?.name ?? null : null, since: Date.now() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flushDwell(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushDwell);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushDwell);
    };
  }, [flushDwell]);

  function markInterest(name: string) {
    if (!interested[name]) beacon("yacht", name);
    setInterested((p) => ({ ...p, [name]: true }));
  }
  function askHold(name: string) {
    if (!holdAsked[name]) beacon("hold", name);
    setHoldAsked((p) => ({ ...p, [name]: true }));
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
          <p style={{ ...label, fontSize: 9 }}>
            {wk ? "Your week, as it stands" : (view.period || "A private charter publication")}
            {view.issueLine ? ` · ${view.issueLine}` : ""}
          </p>
        </div>
        {(wk && weekYachtIdx !== null && view.yachts[weekYachtIdx]?.main ? (
          <div style={{ flex: 1, minHeight: "38vh", backgroundImage: `url(${view.yachts[weekYachtIdx].main})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        ) : photo ? (
          <div style={{ flex: 1, minHeight: "38vh", backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        ) : null)}
        <div style={{ textAlign: "center", padding: "36px 22px 120px", background: PAPER }}>
          {view.editionName && (
            <p style={{
              fontFamily: "var(--salon-display)", fontWeight: 700, color: GOLD,
              fontSize: "clamp(30px, 6.4vw, 52px)", letterSpacing: "0.12em", margin: "0 0 14px",
              textWrap: "balance",
            }}>{wk ? view.editionName.replace(/ Edition$/, " Week") : view.editionName}</p>
          )}
          <p style={{
            fontFamily: "var(--salon-display)", fontWeight: 400, color: INK,
            fontSize: "clamp(15px, 3vw, 20px)", letterSpacing: "0.14em", margin: "0 0 16px",
          }}>
            {wk
              ? (view.clientName ? `Personally prepared for ${view.clientName}` : "Your week, personally prepared")
              : (view.clientName ? `Personally curated for ${view.clientName}` : "A personally curated selection")}
          </p>
          {wk ? (
            <p style={{ ...label, color: INK_DIM, letterSpacing: "0.2em", lineHeight: 2 }}>
              {[wk.vessel, wk.fromLong && wk.toLong ? `${wk.fromLong} to ${wk.toLong}` : "", wk.portEmbarkation ? `from ${wk.portEmbarkation}` : ""].filter(Boolean).join(" · ")}
            </p>
          ) : view.coverLine && (
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
        {(wk ? weekLetter() : view.introParas).map((p, i) => (
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
        {/* 2026-10-02: a comparison, not a list. Cabins, guests, crew, where
            she starts and the all-in figure, side by side, so six yachts can
            be held in one glance. A tier label that repeats shows once. */}
        {(() => {
          const seenTier = new Set<string>();
          return (
            <div style={{ borderTop: GOLD_HAIR }}>
              {view.yachts.map((y, i) => {
                const f = glanceFacts(y);
                const tier = y.tier && !seenTier.has(y.tier.toLowerCase()) ? y.tier : null;
                if (y.tier) seenTier.add(y.tier.toLowerCase());
                return (
                  <button key={y.name} type="button"
                    onClick={() => { setPage(pages.findIndex((p) => p.kind === "yacht" && p.idx === i)); if (pageRef.current) pageRef.current.scrollTop = 0; }}
                    style={{
                      display: "flex", width: "100%", justifyContent: "space-between", alignItems: "flex-start", gap: 14,
                      padding: "16px 4px", background: "none", border: "none", borderBottom: HAIR, cursor: "pointer", textAlign: "left",
                    }}>
                    <span>
                      <span style={{ fontFamily: "var(--salon-serif)", fontSize: 21, color: INK }}>
                        {y.name}
                        {tier && <span style={{ ...label, fontSize: 8.5, marginLeft: 10 }}>{tier}</span>}
                      </span>
                      {f && (
                        <span style={{ display: "block", fontFamily: "var(--salon-ui)", fontSize: 11.5, color: INK_DIM, marginTop: 4, lineHeight: 1.6, letterSpacing: "0.04em" }}>{f}</span>
                      )}
                    </span>
                    <span style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: GOLD, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", paddingTop: 4 }}>
                      {y.money.allInAround ? `${y.money.allInAround} all in` : y.money.allIn ? `${y.money.allIn} all in` : y.money.headline || ""}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11, color: INK_FAINT, marginTop: 16, lineHeight: 1.7 }}>
          All-in figures include APA and VAT and exclude the crew gratuity. The exact breakdown is on each yacht&apos;s page.
        </p>
        <p style={{ ...label, fontSize: 8.5, color: INK_FAINT, marginTop: 14 }}>Turn the page, or tap a name</p>
      </div>
    );
  }

  function renderYacht(y: SalonYachtView, i: number) {
    const money = !wk;
    return (
      <div style={{ ...col, paddingTop: 40 }}>
        {wk ? <p style={{ ...label, textAlign: "center", marginBottom: 10 }}>Your yacht</p> : y.tier && <p style={{ ...label, textAlign: "center", marginBottom: 10 }}>{y.tier}</p>}
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(28px, 5.4vw, 40px)", letterSpacing: "0.1em", margin: "0 0 8px" }}>
          {y.name}
        </h2>
        {y.spec && <p style={{ ...label, color: INK_DIM, textAlign: "center", letterSpacing: "0.22em", marginBottom: 4 }}>{y.spec}</p>}
        {y.voyage && <p style={{ ...label, fontSize: 9, textAlign: "center", marginBottom: 8 }}>{y.voyage}</p>}
        {money && y.availabilityLine && (
          <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: INK_DIM, textAlign: "center", margin: "0 0 14px" }}>{y.availabilityLine}</p>
        )}
        {/* the price is never a mystery: headline figure up top, full
            breakdown in The Investment box below */}
        {money && (y.money.allIn || y.money.headline) && (
          <p style={{ textAlign: "center", margin: "0 0 20px" }}>
            <span style={{ fontFamily: "var(--salon-serif)", fontSize: 24, color: INK, fontVariantNumeric: "tabular-nums" }}>
              {y.money.allInAround ?? y.money.allIn ?? y.money.headline}
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
                {det && <span style={{ color: INK_DIM, textAlign: "right" }}>{det}</span>}
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
        {money && <div style={{ border: GOLD_HAIR, padding: "22px 22px 18px", marginTop: 28, background: "#FFFFFF" }}>
          <p style={{ ...label, fontSize: 9, marginBottom: 14 }}>The investment · in full transparency</p>
          {y.money.discountNote && (
            <p style={{ fontFamily: "var(--salon-serif)", fontWeight: 600, fontSize: 17, color: GOLD, margin: "0 0 12px" }}>{y.money.discountNote}</p>
          )}
          {y.money.periods.length > 0 ? (
            <div>
              {y.money.periods.map((po, k) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: HAIR, fontFamily: "var(--salon-ui)", fontSize: 13.5 }}>
                  <span style={{ color: INK_DIM }}>{[po.label, po.dates].filter(Boolean).join(" · ")}{po.note ? ` - ${po.note}` : ""}</span>
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
              <span style={label}>{y.money.allInclusive ? "All-inclusive" : "Estimated all in"}</span>
              <span style={{ textAlign: "right" }}>
                <span style={{ display: "block", fontFamily: "var(--salon-serif)", fontSize: 25, color: INK, fontVariantNumeric: "tabular-nums" }}>{y.money.allInAround ?? y.money.allIn}</span>
                {y.money.allInAround && (
                  <span style={{ display: "block", fontFamily: "var(--salon-ui)", fontSize: 10.5, color: INK_FAINT, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>exactly {y.money.allIn}</span>
                )}
              </span>
            </div>
          )}
          {/* 2026-10-02: the gratuity is said here, not discovered on the last
              day. Per-guest figures are gone: one price per yacht per week. */}
          <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11, color: INK_DIM, margin: "10px 0 0", lineHeight: 1.7 }}>
            Not included: a crew gratuity of 10 to 15 percent of the charter fee, customary at the end of the week and entirely at your discretion.
          </p>
          {(y.payableAtBase.length > 0 || y.deposit) && (
            <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: INK_DIM, margin: "12px 0 0", lineHeight: 1.7 }}>
              {y.payableAtBase.map((x) => `${x.label}: ${x.amount}`).join(" · ")}
              {y.payableAtBase.length > 0 && y.deposit ? " · " : ""}
              {y.deposit ? `Security deposit: ${y.deposit}` : ""}
              <span style={{ display: "block", color: INK_FAINT, fontSize: 10.5, marginTop: 2 }}>Payable at base, not part of the charter fee.</span>
            </p>
          )}
          {y.freeOnboard.length > 0 && (
            <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: INK_DIM, margin: "10px 0 0" }}>
              Complimentary on board: {y.freeOnboard.join(", ")}
            </p>
          )}
        </div>}

        {money && (
          <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => markInterest(y.name)}
              style={interested[y.name] ? { ...ghostBtn, opacity: 0.75, cursor: "default" } : goldBtn}>
              {interested[y.name] ? "George has been notified" : "This one interests us"}
            </button>
            {/* 2026-10-02: two more ways to say it, both land on George's desk
                with the yacht's name attached. The hold asks the owner; it is
                not a booking and nothing is owed. */}
            <button type="button" onClick={() => askHold(y.name)}
              style={holdAsked[y.name] ? { ...ghostBtn, opacity: 0.75, cursor: "default" } : ghostBtn}>
              {holdAsked[y.name] ? "Hold requested" : "Hold her dates for 48 hours"}
            </button>
            <a href={`${WA}${encodeURIComponent(`Hello George, a question about ${y.name}${view.editionName ? ` in ${view.editionName}` : ""}: `)}`}
              target="_blank" rel="noopener noreferrer" style={ghostBtn} onClick={() => beacon("wa", y.name)}>Ask George about her</a>
            {y.brochure && (
              <a href={y.brochure} target="_blank" rel="noopener noreferrer" style={ghostBtn}>Digital brochure</a>
            )}
          </div>
        )}
        {money && interested[y.name] && (
          <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: INK_DIM, marginTop: 12 }}>
            Noted. George will confirm availability personally and come back to you the same day.
          </p>
        )}
        {money && holdAsked[y.name] && (
          <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: INK_DIM, marginTop: 12 }}>
            Noted. George will ask the owner to hold these dates for 48 hours and confirm to you within the day. Nothing is booked and nothing is owed.
          </p>
        )}
      </div>
    );
  }

  function renderWeek(w: { title: string; days: { leg: string; note: string }[]; chart: WeekChart | null }) {
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>{wk ? "Your week, as we are planning it" : "A week like this"}</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
          {w.title}
        </h2>
        <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 540, margin: "0 auto 26px" }}>
          {wk
            ? "The route we are planning with the captain. It becomes final one week before you board, with the forecast in hand, and the sea keeps the last word."
            : "A sample rhythm for the week, drawn from routes we actually run. Every day is adjusted on board around your pace, the wind and the water."}
        </p>
        {w.chart && <WeekChartSvg chart={w.chart} />}
        <div style={{ borderTop: GOLD_HAIR }}>
          {w.days.map((x, k) => (
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

  // THE WEEK pages (after the yes, George 2 October 2026).
  function weekLetter(): string[] {
    if (!wk) return view.introParas;
    const greet = view.introParas.find((p) => /^dear\b/i.test(p)) ?? (view.clientName ? `Dear ${view.clientName},` : "Dear guests,");
    const when = wk.fromLong && wk.toLong ? ` from ${wk.fromLong} to ${wk.toLong}` : "";
    const port = wk.portEmbarkation ? `, out of ${wk.portEmbarkation}` : "";
    return [
      greet,
      `It is done: ${wk.vessel} is yours${when}${port}. What follows is your week as it stands today: the yacht, her crew by role, the route we are planning with the captain, a taste of the galley, and what to know before you board.`,
      "Nothing here is final until the captain and I speak a week before you sail, with a reliable forecast in hand, and that is as it should be. The sea has the last word, and we plan around it rather than against it.",
      "I am a message away every day between now and your check-in, and every day you are on the water.",
    ];
  }

  function renderCrew() {
    if (!wk) return null;
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>Your crew</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
          On board {wk.vessel}
        </h2>
        <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 540, margin: "0 auto 26px" }}>
          {wk.crew.length} crew, described by role. Names, faces and the preference sheet are in The Cabin, your private page.
        </p>
        <div style={{ borderTop: GOLD_HAIR }}>
          {wk.crew.map((c, k) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 4px", borderBottom: HAIR }}>
              <span style={{ fontFamily: "var(--salon-serif)", fontSize: 20, color: INK }}>{c.role}</span>
              {c.years && <span style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, paddingTop: 6 }}>{c.years} years at sea</span>}
            </div>
          ))}
        </div>
        <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11, color: INK_FAINT, marginTop: 16, lineHeight: 1.7 }}>
          Under the MYBA charter agreement the owner may replace a crew member for health or another serious reason, with someone of the same standard or better. I tell you the moment I know.
        </p>
      </div>
    );
  }

  function renderGalley() {
    if (!wk?.menu) return null;
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>From the galley</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
          A taste of the week
        </h2>
        {/* The Cabin's tagline can name the chef; the edition speaks of the crew
            by role only, so the line here is the house's own. */}
        <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 540, margin: "0 auto 26px" }}>
          A sample from the galley. The menus of your week are written around your preference sheet, not the other way round.
        </p>
        {wk.menu.sections.map((s, k) => (
          <div key={k} style={{ padding: "14px 4px", borderTop: k === 0 ? GOLD_HAIR : HAIR }}>
            <p style={{ ...label, fontSize: 8.5, marginBottom: 8 }}>{s.name}</p>
            {s.items.map((it, j) => (
              <p key={j} style={{ fontFamily: "var(--salon-serif)", fontSize: 17, color: INK_DIM, margin: "0 0 5px", lineHeight: 1.5 }}>{it}</p>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function renderBoard() {
    if (!wk) return null;
    const rows: [string, string][] = [
      ["Embarkation", [wk.portEmbarkation, wk.berth].filter(Boolean).join(", ") || "Athens; the berth is confirmed the week before"],
      ["Dates", wk.fromLong && wk.toLong ? `${wk.fromLong} to ${wk.toLong}` : "As on your charter agreement"],
      ["Disembarkation", wk.portDisembarkation || wk.portEmbarkation || "Athens"],
      ["Transfers", "Arranged from your preference sheet; the captain and I confirm the pick-up the day before."],
      ["Documents", "Passports for every guest are collected in The Cabin for the port authorities; nothing is needed on paper."],
      ["One week before", "The itinerary call with the captain, with a reliable forecast in hand. The embarkation time is confirmed then."],
      ["What to bring", "Soft bags rather than hard suitcases; soft-soled shoes for the deck; light layers for the evening breeze; a hat and reef-safe sunscreen; your medication; chargers for European sockets. The yacht has towels, snorkels and the toys."],
      ["Check-in", "I meet you on the quay, or my team does. From then on, a message away."],
    ];
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>Before you board</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 26px" }}>
          The practical page
        </h2>
        <div style={{ borderTop: GOLD_HAIR }}>
          {rows.map(([h, t], k) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, padding: "12px 4px", borderBottom: HAIR }}>
              <span style={{ ...label, fontSize: 8.5, paddingTop: 5 }}>{h}</span>
              <span style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, lineHeight: 1.65 }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // YOUR CABIN (George 2026-10-02, "the Cabin inside the same link"): the
  // state of the preference brief and one door into it. The door is this
  // edition's own address followed by /cabin; it signs the client in without
  // a password, the same way their emailed link does.
  function renderCabin() {
    if (!wk?.cabin) return null;
    const c = wk.cabin;
    const door = `${window.location.pathname.replace(/\/$/, "")}/cabin`;
    const guestsLine = c.partySize
      ? `${c.guestsOnManifest} of ${c.partySize} guests on the manifest`
      : c.guestsOnManifest ? `${c.guestsOnManifest} guests on the manifest` : "The guest manifest is still empty";
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>Your Cabin</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
          {c.submitted ? "Your brief is with the crew" : c.percent >= 100 ? "Your brief is complete" : "Tell us how you like your week"}
        </h2>
        <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 540, margin: "0 auto 26px" }}>
          {c.submitted
            ? "Everything you told us has reached the captain and the chef. Change anything, any time, from the same page."
            : "The Cabin is your private page for the week: who is coming, how you like the table and the cellar, where you would like to go, the little things. Fill it roughly today and polish it when you have a minute; the chef provisions from it."}
        </p>
        <div style={{ borderTop: GOLD_HAIR, borderBottom: HAIR, padding: "14px 4px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--salon-serif)", fontSize: 18, color: INK }}>The brief</span>
            <span style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM }}>{c.submitted ? "submitted" : `${c.percent} percent`}</span>
          </div>
          <div style={{ height: 3, background: "rgba(23,38,58,0.1)" }}>
            <div style={{ height: 3, width: `${c.submitted ? 100 : c.percent}%`, background: GOLD, transition: "width .6s" }} />
          </div>
          {(c.guestsOnManifest > 0 || !c.submitted) && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--salon-serif)", fontSize: 18, color: INK }}>The guests</span>
              <span style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM }}>{guestsLine}</span>
            </div>
          )}
          {c.pending.length > 0 && (
            <div style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, lineHeight: 1.7 }}>
              Still open: {c.pending.join(" · ")}
            </div>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 26 }}>
          <a href={door} onClick={() => beacon("cabin")} style={{ ...goldBtn, display: "inline-block", textDecoration: "none" }}>
            {c.submitted || c.percent >= 100 ? "Open your Cabin" : "Continue the brief"}
          </a>
          <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11, color: INK_FAINT, marginTop: 12, lineHeight: 1.7 }}>
            No password. The page knows it is you. Passports are typed only there, never here.
          </p>
        </div>
      </div>
    );
  }

  // GOOD TO KNOW (George 2026-10-02): the four misunderstandings that cost a
  // week, said once, in plain words, before the client chooses.
  function renderKnowHow() {
    const items: [string, string][] = [
      ["APA, the Advance Provisioning Allowance",
        "The running budget of your week, paid in advance to the yacht together with the balance. It covers fuel, food and drink, berthing and port fees, water and whatever is bought for the boat during the charter. The captain keeps the accounts and shows you the receipts. What is not spent is returned to you at the end of the week; if the week spends more, the difference is settled on board. The percentage shown in each investment box is the yacht's own."],
      ["Why the VAT differs from yacht to yacht",
        "Greek charter VAT is charged at the rate each yacht is certified for, from 5.2 to 12 percent, with a statutory ceiling of 13 percent. The rate follows the yacht's licence and her itinerary, not the broker, which is why two yachts in the same edition can show two different percentages. Each box states the rate that applies."],
      ["The itineraries are samples, and the sea has the last word",
        "Every route in this edition is one we actually run, and none of it is fixed. The wind, the sea state and the safety of the yacht decide the day, and that decision belongs to the captain alone. We do not control the weather, and neither does any broker; a port authority can close a harbour on a windy morning and a route can change the same day. The itinerary is discussed with the captain one week before embarkation, when the forecast is reliable, and agreed at check-in, when it becomes real. Hold the islands lightly and the week firmly."],
      ["The crew can change, and what you are owed if it does",
        "The crew described here is the crew on board today. Under the MYBA charter agreement the owner may replace a crew member for health or another serious reason. In practice it is rare. When it happens, the owner's duty is to replace them with someone of the same standard or better, and ours is to tell you the moment we know. We describe a crew by role rather than by name for exactly this reason."],
    ];
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>Good to know</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
          {wk ? "Before you sail" : "Before you choose"}
        </h2>
        <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 540, margin: "0 auto 26px" }}>
          Four things I would rather you heard from me now than discovered on the water.
        </p>
        <div style={{ borderTop: GOLD_HAIR }}>
          {items.map(([h, t], k) => (
            <div key={k} style={{ padding: "18px 4px", borderBottom: HAIR }}>
              <p style={{ fontFamily: "var(--salon-serif)", fontSize: 20, color: INK, margin: "0 0 8px" }}>{h}</p>
              <p style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, margin: 0, lineHeight: 1.75 }}>{t}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // AFTER THE YES (George 2026-10-02): the client buys what happens after the
  // booking as much as the yacht. Six steps, the MYBA payment terms in full.
  function renderAfter() {
    const steps: [string, string][] = [
      ["You choose", "Reply with one name, or two. The same day I confirm her availability with the owner and hold the dates for you."],
      ["The charter agreement", "The MYBA charter agreement, the standard contract of the industry, is issued in your name and signed electronically. Nothing is owed until you sign."],
      ["Payment, in two parts", "50 percent of the charter fee on signing. The remaining 50 percent, together with the VAT and the APA, 45 days before embarkation. The security deposit, where one applies, is settled at the base."],
      ["Your preferences, and The Cabin", "You receive the preference sheet, food, drink, pace, occasions, and your private page, The Cabin, where the crew, the menus, the berth and your documents live. Passports are collected there for the port authorities."],
      ["One week before", "The itinerary call with the captain, with a reliable forecast in hand. Transfers and the embarkation time are confirmed."],
      ["Check-in, and after", "I meet you on the quay in Athens, or my team does, and I am a message away every day you are on the water. Afterwards you are no longer a booking; you are a client of this house."],
    ];
    return (
      <div style={col}>
        <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>After the yes</p>
        <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: INK, textAlign: "center", fontSize: "clamp(24px, 4.6vw, 34px)", letterSpacing: "0.1em", margin: "0 0 26px" }}>
          What happens once you choose
        </h2>
        <div style={{ borderTop: GOLD_HAIR }}>
          {steps.map(([h, t], k) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 14, padding: "14px 4px", borderBottom: HAIR }}>
              <span style={{ ...label, fontSize: 9, paddingTop: 6 }}>Step {k + 1}</span>
              <span>
                <span style={{ display: "block", fontFamily: "var(--salon-serif)", fontSize: 20, color: INK }}>{h}</span>
                <span style={{ display: "block", fontFamily: "var(--salon-ui)", fontSize: 12.5, color: INK_DIM, marginTop: 2, lineHeight: 1.6 }}>{t}</span>
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
          {wk
            ? "Anything at all before you sail, from a birthday on board to a change of plan, write to me. I would rather hear it early."
            : "Reply with the one or two names that speak to you, and I will confirm availability with the owners the same day. Nothing is booked and nothing is owed until you decide."}
        </p>
        {view.crewNote && <p style={{ ...serifBody, fontSize: 16, margin: "0 auto 30px", maxWidth: 540 }}>{view.crewNote}</p>}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href={`${WA}${encodeURIComponent("Hello George, we have looked through the proposal and would like to talk.")}`}
            target="_blank" rel="noopener noreferrer" style={goldBtn} onClick={() => beacon("wa")}>WhatsApp George</a>
        </div>
        {/* PDF removed from the client experience entirely (George 2026-07-18:
            "το PDF το βγάζεις τελείως, χρησιμοποιούμε μόνο το περιοδικό"). The
            magazine is the whole deliverable; no download link, no whisper. */}
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
            A licensed sailing skipper, Olympiacos SFP Sailing Academy, with a powerboat licence valid to 25 metres: seasons out of
            Corfu and charter operations across the Ionian, the Cyclades and the Saronic. When he recommends an anchorage, it is
            because he has held a wheel there.
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
      case "knowhow": return renderKnowHow();
      case "after": return renderAfter();
      case "crew": return renderCrew();
      case "galley": return renderGalley();
      case "board": return renderBoard();
      case "cabin": return renderCabin();
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
        /* Scroll cue — a whisper, not a banner: small caps in the house gold
           over a hairline with a slowly falling dot. Appears only while the
           page has unseen content below the fold; the first scroll ends it. */
        .salon-scrollcue { position: fixed; left: 50%; transform: translateX(-50%); bottom: 58px; z-index: 6;
          background: rgba(251,250,246,0.88); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          border: 1px solid rgba(168,135,59,0.32); border-radius: 14px;
          box-shadow: 0 2px 14px rgba(23,38,58,0.10); cursor: pointer; display: flex; flex-direction: column;
          align-items: center; gap: 7px; padding: 9px 20px 7px; animation: salonCueIn 0.7s ease 0.5s both; }
        .salon-scrollcue-label { font-family: var(--salon-ui); font-size: 8.5px; font-weight: 600;
          letter-spacing: 0.34em; text-transform: uppercase; color: ${GOLD}; white-space: nowrap; }
        .salon-scrollcue-line { width: 1px; height: 26px; background: rgba(168,135,59,0.32);
          position: relative; overflow: hidden; display: block; }
        .salon-scrollcue-dot { position: absolute; left: -1.5px; top: -5px; width: 4px; height: 4px;
          border-radius: 50%; background: ${GOLD}; animation: salonCueDrift 2.2s cubic-bezier(0.4,0,0.6,1) infinite; }
        @keyframes salonCueDrift {
          0% { transform: translateY(0); opacity: 0; }
          18% { opacity: 1; }
          72% { opacity: 1; }
          100% { transform: translateY(32px); opacity: 0; }
        }
        @keyframes salonCueIn { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .salon-scrollcue { animation: none; }
          .salon-scrollcue-dot { animation: none; top: 11px; }
        }
      `}</style>

      <div
        ref={pageRef}
        key={page}
        className={leaf !== null ? "salon-under" : undefined}
        style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch", background: PAPER }}
        onScroll={(e) => { if (!pageScrolled && e.currentTarget.scrollTop > 48) setPageScrolled(true); }}
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

      {/* scroll cue — only while this page still hides content below the fold */}
      {pageOverflows && !pageScrolled && leaf === null && !lightbox && page !== 0 && (
        <button
          type="button"
          className="salon-scrollcue"
          aria-label="Scroll down for the full details"
          onClick={() => {
            const el = pageRef.current;
            if (el) el.scrollBy({ top: Math.round(el.clientHeight * 0.72), behavior: "smooth" });
          }}
        >
          <span className="salon-scrollcue-label">
            {pages[page].kind === "yacht" ? "Scroll · the full dossier" : "Scroll · there is more"}
          </span>
          <span className="salon-scrollcue-line" aria-hidden>
            <span className="salon-scrollcue-dot" />
          </span>
        </button>
      )}

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
// "5 cabins · 10 guests · crew of 3 · from Paros", read off the spec and
// voyage lines the edition already carries. Nothing is invented: a fact that
// is not on the spec line is simply not shown.
function glanceFacts(y: SalonYachtView): string {
  const spec = y.spec ?? "";
  const cab = spec.match(/(\d+)\s*CABINS?/i)?.[1];
  const gue = spec.match(/(\d+)\s*GUESTS?/i)?.[1];
  const crew = spec.match(/CREW OF\s*(\d+)/i)?.[1];
  const from = (y.voyage ?? "").split(/\s*(?:->|→)\s*/)[0]?.split("·")[0]?.trim();
  const parts = [
    cab ? `${cab} cabins` : "",
    gue ? `${gue} guests` : "",
    crew ? `crew of ${crew}` : "",
    from && from.length <= 24 ? `from ${from.charAt(0) + from.slice(1).toLowerCase()}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

// The week on paper: gold line, a dot per stop, the day it is reached,
// and a bar in nautical miles. Not a chart to navigate by, and it says so.
function WeekChartSvg({ chart }: { chart: WeekChart }) {
  return (
    <div style={{ margin: "0 0 26px" }}>
      <svg viewBox={`0 0 ${chart.w} ${chart.h}`} width="100%" role="img" aria-label="The week's route, to scale"
        style={{ display: "block", background: "#FFFFFF", border: GOLD_HAIR }}>
        <path d={chart.path} fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        {chart.points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={i === 0 ? 5 : 4} fill={i === 0 ? INK : "#FFFFFF"} stroke={INK} strokeWidth={1.4} />
            {p.label && (
              <text x={p.x + 9} y={p.y - 7} fontFamily="Cormorant Garamond, Georgia, serif" fontSize={17} fill={INK}>{p.label}</text>
            )}
            {i > 0 && (
              <text x={p.x + 9} y={p.y + 12} fontFamily="Montserrat, Helvetica, Arial, sans-serif" fontSize={8.5} letterSpacing={1.5} fill={GOLD}>{`DAY ${p.day}`}</text>
            )}
          </g>
        ))}
        <line x1={chart.scale.x1} x2={chart.scale.x2} y1={chart.scale.y} y2={chart.scale.y} stroke={INK} strokeWidth={1} />
        <line x1={chart.scale.x1} x2={chart.scale.x1} y1={chart.scale.y - 4} y2={chart.scale.y + 4} stroke={INK} strokeWidth={1} />
        <line x1={chart.scale.x2} x2={chart.scale.x2} y1={chart.scale.y - 4} y2={chart.scale.y + 4} stroke={INK} strokeWidth={1} />
        <text x={chart.scale.x1} y={chart.scale.y - 8} fontFamily="Montserrat, Helvetica, Arial, sans-serif" fontSize={8.5} letterSpacing={1.5} fill={INK}>{chart.scale.label.toUpperCase()}</text>
        <text x={chart.w - 16} y={22} textAnchor="end" fontFamily="Montserrat, Helvetica, Arial, sans-serif" fontSize={8.5} letterSpacing={2} fill={GOLD}>N ↑</text>
      </svg>
      <p style={{ fontFamily: "var(--salon-ui)", fontSize: 10.5, color: "rgba(23,38,58,0.42)", margin: "6px 0 0", textAlign: "right" }}>
        Sketch to scale, harbours placed to the nearest mile. Not for navigation.
      </p>
    </div>
  );
}

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
