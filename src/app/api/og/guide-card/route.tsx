// One slide of a guide carousel (src/lib/guide-decks.ts), drawn as a
// 1080x1350 JPEG: the tallest shape the feed shows, so the words are read
// without a tap.
//
//   GET /api/og/guide-card?i=2&n=8&slide=<JSON of a GuideSlide>
//
// The words arrive ready; this file only draws them. Same rules as the
// other drawn pictures: nothing outside the bundled font (ornaments are
// shapes, text goes through plainText), a photograph is asked of the image
// host already cut to size and with a time limit, the picture is rendered
// to bytes before anything is returned, and a failure is an honest status.
// Answers only the cron secret or a signed-in dashboard session: the card
// carries George's name under whatever text it is given.

import { ImageResponse } from "next/og";
import sharp from "sharp";
import { requireUser } from "@/lib/require-user";
import { plainText } from "@/lib/og-plain-text";
import type { GuideSlide } from "@/lib/guide-decks";

export const runtime = "nodejs";
export const maxDuration = 30;

const W = 1080;
const H = 1350;
const PHOTO_H = 756;
const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const PALE_GOLD = "#F4E4B8";
const IVORY = "#F8F5F0";
const MUTED = "rgba(248,245,240,0.70)";
const RULE = "rgba(201,168,76,0.55)";
const PHOTO_TIMEOUT_MS = 12_000;
const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** Ask the image host for the photograph already cut to the top panel, as JPEG. */
function panelRendition(photo: string): string {
  try {
    const u = new URL(photo);
    if (u.hostname === "cdn.sanity.io") {
      return `${u.origin}${u.pathname}?w=${W}&h=${PHOTO_H}&fit=crop&fm=jpg&q=84`;
    }
    if (u.hostname === "res.cloudinary.com" && u.pathname.includes("/image/upload/")) {
      const [head, tail] = u.pathname.split("/image/upload/");
      const first = tail.split("/")[0] ?? "";
      const hasTransform = /^[a-z]{1,3}_[^/]+/.test(first) && !/^v\d+$/.test(first);
      if (!hasTransform) {
        return `${u.origin}${head}/image/upload/c_fill,g_auto,w_${W},h_${PHOTO_H},q_auto:good,f_jpg/${tail}`;
      }
    }
  } catch {
    // fall through to the address as given
  }
  return photo;
}

/** Only photographs from the two hosts this house stores pictures on. */
function allowedPhoto(photo: unknown): photo is string {
  if (typeof photo !== "string") return false;
  try {
    const u = new URL(photo);
    return u.protocol === "https:" && (u.hostname === "cdn.sanity.io" || u.hostname === "res.cloudinary.com");
  } catch {
    return false;
  }
}

async function fetchPhotoDataUri(photo: string): Promise<string | null> {
  try {
    const res = await fetch(panelRendition(photo), { cache: "no-store", signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "image/jpeg" && type !== "image/png") return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function Diamond({ size }: { size: number }) {
  return <div style={{ display: "flex", width: size, height: size, background: GOLD, transform: "rotate(45deg)" }} />;
}

function Label({ text, center }: { text: string; center?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: center ? "center" : "flex-start" }}>
      <Diamond size={10} />
      <div style={{ display: "flex", marginLeft: 18, marginRight: 18, fontSize: 21, letterSpacing: "0.34em", color: GOLD, fontWeight: 600 }}>
        {text}
      </div>
      {center ? <Diamond size={10} /> : null}
    </div>
  );
}

function PageFoot({ page }: { page: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
      <div style={{ display: "flex", fontSize: 18, letterSpacing: "0.34em", color: GOLD, fontWeight: 600 }}>GEORGE YACHTS</div>
      <div style={{ display: "flex", fontSize: 20, letterSpacing: "0.12em", color: MUTED }}>{page}</div>
    </div>
  );
}

/** A slide with a photograph on top and words in the panel below it. */
function PhotoSlide({ photo, page, children }: { photo: string; page: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: H, background: NAVY }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo} width={W} height={PHOTO_H} alt="" style={{ width: W, height: PHOTO_H, objectFit: "cover" }} />
      <div style={{ display: "flex", width: W, height: 3, background: GOLD }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: W,
          height: H - PHOTO_H - 3,
          padding: "50px 64px 44px 64px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
        <PageFoot page={page} />
      </div>
    </div>
  );
}

