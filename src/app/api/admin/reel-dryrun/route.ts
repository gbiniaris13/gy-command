// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { getIgTokenOptional } from "@/lib/ig-token";
import { loadReelState, reelCandidates, prepareReel, cleanupReel, readReady } from "@/lib/reel-build";
import { buildReelFrames, candidateWindows, reelCaption } from "@/lib/reel-plan";

export const maxDuration = 300;

// GET /api/admin/reel-dryrun
//
// Shows the walkthrough reel the crons would make, without publishing.
//   (nothing)        which yachts are next in line, what is waiting, what was set aside
//   ?yacht_id=<id>   the plan for one yacht: frames, stretches, caption
//   &make=1          really makes her reel in the media store (film stored,
//                    frames checked, words laid over) and returns its address
//   &container=1     with make=1: also hands the film to Instagram as an
//                    UNPUBLISHED container and reports whether Instagram
//                    accepts it. Nothing is published; the container expires.
//   &keep=1          with make=1: leave the stored film in place (default: deleted)
export async function GET(req: NextRequest) {
  const denied = await requireUser(req);
  if (denied) return denied;
  const { searchParams, origin } = new URL(req.url);

  const state = await loadReelState();
  const candidates = await reelCandidates(state);
  const yachtId = searchParams.get("yacht_id");

  if (!yachtId) {
    return NextResponse.json({
      waiting: await readReady(),
      candidates: candidates.length,
      next: candidates.slice(0, 8).map((y) => ({ _id: y._id, name: y.name, seconds: y.video?.durationSeconds ?? null, last_reel: state.posted[y._id] ?? null })),
      shown: Object.keys(state.posted).length,
      set_aside: state.rejected,
    });
  }

  const yacht = candidates.find((y) => y._id === yachtId);
  if (!yacht) return NextResponse.json({ error: "not a candidate (not cleared, no film, nothing written, or set aside)" }, { status: 404 });

  const plan = {
    yacht: yacht.name,
    film: yacht.video,
    frames: buildReelFrames(yacht),
    stretches: candidateWindows(Number(yacht.video?.durationSeconds) || 0),
    caption: reelCaption(yacht),
  };
  if (searchParams.get("make") !== "1") return NextResponse.json(plan);

  const result = await prepareReel(yacht, origin, { deadlineMs: Date.now() + 200_000 });
  let container: any = null;
  if (result.ok && searchParams.get("container") === "1") {
    const igToken = getIgTokenOptional();
    const igId = process.env.IG_BUSINESS_ID;
    if (!igToken || !igId) container = { error: "IG not configured here" };
    else {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${igId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_type: "REELS", video_url: result.reel.videoUrl, caption: result.reel.caption, thumb_offset: 1000, share_to_feed: true, access_token: igToken }),
        });
        const data = await res.json();
        container = { id: data.id ?? null, error: data.error?.message ?? null };
        if (data.id) {
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            const s = await (await fetch(`https://graph.facebook.com/v21.0/${data.id}?fields=status_code,status&access_token=${encodeURIComponent(igToken)}`)).json();
            container.status_code = s.status_code ?? null;
            container.status = s.status ?? null;
            if (s.status_code === "FINISHED" || s.status_code === "ERROR") break;
          }
          container.note = "Not published. An unpublished container expires by itself.";
        }
      } catch (e) {
        container = { error: String((e as any)?.message ?? e).slice(0, 200) };
      }
    }
  }
  // With a container in play the film must stay until Instagram has fetched it; it has by now.
  if (searchParams.get("keep") !== "1") await cleanupReel(String(yacht.slug ?? yacht._id));
  return NextResponse.json({ ...plan, result, container, kept: searchParams.get("keep") === "1" });
}
