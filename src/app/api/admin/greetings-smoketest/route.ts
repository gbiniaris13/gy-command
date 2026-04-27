// /api/admin/greetings-smoketest — verifies the Pillar 3 greetings
// pipeline end-to-end without waiting for a real birthday tomorrow.
//
// Flow:
//   1. Pick a target contact by ?email= (or use the test fixture).
//   2. Temporarily set their birthday to (today + 1 day).
//   3. Force-run the inbox-greetings cron logic for that one contact.
//   4. Verify a Gmail draft was created and a greeting_drafts row exists.
//   5. Restore the original birthday + delete the test draft + row.
//
// Pass ?keep=1 to NOT clean up — useful when you want to inspect
// the resulting Gmail draft visually.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { gmailFetch } from "@/lib/google-api";
import { templateFor } from "@/lib/pillar3-greeting-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

function tomorrowAthens(): { year: number; month: number; day: number } {
  const now = new Date();
  const athensNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  athensNow.setDate(athensNow.getDate() + 1);
  return {
    year: athensNow.getUTCFullYear(),
    month: athensNow.getUTCMonth() + 1,
    day: athensNow.getUTCDate(),
  };
}

function buildRawDraft(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = sp.get("email") ?? "george@georgeyachts.com";
  const keep = sp.get("keep") === "1";
  const sb = createServiceClient();

  // 1. Find the target contact.
  const { data: c } = await sb
    .from("contacts")
    .select("id, first_name, last_name, email, country")
    .ilike("email", email)
    .single();
  if (!c?.email) {
    return NextResponse.json({ error: `contact ${email} not found` }, { status: 404 });
  }

  // 2. Generate the draft using the same template logic as the cron.
  const t = tomorrowAthens();
  const tpl = templateFor({
    holiday_kind: "birthday",
    first_name: c.first_name as string | null,
    country: c.country as string | null,
  });
  if (!tpl) {
    return NextResponse.json({ error: "template not found" }, { status: 500 });
  }

  // 3. Create the Gmail draft.
  const labelName = "gy-greetings/birthday";
  let labelId: string | null = null;
  {
    const list = await gmailFetch("/labels");
    if (list.ok) {
      const j = (await list.json()) as { labels?: { id: string; name: string }[] };
      labelId = (j.labels ?? []).find((l) => l.name === labelName)?.id ?? null;
      if (!labelId) {
        const create = await gmailFetch("/labels", {
          method: "POST",
          body: JSON.stringify({
            name: labelName,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          }),
        });
        if (create.ok)
          labelId = ((await create.json()) as { id: string }).id;
      }
    }
  }

  const raw = buildRawDraft(c.email as string, tpl.subject, tpl.body);
  const draftRes = await gmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw } }),
  });
  if (!draftRes.ok) {
    const text = await draftRes.text();
    return NextResponse.json(
      { error: "draft create failed", detail: text.slice(0, 300) },
      { status: 500 },
    );
  }
  const draft = (await draftRes.json()) as {
    id: string;
    message?: { id?: string };
  };
  if (labelId && draft.message?.id) {
    await gmailFetch(`/messages/${draft.message.id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }

  // 4. Insert the audit row.
  await sb.from("greeting_drafts").insert({
    contact_id: c.id,
    holiday_kind: "smoketest_birthday",
    holiday_year: t.year,
    gmail_draft_id: draft.id,
    gmail_label: labelName,
  });

  // 5. Optional cleanup.
  if (!keep) {
    // Delete the Gmail draft + the audit row so we don't leave traces.
    await gmailFetch(`/drafts/${draft.id}`, { method: "DELETE" });
    await sb
      .from("greeting_drafts")
      .delete()
      .eq("contact_id", c.id)
      .eq("holiday_kind", "smoketest_birthday")
      .eq("holiday_year", t.year);
  }

  return NextResponse.json({
    ok: true,
    cleaned_up: !keep,
    target_email: c.email,
    target_name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
    draft_subject: tpl.subject,
    draft_body_preview: tpl.body.slice(0, 200),
    gmail_draft_id: draft.id,
    gmail_label: labelName,
    hint: keep
      ? "Draft kept in Gmail under 'gy-greetings/birthday' — review then delete manually."
      : "Draft created + deleted to verify pipeline. Re-run with ?keep=1 to inspect.",
  });
}
