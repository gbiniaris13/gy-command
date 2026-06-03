// src/lib/helm/proposal-template.ts
// =============================================================
// The Helm — proposal HTML builder. 1:1 port of render_single /
// render_combined / base_css / helpers from
// render-kit/scripts/build_proposal.py. CSS is copied VERBATIM —
// it is what produces the look (navy/gold/ivory, Cinzel/Cormorant/
// Montserrat, metallic-gold gradient via -webkit-background-clip,
// scrims, diamond rules). DO NOT restyle here.
//
// Pure: returns an HTML string. The Chromium render lives in render.ts.
// Images arrive as URLs (George-hosted or white-label supplier links
// that passed the branding check) or as data: URIs; null → placeholder.
// =============================================================

import { computePricing, type PricingInput } from "./pricing";
import { FONT_FACE_CSS } from "./fonts.generated";

// ----------------------------------------------------------------- types
export type Images = Record<string, string | null | undefined>;

export type SingleYacht = {
  name: string;
  type?: string;
  spec_line?: string;
  period_line?: string;
  /** "Athens -> Mykonos · 25 June - 3 July" line (embark/disembark + dates). */
  voyage_line?: string;
  price_sub?: string;
  experience_title?: string;
  experience_paras?: string[];
  highlights?: string[];
  accommodation?: [string, string][];
  crew_line?: string;
  water_toys?: string[];
  tech_specs?: [string, string][];
  pricing?: PricingInput;
  gallery?: (string | null)[];
  gallery_slots?: number;
  links?: Record<string, string>;
  images?: Images;
};

export type SingleProposal = {
  mode: "single";
  no_myba?: boolean;
  show_ghost_credit?: boolean;
  /** Travel-agent white-label: neutral footer, no George identity/colophon. */
  white_label?: boolean;
  yacht: SingleYacht;
};

export type CombinedYacht = {
  name: string;
  type?: string;
  tier_label?: string;
  spec_line?: string;
  /** "Athens -> Mykonos · 25 June - 3 July" line (embark/disembark + dates). */
  voyage_line?: string;
  spec_strip?: [string, string][];
  description?: string;
  inside_info?: string;
  pricing?: PricingInput;
  links?: Record<string, string>;
  images?: Images;
};

export type CombinedProposal = {
  mode: "combined";
  no_myba?: boolean;
  show_ghost_credit?: boolean;
  /** Travel-agent white-label: neutral footer, no George identity/colophon. */
  white_label?: boolean;
  client_name?: string;
  period?: string;
  guests?: string;
  area?: string;
  intro_letter?: string;
  images?: Images;
  yachts: CombinedYacht[];
};

export type ProposalJson = SingleProposal | CombinedProposal;

