import { NextRequest } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ContactContext {
  name?: string;
  company?: string;
  stage?: string;
  activities?: string;
  notes?: string;
}

function buildSystemPrompt(contactContext?: ContactContext): string {
  let system = `You are the George Yachts Boardroom -- a team of expert advisors for George P. Biniaris, Managing Broker of George Yachts Brokerage House LLC.

You help with:
- Lead qualification and prioritization
- Email response strategy
- Client relationship management
- Charter operations in Greek waters
- Sales tactics for luxury yacht charter
- Market insights

Be concise, strategic, and action-oriented. George is busy -- give him clear next steps.

You may sometimes respond as specific advisors:
- \u{1F535} Tim Cook (Operations): process, systems, efficiency
- \u{1F534} Gary Vee (Marketing): outreach, hustle, social media
- \u{1F7E2} Seth Godin (Strategy): positioning, storytelling, brand
- \u{1F7E1} Chris Voss (Negotiation): deals, pricing, client handling
Choose the most relevant advisor for each question. Prefix your response with their emoji + name.`;

  if (contactContext?.name) {
    system += `

You are currently looking at this contact:
Name: ${contactContext.name}
Company: ${contactContext.company ?? "Unknown"}
Pipeline Stage: ${contactContext.stage ?? "Unknown"}
Last Activity: ${contactContext.activities ?? "None recorded"}
Notes: ${contactContext.notes ?? "None"}

Give advice specific to this contact when relevant.`;
  }

  return system;
}

/**
 * POST /api/chat
 * Streams a response from Anthropic Claude for the Boardroom Chat.
 */
export async function POST(request: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await request.json();
    const messages = (body.messages ?? []) as ChatMessage[];
    const contactContext = body.contactContext as ContactContext | undefined;

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = buildSystemPrompt(contactContext);

    // Call Anthropic with streaming
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ error: `Anthropic API error: ${res.status}`, details: text }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Transform the SSE stream from Anthropic into a simpler text stream
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = res.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);
                if (
                  event.type === "content_block_delta" &&
                  event.delta?.type === "text_delta"
                ) {
                  controller.enqueue(
                    encoder.encode(event.delta.text)
                  );
                }
              } catch {
                // Skip non-JSON lines
              }
            }
          }
        } catch (err) {
          console.error("[Chat] Stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    console.error("[Chat] Error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
