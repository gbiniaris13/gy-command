// /api/gmail/trash — move a Gmail message to Trash. Recoverable for
// 30 days inside Gmail before Gmail itself permanently deletes it.
// We never call /delete (permanent) per the safety rules.

import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";

export async function POST(request: NextRequest) {
  try {
    const { messageId } = await request.json();

    if (!messageId) {
      return NextResponse.json(
        { error: "Missing messageId" },
        { status: 400 },
      );
    }

    const res = await gmailFetch(`/messages/${messageId}/trash`, {
      method: "POST",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Companion endpoint to UNDO a trash — moves the message back to inbox.
// Called by the Email view's "UNDO" toast after a swipe-to-delete.
export async function DELETE(request: NextRequest) {
  try {
    const { messageId } = await request.json();

    if (!messageId) {
      return NextResponse.json(
        { error: "Missing messageId" },
        { status: 400 },
      );
    }

    const res = await gmailFetch(`/messages/${messageId}/untrash`, {
      method: "POST",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