// ----------------------------------------------------------------- helpers
// HTML-escape (mirrors Python html.escape(quote=True)).
function e(x: unknown): string {
  if (x === null || x === undefined) return "";
  return String(x)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const DIAMOND = "<span class='dia'>&#9670;</span>";

function imgOrPlaceholder(
  src: string | null | undefined,
  label: string,
  cls = "ph",
  h?: string,
): string {
  const style = h ? `height:${h};` : "";
  if (src) {
    return `<div class='imgwrap ${cls}' style='${style}background-image:url(${src})'></div>`;
  }
  return (
    `<div class='imgwrap ${cls} placeholder' style='${style}'>` +
    `<div class='ph-label'>${e(label)}</div></div>`
  );
}

// `foot` => push the row to the bottom of a flex-column page (`.pad-col`) so it
// sits cleanly above the absolute `.pfoot` footer and never overlaps it.
function linkButtons(links?: Record<string, string> | null, center = false, foot = false): string {
  if (!links) return "";
  const order: [string, string][] = [
    ["gallery", "View Full Gallery"],
    ["video", "Watch Film"],
    ["details", "Yacht Details"],
    ["brochure", "Digital Brochure"],
  ];
  const btns: string[] = [];
  for (const [key, label] of order) {
    const url = links[key];
    if (url) btns.push(`<a class='btnlink' href='${e(url)}'>${label}</a>`);
  }
  if (!btns.length) return "";
  const cls = ["linkrow", center ? "center" : "", foot ? "foot" : ""].filter(Boolean).join(" ");
  return `<div class='${cls}'>${btns.join("")}</div>`;
}

function galleryPage(y: SingleYacht, wl = false): string {
  const imgs = y.gallery;
  const slots = y.gallery_slots;
  if (!imgs && !slots) return "";
  const cells: string[] = [];
  if (imgs) {
    imgs.forEach((src, i) =>
      cells.push(imgOrPlaceholder(src ?? null, `Gallery ${i + 1}`, "ph", "62mm")),
    );
  } else {
    for (let i = 1; i <= Number(slots); i++) {
      cells.push(imgOrPlaceholder(null, `Gallery image ${i}`, "ph", "62mm"));
    }
  }
  return `
<div class="page"><div class="pad">
  <div class="sec-title">Gallery</div>
  <hr class="hair" style="margin:5mm 0 4mm;">
  <div class="gallery">${cells.join("")}</div>
  <div class="pfoot"><span>${confLabel(wl)}</span><span>${e(y.name)} &#8226; Gallery</span></div>
</div></div>`;
}

function companyBlock(showGhost = true): string {
  let ghost = "";
  if (showGhost) {
    ghost = `
    <div style="margin-top:7mm;">
      <a href="https://ghostwebdesign.dev/" style="text-decoration:none;">
        <span class="corm" style="font-style:italic;font-size:10pt;letter-spacing:.03em;color:var(--gold-soft);">Crafted by </span><span class="cinzel" style="font-size:8.5pt;letter-spacing:.18em;color:var(--gold);">GHOST_</span><span class="corm" style="font-style:italic;font-size:10pt;letter-spacing:.03em;color:var(--gold-soft);"> - premium digital studio for the discerning few</span><span style="color:var(--gold);font-size:8.5pt;"> &#8599;</span>
      </a>
    </div>`;
  }
  return `
  <div style="margin-top:12mm;border-top:1px solid var(--hair);padding-top:6mm;text-align:center;">
    <div class="cinzel" style="font-size:13pt;letter-spacing:.16em;color:var(--ivory);">GEORGE YACHTS BROKERAGE HOUSE LLC</div>
    <div class="label dim" style="font-size:6.5pt;letter-spacing:.18em;margin-top:2mm;">
      30 N Gould St, STE R &#8226; Sheridan, WY 82801 &#8226; USA</div>
    <div class="body" style="font-size:8.5pt;margin-top:4mm;color:var(--ivory-dim);">
      georgeyachts.com &#8226; george@georgeyachts.com<br>
      Athens +30 6970380999 &#8226; Miami / WhatsApp +1 7867988798</div>
    <div class="label dim" style="font-size:5.8pt;letter-spacing:.12em;margin-top:5mm;line-height:1.6;color:var(--slate);">
      Confidential &amp; intended solely for the recipient. Charter agreement per MYBA standard terms &amp; conditions.<br>
      All rates and availability subject to change until confirmed in writing. Prices in EUR, estimates only.</div>
    ${ghost}
  </div>`;
}

// Travel-agent white-label footer: brand-free, no George Yachts identity, no
// address / phone / email / website / colophon. Keeps a generic confidentiality
// line and the same CSS classes so the styling matches the rest of the document.
function neutralFooter(): string {
  return `
  <div style="margin-top:12mm;border-top:1px solid var(--hair);padding-top:6mm;text-align:center;">
    <div class="label dim" style="font-size:6.5pt;letter-spacing:.18em;line-height:1.8;">
      Confidential charter proposal &#8226; prepared for the named recipient<br>
      All rates and availability are subject to change until confirmed in writing &#8226; Prices in EUR, estimates only<br>
      Charter agreement per MYBA standard terms &amp; conditions
    </div>
  </div>`;
}

// Footer chooser. Direct-client => the unchanged companyBlock (George Yachts +
// optional Ghost colophon). Travel-agent white-label => the neutral footer.
function footerBlock(d: { white_label?: boolean; show_ghost_credit?: boolean }): string {
  return d.white_label ? neutralFooter() : companyBlock(d.show_ghost_credit ?? true);
}

// Inner-page footer-line label. Direct-client keeps the EXACT existing string;
// white-label drops the George Yachts name to stay anonymous.
function confLabel(wl?: boolean): string {
  return wl ? "Confidential" : "George Yachts &#8226; Confidential";
}

// CSS copied VERBATIM from base_css() in build_proposal.py (after the
// embedded @font-face). The one backslash escape (\25C6 for the ◆ list
// bullet) is doubled here so the emitted CSS keeps the literal "\25C6".
function baseCss(): string {
  return (
    FONT_FACE_CSS +
    "\n" +
    `
:root{
  --navy:#0D1B2A; --navy-deep:#091420; --navy-soft:#12243A;
  --gold:#C9A84C; --gold-soft:#D8C088; --ivory:#F4F1EA; --ivory-dim:#CBC8C0;
  --slate:#8A97A6; --hair:rgba(201,168,76,0.30);
}
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:A4;margin:0;}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{font-family:'Montserrat',sans-serif;color:var(--ivory);background:var(--navy);}
.page{position:relative;width:210mm;height:297mm;overflow:hidden;
      background:var(--navy);page-break-after:always;}
.page:last-child{page-break-after:auto;}
.pad{position:absolute;inset:0;padding:20mm 18mm;}

/* typography */
.cinzel{font-family:'Cinzel',serif;}
.corm{font-family:'Cormorant',serif;}
.label{font-family:'Cinzel',serif;letter-spacing:.34em;text-transform:uppercase;
       font-size:8.5pt;color:var(--gold);font-weight:600;}
.label.dim{color:var(--slate);}
.sec-title{font-family:'Cinzel',serif;letter-spacing:.30em;text-transform:uppercase;
       font-size:10pt;color:var(--gold);font-weight:700;}
.body{font-family:'Montserrat',sans-serif;font-weight:300;font-size:10.5pt;
      line-height:1.85;color:var(--ivory-dim);}
.body b{color:var(--ivory);font-weight:500;}

.dia{color:var(--gold);font-size:7pt;vertical-align:middle;margin:0 .7em;}
.drule{display:flex;align-items:center;justify-content:center;margin:6mm 0;}
.drule span{height:1px;width:34mm;background:var(--hair);}
.hair{height:1px;background:var(--hair);border:0;width:100%;}

/* full-bleed image + overlays */
.bleed{position:absolute;inset:0;background-size:cover;background-position:center;}
.bleed.placeholder{background:var(--navy-deep);display:flex;align-items:center;justify-content:center;}
.scrim-bottom{position:absolute;inset:0;background:linear-gradient(to bottom,
      rgba(9,20,32,0) 30%, rgba(9,20,32,.55) 62%, rgba(9,20,32,.96) 100%);}
.scrim-full{position:absolute;inset:0;background:linear-gradient(135deg,
      rgba(9,20,32,.78), rgba(9,20,32,.55));}
.ph-big-label{font-family:'Cinzel',serif;letter-spacing:.3em;color:rgba(201,168,76,.5);
      font-size:9pt;text-transform:uppercase;text-align:center;
      border:1px dashed rgba(201,168,76,.4);padding:10mm 14mm;border-radius:2px;}
.ph-corner{position:absolute;top:11mm;left:18mm;z-index:3;font-family:'Cinzel',serif;
      font-size:6.5pt;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,168,76,.45);}

/* content image blocks */
.imgwrap{background-size:cover;background-position:center;border-radius:2px;width:100%;height:46mm;}
.imgwrap.placeholder{background:var(--navy-deep);border:1px dashed rgba(201,168,76,.35);
      display:flex;align-items:center;justify-content:center;}
.ph-label{font-family:'Cinzel',serif;letter-spacing:.22em;color:rgba(201,168,76,.55);
      font-size:7.5pt;text-transform:uppercase;text-align:center;padding:4mm;}
.imgrow{display:grid;grid-template-columns:1fr 1fr;gap:5mm;}

/* footer line on inner pages */
.pfoot{position:absolute;left:18mm;right:18mm;bottom:12mm;display:flex;
      justify-content:space-between;align-items:center;
      font-family:'Cinzel',serif;letter-spacing:.22em;font-size:7pt;color:var(--slate);
      text-transform:uppercase;border-top:1px solid var(--hair);padding-top:4mm;}

/* lists */
.hl{display:grid;grid-template-columns:1fr 1fr;gap:1.6mm 9mm;margin-top:5mm;}
.hl li{list-style:none;font-weight:300;font-size:9.5pt;color:var(--ivory-dim);
      line-height:1.5;padding-left:7mm;position:relative;}
.hl li::before{content:"\\25C6";color:var(--gold);font-size:6pt;position:absolute;
      left:0;top:3.5pt;}

/* spec / accommodation tables */
.kv{display:flex;justify-content:space-between;padding:3mm 0;border-bottom:1px solid var(--hair);}
.kv .k{color:var(--slate);font-weight:300;font-size:9.5pt;}
.kv .v{color:var(--ivory);font-weight:400;font-size:9.5pt;text-align:right;}
.acc-row{padding:2.6mm 0;border-bottom:1px solid var(--hair);}
.acc-row .a-name{color:var(--ivory);font-weight:500;font-size:10pt;}
.acc-row .a-desc{color:var(--slate);font-weight:300;font-size:9.5pt;margin-top:.6mm;}
.spec-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12mm;}

/* pricing */
.price-hero{font-family:'Cormorant',serif;font-weight:500;font-size:42pt;color:var(--gold);
      letter-spacing:.01em;line-height:1;}
.cost-row{display:flex;justify-content:space-between;padding:3.2mm 0;border-bottom:1px solid var(--hair);
      font-size:10.5pt;font-weight:300;color:var(--ivory-dim);}
.cost-row .amt{color:var(--ivory);font-weight:400;}
.cost-total{display:flex;justify-content:space-between;padding:4mm 0;margin-top:1mm;
      border-top:1px solid var(--gold);font-family:'Cinzel',serif;letter-spacing:.04em;}
.cost-total .lab{font-size:10pt;color:var(--gold);text-transform:uppercase;letter-spacing:.18em;}
.cost-total .amt{font-family:'Cormorant',serif;font-weight:600;font-size:18pt;color:var(--gold);}
.pay b{color:var(--gold-soft);font-weight:600;}

/* navy harmoniser over full-bleed photos so warm/pink images stay on-brand */
.bleed-tint{position:absolute;inset:0;background:rgba(10,20,33,.50);}

/* discover-more link buttons (George-hosted URLs only) */
.linkrow{display:flex;gap:5mm;flex-wrap:wrap;margin-top:7mm;}
/* flex-column page: lets .linkrow.foot sit at the bottom of the content box,
   clear of the absolute .pfoot footer (no overlap regardless of card height) */
.pad-col{display:flex;flex-direction:column;}
.linkrow.foot{margin-top:auto;margin-bottom:7mm;}
.btnlink{font-family:'Cinzel',serif;letter-spacing:.18em;text-transform:uppercase;
      font-size:7.5pt;color:var(--gold);text-decoration:none;
      border:1px solid var(--hair);padding:3mm 6mm;border-radius:2px;}
.linkrow.center{justify-content:center;}

/* gallery grid */
.gallery{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:8mm;}
.gallery .imgwrap{height:62mm;}
.gallery.three{grid-template-columns:1fr 1fr;}

/* metallic gold: champagne highlight -> gold -> bronze, with engraved depth.
   Applied to the large gold moments so they read as polished metal, not flat mustard. */
.gold-metal,.price-hero,.cost-total .amt{
  background:linear-gradient(180deg,#FBF0C4 0%,#E8CD86 40%,#CBA456 58%,#A07C32 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 1px 1px rgba(0,0,0,.40));
}
.sec-title{
  background:linear-gradient(180deg,#F4E3A0 0%,#D2AC54 62%,#A8842F 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
}
`
  );
}

function wrapPages(pages: string[], title = ""): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${e(title)}</title>\n` +
    `<style>${baseCss()}</style></head><body>${pages.join("")}</body></html>`
  );
}

// ----------------------------------------------------------------- SINGLE
function renderSingle(d: SingleProposal): string {
  const y = d.yacht;
  const pr = computePricing(y.pricing);
  const imgs: Images = y.images ?? {};
  const noMyba = d.no_myba ?? false;
  const pages: string[] = [];

  // ---- P1 COVER ----
  const cover = imgs.cover;
  const bg = cover
    ? `<div class='bleed' style="background-image:url(${cover})"></div><div class='bleed-tint'></div>`
    : `<div class='bleed placeholder'></div><div class='ph-corner'>Image &#8226; full-bleed cover</div>`;
  pages.push(`
<div class="page">
  ${bg}
  <div class="scrim-bottom"></div>
  <div class="pad" style="display:flex;flex-direction:column;">
    <div style="text-align:center;">
      <div class="label">Confidential Charter Proposal</div>
      <div class="drule"><span></span>${DIAMOND}<span></span></div>
    </div>
    <div style="flex:1.5;"></div>
    <div style="text-align:center;">
      <div class="label" style="color:var(--ivory-dim);">${e(y.type ?? "Motor Yacht")}</div>
      <h1 class="cinzel gold-metal" style="font-size:33pt;letter-spacing:.12em;color:var(--gold);
            margin:5mm 0 4mm;font-weight:700;">${e(y.name)}</h1>
      <div class="body" style="color:var(--ivory);letter-spacing:.12em;font-size:9.5pt;">${e(y.spec_line ?? "")}</div>
      <div class="drule"><span></span>${DIAMOND}<span></span></div>
      <div class="label dim" style="letter-spacing:.18em;">${e(y.period_line ?? "")}</div>
      <div class="price-hero" style="margin:7mm 0 3mm;">${pr.headline}</div>
      <div class="body" style="font-size:9pt;color:var(--slate);letter-spacing:.06em;">${e(y.price_sub ?? "")}</div>
    </div>
    <div style="flex:0.6;"></div>
    <div style="text-align:center;">
      <div class="label dim" style="font-size:6.5pt;letter-spacing:.2em;">
        This document is confidential and intended solely for the recipient</div>
    </div>
  </div>
</div>`);

  // ---- P2 THE EXPERIENCE ----
  const expParas = (y.experience_paras ?? [])
    .map((t) => `<p style='margin-bottom:3.5mm;'>${e(t)}</p>`)
    .join("");
  const highlights = y.highlights ?? [];
  let hl = "";
  if (highlights.length) {
    const items = highlights.map((h) => `<li>${e(h)}</li>`).join("");
    hl = `<div style="margin-top:9mm;"><div class="label">Key Highlights</div>
                 <ul class="hl">${items}</ul></div>`;
  }
  pages.push(`
<div class="page"><div class="pad pad-col">
  ${imgOrPlaceholder(imgs.experience, "Lifestyle image - deck / sunset / dining", "ph", "78mm")}
  <div style="margin-top:9mm;">
    <div class="sec-title">${e(y.experience_title ?? "The Experience")}</div>
    <hr class="hair" style="margin:5mm 0 7mm;">
    <div class="body">${expParas}</div>
  </div>
  ${hl}
  ${linkButtons(y.links, false, true)}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 02</span></div>
</div></div>`);

  // ---- P3 INTERIOR & LIFESTYLE ----
  const acc = y.accommodation;
  const crew = y.crew_line;
  if (acc || crew) {
    let accHtml = "";
    if (acc) {
      const rows = acc
        .map(
          (a) =>
            `<div class='acc-row'><div class='a-name'>${e(a[0])}</div>` +
            `<div class='a-desc'>${e(a[1])}</div></div>`,
        )
        .join("");
      accHtml = `<div class='label'>Accommodation</div><div style='margin-top:4mm;'>${rows}</div>`;
    }
    let crewHtml = "";
    if (crew) {
      crewHtml = `<div style='margin-top:9mm;'><div class='label'>Professional Crew</div><p class='body' style='margin-top:4mm;font-size:10pt;'>${e(crew)}</p></div>`;
    }
    pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">Interior &amp; Lifestyle</div>
  <hr class="hair" style="margin:5mm 0 7mm;">
  <div class="imgrow" style="margin-bottom:9mm;">
    ${imgOrPlaceholder(imgs.interior1, "Interior - salon / master", "ph", "58mm")}
    ${imgOrPlaceholder(imgs.interior2, "Interior - dining / detail", "ph", "58mm")}
  </div>
  ${accHtml}
  ${crewHtml}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 03</span></div>
</div></div>`);
  }

  // ---- GALLERY (optional) ----
  const gp = galleryPage(y, d.white_label);
  if (gp) pages.push(gp);

  // ---- P4 EXTERIOR & WATER TOYS ----
  const toys = y.water_toys;
  const specs = y.tech_specs;
  if (toys || specs) {
    let toysHtml = "";
    if (toys) {
      const items = toys.map((t) => `<li>${e(t)}</li>`).join("");
      toysHtml = `<div class='label'>Water Toys &amp; Tenders</div><ul class='hl'>${items}</ul>`;
    }
    let specsHtml = "";
    if (specs) {
      const half = Math.floor((specs.length + 1) / 2);
      const col1 = specs
        .slice(0, half)
        .map((s) => `<div class='kv'><span class='k'>${e(s[0])}</span><span class='v'>${e(s[1])}</span></div>`)
        .join("");
      const col2 = specs
        .slice(half)
        .map((s) => `<div class='kv'><span class='k'>${e(s[0])}</span><span class='v'>${e(s[1])}</span></div>`)
        .join("");
      specsHtml = `<div style='margin-top:10mm;'><div class='label'>Technical Specifications</div><div class='spec-grid' style='margin-top:4mm;'><div>${col1}</div><div>${col2}</div></div></div>`;
    }
    pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">Exterior &amp; Water Toys</div>
  <hr class="hair" style="margin:5mm 0 7mm;">
  ${imgOrPlaceholder(imgs.exterior, "Exterior - aerial / cruising", "ph", "62mm")}
  <div style="margin-top:9mm;">${toysHtml}</div>
  ${specsHtml}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 04</span></div>
</div></div>`);
  }

  // ---- P5 CHARTER TERMS & PRICING ----
  const details = y.pricing?.details ?? [];
  const detHtml = details
    .map((x) => `<div class='kv'><span class='k'>${e(x[0])}</span><span class='v'>${e(x[1])}</span></div>`)
    .join("");

  let costBlock = "";
  let apaNote = "";
  let payBlock = "";
  if (pr.all_inclusive) {
    costBlock = `<div class="cost-row"><span>All-inclusive</span><span class="amt">${pr.all_in}</span></div>
        <div class="body" style="margin-top:5mm;font-size:9.5pt;">Everything is included (APA, VAT, and all extras).</div>`;
    payBlock = noMyba ? "" : `
        <div style="margin-top:8mm;"><div class="label">Payment Schedule (MYBA)</div>
        <div class="body pay" style="margin-top:3mm;font-size:9.5pt;line-height:1.7;">
          <b>Upon signing of the Charter Agreement</b> - 50%: ${pr.deposit}<br>
          <b>Four weeks prior to embarkation</b> - balance: ${pr.balance}<br>
          All charges (APA, VAT and extras) are included in the all-inclusive price.
        </div></div>`;
  } else if (pr.extras_mode) {
    costBlock = `
        <div class="cost-row"><span>Charter Fee</span><span class="amt">${pr.charter_fee_disp}</span></div>
        <div class="body" style="margin-top:5mm;font-size:9.5pt;">All operating expenses (fuel, food &amp; beverages,
            port fees and provisioning) are additional and settled directly, as advised for this vessel.</div>`;
  } else {
    const crows = pr.rows
      .map(([l, a]) => `<div class='cost-row'><span>${e(l)}</span><span class='amt'>${a}</span></div>`)
      .join("");
    const total = pr.all_in
      ? `<div class='cost-total'><span class='lab'>Estimated All-In Total</span><span class='amt'>${pr.all_in}</span></div>`
      : "";
    costBlock =
      `<div class='cost-row'><span>Charter Fee</span><span class='amt'>${pr.charter_fee_disp}</span></div>` +
      (pr.discount_note ? `<div class="body" style="font-size:9.5pt;font-weight:600;color:var(--gold-soft);margin:2mm 0;">${e(pr.discount_note)}</div>` : "") +
      crows +
      total;
    apaNote = `
        <div style="margin-top:8mm;"><div class="label">About the APA</div>
        <p class="body" style="margin-top:3mm;font-size:9.5pt;">The Advance Provisioning Allowance covers fuel,
        food &amp; beverages, port fees, communications and miscellaneous costs. It is managed transparently by
        the Captain, and any unused portion is refunded in full after disembarkation with a detailed expense log.</p></div>`;
    if (noMyba) {
      payBlock = "";
    } else {
      payBlock = `
        <div style="margin-top:8mm;"><div class="label">Payment Schedule (MYBA)</div>
        <div class="body pay" style="margin-top:3mm;font-size:9.5pt;line-height:1.7;">
          <b>Upon signing of the Charter Agreement</b> - 50% of the net charter fee: ${pr.deposit}<br>
          <b>Four weeks prior to embarkation</b> - remaining 50% of the charter fee + full APA + full VAT: ${pr.balance}<br>
          <b>Post-charter</b> - unused APA refunded within four weeks with a full expense log.
        </div></div>`;
    }
  }

  // Per-guest estimate at 4 and 6 guests (when an all-in total exists).
  const perPerson = pr.per_person_4
    ? `<div style="margin-top:8mm;"><div class="label">Per Guest (estimate)</div>
        <div class="body" style="margin-top:3mm;font-size:9.5pt;line-height:1.7;">
          Based on 4 guests: <b>${pr.per_person_4}</b><br>
          Based on 6 guests: <b>${pr.per_person_6}</b>
        </div></div>`
    : "";

  const detSection = detHtml
    ? `<div style='margin-top:8mm;'><div class='label'>Charter Details</div><div style='margin-top:4mm;'>${detHtml}</div></div>`
    : "";

  pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">Charter Terms &amp; Pricing</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="text-align:center;margin-bottom:6mm;">
    <div class="price-hero">${pr.headline}</div>
    <div class="label dim" style="margin-top:3mm;letter-spacing:.16em;">${e(y.period_line ?? "")}</div>${y.voyage_line ? `\n    <div class="label dim" style="margin-top:2mm;letter-spacing:.12em;font-size:7pt;color:var(--gold-soft);">${e(y.voyage_line)}</div>` : ""}
  </div>
  ${detSection}
  <div style="margin-top:8mm;">${costBlock}</div>
  ${apaNote}
  ${payBlock}
  ${perPerson}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(y.name)} &#8226; 05</span></div>
