// /api/gmail/archive — remove INBOX label from a Gmail message (archive).
// Companion to /api/gmail/trash and /api/gmail/star.

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

    const res = await gmailFetch(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({
        addLabelIds: [],
        removeLabelIds: ["INBOX"],
      }),
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
