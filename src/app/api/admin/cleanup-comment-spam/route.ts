// @ts-nocheck
import { NextResponse } from "next/server";

// POST /api/admin/cleanup-comment-spam
// Body: { parent_comment_id: string, dry_run?: boolean, secret: string }
//
// Instagram has no "archive replies" endpoint, but any comment made by
// our page (including replies) can be deleted via
// DELETE /{comment-id}. This endpoint walks all replies on a given
// parent comment, keeps the FIRST one chronologically (the real
// reply), and deletes every subsequent reply from @georgeyachts.
//
// Gated behind SYNC_SECRET so it can't be triggered by anyone hitting
// the public URL.

export async function POST(request: Request) {
  const token = process.env.IG_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ID;
  const expected = process.env.SYNC_SECRET;

  if (!token || !igId) {
    return NextResponse.json({ error: "IG not configured" }, { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!expected || body.secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parentId = body.parent_comment_id;
  if (!parentId) {
    return NextResponse.json(
      { error: "parent_comment_id required" },
      { status: 400 }
    );
  }

  const dryRun = body.dry_run !== false; // default to dry run for safety

  // 1. Fetch all replies to this parent comment
  let replies: any[] = [];
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${parentId}/replies?fields=id,text,username,timestamp,from&access_token=${encodeURIComponent(token)}`
    );
    const json = await res.json();
    if (!res.ok || !Array.isArray(json?.data)) {
      return NextResponse.json(
        {
          error: "Failed to fetch replies",
          detail: json?.error?.message ?? `HTTP ${res.status}`,
        },
        { status: 502 }
      );
    }
    replies = json.data;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 }
    );
  }

  // 2. Filter for replies FROM our own page (we can only delete
  //    comments we created).
  //    Instagram API returns `from.id` = our IG business id for our
  //    own replies.
  const ourReplies = replies.filter(
    (r) => r?.from?.id === igId || r?.username === "georgeyachts"
  );

  if (ourReplies.length === 0) {
    return NextResponse.json({
      ok: true,
      parent_comment_id: parentId,
      total_replies_found: replies.length,
      our_replies: 0,
      message: "No replies from our page on this comment.",
    });
  }

  // 3. Sort by timestamp ASC — keep the FIRST one, delete everything
  //    that came after it.
  ourReplies.sort((a, b) => {
    const ta = new Date(a.timestamp ?? 0).getTime();
    const tb = new Date(b.timestamp ?? 0).getTime();
    return ta - tb;
  });
  const keep = ourReplies[0];
  const toDelete = ourReplies.slice(1);

  if (toDelete.length === 0) {
    return NextResponse.json({
      ok: true,
      parent_comment_id: parentId,
      total_replies_found: replies.length,
      our_replies: ourReplies.length,
      message: "Only one reply from our page — nothing to delete.",
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      parent_comment_id: parentId,
      total_replies_found: replies.length,
      our_replies: ourReplies.length,
      would_keep: { id: keep.id, text: keep.text, timestamp: keep.timestamp },
      would_delete_count: toDelete.length,
      would_delete: toDelete.map((r) => ({
        id: r.id,
        text: (r.text ?? "").slice(0, 80),
        timestamp: r.timestamp,
      })),
      hint:
        'Re-run with {"dry_run": false} to actually delete. Live deletions are irreversible.',
    });
  }

  // 4. Actually delete the extras (sequential — batched deletes can
  //    trigger anti-abuse rate limits)
  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const r of toDelete) {
    try {
      const delRes = await fetch(
        `https://graph.instagram.com/v21.0/${r.id}?access_token=${encodeURIComponent(token)}`,
        { method: "DELETE" }
      );
      const delJson = await delRes.json().catch(() => ({}));
      if (delRes.ok && (delJson?.success === true || delJson?.success === "true" || !delJson?.error)) {
        results.push({ id: r.id, ok: true });
      } else {
        results.push({
          id: r.id,
          ok: false,
          reason: delJson?.error?.message ?? `HTTP ${delRes.status}`,
        });
      }
    } catch (err) {
      results.push({
        id: r.id,
        ok: false,
        reason: err instanceof Error ? err.message : "delete failed",
      });
    }
    // 500ms gap between deletes to stay polite with IG rate limits
    await new Promise((res) => setTimeout(res, 500));
  }

  const deleted = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: true,
    parent_comment_id: parentId,
    total_replies_found: replies.length,
    our_replies: ourReplies.length,
    kept: { id: keep.id, text: keep.text },
    deleted,
    failed: failed.length,
    failures: failed,
  });
}
