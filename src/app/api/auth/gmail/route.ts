import { NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/google-api";

export async function GET() {
  const url = getGoogleAuthUrl();
  return NextResponse.redirect(url);
}
