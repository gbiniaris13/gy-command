// @ts-nocheck
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://georgeyachts.com/sitemap.xml", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ count: 0 });
    const xml = await res.text();
    const matches = xml.match(/<loc>/g);
    return NextResponse.json({ count: matches?.length ?? 0 });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
