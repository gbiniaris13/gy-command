import OpenAI from "openai";

// Universal AI client — works with Gemini (free), OpenAI, or Anthropic
// Change provider by updating env vars only — zero code changes
const ai = new OpenAI({
  apiKey: process.env.AI_API_KEY || "",
  baseURL: process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
});

const MODEL = process.env.AI_MODEL || "gemini-2.5-flash";

export async function aiChat(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY not configured");
  }

  const response = await ai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return response.choices[0]?.message?.content || "";
}

export async function aiStream(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<ReadableStream> {
  if (!process.env.AI_API_KEY) {
    throw new Error("AI_API_KEY not configured");
  }

  const response = await ai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages,
    ],
    stream: true,
    temperature: 0.7,
    max_tokens: 2000,
  });

  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content || "";
          if (text) {
            controller.enqueue(encoder.encode(text));
          }
        }
        controller.close();
      } catch {
        controller.close();
      }
    },
  });
}

export { MODEL };
