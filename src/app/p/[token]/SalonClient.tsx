"use client";

// The Private Salon — client renderer (2026-07-16). One quiet, editorial
// column: George's letter (and optional personal video), each yacht with its
// real photos, approved copy and figures, his hand-written week, and a single
// restrained action per yacht. Navy ground, gold accents, whitespace as
// status — the page must read like the PDF's living sibling, never a
// brochure site.

import { useEffect, useRef, useState } from "react";

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
};

export type SalonView = {
  token: string;
  clientName: string | null;
  coverLine: string | null;
  period: string | null;
  guests: string | null;
  area: string | null;
  introParas: string[];
  video: { kind: "iframe" | "video"; src: string } | null;
  yachts: SalonYachtView[];
  weeks: { title: string; days: { leg: string; note: string }[] }[];
  crewNote: string | null;
  hasPdf: boolean;
};

const GOLD = "#C9A84C";
const IVORY = "#F3EFE6";
const IVORY_DIM = "rgba(243,239,230,0.72)";
const NAVY = "#0D1B2A";
const HAIR = "1px solid rgba(201,168,76,0.28)";
const WA = "https://api.whatsapp.com/send/?phone=17867988798&text=";

export default function SalonClient({ view }: { view: SalonView }) {
  const sent = useRef(false);
  const [interested, setInterested] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

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
    if (sent.current) return;
    sent.current = true;
    beacon("view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function markInterest(name: string) {
    if (!interested[name]) beacon("yacht", name);
    setInterested((p) => ({ ...p, [name]: true }));
  }

  const label: React.CSSProperties = {
    fontFamily: "var(--salon-ui)", fontSize: 10, letterSpacing: "0.34em",
    textTransform: "uppercase", color: GOLD, fontWeight: 600,
  };
  const serifBody: React.CSSProperties = {
    fontFamily: "var(--salon-serif)", fontSize: 19, lineHeight: 1.65, color: IVORY_DIM,
  };
  const goldBtn: React.CSSProperties = {
    display: "inline-block", fontFamily: "var(--salon-ui)", fontSize: 11,
    letterSpacing: "0.28em", textTransform: "uppercase", fontWeight: 600,
    color: NAVY, background: GOLD, padding: "15px 26px", textDecoration: "none",
    border: "none", cursor: "pointer",
  };
  const ghostBtn: React.CSSProperties = {
    ...goldBtn, color: GOLD, background: "transparent", border: `1px solid ${GOLD}`,
  };

  return (
    <main style={{ background: NAVY, minHeight: "100vh", color: IVORY }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 22px 90px" }}>

        {/* ── Masthead ─────────────────────────────────────────────── */}
        <header style={{ textAlign: "center", padding: "76px 0 56px", borderBottom: HAIR }}>
          <p style={{ ...label, marginBottom: 26 }}>George Yachts · Confidential Charter Proposal</p>
          <h1 style={{
            fontFamily: "var(--salon-display)", fontWeight: 700, color: GOLD,
            fontSize: "clamp(30px, 6vw, 46px)", letterSpacing: "0.08em",
            margin: "0 0 18px", lineHeight: 1.25, textWrap: "balance",
          }}>
            {view.clientName ? `Personally Curated for ${view.clientName}` : "A Personally Curated Selection"}
          </h1>
          {view.coverLine ? (
            <p style={{ ...label, color: IVORY_DIM, letterSpacing: "0.2em", lineHeight: 1.9 }}>{view.coverLine}</p>
          ) : (
            <p style={{ ...label, color: IVORY_DIM, letterSpacing: "0.2em" }}>
              {[view.guests, view.area, view.period].filter(Boolean).join(" · ")}
            </p>
          )}
        </header>

        {/* ── Personal video ───────────────────────────────────────── */}
        {view.video && (
          <section style={{ padding: "56px 0 8px" }}>
            <p style={{ ...label, textAlign: "center", marginBottom: 18 }}>A personal word from George</p>
            <div style={{ position: "relative", paddingTop: "56.25%", border: HAIR }}>
              {view.video.kind === "iframe" ? (
                <iframe
                  src={view.video.src}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <video
                  src={view.video.src}
                  controls
                  playsInline
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
                />
              )}
            </div>
          </section>
        )}

        {/* ── Broker letter ────────────────────────────────────────── */}
        {view.introParas.length > 0 && (
          <section style={{ padding: "60px 0 26px" }}>
            <p style={{ ...label, marginBottom: 22 }}>A note from your broker</p>
            {view.introParas.map((p, i) => (
              <p key={i} style={{ ...serifBody, margin: "0 0 16px" }}>{p}</p>
            ))}
            <p style={{ fontFamily: "var(--salon-serif)", fontSize: 22, color: GOLD, margin: "26px 0 2px" }}>George Biniaris</p>
            <p style={{ ...label, fontSize: 8.5, color: IVORY_DIM }}>Managing Broker · George Yachts Brokerage House LLC</p>
          </section>
        )}

        {/* ── The selection at a glance ────────────────────────────── */}
        {view.yachts.length >= 3 && (
          <section style={{ padding: "34px 0 10px" }}>
            <p style={{ ...label, marginBottom: 16 }}>The selection at a glance</p>
            <div style={{ border: HAIR }}>
              {view.yachts.map((y, i) => (
                <a key={y.name} href={`#yacht-${i}`} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 14,
                  padding: "14px 16px", textDecoration: "none",
                  borderBottom: i < view.yachts.length - 1 ? "1px solid rgba(201,168,76,0.14)" : "none",
                }}>
                  <span style={{ fontFamily: "var(--salon-serif)", fontSize: 19, color: IVORY }}>
                    {y.name}
                    {y.tier && <span style={{ ...label, fontSize: 8.5, marginLeft: 10 }}>{y.tier}</span>}
                  </span>
                  <span style={{ fontFamily: "var(--salon-ui)", fontSize: 13, color: GOLD, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {y.money.allIn ? `${y.money.allIn} all-in` : y.money.headline || ""}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ── Yachts ───────────────────────────────────────────────── */}
        {view.yachts.map((y, i) => (
          <section key={y.name} id={`yacht-${i}`} style={{ padding: "72px 0 0" }}>
            {y.tier && <p style={{ ...label, textAlign: "center", marginBottom: 10 }}>{y.tier}</p>}
            <h2 style={{
              fontFamily: "var(--salon-display)", fontWeight: 400, color: IVORY, textAlign: "center",
              fontSize: "clamp(26px, 5vw, 36px)", letterSpacing: "0.1em", margin: "0 0 8px",
            }}>{y.name}</h2>
            {y.spec && <p style={{ ...label, color: IVORY_DIM, textAlign: "center", letterSpacing: "0.22em", marginBottom: 4 }}>{y.spec}</p>}
            {y.voyage && <p style={{ ...label, fontSize: 9, color: GOLD, textAlign: "center", marginBottom: 20 }}>{y.voyage}</p>}

            {y.main && (
              <img
                src={y.main}
                alt={y.name}
                onClick={() => setLightbox(y.main)}
                style={{ width: "100%", maxHeight: 440, objectFit: "cover", display: "block", cursor: "zoom-in", border: HAIR }}
              />
            )}
            {y.gallery.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, y.gallery.length)}, 1fr)`, gap: 8, marginTop: 8 }}>
                {y.gallery.map((g) => (
                  <img key={g} src={g} alt="" onClick={() => setLightbox(g)}
                    style={{ width: "100%", height: 110, objectFit: "cover", cursor: "zoom-in" }} />
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

            {y.crewLine && (
              <p style={{ fontFamily: "var(--salon-ui)", fontSize: 12.5, color: IVORY_DIM, marginTop: 20, lineHeight: 1.7 }}>
                <span style={{ ...label, fontSize: 8.5, marginRight: 10 }}>Crew</span>{y.crewLine}
                <span style={{ display: "block", fontSize: 10.5, color: "rgba(243,239,230,0.45)", marginTop: 3 }}>
                  Crew composition is indicative and remains subject to the owner&apos;s final confirmation.
                </span>
              </p>
            )}
            {y.dateNote && (
              <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: IVORY_DIM, marginTop: 14 }}>{y.dateNote}</p>
            )}

            {/* money box */}
            <div style={{ border: HAIR, padding: "22px 22px 18px", marginTop: 28 }}>
              {y.money.discountNote && (
                <p style={{ fontFamily: "var(--salon-serif)", fontWeight: 600, fontSize: 17, color: GOLD, margin: "0 0 12px" }}>{y.money.discountNote}</p>
              )}
              {y.money.periods.length > 0 ? (
                <div>
                  {y.money.periods.map((po, k) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(243,239,230,0.08)", fontFamily: "var(--salon-ui)", fontSize: 13.5 }}>
                      <span style={{ color: IVORY_DIM }}>{[po.label, po.dates].filter(Boolean).join(" · ")}{po.note ? ` — ${po.note}` : ""}</span>
                      <span style={{ color: IVORY, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{po.fee}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  {y.money.rows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontFamily: "var(--salon-ui)", fontSize: 13.5 }}>
                      <span style={{ color: IVORY_DIM }}>{k}</span>
                      <span style={{ color: IVORY, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {y.money.allIn && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 0 0", marginTop: 10, borderTop: `1px solid rgba(201,168,76,0.4)` }}>
                  <span style={{ ...label }}>{y.money.allInclusive ? "All-inclusive" : "Estimated all-in"}</span>
                  <span style={{ fontFamily: "var(--salon-serif)", fontSize: 24, color: GOLD, fontVariantNumeric: "tabular-nums" }}>{y.money.allIn}</span>
                </div>
              )}
              {(y.money.perGuest4 || y.money.perGuest6) && (
                <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11, color: "rgba(243,239,230,0.5)", margin: "8px 0 0", textAlign: "right" }}>
                  {[y.money.perGuest4 ? `${y.money.perGuest4} per guest at 4` : "", y.money.perGuest6 ? `${y.money.perGuest6} at 6` : ""].filter(Boolean).join(" · ")}
                </p>
              )}
              {(y.payableAtBase.length > 0 || y.deposit) && (
                <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: IVORY_DIM, margin: "12px 0 0", lineHeight: 1.7 }}>
                  {y.payableAtBase.map((x) => `${x.label}: ${x.amount}`).join(" · ")}
                  {y.payableAtBase.length > 0 && y.deposit ? " · " : ""}
                  {y.deposit ? `Security deposit: ${y.deposit}` : ""}
                  <span style={{ display: "block", color: "rgba(243,239,230,0.45)", fontSize: 10.5, marginTop: 2 }}>Payable at base — not part of the charter fee.</span>
                </p>
              )}
              {y.freeOnboard.length > 0 && (
                <p style={{ fontFamily: "var(--salon-ui)", fontSize: 11.5, color: IVORY_DIM, margin: "10px 0 0" }}>
                  Complimentary on board: {y.freeOnboard.join(", ")}
                </p>
              )}
            </div>

            {/* actions */}
            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => markInterest(y.name)}
                style={interested[y.name] ? { ...ghostBtn, opacity: 0.75, cursor: "default" } : goldBtn}
              >
                {interested[y.name] ? "George has been notified" : "This one interests us"}
              </button>
              {y.brochure && (
                <a href={y.brochure} target="_blank" rel="noopener noreferrer" style={ghostBtn}>Digital brochure</a>
              )}
            </div>
            {interested[y.name] && (
              <p style={{ fontFamily: "var(--salon-serif)", fontStyle: "italic", fontSize: 15, color: IVORY_DIM, marginTop: 12 }}>
                Noted — George will confirm availability personally and come back to you the same day.
              </p>
            )}
          </section>
        ))}

        {/* ── George's weeks ───────────────────────────────────────── */}
        {view.weeks.map((wk) => (
          <section key={wk.title} style={{ padding: "78px 0 0" }}>
            <p style={{ ...label, textAlign: "center", marginBottom: 8 }}>A week like this</p>
            <h2 style={{ fontFamily: "var(--salon-display)", fontWeight: 400, color: GOLD, textAlign: "center", fontSize: "clamp(24px, 4.4vw, 32px)", letterSpacing: "0.1em", margin: "0 0 10px" }}>
              {wk.title}
            </h2>
            <p style={{ ...serifBody, fontSize: 16, textAlign: "center", maxWidth: 560, margin: "0 auto 26px" }}>
              A sample rhythm for the week, drawn from routes we actually run. Every day is adjusted on board around your pace, the wind and the water.
            </p>
            <div style={{ border: HAIR }}>
              {wk.days.map((x, k) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 14, padding: "13px 16px", borderBottom: k < wk.days.length - 1 ? "1px solid rgba(201,168,76,0.14)" : "none" }}>
                  <span style={{ ...label, fontSize: 9, paddingTop: 5 }}>Day {k + 1}</span>
                  <span>
                    <span style={{ display: "block", fontFamily: "var(--salon-serif)", fontSize: 19, color: GOLD }}>{x.leg.replace(/\s*(?:->|→)\s*/g, " → ")}</span>
                    {x.note && <span style={{ display: "block", fontFamily: "var(--salon-ui)", fontSize: 12.5, color: IVORY_DIM, marginTop: 2, lineHeight: 1.6 }}>{x.note}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}

        {view.crewNote && (
          <p style={{ ...serifBody, fontSize: 16, marginTop: 44 }}>{view.crewNote}</p>
        )}

        {/* ── What happens next ────────────────────────────────────── */}
        <section style={{ padding: "80px 0 0", textAlign: "center" }}>
          <p style={{ ...label, marginBottom: 18 }}>What happens next</p>
          <p style={{ ...serifBody, maxWidth: 560, margin: "0 auto 30px" }}>
            Reply with the one or two names that speak to you, and I will confirm availability with the owners the same day.
            Nothing is booked and nothing is owed until you decide.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href={`${WA}${encodeURIComponent("Hello George, we have looked through the proposal and would like to talk.")}`}
              target="_blank" rel="noopener noreferrer" style={goldBtn}
              onClick={() => beacon("wa")}
            >WhatsApp George</a>
            {view.hasPdf && (
              <a href={`/p/${view.token}/pdf`} style={ghostBtn} onClick={() => beacon("pdf")}>Download the proposal (PDF)</a>
            )}
          </div>
          <p style={{ fontFamily: "var(--salon-ui)", fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(243,239,230,0.4)", marginTop: 56, lineHeight: 2 }}>
            Confidential · Prepared solely for the named recipient<br />
            George Yachts Brokerage House LLC · WhatsApp +1 786 798 8798
          </p>
        </section>
      </div>

      {/* lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(5,10,17,0.94)", display: "grid", placeItems: "center", cursor: "zoom-out", zIndex: 50, padding: 18 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "92vh", objectFit: "contain" }} />
        </div>
      )}
    </main>
  );
}
