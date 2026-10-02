// POST /api/lighthouse/season-edition { email, year? }
// Creates the DRAFT annual edition for a past client (see
// src/lib/helm/season-edition.ts). George finishes and sends it from The Helm.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-user";
import { createSeasonEdition } from "@/lib/helm/season-edition";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  let body: { email?: string; year?: number } = {};
  try { body = await request.json(); } catch { /* empty */ }
  if (!body.email) return NextResponse.json({ error: "email required" }, { status: 400 });
  try {
    const r = await createSeasonEdition({ email: String(body.email), year: body.year ? Number(body.year) : undefined, actorEmail: "lighthouse" });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
}
