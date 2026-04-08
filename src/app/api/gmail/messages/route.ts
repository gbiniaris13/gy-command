import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  headers?: GmailHeader[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload?: GmailMessagePart;
}

function getHeader(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q") ?? "in:inbox";
  const maxResults = searchParams.get("maxResults") ?? "20";
  const pageToken = searchParams.get("pageToken") ?? "";

  try {
    // List message IDs
    const listParams = new URLSearchParams({
      q,
      maxResults,
      ...(pageToken ? { pageToken } : {}),
    });

    const listRes = await gmailFetch(`/messages?${listParams.toString()}`);
    if (!listRes.ok) {
      const text = await listRes.text();
      return NextResponse.json({ error: text }, { status: listRes.status });
    }

    const listData = await listRes.json();
    const messageIds: { id: string }[] = listData.messages ?? [];
    const nextPageToken: string | undefined = listData.nextPageToken;

    if (messageIds.length === 0) {
      return NextResponse.json({ messages: [], nextPageToken: null });
    }

    // Fetch each message in metadata format
    const messages = await Promise.all(
      messageIds.map(async ({ id }) => {
        const res = await gmailFetch(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!res.ok) return null;
        const msg: GmailMessage = await res.json();
        const headers = msg.payload?.headers ?? [];

        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          subject: getHeader(headers, "Subject"),
          snippet: msg.snippet,
          date: getHeader(headers, "Date") || new Date(parseInt(msg.internalDate)).toISOString(),
          labelIds: msg.labelIds ?? [],
          isStarred: (msg.labelIds ?? []).includes("STARRED"),
        };
      })
    );

    return NextResponse.json({
      messages: messages.filter(Boolean),
      nextPageToken: nextPageToken ?? null,
    });
  } catch (err) {
    console.error("[Gmail] List messages error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