</div></div>`);

  // ---- P6 CLOSING ----
  const close = imgs.closing;
  const cbg = close
    ? `<div class='bleed' style="background-image:url(${close})"></div><div class='bleed-tint'></div>`
    : `<div class='bleed placeholder'></div><div class='ph-corner'>Image &#8226; full-bleed closing</div>`;
  pages.push(`
<div class="page">
  ${cbg}<div class="scrim-full"></div>
  <div class="pad" style="display:flex;flex-direction:column;justify-content:center;text-align:center;">
    <div class="label" style="color:var(--gold);">${e(y.type ?? "")} &#8226; ${e(y.name)}</div>
    <div class="drule"><span></span>${DIAMOND}<span></span></div>
    <h2 class="corm" style="font-size:30pt;font-weight:500;color:var(--ivory);margin:2mm 0 5mm;">
      Your Mediterranean Journey Awaits</h2>
    <div class="body" style="font-size:9.5pt;color:var(--ivory-dim);">${e(y.spec_line ?? "")}</div>
    ${footerBlock(d)}
  </div>
</div>`);

  return wrapPages(pages, y.name);
}

// ----------------------------------------------------------------- COMBINED
function renderCombined(d: CombinedProposal): string {
  const pages: string[] = [];
  const yachts = d.yachts ?? [];
  const client = d.client_name;
  const intro = d.intro_letter ?? "";

  // ---- COVER + intro letter ----
  const cover = (d.images ?? {}).cover;
  const bg = cover
    ? `<div class='bleed' style="background-image:url(${cover})"></div><div class='bleed-tint'></div>`
    : `<div class='bleed placeholder'></div><div class='ph-corner'>Image &#8226; full-bleed cover</div>`;
  const introParas = intro
    .split("\n")
    .filter((t) => t.trim())
    .map((t) => `<p style='margin-bottom:3.5mm;'>${e(t)}</p>`)
    .join("");
  pages.push(`
<div class="page">${bg}<div class="scrim-bottom"></div>
  <div class="pad" style="display:flex;flex-direction:column;">
    <div style="text-align:center;"><div class="label">Confidential Charter Proposal</div>
      <div class="drule"><span></span>${DIAMOND}<span></span></div></div>
    <div style="margin-top:auto;text-align:center;">
      <div class="label dim">${e(d.period ?? "")}</div>
      <h1 class="cinzel gold-metal" style="font-size:26pt;letter-spacing:.10em;color:var(--gold);margin:5mm 0;font-weight:700;">
        ${client ? "Personally Curated for " + e(client) : "A Personally Curated Selection"}</h1>
      <div class="label dim" style="letter-spacing:.16em;">${e(d.guests ?? "")} &#8226; ${e(d.area ?? "Greek Waters")} &#8226; ${yachts.length} Yachts</div>
    </div>
    <div style="text-align:center;margin-top:auto;"><div class="label dim" style="font-size:6.5pt;">
      This document is confidential and intended solely for the recipient</div></div>
  </div></div>`);

  if (introParas) {
    pages.push(`
<div class="page"><div class="pad">
  <div class="sec-title">A Note From Your Broker</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div class="body">${introParas}</div>
  ${d.white_label ? "" : `<div style="margin-top:10mm;">
    <div class="corm gold-metal" style="font-size:15pt;color:var(--gold);">George Biniaris</div>
    <div class="label" style="margin-top:1mm;font-size:7.5pt;">Managing Broker &#8226; George Yachts Brokerage House LLC</div>
  </div>`}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(d.period ?? "")}</span></div>
</div></div>`);
  }

  // ---- one page per yacht (caller sorts cheapest -> priciest) ----
  yachts.forEach((y, i) => pages.push(renderCombinedYacht(y, i + 1, d)));

  // ---- key information / closing ----
  pages.push(keyInfoPage(d));
  return wrapPages(pages, d.white_label ? "Charter Proposal" : "Curated Selection" + (client ? ` - ${client}` : ""));
}

