// Newsletter section — operator surface inside GY Command Center.
//
// Subscriber data lives in Vercel KV on the public site (georgeyachts.com).
// This page is a server component that fetches a status snapshot via the
// internal proxy lib (which talks to the public-site admin endpoints
// using the server-side NEWSLETTER_PROXY_SECRET — the secret never
// touches the browser).
//
// George can: see counts, see masked subscriber list, bulk-add emails,
// remove subscribers, prepare a fresh Issue #1 draft. All operator
// actions live here — no need to leave the CRM.

import NewsletterClient from "./NewsletterClient";
import { getNewsletterStatus } from "@/lib/newsletter-proxy";

export const dynamic = "force-dynamic";

export default async function NewsletterPage() {
  let status: any = null;
  let error: string | null = null;
  try {
    status = await getNewsletterStatus();
  } catch (e) {
    error = e instanceof Error ? e.message : "unknown";
  }
  return <NewsletterClient initialStatus={status} initialError={error} />;
}
