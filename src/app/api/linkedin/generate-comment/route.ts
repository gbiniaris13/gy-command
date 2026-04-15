// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai";
import { commentPrompt } from "@/lib/linkedin-safety";

// POST /api/linkedin/generate-comment
// Body: { post_text: string, author_industry?: string, author_name?: string }
//
// Generates a single LinkedIn comment in George Biniaris voice via the
// existing aiChat helper (which already routes to Gemini per the
// brand-radar setup). The prompt is locked in src/lib/linkedin-safety.ts
// so we keep one source of truth for the tone/rules.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const postText = (body.post_text ?? "").trim();
    if (!postText) {
      return NextResponse.json(
        { error: "post_text is required" },
        { status: 400 }
      );
    }

    const prompt = commentPrompt({
      text: postText,
      authorIndustry: body.author_industry ?? null,
    });

    const raw = await aiChat(
      "You write LinkedIn comments in the voice of George Biniaris. Reply with only the comment text, no formatting, no preamble, no quotes.",
      prompt
    );

    // Trim whitespace, strip leading/trailing quotes the model sometimes
    // adds despite the system prompt, collapse internal newlines.
    let comment = (raw ?? "").trim();
    comment = comment.replace(/^["“”']+|["“”']+$/g, "").trim();
    // Cap to 4 sentences as a safety belt — split on . ! ? followed by space
    const sentences = comment.split(/(?<=[.!?])\s+/);
    if (sentences.length > 4) {
      comment = sentences.slice(0, 4).join(" ");
    }

    return NextResponse.json({
      ok: true,
      comment,
      author_name: body.author_name ?? null,
      author_industry: body.author_industry ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generate failed" },
      { status: 500 }
    );
  }
}
