// Text cards for a yacht carousel: George's note, who she suits, what the
// week costs. The words come from src/lib/fleet-cards.ts, which takes them
// from George's own text on the yacht's page; this file only draws them.
//
//   GET /api/og/post-card?w=1080&h=720&card=<JSON of a Card>
//
// Instagram crops every slide of a carousel to the shape of the first, so
// the caller asks for the hero photograph's shape (cardSizeFor) and the
// layout scales with the height. Returns JPEG: the publishing API takes
// JPEG only for feed images.
//
// Same rules as the story composer: nothing outside the bundled font is
// drawn (ornaments are shapes, text goes through plainText), the picture
// is rendered to bytes before anything is returned, and a failure is an
// honest error status.

import { requireUser } from "@/lib/require-user";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { plainText } from "@/lib/og-plain-text";
import type { Card } from "@/lib/fleet-cards";

export const runtime = "nodejs";
export const maxDuration = 30;

const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const IVORY = "#F8F5F0";

function Diamond({ size }: { size: number }) {
  return <div style={{ display: "flex", width: size, height: size, background: GOLD, transform: "rotate(45deg)" }} />;
}

function Header({ label, yacht, k }: { label: string; yacht: string; k: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Diamond size={Math.round(10 * k)} />
        <div
          style={{
            display: "flex",
            margin: `0 ${Math.round(20 * k)}px`,
            fontSize: Math.round(20 * k),
            letterSpacing: "0.38em",
            color: GOLD,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        <Diamond size={Math.round(10 * k)} />
      </div>
      <div
        style={{
          display: "flex",
          marginTop: Math.round(12 * k),
          fontSize: Math.round(30 * k),
          letterSpacing: "0.14em",
          color: IVORY,
          fontWeight: 700,
        }}
      >
        {yacht.toUpperCase()}
      </div>
    </div>
  );
}

function Body({ card, k, innerW }: { card: Card; k: number; innerW: number }) {
  if (card.kind === "note") {
    const text = plainText(card.text, 260);
    const size = text.length <= 120 ? 44 : text.length <= 180 ? 38 : 33;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: innerW }}>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            width: innerW,
            fontSize: Math.round(size * k),
            lineHeight: 1.36,
            color: IVORY,
            textAlign: "center",
          }}
        >
          {text}
        </div>
      </div>
    );
  }
  if (card.kind === "suits") {
    const items = card.items.map((s) => plainText(s, 180));
    if (items.length === 1) {
      return (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            width: innerW,
            fontSize: Math.round(36 * k),
            lineHeight: 1.36,
            color: IVORY,
            textAlign: "center",
          }}
        >
          {items[0]}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", width: innerW }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", marginTop: i === 0 ? 0 : Math.round(22 * k) }}>
            <div style={{ display: "flex", width: Math.round(46 * k), justifyContent: "center" }}>
              <Diamond size={Math.round(11 * k)} />
            </div>
            <div style={{ display: "flex", width: innerW - Math.round(46 * k), fontSize: Math.round(34 * k), lineHeight: 1.25, color: IVORY }}>
              {item}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const labelW = Math.round(215 * k);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: innerW }}>
      {card.rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "flex-start",
            paddingTop: i === 0 ? 0 : Math.round(15 * k),
            marginTop: i === 0 ? 0 : Math.round(15 * k),
            borderTop: i === 0 ? "0px solid transparent" : "1px solid rgba(201,168,76,0.28)",
          }}
        >
          <div
            style={{
              display: "flex",
              width: labelW,
              paddingTop: Math.round(5 * k),
              fontSize: Math.round(17 * k),
              letterSpacing: "0.2em",
              color: GOLD,
              fontWeight: 600,
            }}
          >
            {plainText(row.label, 30).toUpperCase()}
          </div>
          <div style={{ display: "flex", width: innerW - labelW, fontSize: Math.round(25 * k), lineHeight: 1.3, color: IVORY }}>
            {plainText(row.value, 150)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Footer({ card, k }: { card: Card; k: number }) {
  if (card.kind === "note") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: Math.round(27 * k), color: IVORY, fontWeight: 600 }}>George P. Biniaris</div>
        <div style={{ display: "flex", marginTop: Math.round(6 * k), fontSize: Math.round(15 * k), letterSpacing: "0.36em", color: GOLD }}>
          GEORGE YACHTS
        </div>
      </div>
    );
  }
  const text = card.kind === "suits" ? plainText(card.facts, 90) : plainText(card.cta, 60);
  return (
    <div
      style={{
        display: "flex",
        fontSize: Math.round((card.kind === "cost" ? 27 : 23) * k),
        letterSpacing: card.kind === "cost" ? "0.02em" : "0.06em",
        color: card.kind === "cost" ? "#F4E4B8" : "rgba(248,245,240,0.72)",
        fontWeight: card.kind === "cost" ? 700 : 400,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

const LABEL: Record<Card["kind"], string> = {
  note: "GEORGE'S NOTE",
  suits: "WHO SHE SUITS",
  cost: "THE WEEK, IN NUMBERS",
};

export async function GET(request: Request): Promise<Response> {
  // The card carries George's name under whatever text it is given, so it
  // is not drawn for strangers: only for the cron (bearer) and for a
  // signed-in dashboard session (the preview links).
  const denied = await requireUser(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const w = Math.min(1440, Math.max(600, parseInt(searchParams.get("w") || "1080", 10) || 1080));
  const h = Math.min(1800, Math.max(500, parseInt(searchParams.get("h") || "720", 10) || 720));

  let card: Card;
  try {
    card = JSON.parse(searchParams.get("card") || "");
    if (!card || !["note", "suits", "cost"].includes(card.kind)) throw new Error("unknown card");
    if (card.kind === "note" && typeof card.text !== "string") throw new Error("note needs text");
    if (card.kind === "suits" && !Array.isArray(card.items)) throw new Error("suits needs items");
    if (card.kind === "cost" && !Array.isArray(card.rows)) throw new Error("cost needs rows");
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "bad card" }, { status: 400 });
  }

  // Everything scales with the height; a 16:9 hero gives a 607px card.
  const k = Math.min(1.45, Math.max(0.74, h / 760)) * (w / 1080);
  const pad = Math.round(54 * k);
  const frame = Math.round(22 * k);
  const innerW = w - 2 * (pad + frame) - Math.round(40 * k);

  try {
    const image = new ImageResponse(
      (
        <div style={{ display: "flex", width: w, height: h, background: NAVY, padding: frame }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "space-between",
              width: w - 2 * frame,
              height: h - 2 * frame,
              border: "1px solid rgba(201,168,76,0.55)",
              padding: `${pad}px ${pad}px`,
            }}
          >
            <Header label={LABEL[card.kind]} yacht={plainText(card.yacht, 40)} k={k} />
            <Body card={card} k={k} innerW={innerW} />
            <Footer card={card} k={k} />
          </div>
        </div>
      ),
      { width: w, height: h },
    );
    const png = Buffer.from(await image.arrayBuffer());
    if (png.byteLength < 1000) return Response.json({ error: "render produced no image" }, { status: 500 });
    const jpeg = await sharp(png).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600, s-maxage=3600" },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message.slice(0, 200) : "render failed" }, { status: 500 });
  }
}
