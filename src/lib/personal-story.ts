// @ts-nocheck
// A story on George's own profile each time the house publishes a post.
//
// 2026-11-20 (George). His personal profile has more followers than the
// company's (about 5,900 against 4,300) and he turned it into a Creator
// account so the system can use it. His choice: stories only, automatic.
// Each time a yacht carousel, a guide or a reel goes out on @georgeyachts,
// his profile gets one story: the same photograph, what it is, and
// "@georgeyachts", with the company account tagged.
//
// What the API cannot do, so this does not pretend to: it cannot reshare a
// post into a story and it cannot add a link sticker. The story is a
// picture with words on it and a tag.
//
// DORMANT until the account is connected. It runs only when
// settings.ig_personal_id holds his profile's Instagram id, and that id is
// only usable once the profile is linked in Meta Business so the token the
// publishing crons already use may post to it (no second token is stored).
// settings.ig_personal_stories = "false" switches it off again.
// It never throws and never delays or fails the company post it follows.

import { createServiceClient } from "@/lib/supabase-server";
import { getIgTokenOptional } from "@/lib/ig-token";
import { composeAndUploadStoryImage } from "@/lib/story-image-uploader";

const GRAPH = "https://graph.facebook.com/v21.0";
export const PERSONAL_ID_KEY = "ig_personal_id";
export const PERSONAL_SWITCH_KEY = "ig_personal_stories";
const COMPANY_HANDLE = "georgeyachts";

export type PersonalStoryResult =
  | { ok: true; media_id: string; tagged: boolean }
  | { ok: false; skipped: string }
  | { ok: false; error: string };

export async function personalAccountId(): Promise<string | null> {
  try {
    const sb = createServiceClient();
    const { data } = await sb.from("settings").select("key,value").in("key", [PERSONAL_ID_KEY, PERSONAL_SWITCH_KEY]);
    const map = new Map((data ?? []).map((r: any) => [r.key, String(r.value ?? "").trim()]));
    if (map.get(PERSONAL_SWITCH_KEY) === "false") return null;
    const id = map.get(PERSONAL_ID_KEY) ?? "";
    return /^\d{5,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function appBase(): string {
  const host =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "https://command.georgeyachts.com";
  return host.startsWith("http") ? host : `https://${host}`;
}

/** Create a story container on an account. `publish: false` stops there (containers expire unpublished). */
export async function storyOnAccount(
  accountId: string,
  imageUrl: string,
  opts: { publish: boolean },
): Promise<PersonalStoryResult & { container_id?: string; status?: string }> {
  const token = getIgTokenOptional();
  if (!token) return { ok: false, skipped: "no token" };
  const create = async (tag: boolean) => {
    const res = await fetch(`${GRAPH}/${accountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        media_type: "STORIES",
        ...(tag ? { user_tags: [{ username: COMPANY_HANDLE }] } : {}),
        access_token: token,
      }),
    });
    return await res.json().catch(() => ({}));
  };
  try {
    let tagged = true;
    let data = await create(true);
    if (!data?.id) {
      tagged = false;
      const first = data?.error?.message;
      data = await create(false);
      if (!data?.id) return { ok: false, error: String(data?.error?.message || first || "container refused").slice(0, 240) };
    }
    let status = "";
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await (await fetch(`${GRAPH}/${data.id}?fields=status_code&access_token=${encodeURIComponent(token)}`)).json().catch(() => ({}));
      status = String(s?.status_code ?? "");
      if (status === "FINISHED" || status === "ERROR") break;
    }
    if (status !== "FINISHED") return { ok: false, error: `story was not processed (${status || "no status"})`, container_id: data.id, status };
    if (!opts.publish) return { ok: true, media_id: "", tagged, container_id: data.id, status };
    const pub = await (
      await fetch(`${GRAPH}/${accountId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: data.id, access_token: token }),
      })
    ).json().catch(() => ({}));
    if (!pub?.id) return { ok: false, error: String(pub?.error?.message || "publish refused").slice(0, 240) };
    return { ok: true, media_id: pub.id, tagged };
  } catch (e) {
    return { ok: false, error: String((e as any)?.message ?? e).slice(0, 240) };
  }
}

/**
 * The story on George's profile for a post the house just published.
 * `photoUrl` is the post's lead photograph; `title` what it is.
 */
export async function publishPersonalStory(args: { photoUrl: string | null | undefined; title: string; subtitle?: string }): Promise<PersonalStoryResult> {
  try {
    const accountId = await personalAccountId();
    if (!accountId) return { ok: false, skipped: "personal profile not connected" };
    if (!args.photoUrl) return { ok: false, skipped: "no photograph" };
    const composed = await composeAndUploadStoryImage({
      photoUrl: args.photoUrl,
      displayUrl: `@${COMPANY_HANDLE}`,
      eyebrow: "New on George Yachts",
      icon: "none",
      title: args.title,
      subtitle: args.subtitle ?? "",
      appBaseUrl: appBase(),
    });
    // The composer hands back the bare photograph when it cannot draw.
    // A bare photograph with no words says nothing on his profile: skip.
    if (composed === args.photoUrl) return { ok: false, skipped: "the story picture could not be drawn" };
    return await storyOnAccount(accountId, composed, { publish: true });
  } catch (e) {
    return { ok: false, error: String((e as any)?.message ?? e).slice(0, 240) };
  }
}

/** One line for the Telegram card of the post it followed. Empty while the profile is not connected. */
export function personalStoryLine(r: PersonalStoryResult): string {
  if (r.ok) return `Story on your own profile: ✅ posted${r.tagged ? " (@georgeyachts tagged)" : " (tag refused, posted without)"}`;
  if ("skipped" in r) return r.skipped === "personal profile not connected" ? "" : `Story on your own profile: skipped (${r.skipped})`;
  return `Story on your own profile: ⚠ failed (${r.error})`;
}
