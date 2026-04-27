// v3 Pillar 8 — Document-Driven Charter Setup endpoint.
//
// POST /api/admin/charter-extract
//
// Accepts multipart/form-data with:
//   document_type        contract | passport | guest_list | pif (required)
//   raw_text             text payload to feed the AI extractor (required)
//   file                 optional File blob — stored in bucket `charter-docs`
//   original_filename?   override filename for the storage path
//   deal_id?             link to existing deal (otherwise inferred during activation)
//   contact_id?          link to existing contact
//   primary_contact_id?  for the contract-activation cascade
//   threshold?           confidence threshold for auto-activation (default 0.80)
//
// Or JSON with the same fields (no file).
//
// Behaviour:
//   1. Insert charter_documents row (extraction_status='pending')
//   2. If file present, upload to Storage bucket `charter-docs` (idempotent
//      bucket create) and persist file_path
//   3. Run the appropriate AI extractor
//   4. If document_type=contract AND ready_for_activation, run the
//      activation cascade in src/lib/charter-activation.ts → returns
//      deal_id + milestones_generated
//   5. Otherwise persist extracted_data + (extraction_status =
//      'extracted' | 'manual_review' | 'failed') and return to caller
//
// Returns the charter_documents row + (for contracts) the activation summary.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  extractContract,
  extractPassport,
  extractGuestList,
  extractPif,
  isContractReadyForActivation,
  type ContractExtraction,
} from "@/lib/charter-doc-extractor";
import { activateCharterFromContract } from "@/lib/charter-activation";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "charter-docs";
const VALID_TYPES = new Set([
  "contract",
  "passport",
  "guest_list",
  "pif",
  "accept_form",
  "apa_receipt",
  "invoice",
  "itinerary",
  "other",
]);

async function ensureBucket(sb: ReturnType<typeof createServiceClient>) {
  try {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message || "")) throw error;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (!/already exists/i.test(msg)) throw err;
  }
}

interface InputPayload {
  document_type: string;
  raw_text: string;
  original_filename?: string;
  deal_id?: string;
  contact_id?: string;
  primary_contact_id?: string;
  threshold?: number;
  file?: File | null;
}

async function parseInput(req: NextRequest): Promise<InputPayload | null> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json();
    return {
      document_type: String(body.document_type ?? ""),
      raw_text: String(body.raw_text ?? ""),
      original_filename: body.original_filename ?? undefined,
      deal_id: body.deal_id ?? undefined,
      contact_id: body.contact_id ?? undefined,
      primary_contact_id: body.primary_contact_id ?? undefined,
      threshold: typeof body.threshold === "number" ? body.threshold : undefined,
      file: null,
    };
  }
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    return {
      document_type: String(form.get("document_type") ?? ""),
      raw_text: String(form.get("raw_text") ?? ""),
      original_filename:
        (form.get("original_filename") as string | null) ?? undefined,
      deal_id: (form.get("deal_id") as string | null) ?? undefined,
      contact_id: (form.get("contact_id") as string | null) ?? undefined,
      primary_contact_id:
        (form.get("primary_contact_id") as string | null) ?? undefined,
      threshold: form.get("threshold")
        ? Number(form.get("threshold"))
        : undefined,
      file: file && typeof file !== "string" ? (file as File) : null,
    };
  }
  return null;
}

