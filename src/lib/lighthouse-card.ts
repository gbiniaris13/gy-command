// @ts-nocheck
// The Lighthouse greeting card. Warm ivory paper, deep navy ink, bronze
// gold, thin hairlines, the type of the Edition.
//
// 26/11/2026, George: every occasion its own card, a card of the HOUSE,
// not a photograph of him ("δεν είναι ανάγκη να έχει τη φάτσα μου").
// The research of that day (Desktop/RESEARCH-PROMPT-GREETING-CARDS-*):
// the great houses show human craft (Hermès, Prada drew by hand in 2026;
// AI imagery was punished), sign as the house, and keep the founder to a
// handwritten signature. So each occasion carries one old print from a
// public-domain museum collection (real human art, free to use), mounted
// like a print on the card, and George appears as his own signature in
// navy ink, taken from a contract he signed.
//
// Email reality: Apple Mail (most of the US clientele reads on iPhone)
// honours the web fonts; Gmail falls back to Georgia. All layout inline,
// one column, images hosted (never base64: Gmail clips HTML over 102 KB),
// "light only" so Apple Mail does not invert the paper in dark mode.

const INK = "#17263A";
const INK_DIM = "rgba(23,38,58,0.74)";
const INK_FAINT = "rgba(23,38,58,0.46)";
const GOLD = "#A8873B";
const PAPER = "#FBFAF6";
const TABLE = "#F1EEE7";
const HAIR = "rgba(23,38,58,0.14)";
const GOLD_HAIR = "rgba(168,135,59,0.42)";

const ASSETS = "https://command.georgeyachts.com/cards";
// v2 (26/11/2026): transparent, in bronze ink. v1 sat on an ivory square
// that showed as a beige box when a phone in dark mode darkened the card;
// navy ink would vanish on the dark card, bronze reads on both.
const SIGNATURE = { src: `${ASSETS}/george-signature-v2.png`, w: 170, h: 104 };

const DISPLAY = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const UI = "'Montserrat',Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const EYEBROWS: Record<string, string> = {
  birthday: "A Birthday Wish",
  anniversary: "An Anniversary Wish",
  name_day: "Χρόνια Πολλά",
  western_christmas: "Season's Greetings",
  orthodox_christmas: "Season's Greetings",
  new_year: "To the Year Ahead",
  western_easter: "Easter Greetings",
  orthodox_easter: "Kalo Pascha",
  thanksgiving: "With Gratitude",
  us_independence_day: "Happy Fourth",
  memorial_day: "To Summer's Beginning",
  labor_day: "To Summer Well Spent",
  rosh_hashanah: "Shana Tova",
  hanukkah_first_night: "Festival of Lights",
  eid_al_fitr: "Eid Mubarak",
  eid_al_adha: "Eid Mubarak",
  diwali: "Festival of Lights",
  greek_independence_day: "Zito i Ellas",
};

// One print per occasion, reused every year (the Van Cleef pendant
// model: the same card each year, so clients come to recognise it).
// w is the display width inside the mount (474 = full); the files are 2x
// for retina. Sources (all public domain / CC0, via Wikimedia Commons):
//   birthday      N. Artsay, Ship under Sail, etching, National Gallery of Art (CC0)
//   thanksgiving  J. S. Sargent, Olive Trees, Corfu, 1909, Art Institute of Chicago
//   christmas     Elizabeth Blackwell, A Curious Herbal, 1737, plate 145 (BHL)
export type CardArt = { src: string; w: number; alt: string; credit: string; accent: string };
export const CARD_ART: Record<string, CardArt> = {
  birthday: {
    src: `${ASSETS}/birthday-v1.jpg`,
    w: 474,
    alt: "An etching of a sailing ship under full sail off a rocky coast",
    credit: "N. Artsay, Ship under Sail, etching",
    accent: GOLD,
  },
  thanksgiving: {
    src: `${ASSETS}/thanksgiving-v1.jpg`,
    w: 474,
    alt: "A watercolour of olive trees on Corfu by John Singer Sargent",
    credit: "John Singer Sargent, Olive Trees, Corfu, 1909",
    accent: "#8A6A2F",
  },
  // The Greek New Year's pomegranate: abundance for the year ahead, and
  // no faith assumed, so it suits "Season's Greetings" for every client.
  // v2 (26/11/2026): Elizabeth Blackwell's hand-coloured engraving, 1737.
  western_christmas: {
    src: `${ASSETS}/christmas-v2.jpg`,
    w: 300,
    alt: "An eighteenth-century hand-coloured engraving of a pomegranate branch with fruit",
    credit: "Elizabeth Blackwell, Pomegranates, A Curious Herbal, 1737",
    accent: "#6B2430",
  },
};
CARD_ART.orthodox_christmas = CARD_ART.western_christmas;
CARD_ART.new_year = CARD_ART.western_christmas;

