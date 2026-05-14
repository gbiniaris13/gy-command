// Story-image generator with a visible URL banner baked in.
//
// Meta's Content Publishing API does NOT let us add an Instagram Link
// Sticker programmatically — link stickers are app-only. Workaround:
// we compose a 1080×1920 story image where the original photo is the
// background and a gold-bordered URL banner sits anchored at the
// bottom. Viewers see the destination clearly and can long-press
// (iOS) or simply type it into a browser.
//
// Uses Next.js's built-in `ImageResponse` (next/og) — Edge runtime,
// zero new dependencies, free forever.
//
// Query params:
//   photo    = absolute URL of the source photo (required)
//   url      = display URL string ("georgeyachts.com/yachts/alena")
//   eyebrow  = optional small line above the URL ("Open in browser")
//   title    = optional headline shown TOP-CENTER (yacht name / theme)
//   subtitle = optional second line below the title
//
// 2026-05-14 — added top caption (title + subtitle) after George
// flagged stories were going up "with no text on them". The story
// is now visually self-contained: yacht/theme heading at the top,
// photo in the middle, gold URL banner at the bottom.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const photo = searchParams.get("photo") || "";
  const displayUrl = (searchParams.get("url") || "georgeyachts.com").slice(0, 70);
  const eyebrow = (searchParams.get("eyebrow") || "Open in browser").slice(0, 50);
  const title = (searchParams.get("title") || "").slice(0, 70);
  const subtitle = (searchParams.get("subtitle") || "").slice(0, 90);

  // If the photo URL is missing or malformed we still emit a placeholder
  // story rather than 500 — keeps the IG cron from failing on weird
  // edge cases.
  const safePhoto = photo.startsWith("http") ? photo : "";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: 1080,
          height: 1920,
          background: "#0D1B2A",
          position: "relative",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Background photo (cover-fitted to the 9:16 frame) */}
        {safePhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={safePhoto}
            alt=""
            width={1080}
            height={1920}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 1080,
              height: 1920,
              objectFit: "cover",
            }}
          />
        ) : null}

        {/* Subtle gradient at the bottom so the URL banner sits on a
            dark base regardless of the underlying photo. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 600,
            background:
              "linear-gradient(to top, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.55) 55%, rgba(13,27,42,0) 100%)",
            display: "flex",
          }}
        />

        {/* Top gradient + headline block — only emitted when a title
            is present. Mirrors the dark band at the bottom so the
            yacht name / theme reads regardless of the photo's hue. */}
        {title ? (
          <>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                height: 500,
                background:
                  "linear-gradient(to bottom, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.55) 55%, rgba(13,27,42,0) 100%)",
                display: "flex",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 70,
                right: 70,
                top: 130,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  fontSize: 22,
                  letterSpacing: "0.42em",
                  textTransform: "uppercase",
                  color: "#C9A84C",
                  fontWeight: 600,
                }}
              >
                <span style={{ display: "flex" }}>✦</span>
                <span style={{ display: "flex" }}>GEORGE YACHTS</span>
                <span style={{ display: "flex" }}>✦</span>
              </div>
              <div
                style={{
                  color: "#F8F5F0",
                  fontSize: 64,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  textAlign: "center",
                  lineHeight: 1.1,
                  display: "flex",
                  textShadow: "0 4px 24px rgba(0,0,0,0.55)",
                  maxWidth: 940,
                }}
              >
                {title}
              </div>
              {subtitle ? (
                <div
                  style={{
                    color: "rgba(248, 245, 240, 0.85)",
                    fontSize: 30,
                    fontWeight: 400,
                    fontStyle: "italic",
                    letterSpacing: "0.01em",
                    textAlign: "center",
                    lineHeight: 1.35,
                    display: "flex",
                    maxWidth: 880,
                    textShadow: "0 2px 12px rgba(0,0,0,0.55)",
                  }}
                >
                  {subtitle}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {/* URL banner — gold border, ivory text, anchored above the
            iOS story controls (which Instagram overlays on the lower
            ~110 px of every story). */}
        <div
          style={{
            position: "absolute",
            left: 70,
            right: 70,
            bottom: 220,
            padding: "32px 40px",
            background: "rgba(13, 27, 42, 0.78)",
            border: "3px solid #C9A84C",
            borderRadius: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              color: "rgba(248, 245, 240, 0.65)",
              fontSize: 28,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              fontWeight: 500,
              display: "flex",
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              color: "#F4E4B8",
              fontSize: 54,
              fontWeight: 700,
              letterSpacing: "0.01em",
              display: "flex",
              alignItems: "center",
              gap: 14,
              textAlign: "center",
              maxWidth: 920,
              wordBreak: "break-word",
            }}
          >
            <span style={{ fontSize: 56, display: "flex" }}>🔗</span>
            <span style={{ display: "flex" }}>{displayUrl}</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1920,
      // Edge response cache: 1h is plenty — the IG container fetches
      // once during media creation; we never re-serve.
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    },
  );
}
