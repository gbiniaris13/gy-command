// @ts-nocheck
import { NextResponse } from "next/server";
import OpenAI from "openai";

// MYBA contract reader — George's own spec (29/8): "θα παίρνει μόνο
// τις ημερομηνίες, το όνομα του πελάτη και το σκάφος, και θα τον
// βρίσκει στην καρτέλα Πελάτες και θα τα κάνει update". Nothing else
// leaves the document: no fees, no clauses, no signatures.
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
  let mime = file.type || "application/pdf";
  if (mime.includes("pdf")) {
    // George's spec (29/8, tested on his own signed Pi2 contract): a
    // MYBA runs 10+ pages and megabytes, but everything we want -
    // charterer, vessel, dates - sits in the top half of page ONE.
    // Send only that page: 5.4MB became 466KB and the read dropped
    // from a stall to ~4 seconds.
    try {
      const { PDFDocument } = await import("pdf-lib");
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      if (src.getPageCount() > 1) {
        const out = await PDFDocument.create();
        const [p1] = await out.copyPages(src, [0]);
        out.addPage(p1);
        buf = Buffer.from(await out.save());
      }
    } catch {
      // Unparseable PDF: fall through with the original, Gemini may
      // still manage it.
    }
  } else {
    try {
      const sharp = (await import("sharp")).default;
      buf = await sharp(buf).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      mime = "image/jpeg";
    } catch {
      return NextResponse.json(
        { error: "δεν διαβάζεται αυτή η μορφή, στείλε PDF ή φωτογραφία της πρώτης σελίδας" },
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
              "This is the first page of a yacht charter agreement (MYBA form). Extract EXACTLY these fields as JSON and NOTHING else: " +
              '{"charterer_name": "the charterer/client full name", "vessel": "the yacht name", "date_from": "YYYY-MM-DD charter start/delivery date", "date_to": "YYYY-MM-DD charter end/redelivery date"}. ' +
              "Do NOT extract fees, addresses, signatures or any other detail. If a field is unreadable use null. Reply with the JSON only.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 3000,
  });

  const text = response.choices[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return NextResponse.json({ error: "δεν βρέθηκαν τα στοιχεία στο έγγραφο" }, { status: 422 });
  let fields;
  try {
    fields = JSON.parse(m[0]);
  } catch {
    return NextResponse.json({ error: "δεν διαβάστηκε καθαρά, δοκίμασε φωτογραφία της πρώτης σελίδας" }, { status: 422 });
  }
  return NextResponse.json({
    ok: true,
    fields: {
      charterer_name: fields.charterer_name ?? null,
      vessel: fields.vessel ?? null,
      date_from: fields.date_from ?? null,
      date_to: fields.date_to ?? null,
    },
  });
}
