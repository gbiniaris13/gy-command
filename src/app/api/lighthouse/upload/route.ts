// @ts-nocheck
import { NextResponse } from "next/server";

// The private box. George uploads client documents (passports for
// charter paperwork) and they land in a PRIVATE Supabase storage
// bucket - no public URLs, service-role access only. The Lighthouse
// stores the derived dates; this box stores the paper.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const BUCKET = "lighthouse-private";

function sb() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function ensureBucket() {
  const { url, key } = sb();
  const res = await fetch(`${url}/storage/v1/bucket/${BUCKET}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  if (res.ok) return;
  await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ name: BUCKET, id: BUCKET, public: false }),
  });
}

export async function POST(request) {
  const form = await request.formData();
  const file = form.get("file");
  const person = String(form.get("person") || "unfiled").replace(/[^a-z0-9-]/gi, "_").slice(0, 60);
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (15MB max)" }, { status: 400 });
  }
  await ensureBucket();
  const { url, key } = sb();
  const safeName = String(file.name || "document").replace(/[^a-z0-9.-]/gi, "_").slice(0, 80);
  const path = `${person}/${Date.now()}-${safeName}`;
  const up = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false",
    },
    body: buf,
  });
  if (!up.ok) {
    return NextResponse.json({ error: `storage ${up.status}: ${await up.text()}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path, bucket: BUCKET, private: true });
}

export async function GET() {
  // List the box, grouped by person folder.
  const { url, key } = sb();
  const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 500, sortBy: { column: "created_at", order: "desc" } }),
  });
  if (!res.ok) return NextResponse.json({ files: [] });
  const rows = await res.json();
  return NextResponse.json({ files: rows });
}