function renderCombinedYacht(y: CombinedYacht, idx: number, d: CombinedProposal): string {
  const pr = computePricing(y.pricing);
  const imgs: Images = y.images ?? {};
  const tier = y.tier_label;
  const tierHtml = tier ? `<div class='label' style='color:var(--gold-soft);'>${e(tier)}</div>` : "";
  const inside = y.inside_info;
  let insideHtml = "";
  if (inside) {
    insideHtml = `<div style="margin-top:6mm;background:var(--navy-soft);border-left:2px solid var(--gold);
            padding:5mm 6mm;border-radius:2px;">
            <div class="label" style="font-size:7.5pt;">${d.white_label ? "Inside Info" : "George's Inside Info"}</div>
            <p class="corm" style="font-style:italic;font-size:12.5pt;line-height:1.6;color:var(--ivory);margin-top:2mm;">${e(inside)}</p></div>`;
  }

  const strip = y.spec_strip ?? [];
  const stripHtml = strip
    .map(
      (s) =>
        `<div style='text-align:center;'><div class='label dim' style='font-size:6.5pt;'>${e(s[0])}</div>` +
        `<div class='corm' style='font-size:14pt;color:var(--ivory);margin-top:1mm;'>${e(s[1])}</div></div>`,
    )
    .join("");

  let cost: string;
  if (pr.all_inclusive) {
    cost =
      `<div class='cost-row'><span>All-inclusive</span><span class='amt'>${pr.all_in}</span></div>` +
      `<div class='cost-row'><span>Everything included</span><span class='amt'>APA, VAT &amp; extras</span></div>`;
  } else if (pr.extras_mode) {
    cost =
      `<div class='cost-row'><span>Charter Fee</span><span class='amt'>${pr.charter_fee_disp}</span></div>` +
      `<div class='cost-row'><span>Operating expenses</span><span class='amt'>${e(y.pricing?.extras_text ?? "")}</span></div>`;
  } else {
    const crows = pr.rows
      .map(([l, a]) => `<div class='cost-row'><span>${e(l)}</span><span class='amt'>${a}</span></div>`)
      .join("");
    const total = pr.all_in
      ? `<div class='cost-total'><span class='lab'>Estimated All-In</span><span class='amt'>${pr.all_in}</span></div>`
      : "";
    cost = `<div class='cost-row'><span>Charter Fee</span><span class='amt'>${pr.charter_fee_disp}</span></div>${pr.discount_note ? `<div class="body" style="font-size:8.5pt;font-weight:600;color:var(--gold-soft);margin:1.5mm 0;">${e(pr.discount_note)}</div>` : ""}${crows}${total}`;
  }

  const idx2 = String(idx).padStart(2, "0");
  return `
<div class="page"><div class="pad pad-col">
  ${tierHtml}
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:2mm;">
    <div><div class="label dim" style="font-size:7pt;">${e(y.type ?? "")}</div>
      <h2 class="cinzel gold-metal" style="font-size:21pt;letter-spacing:.08em;color:var(--gold);font-weight:700;margin-top:1mm;">${e(y.name)}</h2></div>
    <div class="corm" style="font-size:30pt;color:rgba(201,168,76,.25);font-weight:600;">${idx2}</div>
  </div>
  <div class="body" style="font-size:8.5pt;letter-spacing:.06em;color:var(--slate);margin-top:1mm;">${e(y.spec_line ?? "")}</div>${y.voyage_line ? `\n  <div class="body" style="font-size:8.5pt;letter-spacing:.04em;color:var(--gold-soft);margin-top:1mm;">${e(y.voyage_line)}</div>` : ""}
  ${imgOrPlaceholder(imgs.main, "Yacht image", "ph", "52mm")}
  <div style="display:flex;justify-content:space-around;margin:6mm 0;">${stripHtml}</div>
  <p class="body" style="font-size:9.5pt;">${e(y.description ?? "")}</p>
  ${insideHtml}
  <div style="margin-top:6mm;">${cost}</div>
  ${pr.per_person_4 ? `<div class="body" style="font-size:8.5pt;color:var(--slate);margin-top:3mm;">Per guest: ${pr.per_person_4} (4 guests) &#8226; ${pr.per_person_6} (6 guests)</div>` : ""}
  ${linkButtons(y.links, false, true)}
  <div class="pfoot"><span>${confLabel(d.white_label)}</span><span>${e(d.period ?? "")} &#8226; ${idx2}</span></div>
</div></div>`;
}

function keyInfoPage(d: CombinedProposal): string {
  const noMyba = d.no_myba ?? false;
  const myba = noMyba
    ? ""
    : `
      <div><div class="label">Booking &amp; Payment</div>
      <p class="body" style="font-size:9pt;margin-top:2mm;">50% deposit on signing of the MYBA e-contract. The remaining
      50% + VAT + APA is due four weeks prior to embarkation. Availability is confirmed only at the moment of booking.</p></div>`;
  return `
<div class="page"><div class="pad" style="display:flex;flex-direction:column;">
  <div class="sec-title">Key Information</div>
  <hr class="hair" style="margin:5mm 0 8mm;">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8mm;">
    <div><div class="label">What is the APA?</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">The Advance Provisioning Allowance covers fuel, port fees,
    food and beverages. Any unspent funds are refunded after disembarkation with a full expense log from the Captain.</p></div>
    ${myba}
    <div><div class="label">Crew Gratuity</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Not included in any rate. The industry standard is 10-15% of
    the charter fee, handed to the Captain at disembarkation. Discretionary, but customary for excellent service.</p></div>
    <div><div class="label">A Personal Service</div>
    <p class="body" style="font-size:9pt;margin-top:2mm;">Every option here has been selected by hand. We are with you from
    first enquiry to disembarkation - on the ground in Greece, and a message away at any hour.</p></div>
  </div>
  <div style="margin-top:auto;">${footerBlock(d)}</div>
</div></div>`;
}

// ----------------------------------------------------------------- entry
export function buildProposalHtml(d: ProposalJson): string {
  return d.mode === "combined" ? renderCombined(d) : renderSingle(d);
}
