// The frame a walkthrough reel plays inside: a 1080x1920 PNG, navy above
// and below, with a clear window in the middle where the film shows.
//
//   GET /api/og/reel-frame?frame=<JSON of a ReelFrame>
//
// The film is the yacht's own walkthrough, lying on its side for a phone
// (16:9). Rather than cut two thirds of every picture away to fill the
// screen, the film keeps its shape in a band across the middle and the
// words sit above and below it: her name and facts on top, George's own
// words underneath. The words come from src/lib/fleet-cards.ts; this file
// only draws them.
//
// Geometry is fixed and shared with src/lib/reel-plan.ts: the window is
// 1080x810, from y=400 to y=1210. Instagram covers roughly the top 220px
// and the bottom 380px of a reel with its own buttons and caption, so no
// text is drawn there.
//
// PNG, because the window must be transparent. Answers only the cron
// secret or a signed-in dashboard session.

import { ImageResponse } from "next/og";
import { requireUser } from "@/lib/require-user";
import { plainText } from "@/lib/og-plain-text";
import { REEL, type ReelFrame } from "@/lib/reel-plan";

export const runtime = "nodejs";
export const maxDuration = 30;

const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const PALE_GOLD = "#F4E4B8";
const IVORY = "#F8F5F0";
const MUTED = "rgba(248,245,240,0.72)";

function Diamond({ size }: { size: number }) {
  return <div style={{ display: "flex", width: size, height: size, background: GOLD, transform: "rotate(45deg)" }} />;
}

function Below({ frame }: { frame: ReelFrame }) {
  const W = REEL.width - 128;
  if (frame.kind === "note") {
    const text = plainText(frame.text, 190);
    return (
      <div style={{ display: "flex", width: W, fontSize: text.length > 120 ? 37 : 42, lineHeight: 1.34, color: IVORY }}>{text}</div>
    );
  }
  if (frame.kind === "suits") {
    const items = frame.items.slice(0, 3).map((s) => plainText(s, 180));
    if (items.length === 1) {
      return <div style={{ display: "flex", width: W, fontSize: items[0].length > 120 ? 37 : 42, lineHeight: 1.34, color: IVORY }}>{items[0]}</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", width: W }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", marginTop: i === 0 ? 0 : 18 }}>
            <div style={{ display: "flex", width: 40, height: 52, alignItems: "center" }}>
              <Diamond size={12} />
            </div>
            <div style={{ display: "flex", width: W - 40, fontSize: 40, lineHeight: 1.28, color: IVORY }}>{item}</div>
          </div>
        ))}
      </div>
    );
  }
  // cost
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W }}>
      <div style={{ display: "flex", fontSize: 44, lineHeight: 1.2, fontWeight: 700, color: PALE_GOLD }}>{plainText(frame.fee, 60)}</div>
      <div style={{ display: "flex", marginTop: 14, fontSize: 32, lineHeight: 1.34, color: IVORY }}>{plainText(frame.line, 120)}</div>
      <div style={{ display: "flex", marginTop: 22, fontSize: 38, lineHeight: 1.2, fontWeight: 700, color: IVORY }}>{plainText(frame.cta, 60)}</div>
    </div>
  );
}

const LABEL: Record<ReelFrame["kind"], string> = {
  note: "GEORGE'S NOTE",
  suits: "WHO SHE SUITS",
  cost: "THE WEEK, IN NUMBERS",
};

export async function GET(request: Request): Promise<Response> {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);

  let frame: ReelFrame;
  try {
    frame = JSON.parse(searchParams.get("frame") || "");
    if (!frame || !["note", "suits", "cost"].includes(frame.kind)) throw new Error("unknown frame");
    if (frame.kind === "note" && typeof frame.text !== "string") throw new Error("note needs text");
    if (frame.kind === "suits" && !Array.isArray(frame.items)) throw new Error("suits needs items");
    if (frame.kind === "cost" && typeof frame.fee !== "string") throw new Error("cost needs a fee");
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "bad frame" }, { status: 400 });
  }

  const { width: W, height: H, windowTop, windowHeight } = REEL;
  const below = H - windowTop - windowHeight;

  try {
    const image = new ImageResponse(
      (
        <div style={{ display: "flex", flexDirection: "column", width: W, height: H }}>
          {/* Above the film: her name and her facts, clear of Instagram's own header. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              width: W,
              height: windowTop - 3,
              background: NAVY,
              padding: "0 64px 30px 64px",
            }}
          >
            <div style={{ display: "flex", fontSize: 62, lineHeight: 1.08, letterSpacing: "0.05em", fontWeight: 700, color: IVORY }}>
              {plainText(frame.yacht, 30)}
            </div>
            <div style={{ display: "flex", marginTop: 12, fontSize: 27, color: MUTED }}>{plainText(frame.facts, 80)}</div>
          </div>
          <div style={{ display: "flex", width: W, height: 3, background: GOLD }} />
          {/* The window. Nothing is drawn here: the film shows through. */}
          <div style={{ display: "flex", width: W, height: windowHeight }} />
          <div style={{ display: "flex", width: W, height: 3, background: GOLD }} />
          {/* Below the film: George's words. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: W,
              height: below - 3,
              background: NAVY,
              padding: "40px 64px 0 64px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
              <Diamond size={10} />
              <div style={{ display: "flex", marginLeft: 18, fontSize: 21, letterSpacing: "0.34em", color: GOLD, fontWeight: 600 }}>
                {LABEL[frame.kind]}
              </div>
            </div>
            <Below frame={frame} />
          </div>
        </div>
      ),
      { width: W, height: H },
    );
    const png = Buffer.from(await image.arrayBuffer());
    if (png.byteLength < 1000) return Response.json({ error: "render produced no image" }, { status: 500 });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message.slice(0, 200) : "render failed" }, { status: 500 });
  }
}
