// Newsletter admin operations live on the public site (georgeyachts.com)
// where the Vercel KV subscriber data is stored. This module is a
// server-side proxy that the CRM dashboard uses so:
//
//   - The browser never sees the proxy secret
//   - Auth is the existing CRM dashboard session
//   - Cross-project API shape changes only ripple here
//
// All four functions return the parsed JSON from the upstream endpoint,
// or throw on transport failure / non-2xx response.

const PUBLIC_BASE =
  process.env.NEWSLETTER_PUBLIC_BASE_URL || "https://georgeyachts.com";

function secret(): string {
  const s = process.env.NEWSLETTER_PROXY_SECRET;
  if (!s) {
    throw new Error(
      "NEWSLETTER_PROXY_SECRET not configured on the CRM side — set it equal to NEWSLETTER_UNSUB_SECRET in george-yachts Vercel env",
    );
  }
  return s;
}

async function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const url = new URL(`${PUBLIC_BASE}${path}`);
  url.searchParams.set("key", secret());
  const res = await fetch(url.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = { error: "non-json response", status: res.status };
  }
  return { status: res.status, json };
}

export interface NewsletterStatus {
  flag: { var_name: string; raw_value: string | null; will_send: boolean; note: string };
  subscriber_count: number;
  subscribers_by_domain: Record<string, number>;
  subscribers_masked: string[];
  subscribers?: string[];
  env_presence: Record<string, boolean>;
}

export async function getNewsletterStatus(): Promise<NewsletterStatus> {
  const r = await call("GET", `/api/admin/newsletter-status`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return r.json;
}

export interface AddSubscribersInput {
  stream: "bridge" | "wake" | "compass" | "greece";
  emails: string[];
  source?: string;
  send_welcome?: boolean;
}

export interface AddSubscribersResult {
  ok: boolean;
  stream: string;
  received: number;
  accepted: number;
  added: number;
  already_on_list: number;
  rejected: { email: string; reason: string }[];
  suppressed: string[];
  welcome_sends: number;
}

export async function addSubscribers(
  input: AddSubscribersInput,
): Promise<AddSubscribersResult> {
  const r = await call("POST", `/api/admin/newsletter-add-subscribers`, input);
  if (r.status !== 200) throw new Error(r.json?.error ?? `status ${r.status}`);
  return r.json;
}

export interface RemoveSubscriberInput {
  email: string;
  stream?: "bridge" | "wake" | "compass" | "greece";
  suppress?: boolean;
}

export async function removeSubscriber(
  input: RemoveSubscriberInput,
): Promise<{ ok: boolean; email: string; stream: string; removed_from_sets: number; suppressed: boolean }> {
  const r = await call("POST", `/api/admin/newsletter-remove-subscriber`, input);
  if (r.status !== 200) throw new Error(r.json?.error ?? `status ${r.status}`);
  return r.json;
}

export interface PrepareIssue1Result {
  ok: boolean;
  draft_id: string;
  issue_number: number;
  audience_size: number;
  word_count: number;
  reading_time_min: number;
  telegram: { ok: boolean; message_id: number | null; error?: string };
  next_steps: string[];
}

export async function prepareIssue1(
  reset = false,
): Promise<PrepareIssue1Result> {
  const path = reset
    ? `/api/admin/newsletter-prepare-issue-1?reset=1`
    : `/api/admin/newsletter-prepare-issue-1`;
  const r = await call("GET", path);
  if (r.status !== 200) throw new Error(r.json?.error ?? `status ${r.status}`);
  return r.json;
}

// ─── Composer (Phase 3) ────────────────────────────────────────────

export interface ComposerYachtOption {
  slug: string;
  name: string;
  subtitle?: string;
  length?: string;
  cruisingRegion?: string;
  fleetTier?: string;
  has_voice_notes?: boolean;
  has_captain_credentials?: boolean;
  voice_notes?: string | null;
}
export interface ComposerPostOption {
  slug: string;
  title: string;
  publishedAt?: string;
}

export async function getComposerOptions(): Promise<{
  yachts: ComposerYachtOption[];
  posts: ComposerPostOption[];
}> {
  const r = await call("GET", `/api/admin/newsletter-compose-options`);
  if (r.status !== 200) throw new Error(r.json?.error ?? `status ${r.status}`);
  return { yachts: r.json?.yachts ?? [], posts: r.json?.posts ?? [] };
}

export type ComposeContentType =
  | "announcement"
  | "offer"
  | "story"
  | "intel"
  | "blog";

export interface ComposeInput {
  content_type: ComposeContentType;
  audience: ("bridge" | "wake" | "compass" | "greece")[];
  yacht_slug?: string;
  post_slug?: string;
  george_angle?: string;
  headline?: string;
  signal_text?: string;
  source_note?: string;
  subject_line?: string;
  body_text?: string;
  hero_image_url?: string;
  posture?: string;
  link_label?: string;
  // Update 2 §5.3 caveat — captain credentials only when George opts in.
  include_captain_credentials?: boolean;
}

export interface ComposeResult {
  ok: boolean;
  content_type: string;
  requested_audience: string[];
  final_audience: string[];
  refused: string[];
  refusal_reasons: string[];
  drafts_created: number;
  drafts_blocked: number;
  errors: number;
  results: Array<{
    stream: string;
    draft_id?: string;
    issue_number?: number;
    audience_size?: number;
    word_count?: number;
    reading_time_min?: number;
    status?: string;
    violations?: { rule: string }[];
    warnings?: { rule: string }[];
    telegram?: { ok: boolean; message_id: number | null; error?: string };
    error?: string;
  }>;
}

export async function compose(input: ComposeInput): Promise<ComposeResult> {
  const r = await call("POST", `/api/admin/newsletter-compose`, input);
  if (r.status !== 200 && r.status !== 422)
    throw new Error(r.json?.error ?? `status ${r.status}`);
  return r.json;
}
