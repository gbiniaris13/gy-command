import { NextRequest, NextResponse } from "next/server";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "https://command.georgeyachts.com/api/auth/gmail/callback";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  const baseUrl = request.nextUrl.origin;

  if (error) {
    return NextResponse.redirect(`${baseUrl}/dashboard/email?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/dashboard/email?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[Gmail OAuth] Token exchange failed:", text);
      return NextResponse.redirect(`${baseUrl}/dashboard/email?error=token_exchange_failed`);
    }

    const tokens = await res.json();

    // Store tokens in Supabase settings table via service role
    const sbUrl = "https://lquxemsonehfltdzdbhq.supabase.co";
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    // Try to upsert — if table doesn't exist, create it first
    const upsertResult = await fetch(`${sbUrl}/rest/v1/settings`, {
      method: "POST",
      headers: {
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([
        { key: "gmail_refresh_token", value: tokens.refresh_token || "", updated_at: new Date().toISOString() },
        { key: "gmail_token_expiry", value: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() },
      ]),
    });

    if (!upsertResult.ok) {
      const errText = await upsertResult.text();
      console.error("[Gmail OAuth] Settings save failed:", errText);

      // If table doesn't exist, store in cookie as fallback
      const response = NextResponse.redirect(`${baseUrl}/dashboard/email?connected=true`);
      if (tokens.refresh_token) {
        response.cookies.set("gmail_refresh_token", tokens.refresh_token, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 365, // 1 year
          path: "/",
        });
      }
      return response;
    }

    return NextResponse.redirect(`${baseUrl}/dashboard/email?connected=true`);
  } catch (err) {
    console.error("[Gmail OAuth] Callback error:", err);
    return NextResponse.redirect(`${baseUrl}/dashboard/email?error=callback_failed`);
  }
}
