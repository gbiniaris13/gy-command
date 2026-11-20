// Story-image generator: photo, a heading at the top, a banner at the bottom.
//
// Meta's Content Publishing API does not let us attach a link sticker
// ("Publishing stickers (i.e., link, poll, location) is not supported"),
// so whatever the story has to say is drawn into the picture: the yacht
// or theme at the top, a call to action in a gold-bordered banner at the
// bottom ("Link in bio", 'DM me "AD ASTRA"'; see src/lib/story-cta.ts).
//
// Query params:
//   photo    = absolute URL of the source photo (required)
//   url      = main line of the banner
//   eyebrow  = small line above it
//   icon     = "none" drops the link glyph before the main line
//   title    = heading shown top-centre (yacht name / theme)
//   subtitle = second line below the title
//
// 2026-11-19: rebuilt after finding that 18 of the last 20 stories went
// out as bare photographs. The stories cron gives this route 20 seconds,
// twice, and it kept running out. Rendering depended on three things
// fetched from the internet at draw time with no time limit: a font for
// the "✦" around the brand line, the emoji artwork for "🔗", and the
// photograph at its original size. Any one of them stalling hung the
// render. Now:
//   - No glyph outside the bundled font is ever drawn. The ornaments are
//     shapes, the link glyph is an inline SVG, and incoming text is
//     reduced to characters the font has (plainText below).
//   - The photograph is asked for at story size (1080x1920 JPEG) from
//     Sanity or Cloudinary, fetched here with a time limit, and embedded.
//     A photo that cannot be fetched is a fast 502, never a hang, so the
//     cron's retry and fallback happen in seconds.
//   - The picture is rendered to bytes before anything is returned, so a
//     failed render is a 500, never a 200 with half a file.
// The same pass fixed the heading: it sat inside a React fragment, which
// the renderer laid out as a narrow column in the top-left corner with
// the title and subtitle on top of each other.

import { ImageResponse } from "next/og";
import { plainText } from "@/lib/og-plain-text";

export const runtime = "nodejs";
export const maxDuration = 30;

const W = 1080;
const H = 1920;
const NAVY = "#0D1B2A";
const GOLD = "#C9A84C";
const PHOTO_TIMEOUT_MS = 12_000;
const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** Ask the image host for the photo already cut to a story, as JPEG. */
function storyRendition(photo: string): string {
  try {
    const u = new URL(photo);
    if (u.hostname === "cdn.sanity.io") {
      return `${u.origin}${u.pathname}?w=${W}&h=${H}&fit=crop&fm=jpg&q=82`;
    }
    if (u.hostname === "res.cloudinary.com" && u.pathname.includes("/image/upload/")) {
      // Only add a transformation when the URL does not already carry one.
      const [head, tail] = u.pathname.split("/image/upload/");
      const first = tail.split("/")[0] ?? "";
      const hasTransform = /^[a-z]{1,3}_[^/]+/.test(first) && !/^v\d+$/.test(first);
      if (!hasTransform) {
        return `${u.origin}${head}/image/upload/c_fill,g_auto,w_${W},h_${H},q_auto:good,f_jpg/${tail}`;
      }
    }
  } catch {
    // fall through to the URL as given
  }
  return photo;
}

async function fetchPhotoDataUri(photo: string): Promise<string | null> {
  for (const url of [storyRendition(photo), photo]) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!res.ok) continue;
      const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (type !== "image/jpeg" && type !== "image/png") continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) continue;
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch {
      // try the next candidate
    }
    if (url === photo) break; // rendition and original were the same URL
  }
  return null;
}

function Diamond() {
  return (
    <div
      style={{
        display: "flex",
        width: 12,
        height: 12,
        background: GOLD,
        transform: "rotate(45deg)",
      }}
    />
  );
}