/** A slide of words alone, inside the gold hairline. */
function TextSlide({ label, page, center, children }: { label: string; page: string; center?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", width: W, height: H, background: NAVY, padding: 24 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: W - 48,
          height: H - 48,
          border: `1px solid ${RULE}`,
          padding: "64px 64px 46px 64px",
        }}
      >
        <Label text={label} center={center} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: center ? "center" : "flex-start", width: "100%" }}>{children}</div>
        <PageFoot page={page} />
      </div>
    </div>
  );
}

function Heading({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <div style={{ display: "flex", fontSize: 56, lineHeight: 1.14, fontWeight: 700, color: IVORY }}>{text}</div>
      <div style={{ display: "flex", width: 96, height: 3, background: GOLD, marginTop: 30, marginBottom: 40 }} />
    </div>
  );
}

function draw(slide: GuideSlide, photo: string | null, page: string) {
  const INNER = W - 48 - 128;
  if (slide.kind === "cover") {
    const title = plainText(slide.title, 90);
    const sub = plainText(slide.sub, 110);
    if (photo) {
      return (
        <PhotoSlide photo={photo} page={page}>
          <Label text={plainText(slide.label, 30)} />
          <div style={{ display: "flex", marginTop: 26, fontSize: title.length > 48 ? 52 : 60, lineHeight: 1.12, fontWeight: 700, color: IVORY }}>
            {title}
          </div>
          <div style={{ display: "flex", marginTop: 22, fontSize: 30, lineHeight: 1.3, color: MUTED }}>{sub}</div>
        </PhotoSlide>
      );
    }
    return (
      <TextSlide label={plainText(slide.label, 30)} page={page} center>
        <div style={{ display: "flex", width: INNER, justifyContent: "center", textAlign: "center", fontSize: 76, lineHeight: 1.12, fontWeight: 700, color: IVORY }}>
          {title}
        </div>
        <div style={{ display: "flex", width: 96, height: 3, background: GOLD, marginTop: 44, marginBottom: 44 }} />
        <div style={{ display: "flex", width: INNER, justifyContent: "center", textAlign: "center", fontSize: 36, lineHeight: 1.34, color: MUTED }}>
          {sub}
        </div>
      </TextSlide>
    );
  }
  if (slide.kind === "text") {
    const body = plainText(slide.body, 340);
    return (
      <TextSlide label={plainText(slide.label, 30)} page={page}>
        <Heading text={plainText(slide.heading, 60)} />
        <div style={{ display: "flex", width: INNER, fontSize: body.length > 220 ? 38 : 44, lineHeight: 1.38, color: IVORY }}>{body}</div>
      </TextSlide>
    );
  }
  if (slide.kind === "list") {
    const items = slide.items.slice(0, 5).map((s) => plainText(s, 80));
    return (
      <TextSlide label={plainText(slide.label, 30)} page={page}>
        <Heading text={plainText(slide.heading, 60)} />
        <div style={{ display: "flex", flexDirection: "column", width: INNER }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", marginTop: i === 0 ? 0 : 30 }}>
              <div style={{ display: "flex", width: 44, height: 50, alignItems: "center" }}>
                <Diamond size={12} />
              </div>
              <div style={{ display: "flex", width: INNER - 44, fontSize: 38, lineHeight: 1.3, color: IVORY }}>{item}</div>
            </div>
          ))}
        </div>
        {slide.foot ? (
          <div style={{ display: "flex", width: INNER, marginTop: 48, fontSize: 30, lineHeight: 1.36, color: MUTED }}>{plainText(slide.foot, 120)}</div>
        ) : null}
      </TextSlide>
    );
  }
  if (slide.kind === "rows") {
    const rows = slide.rows.slice(0, 4);
    return (
      <TextSlide label={plainText(slide.label, 30)} page={page}>
        <Heading text={plainText(slide.heading, 60)} />
        <div style={{ display: "flex", flexDirection: "column", width: INNER }}>
          {rows.map((row, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                paddingTop: i === 0 ? 0 : 24,
                paddingBottom: 24,
                borderBottom: i === rows.length - 1 ? "0px solid transparent" : "1px solid rgba(248,245,240,0.16)",
              }}
            >
              <div style={{ display: "flex", fontSize: 20, letterSpacing: "0.26em", color: GOLD, fontWeight: 600 }}>
                {plainText(row.label, 40).toUpperCase()}
              </div>
              <div style={{ display: "flex", width: INNER, marginTop: 10, fontSize: 35, lineHeight: 1.3, color: IVORY }}>{plainText(row.value, 110)}</div>
            </div>
          ))}
        </div>
        {slide.foot ? (
          <div style={{ display: "flex", width: INNER, marginTop: 30, fontSize: 27, lineHeight: 1.36, color: MUTED }}>{plainText(slide.foot, 120)}</div>
        ) : null}
      </TextSlide>
    );
  }
  if (slide.kind === "yacht") {
    if (!photo) return null;
    const note = plainText(slide.note, 160);
    return (
      <PhotoSlide photo={photo} page={page}>
        <Label text={plainText(slide.label, 20)} />
        <div style={{ display: "flex", marginTop: 20, fontSize: 54, lineHeight: 1.1, letterSpacing: "0.04em", fontWeight: 700, color: IVORY }}>
          {plainText(slide.name, 30)}
        </div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 25, color: MUTED }}>{plainText(slide.facts, 80)}</div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 34, fontWeight: 700, color: PALE_GOLD }}>{plainText(slide.fee, 60)}</div>
        {note ? <div style={{ display: "flex", marginTop: 18, fontSize: 28, lineHeight: 1.34, color: IVORY }}>{note}</div> : null}
      </PhotoSlide>
    );
  }
  // The closing card.
  return (
    <TextSlide label="YOUR WEEK" page={page} center>
      <div style={{ display: "flex", fontSize: 40, color: MUTED }}>DM me</div>
      <div style={{ display: "flex", marginTop: 18, fontSize: 124, lineHeight: 1.05, letterSpacing: "0.06em", fontWeight: 700, color: PALE_GOLD }}>
        {`"${plainText(slide.keyword, 12).toUpperCase()}"`}
      </div>
      <div style={{ display: "flex", width: INNER, marginTop: 34, justifyContent: "center", textAlign: "center", fontSize: 38, lineHeight: 1.36, color: IVORY }}>
        {plainText(slide.line, 130)}
      </div>
      <div style={{ display: "flex", width: 96, height: 3, background: GOLD, marginTop: 54, marginBottom: 40 }} />
      <div style={{ display: "flex", fontSize: 36, color: IVORY }}>George P. Biniaris</div>
      <div style={{ display: "flex", marginTop: 10, fontSize: 22, color: MUTED }}>Founder and Managing Broker</div>
    </TextSlide>
  );
}

