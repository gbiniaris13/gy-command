// @ts-nocheck
// The Lighthouse greeting card — built on the REAL Edition (the Salon
// at /p/<token>), not the PDF: warm ivory paper, deep navy ink,
// bronze gold, Cinzel display / Cormorant Garamond serif / Montserrat
// smallcap labels, thin hairlines, and George himself on the quay in
// Syros as the signature. George (29/8): "σαν να τους έχουμε στείλει
// μια ευχητήρια κάρτα πολύ ακριβή... να συγκινούνται".
//
// Email reality: Apple Mail (most of the US clientele reads on
// iPhone) honors the @import web fonts; Gmail falls back to
// Georgia/Times with the same letter-spacing discipline. All layout
// inline, single column.

const INK = "#17263A";
const INK_DIM = "rgba(23,38,58,0.72)";
const INK_FAINT = "rgba(23,38,58,0.45)";
const GOLD = "#A8873B";
const PAPER = "#FBFAF6";
const HAIR = "rgba(23,38,58,0.14)";
const GOLD_HAIR = "rgba(168,135,59,0.4)";
const GEORGE_PHOTO = "https://georgeyachts.com/images/george-syros-quay.jpg";

const DISPLAY = "'Cinzel',Georgia,'Times New Roman',serif";
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

export function greetingCard({ kind, subject, body }: { kind: string; subject: string; body: string }): string {
  const eyebrow = EYEBROWS[kind] ?? "With Warm Wishes";
  const greek = kind === "name_day";
  const paras = String(body).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  let sign: string[] = [];
  if (paras.length > 1 && /^(warm regards|με εκτίμηση)/i.test(paras[paras.length - 1])) {
    sign = paras.pop().split("\n").map((x) => x.trim());
  }
  const paraHtml = paras
    .map(
      (t) =>
        `<p style="margin:0 0 18px;font-family:${SERIF};font-size:19px;line-height:1.66;color:${INK_DIM};">${esc(t).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const signName = greek ? "Γιώργος Π. Μπινιάρης" : "George P. Biniaris";
  const signTitle = greek ? "George Yachts Brokerage House" : "Founder &amp; Managing Broker · George Yachts Brokerage House";
  const closing = sign.length ? esc(sign[0]) : greek ? "Με εκτίμηση," : "Warm regards,";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Montserrat:wght@400;500;600&display=swap');
</style>
</head>
<body style="margin:0;padding:0;background:#F1EEE7;">
  <div style="padding:36px 14px;background:#F1EEE7;">
    <div style="max-width:560px;margin:0 auto;background:${PAPER};border:1px solid ${HAIR};">

      <!-- Masthead -->
      <div style="padding:42px 44px 0;text-align:center;">
        <p style="margin:0;font-family:${UI};font-weight:600;font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:${GOLD};">George&nbsp;Yachts</p>
        <p style="margin:6px 0 0;font-family:${UI};font-size:8px;letter-spacing:.34em;text-transform:uppercase;color:${INK_FAINT};">The&nbsp;Brokerage&nbsp;House</p>
      </div>

      <!-- George on the quay in Syros, full width, exactly as the
           Salon opens - natural aspect, no cropping games that Gmail
           would break -->
      <div style="padding:30px 30px 0;">
        <img src="${GEORGE_PHOTO}" width="500" alt="George P. Biniaris on the quay in Syros" style="display:block;width:100%;height:auto;border:1px solid ${HAIR};">
        <p style="margin:6px 2px 0;font-family:${UI};font-size:7.5px;letter-spacing:.26em;text-transform:uppercase;color:${INK_FAINT};text-align:right;">On the quay in Syros, where his family is from</p>
      </div>

      <!-- Eyebrow + headline -->
      <div style="padding:34px 44px 0;text-align:center;">
        <p style="margin:0 0 14px;font-family:${UI};font-size:9px;letter-spacing:.34em;text-transform:uppercase;color:${GOLD};">
          <span style="font-size:7px;">&#9670;</span>&nbsp;&nbsp;&nbsp;${esc(eyebrow)}&nbsp;&nbsp;&nbsp;<span style="font-size:7px;">&#9670;</span>
        </p>
        <h1 style="margin:0;font-family:${DISPLAY};font-weight:400;font-size:30px;line-height:1.3;letter-spacing:.06em;color:${INK};">${esc(subject)}</h1>
        <div style="margin:26px auto 0;width:64px;border-top:1px solid ${GOLD_HAIR};"></div>
      </div>

      <!-- Body -->
      <div style="padding:30px 48px 6px;">
        ${paraHtml}
      </div>

      <!-- Signature -->
      <div style="padding:8px 48px 0;">
        <div style="border-top:1px solid ${HAIR};padding-top:24px;">
          <p style="margin:0;font-family:${SERIF};font-style:italic;font-size:17px;color:${INK_DIM};">${closing}</p>
          <p style="margin:6px 0 0;font-family:${SERIF};font-size:24px;color:${GOLD};">${signName}</p>
          <p style="margin:5px 0 0;font-family:${UI};font-size:8.5px;letter-spacing:.22em;text-transform:uppercase;color:${INK_FAINT};">${signTitle}</p>
        </div>
      </div>

      <!-- Foot -->
      <div style="padding:30px 44px 36px;text-align:center;">
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