export function greetingCard({ kind, subject, body, closing: closingIn }: { kind: string; subject: string; body: string; closing?: string }): string {
  const eyebrow = EYEBROWS[kind] ?? "With Warm Wishes";
  const greek = kind === "name_day";
  const art = CARD_ART[kind] ?? null;
  const accent = art?.accent ?? GOLD;
  const paras = String(body).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  let sign: string[] = [];
  if (paras.length > 1 && /^(warm regards|warmly|με εκτίμηση)/i.test(paras[paras.length - 1])) {
    sign = paras.pop().split("\n").map((x) => x.trim());
  }
  const paraHtml = paras
    .map(
      (t) =>
        `<p style="margin:0 0 18px;font-family:${SERIF};font-size:19px;line-height:1.66;color:${INK_DIM};">${esc(t).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const signName = greek ? "Γιώργος Π. Μπινιάρης" : "George P. Biniaris";
  const signTitle = greek ? "George Yachts Brokerage House" : "Founder &amp; Managing Broker";
  // The After sales texts end "Warmly,\nGeorge"; the sender strips that and
  // passes the closing, so the card signs it once, by hand.
  const closing = closingIn ? esc(closingIn) : sign.length ? esc(sign[0]) : greek ? "Με εκτίμηση," : "Warmly,";

  // The line the inbox shows under the subject. Without it Gmail and
  // Apple Mail preview the masthead and the print's credit ("George Yachts
  // The Brokerage House N. Artsay, Ship under Sail..."), seen in the test of
  // 26/11/2026. It shows the first words of the wish instead, then padding
  // so nothing from the card itself leaks into the preview.
  const opening = paras.find((t, i) => !(i === 0 && /^(dear|hey|hi|hello|αγαπητ)[^\n]{0,60},$/i.test(t))) ?? "";
  const preheaderText = opening.replace(/\s+/g, " ").trim().slice(0, 140);
  const preheader = preheaderText
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:transparent;">${esc(preheaderText)}${"&#8199;&#847;&nbsp;".repeat(60)}</div>`
    : "";

  // The print, mounted: a wide ivory margin, one hairline, the credit
  // under it like a museum label. Without a print (other occasions) a
  // small gold rule stands in, so the card is still whole.
  const artHtml = art
    ? `<div style="padding:34px 30px 0;">
        <div style="border:1px solid ${HAIR};padding:12px;background:${PAPER};">
          <img src="${art.src}" width="${art.w}" alt="${esc(art.alt)}" style="display:block;width:100%;max-width:${art.w}px;height:auto;margin:0 auto;border:0;">
        </div>
        <p style="margin:8px 2px 0;font-family:${UI};font-size:7.5px;letter-spacing:.24em;text-transform:uppercase;color:${INK_FAINT};text-align:right;">${esc(art.credit)}</p>
      </div>`
    : `<div style="padding:34px 44px 0;text-align:center;"><div style="margin:0 auto;width:40px;border-top:1px solid ${GOLD_HAIR};"></div></div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Montserrat:wght@400;500;600&display=swap');
:root{color-scheme:light only;supported-color-schemes:light only;}
</style>
</head>
<body style="margin:0;padding:0;background:${TABLE};">
  ${preheader}
  <div style="padding:36px 14px;background:${TABLE};">
    <div style="max-width:560px;margin:0 auto;background:${PAPER};border:1px solid ${HAIR};">

      <!-- Masthead -->
      <div style="padding:40px 44px 0;text-align:center;">
        <p style="margin:0;font-family:${UI};font-weight:600;font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:${GOLD};">George&nbsp;Yachts</p>
        <p style="margin:6px 0 0;font-family:${UI};font-size:8px;letter-spacing:.34em;text-transform:uppercase;color:${INK_FAINT};">The&nbsp;Brokerage&nbsp;House</p>
      </div>

      ${artHtml}

      <!-- Eyebrow + headline -->
      <div style="padding:34px 44px 0;text-align:center;">
        <p style="margin:0 0 14px;font-family:${UI};font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:${accent};">
          <span style="font-size:7px;">&#9670;</span>&nbsp;&nbsp;&nbsp;${esc(eyebrow)}&nbsp;&nbsp;&nbsp;<span style="font-size:7px;">&#9670;</span>
        </p>
        <h1 style="margin:0;font-family:${DISPLAY};font-style:italic;font-weight:400;font-size:34px;line-height:1.22;letter-spacing:.01em;color:${INK};">${esc(subject)}</h1>
        <div style="margin:24px auto 0;width:64px;border-top:1px solid ${GOLD_HAIR};"></div>
      </div>

      <!-- Body -->
      <div style="padding:30px 48px 4px;">
        ${paraHtml}
      </div>

      <!-- Signature: his own hand, in the house's ink -->
      <div style="padding:6px 48px 0;">
        <p style="margin:0;font-family:${SERIF};font-style:italic;font-size:19px;color:${INK_DIM};">${closing}</p>
        <img src="${SIGNATURE.src}" width="${SIGNATURE.w}" height="${SIGNATURE.h}" alt="${greek ? "Γιώργος" : "George"}" style="display:block;margin:6px 0 4px -6px;width:${SIGNATURE.w}px;height:auto;border:0;">
        <p style="margin:0;font-family:${UI};font-size:9px;font-weight:500;letter-spacing:.26em;text-transform:uppercase;color:${INK};">${signName}</p>
        <p style="margin:5px 0 0;font-family:${UI};font-size:8px;letter-spacing:.22em;text-transform:uppercase;color:${INK_FAINT};">${signTitle}</p>
      </div>

      <!-- Foot -->
      <div style="padding:34px 44px 36px;text-align:center;">
        <div style="margin:0 auto 18px;width:64px;border-top:1px solid ${GOLD_HAIR};"></div>
        <p style="margin:0;font-family:${UI};font-size:8px;letter-spacing:.30em;text-transform:uppercase;color:${INK_FAINT};">
          Athens&nbsp;&nbsp;<span style="color:${GOLD};font-size:6px;">&#9670;</span>&nbsp;&nbsp;Aegean&nbsp;&nbsp;<span style="color:${GOLD};font-size:6px;">&#9670;</span>&nbsp;&nbsp;Ionian
        </p>
        <p style="margin:12px 0 0;"><a href="https://www.georgeyachts.com" style="font-family:${UI};font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:${GOLD};text-decoration:none;">georgeyachts.com</a></p>
      </div>

    </div>
  </div>
</body></html>`;
}
