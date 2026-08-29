// @ts-nocheck
import { NextResponse } from "next/server";
import OpenAI from "openai";

// Passport reader for The Lighthouse. George uploads a passport photo
// from the dashboard; Gemini (vision, via the same OpenAI-compatible
// client as lib/ai) reads ONLY the three fields the Lighthouse needs
// and returns them for George to CONFIRM before anything is saved.
//
// Privacy rules, deliberate and non-negotiable (design session 29/8):
//   - The passport NUMBER is never extracted, never stored, never
//     returned. We wish people happy birthday; we do not need it.
//   - The image itself is not persisted by this route. If George
//     wants the file kept for charter paperwork he stores it in the
//     private box (see /api/lighthouse/upload) - separate, deliberate.
//   - Nothing writes to the database here; the CONFIRM step does.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const ai = new OpenAI({
  apiKey: process.env.AI_API_KEY || "",
  baseURL: process.env.AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
});
const MODEL = process.env.AI_MODEL || "gemini-2.5-flash";

export async function POST(request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  let buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (15MB max)" }, { status: 400 });
  }
  let mime = file.type || "image/jpeg";
  // Server-side belt to the client-side braces (the 3-minute passport,
  // 29/8): whatever arrives, normalise to a small JPEG before Gemini.
  // sharp ships with Next; a phone photo drops from 8MB to ~150KB and
  // the whole read lands in seconds. HEIC and exotic formats that
  // sharp cannot decode fall through with a clear error instead of a
  // silent crawl.
  if (!mime.includes("pdf")) {
    try {
      const sharp = (await import("sharp")).default;
      buf = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      mime = "image/jpeg";
    } catch {
      return NextResponse.json(
        { error: "δεν διαβάζεται αυτή η μορφή αρχείου, στείλε το ως JPEG ή PNG (ένα screenshot της σελίδας του διαβατηρίου αρκεί)" },
        { status: 422 },
      );
    }
  }

  const response = await ai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "This is a passport photo page. Extract EXACTLY these fields and nothing else, as JSON: " +
              '{"full_name": "given names + surname as printed", "date_of_birth": "YYYY-MM-DD", "nationality": "country name in English"}. ' +
              "Do NOT include the passport number or any other field. If a field is unreadable use null. Reply with the JSON only.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
          },
        ],
      },
    ],
    temperature: 0,
    // Gemini 2.5 spends "thinking" tokens from this same budget via the
    // OpenAI-compat layer; 200 died mid-thought and produced five words
    // of JSON (finish_reason: length) - George's "δεν διαβάστηκε".
    max_tokens: 3000,
  });

  const text = response.choices[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: "could not read the document" }, { status: 422 });
  let fields;
  try {
    fields = JSON.parse(m[0]);
  } catch {
    return NextResponse.json({ error: "could not parse the document" }, { status: 422 });
  }
  // Belt and braces: even if the model disobeys, nothing beyond the
  // three fields leaves this route.
  return NextResponse.json({
    ok: true,
    fields: {
      full_name: fields.full_name ?? null,
      date_of_birth: fields.date_of_birth ?? null,
      nationality: fields.nationality ?? null,
    },
  });
}
