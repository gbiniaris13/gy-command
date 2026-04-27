// Pillar 4 — daily 08:00 Athens cron.
//
// Pushes a Telegram message summarising:
//   - Promises due today
//   - Overdue promises (1-7d)
//   - Severely overdue (>7d) — these need active triage
//
// Also auto-marks commitments as fulfilled when George has sent a
// follow-up in the same thread AFTER the source message (cheap
// heuristic — Sprint 2.4 will add AI-verified fulfillment matching).

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { sendTelegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 120;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET() {
  try {
    const sb = createServiceClient();

    // 1. Auto-fulfillment heuristic — for any open commitment, did
    //    George send a NEW outbound in the same thread AFTER the
    //    commitment's source_sent_at? If yes, mark fulfilled.
    const { data: openByThread } = await sb
      .from("commitments")
      .select("id, contact_id, thread_id, source_sent_at, source_message_id")
      .is("fulfilled_at", null)
      .is("dismissed_at", null)
      .not("thread_id", "is", null)
      .limit(500);

    let auto_fulfilled = 0;
    for (const c of openByThread ?? []) {
      const { data: laterSend } = await sb
        .from("activities")
        .select("id, metadata, created_at")
        .eq("contact_id", c.contact_id as string)
        .eq("type", "email_sent")
        .gt("created_at", c.source_sent_at as string)
        .order("created_at", { ascending: true })
        .limit(20);
      const fulfillment = (laterSend ?? []).find((a) => {
        const tid = (a.metadata as { thread_id?: string } | null)?.thread_id;
        const mid =
          (a.metadata as { message_id?: string } | null)?.message_id;
        return tid === c.thread_id && mid !== c.source_message_id;
      });
      if (fulfillment) {
        await sb
          .from("commitments")
          .update({
            fulfilled_at: fulfillment.created_at,
            fulfillment_message_id:
              (fulfillment.metadata as { message_id?: string })?.message_id ??
              null,
          })
          .eq("id", c.id);
        auto_fulfilled++;
      }
    }

    // 2. Pull open commitments grouped by deadline status.
    const today = new Date().toISOString().slice(0, 10);
    const { data: open } = await sb
      .from("commitments")
      .select(
        "id, deadline_date, deadline_phrase, commitment_summary, contact:contacts(first_name, last_name, email)",
      )
      .is("fulfilled_at", null)
      .is("dismissed_at", null)
      .order("deadline_date", { ascending: true, nullsFirst: false })
      .limit(50);

    type Row = {
      id: string;
      deadline_date: string | null;
      deadline_phrase: string | null;
      commitment_summary: string | null;
      contact: {
        first_name: string | null;
        last_name: string | null;
      } | null;
    };
    const dueToday: Row[] = [];
    const overdue: Row[] = [];
    const upcoming: Row[] = [];
    const noDeadline: Row[] = [];

    for (const c of (open ?? []) as unknown as Row[]) {
      if (!c.deadline_date) {
        noDeadline.push(c);
        continue;
      }
      if (c.deadline_date < today) overdue.push(c);
      else if (c.deadline_date === today) dueToday.push(c);
      else upcoming.push(c);
    }

    // 3. Telegram push (only when there's something to surface).
    const total = dueToday.length + overdue.length;
    if (total > 0) {
      const lines: string[] = [`⏰ <b>Promises due (${total})</b>`];
      for (const c of overdue) {
        const days = Math.round(
          (new Date(today).getTime() -
            new Date(c.deadline_date!).getTime()) /
            86_400_000,
        );
        const name =
          `${c.contact?.first_name ?? ""} ${c.contact?.last_name ?? ""}`.trim() ||
          "(contact)";
        lines.push(
          `🔴 Overdue ${days}d · ${escapeHtml(name)} — ${escapeHtml(c.commitment_summary ?? "")}`,
        );
      }
      for (const c of dueToday) {
        const name =
          `${c.contact?.first_name ?? ""} ${c.contact?.last_name ?? ""}`.trim() ||
          "(contact)";
        lines.push(
          `🟡 Today · ${escapeHtml(name)} — ${escapeHtml(c.commitment_summary ?? "")}`,
        );
      }
      lines.push("", `<a href="https://command.georgeyachts.com">→ Open cockpit</a>`);
      await sendTelegram(lines.join("\n")).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      auto_fulfilled,
      open_total: (open ?? []).length,
      due_today: dueToday.length,
      overdue: overdue.length,
      upcoming: upcoming.length,
      no_deadline: noDeadline.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    await sendTelegram(
      `⚠️ <b>Commitments cron crashed</b>\n<code>${msg.slice(0, 300)}</code>`,
    ).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
