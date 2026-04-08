import { NextRequest, NextResponse } from "next/server";
import { gmailFetch } from "@/lib/google-api";

function createRawEmail(
  to: string,
  subject: string,
  body: string,
  threadId?: string,
  inReplyTo?: string
): string {
  const boundary = "boundary_" + Date.now();
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }

  lines.push("", `--${boundary}`);
  lines.push("Content-Type: text/plain; charset=UTF-8", "", body);
  lines.push(
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    body.replace(/\n/g, "<br>")
  );
  lines.push(`--${boundary}--`);

  // Suppress threadId unused warning — it's used in the API call body
  void threadId;

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

export async function POST(request: NextRequest) {
  try {
    const { to, subject, body, threadId, inReplyTo } = await request.json();

    if (!to || !body) {
      return NextResponse.json(
        { error: "Missing required fields: to, body" },
        { status: 400 }
      );
    }

    const raw = createRawEmail(to, subject ?? "", body, threadId, inReplyTo);

    const sendBody: Record<string, string> = { raw };
    if (threadId) {
      sendBody.threadId = threadId;
    }

    const res = await gmailFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify(sendBody),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, messageId: data.id });
  } catch (err) {
    console.error("[Gmail] Send error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