export async function POST(req: NextRequest) {
  let input: InputPayload | null;
  try {
    input = await parseInput(req);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bad request" },
      { status: 400 },
    );
  }
  if (!input) {
    return NextResponse.json(
      { error: "Send JSON or multipart/form-data" },
      { status: 400 },
    );
  }
  if (!VALID_TYPES.has(input.document_type)) {
    return NextResponse.json(
      {
        error: `document_type must be one of: ${[...VALID_TYPES].join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!input.raw_text || input.raw_text.length < 20) {
    return NextResponse.json(
      {
        error:
          "raw_text is required (paste the document text). For PDFs, OCR/copy the text out client-side.",
      },
      { status: 400 },
    );
  }

  const sb = createServiceClient();
  const startedAt = new Date().toISOString();

  // 1. Insert the charter_documents shell row.
  const filename =
    input.original_filename ||
    (input.file?.name ?? `${input.document_type}-${Date.now()}.txt`);
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const today = startedAt.slice(0, 10);
  const storagePath = `${today}/${Date.now()}-${sanitized}`;

  const { data: docRow, error: insertErr } = await sb
    .from("charter_documents")
    .insert({
      deal_id: input.deal_id ?? null,
      contact_id: input.contact_id ?? null,
      document_type: input.document_type,
      file_path: input.file ? storagePath : `inline://${storagePath}`,
      original_filename: filename,
      mime_type: input.file?.type ?? "text/plain",
      size_bytes: input.file?.size ?? input.raw_text.length,
      uploaded_by: "george@georgeyachts.com",
      extraction_status: "extracting",
      extraction_started_at: startedAt,
    })
    .select("*")
    .single();

  if (insertErr || !docRow) {
    return NextResponse.json(
      {
        error: "Failed to create charter_documents row",
        detail: insertErr?.message,
      },
      { status: 500 },
    );
  }

  // 2. Upload the file to Storage (best-effort; extraction proceeds either way).
  if (input.file) {
    try {
      await ensureBucket(sb);
      const arrayBuffer = await input.file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(storagePath, bytes, {
          contentType: input.file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) {
        await sb
          .from("charter_documents")
          .update({ extraction_errors: `storage: ${upErr.message}` })
          .eq("id", docRow.id);
      }
    } catch (err) {
      await sb
        .from("charter_documents")
        .update({
          extraction_errors:
            err instanceof Error ? err.message : "storage upload failed",
        })
        .eq("id", docRow.id);
    }
  }

  // 3. Route to the right extractor.
  let extractionStatus = "extracted";
  let extractedData: unknown = null;
  let confidence = 0;
  let aiModel = "";
  let extractionError: string | null = null;
  let activationSummary: unknown = null;

  try {
    if (input.document_type === "contract") {
      const result = await extractContract(input.raw_text);
      confidence = result.confidence;
      aiModel = result.ai_model_used;
      if (!result.ok || !result.data) {
        extractionStatus = "failed";
        extractionError = result.error ?? "extraction failed";
      } else {
        extractedData = result.data;
        const ready = isContractReadyForActivation(
          result.data,
          confidence,
          input.threshold ?? 0.8,
        );
        if (ready.ready) {
          // 4a. Auto-activate.
          activationSummary = await activateCharterFromContract(sb, {
            extracted: result.data as ContractExtraction,
            document_id: docRow.id as string,
            primary_contact_id: input.primary_contact_id ?? null,
          });
        } else {
          extractionStatus = "manual_review";
          extractionError = `Missing critical fields: ${ready.missing.join(", ")}. confidence=${confidence.toFixed(2)}`;
        }
      }
    } else if (input.document_type === "passport") {
      const result = await extractPassport(input.raw_text);
      confidence = result.confidence;
      aiModel = result.ai_model_used;
      if (!result.ok) {
        extractionStatus = "failed";
        extractionError = result.error ?? "extraction failed";
      } else {
        extractedData = result.data;
        if (confidence < (input.threshold ?? 0.8)) {
          extractionStatus = "manual_review";
        }
      }
    } else if (input.document_type === "guest_list") {
      const result = await extractGuestList(input.raw_text);
      confidence = result.confidence;
      aiModel = result.ai_model_used;
      if (!result.ok) {
        extractionStatus = "failed";
        extractionError = result.error ?? "extraction failed";
      } else {
        extractedData = result.data;
        if (confidence < (input.threshold ?? 0.8)) {
          extractionStatus = "manual_review";
        }
      }
    } else if (input.document_type === "pif") {
      const result = await extractPif(input.raw_text);
      confidence = result.confidence;
      aiModel = result.ai_model_used;
      if (!result.ok) {
        extractionStatus = "failed";
        extractionError = result.error ?? "extraction failed";
      } else {
        extractedData = result.data;
        if (confidence < (input.threshold ?? 0.8)) {
          extractionStatus = "manual_review";
        }
      }
    } else {
      // Other / accept_form / apa_receipt / invoice / itinerary — store raw,
      // human reviews. No AI extraction defined yet.
      extractionStatus = "manual_review";
      extractedData = { note: "no extractor for this document_type yet" };
    }
  } catch (err) {
    extractionStatus = "failed";
    extractionError = err instanceof Error ? err.message : "extractor crashed";
  }

  // 5. Persist extraction outcome.
  await sb
    .from("charter_documents")
    .update({
      extraction_status: extractionStatus,
      extraction_completed_at: new Date().toISOString(),
      extracted_data: extractedData,
      extraction_confidence: confidence,
      extraction_errors: extractionError,
      ai_model_used: aiModel,
    })
    .eq("id", docRow.id);

  return NextResponse.json({
    ok: extractionStatus !== "failed",
    document_id: docRow.id,
    document_type: input.document_type,
    extraction_status: extractionStatus,
    extraction_confidence: confidence,
    extraction_errors: extractionError,
    extracted_data: extractedData,
    activation: activationSummary,
  });
}

// GET /api/admin/charter-extract?status=manual_review
// Returns documents awaiting review (used by the queue page).
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "manual_review";
  const limit = Math.min(
    100,
    parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10),
  );
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("charter_documents")
    .select("*")
    .eq("extraction_status", status)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: data?.length ?? 0, documents: data ?? [] });
}
