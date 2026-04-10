import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "577946473201-48bvc1l6e0p1d3ujt7f5aq7or831agkm.apps.googleusercontent.com";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://command.georgeyachts.com/api/auth/gmail/callback",
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/webmasters.readonly",
    access_type: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