function LinkGlyph() {
  return (
    <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#F4E4B8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const photo = searchParams.get("photo") || "";
  const main = plainText(searchParams.get("url") || "georgeyachts.com", 70);
  const eyebrow = plainText(searchParams.get("eyebrow") || "George Yachts", 50);
  const showLinkIcon = searchParams.get("icon") !== "none";
  const title = plainText(searchParams.get("title") || "", 70);
  const subtitle = plainText(searchParams.get("subtitle") || "", 90);

  let photoData: string | null = null;
  if (photo.startsWith("http")) {
    photoData = await fetchPhotoDataUri(photo);
    if (!photoData) {
      return Response.json({ error: "photo could not be fetched as JPEG or PNG" }, { status: 502 });
    }
  }

  try {
    const image = new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: W,
            height: H,
            background: NAVY,
            position: "relative",
          }}
        >
          {photoData ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoData}
              alt=""
              width={W}
              height={H}
              style={{ position: "absolute", top: 0, left: 0, width: W, height: H, objectFit: "cover" }}
            />
          ) : null}

          {/* Dark base under the banner, whatever the photo. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: W,
              height: 600,
              display: "flex",
              background:
                "linear-gradient(to top, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.55) 55%, rgba(13,27,42,0) 100%)",
            }}
          />

          {/* Dark base under the heading. */}
          {title ? (
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: W,
                height: 520,
                display: "flex",
                background:
                  "linear-gradient(to bottom, rgba(13,27,42,0.88) 0%, rgba(13,27,42,0.55) 55%, rgba(13,27,42,0) 100%)",
              }}
            />
          ) : null}

          {/* Heading: brand line, title, subtitle. Explicit width, no fragment. */}
          {title ? (
            <div
              style={{
                position: "absolute",
                left: 70,
                top: 130,
                width: W - 140,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <Diamond />
                <div
                  style={{
                    display: "flex",
                    margin: "0 22px",
                    fontSize: 22,
                    letterSpacing: "0.42em",
                    color: GOLD,
                    fontWeight: 600,
                  }}
                >
                  GEORGE YACHTS
                </div>
                <Diamond />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginTop: 22,
                  width: W - 140,
                  color: "#F8F5F0",
                  fontSize: 64,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  textAlign: "center",
                  lineHeight: 1.1,
                  textShadow: "0 4px 24px rgba(0,0,0,0.55)",
                }}
              >
                {title}
              </div>
              {subtitle ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    marginTop: 18,
                    width: W - 200,
                    color: "rgba(248, 245, 240, 0.88)",
                    fontSize: 30,
                    letterSpacing: "0.01em",
                    textAlign: "center",
                    lineHeight: 1.35,
                    textShadow: "0 2px 12px rgba(0,0,0,0.55)",
                  }}
                >
                  {subtitle}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Banner, anchored above the controls Instagram overlays on the
              lower part of every story. */}
          <div
            style={{
              position: "absolute",
              left: 70,
              bottom: 220,
              width: W - 140,
              padding: "32px 40px",
              background: "rgba(13, 27, 42, 0.78)",
              border: `3px solid ${GOLD}`,
              borderRadius: 24,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                color: "rgba(248, 245, 240, 0.7)",
                fontSize: 28,
                letterSpacing: "0.32em",
                textTransform: "uppercase",
                fontWeight: 500,
                textAlign: "center",
              }}
            >
              {eyebrow}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 12,
                color: "#F4E4B8",
                fontSize: 54,
                fontWeight: 700,
                letterSpacing: "0.01em",
                textAlign: "center",
              }}
            >
              {showLinkIcon ? (
                <div style={{ display: "flex", marginRight: 16 }}>
                  <LinkGlyph />
                </div>
              ) : null}
              <div style={{ display: "flex" }}>{main}</div>
            </div>
          </div>
        </div>
      ),
      { width: W, height: H },
    );

    // Render to bytes here, so a failure is an honest 500.
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength < 1000) {
      return Response.json({ error: "render produced no image" }, { status: 500 });
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "render failed" },
      { status: 500 },
    );
  }
}
