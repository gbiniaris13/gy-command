import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, setSetting } from "@/lib/google-api";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/dashboard/email?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/dashboard/email?error=no_code", request.url)
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    if (tokens.refresh_token) {
      await setSetting("gmail_refresh_token", tokens.refresh_token);
    }

    // Store initial access token expiry for reference
    await setSetting(
      "gmail_token_expiry",
      new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    );

    return NextResponse.redirect(
      new URL("/dashboard/email?connected=true", request.url)
    );
  } catch (err) {
    console.error("[Gmail OAuth] Callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/email?error=token_exchange_failed", request.url)
    );
  }
}