const KINDS = ["cover", "text", "list", "rows", "yacht", "end"];

export async function GET(request: Request): Promise<Response> {
  const denied = await requireUser(request);
  if (denied) return denied;
  const { searchParams } = new URL(request.url);

  let slide: GuideSlide;
  try {
    slide = JSON.parse(searchParams.get("slide") || "");
    if (!slide || !KINDS.includes(slide.kind)) throw new Error("unknown slide");
    if (slide.kind === "list" && !Array.isArray(slide.items)) throw new Error("list needs items");
    if (slide.kind === "rows" && !Array.isArray(slide.rows)) throw new Error("rows needs rows");
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "bad slide" }, { status: 400 });
  }
  const i = Math.min(10, Math.max(1, parseInt(searchParams.get("i") || "1", 10) || 1));
  const n = Math.min(10, Math.max(i, parseInt(searchParams.get("n") || "1", 10) || 1));
  const page = `${i} / ${n}`;

  let photo: string | null = null;
  if ((slide.kind === "cover" || slide.kind === "yacht") && allowedPhoto(slide.photo)) {
    photo = await fetchPhotoDataUri(slide.photo);
  }
  // A yacht slide is her photograph. Without it there is no slide.
  if (slide.kind === "yacht" && !photo) {
    return Response.json({ error: "photograph could not be loaded" }, { status: 502 });
  }

  try {
    const tree = draw(slide, photo, page);
    if (!tree) return Response.json({ error: "nothing to draw" }, { status: 500 });
    const image = new ImageResponse(tree, { width: W, height: H });
    const png = Buffer.from(await image.arrayBuffer());
    if (png.byteLength < 1000) return Response.json({ error: "render produced no image" }, { status: 500 });
    const jpeg = await sharp(png).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message.slice(0, 200) : "render failed" }, { status: 500 });
  }
}
