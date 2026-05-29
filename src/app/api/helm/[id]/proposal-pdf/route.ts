// GET /api/helm/:id/proposal-pdf — stream the generated proposal PDF from
// Supabase Storage (private bucket), admin-gated. Used by the detail page
// link so the confidential PDF is never exposed via a public URL.

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getRequest } from "@/lib/helm-admin";
import { downloadProposalPdf } from "@/lib/helm/storage";

export const runtime = "nodejs";

async function adminEmail(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const jar = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: { getAll: () => jar.getAll(), setAll: () => {} },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const email = await adminEmail();
  if (!email) return new Response("unauthorized", { status: 401 });

  const r = await getRequest(id);
  if (!r || !r.proposal_pdf_path) return new Response("no proposal generated", { status: 404 });

  try {
    const bytes = await downloadProposalPdf(r.proposal_pdf_path);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="proposal-${id}.pdf"`,
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 500 });
  }
}
