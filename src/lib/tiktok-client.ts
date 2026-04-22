// @ts-nocheck
// Thin TikTok Content Posting API wrapper.
//
// Spec: https://developers.tiktok.com/doc/content-posting-api-reference
//
// Three things this file does, nothing else:
//   1. Refresh the stored OAuth token when it's about to expire.
//   2. Upload a video/photo and start a post.
//   3. Poll post status until PUBLISH_COMPLETE (or fail).
//
// Token storage: a single row in `settings` (key='tiktok_oauth') with
// a JSON value = { access_token, refresh_token, expires_at }. The
// OAuth callback route (/api/auth/tiktok/callback) writes the first
// token after George connects @george.yachts; this helper refreshes
// it when needed.
//
// Why not use a TikTok SDK? Their official Node SDK is incomplete for
// Content Posting (focuses on Login Kit). Raw fetch is cleaner and
// easier to read in ~200 lines.

import { createServiceClient } from "@/lib/supabase-server";

const TT_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const TT_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const TT_API_BASE = "https://open.tiktokapis.com/v2";

type TikTokTokenRow = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
  open_id?: string;
};

async function loadToken(): Promise<TikTokTokenRow | null> {
  const sb = createServiceClient();
  const { data } = await sb
    .from("settings")
    .select("value")
    .eq("key", "tiktok_oauth")
    .maybeSingle();
  if (!data?.value) return null;
  try {
    return typeof data.value === "string" ? JSON.parse(data.value) : data.value;
  } catch {
    return null;
  }
}

async function saveToken(row: TikTokTokenRow): Promise<void> {
  const sb = createServiceClient();
  await sb
    .from("settings")
    .upsert(
      { key: "tiktok_oauth", value: JSON.stringify(row) },
      { onConflict: "key" }
    );
}

// Returns a valid access token, refreshing on the fly if <5 min left.
export async function getValidAccessToken(): Promise<string | null> {
  const row = await loadToken();
  if (!row) return null;
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
  if (row.expires_at > fiveMinFromNow) return row.access_token;

  // Refresh
  const body = new URLSearchParams({
    client_key: TT_CLIENT_KEY ?? "",
    client_secret: TT_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
  });
  try {
    const res = await fetch(`${TT_API_BASE}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json();
    if (!data?.access_token) return null;
    const fresh: TikTokTokenRow = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? row.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
      open_id: row.open_id,
    };
    await saveToken(fresh);
    return fresh.access_token;
  } catch {
    return null;
  }
}

// ── Video publish (single reel/video file) ──
// We use the PULL_FROM_URL path so TikTok fetches the video from our
// Supabase public bucket. Avoids the 2-step chunked upload when the
// video is already accessible on the open internet.
export async function publishVideo({
  videoUrl,
  caption,
}: {
  videoUrl: string;
  caption: string;
}): Promise<{ ok: boolean; publish_id?: string; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { ok: false, error: "no_token" };

  try {
    const res = await fetch(`${TT_API_BASE}/post/publish/video/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          brand_content_toggle: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: videoUrl,
        },
      }),
    });
    const data = await res.json();
    if (data?.data?.publish_id) {
      return { ok: true, publish_id: data.data.publish_id };
    }
    return { ok: false, error: data?.error?.message ?? "publish_init_failed" };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

// ── Photo carousel publish ──
// Up to 35 images. Good fit for our existing IG photo posts that we
// want to mirror.
export async function publishPhotos({
  photoUrls,
  caption,
}: {
  photoUrls: string[];
  caption: string;
}): Promise<{ ok: boolean; publish_id?: string; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { ok: false, error: "no_token" };
  if (photoUrls.length === 0) return { ok: false, error: "no_photos" };

  try {
    const res = await fetch(`${TT_API_BASE}/post/publish/content/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: caption.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_comment: false,
          auto_add_music: true,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: photoUrls.slice(0, 35),
          photo_cover_index: 0,
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    });
    const data = await res.json();
    if (data?.data?.publish_id) {
      return { ok: true, publish_id: data.data.publish_id };
    }
    return { ok: false, error: data?.error?.message ?? "publish_init_failed" };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

// Poll publish status. TikTok reports SEND_TO_USER_INBOX when the
// video is uploaded but not yet approved, and PUBLISH_COMPLETE once
// it's live on the feed. We wait up to ~2 min then give up and
// return PENDING.
export async function pollPublishStatus(
  publishId: string,
  maxPolls = 24
): Promise<{ status: string; raw?: unknown }> {
  const token = await getValidAccessToken();
  if (!token) return { status: "NO_TOKEN" };
  for (let i = 0; i < maxPolls; i++) {
    try {
      const res = await fetch(`${TT_API_BASE}/post/publish/status/fetch/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const data = await res.json();
      const status = data?.data?.status ?? "UNKNOWN";
      if (status === "PUBLISH_COMPLETE") return { status, raw: data };
      if (status === "FAILED") return { status, raw: data };
      await new Promise((r) => setTimeout(r, 5000));
    } catch {
      // ignore, retry
    }
  }
  return { status: "PENDING" };
}
