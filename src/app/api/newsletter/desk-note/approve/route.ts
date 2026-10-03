// The one-click approval from the morning brief. The link is signed with the
// note's own text and week, so it approves exactly what George read and
// nothing else; it works from his phone without a login.
import { NextResponse } from "next/server";
import { approveDraft } from "@/lib/newsletter-desk-note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const r = await approveDraft(String(u.searchParams.get("w") || ""), String(u.searchParams.get("t") || ""));
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${r.ok ? "Approved" : "Not approved"}</title>
  <body style="margin:0;background:#FAF8F3;font-family:Georgia,serif;color:#0D1B2A"><div style="max-width:520px;margin:12vh auto;padding:36px 28px;background:#fff;border:1px solid #E4E0D5;text-align:center">
  <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#DAA110">George Yachts · The Bridge</div>
  <h1 style="font-weight:300;font-size:26px;margin:14px 0 10px">${r.ok ? "Approved" : "Not approved"}</h1>
  <p style="font-size:15px;line-height:1.6;color:#26313D">${r.message}</p>
  <a href="https://command.georgeyachts.com/dashboard/newsletter" style="display:inline-block;margin-top:12px;font-size:12px;color:#0D1B2A">The newsletter desk</a></div></body>`;
  return new NextResponse(html, { status: r.ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
}
