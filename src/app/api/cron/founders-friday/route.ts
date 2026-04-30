// Founder's Friday Reflection — Friday 15:00 UTC (18:00 Athens).
//
// Sends ONE journaling prompt to Telegram. No expected answer. The
// goal is to make George stop for 30 seconds before the weekend and
// think about something that's NOT a tactical action.
//
// Different from weekly-strategy (also Friday): strategy is forward-
// looking ("next week's priorities"). Friday Reflection is INWARD-
// looking ("what did you learn"). Two beats, same day. Strategy at
// 17:00, Reflection at 18:00 — close out, then pause.
//
// Prompts rotate from a curated list with AI-personalized intros.
// Over months, this builds a body of reflections that become blog
// post seeds (working-broker authenticity) without any writing
// effort beyond honest 30-sec answers George thinks (or notes).

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { aiChat } from "@/lib/ai";
import { sendTelegram } from "@/lib/telegram";
import { observeCron } from "@/lib/cron-observer";

export const runtime = "nodejs";
export const maxDuration = 60;

// Curated set of broker-specific reflection prompts. These are
// designed to surface unexamined assumptions, not generic
// "leadership questions."
const PROMPTS = [
  {
    theme: "blind_spots",
    question:
      "Ποιο move δεν έκανες αυτή την εβδομάδα γιατί ήταν unconventional — αλλά ήξερες ότι έπρεπε να το κάνεις;",
  },
  {
    theme: "client_truth",
    question:
      "Ποιος client σου είπε κάτι αυτή την εβδομάδα που σε ενόχλησε — και είχε δίκιο;",
  },
  {
    theme: "unexpected_lesson",
    question:
      "Τι ήταν το unexpected μάθημα της εβδομάδας; (δεν είναι 'δούλεψα σκληρά')",
  },
  {
    theme: "competitor_admire",
    question:
      "Σε τι σε νικάει ο μεγαλύτερος ανταγωνιστής σου αυτή τη στιγμή; Πες την αλήθεια — θα σε βοηθήσει.",
  },
  {
    theme: "would_recommend",
    question:
      "Αν ένας past client σου τηλεφωνούσε τώρα για να ζητήσει συμβουλή ΟΧΙ για yacht charter αλλά για το τι κάνεις — τι θα έλεγες;",
  },
  {
    theme: "drop_one",
    question:
      "Αν έπρεπε να σταματήσεις ΕΝΑ thing που κάνεις τώρα στη δουλειά για 30 μέρες — ποιο θα έπεφτε; Γιατί δεν το έχεις σταματήσει ήδη;",
  },
  {
    theme: "next_self",
    question:
      "Σε 12 μήνες, όταν έχεις closed €1M+ commission, ποια συνήθεια ξεκίνησες τώρα που τότε θα νιώθεις ευγνωμοσύνη;",
  },
  {
    theme: "honest_friend",
    question:
      "Ένας φίλος σου που είναι έμπειρος επιχειρηματίας θα σε ρωτούσε αυτή τη στιγμή ένα κρίσιμο ερώτημα. Ποιο είναι;",
  },
  {
    theme: "yacht_choice",
    question:
      "Αν είχες budget για 1 yacht αυτή τη χρονιά να βάλεις στη fleet, ποιο θα ήταν και γιατί; (το ένστικτο, όχι το λογικό)",
  },
  {
    theme: "hardest_email",
    question:
      "Ποιο email αυτή την εβδομάδα ήταν το πιο δύσκολο να γράψεις — και στείλε το, αν δεν το έστειλες;",
  },
];

async function _observedImpl(): Promise<Response> {
  try {
    const sb = createServiceClient();

    // Pick prompt deterministically by week-of-year so it rotates but
    // consistent across multiple invocations the same day
    const weekNumber = Math.floor(
      (Date.now() - new Date("2026-01-01").getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
    const prompt = PROMPTS[weekNumber % PROMPTS.length];

    // Generate a personalized intro — 1 line that ties the prompt to
    // the live business state
    let intro = "Παρασκευή απόγευμα. Πριν κλείσεις τον υπολογιστή, σταμάτα 30 sec.";
    try {
      const sys = `You are a quiet voice nudging George to reflect. Generate ONE short intro sentence (max 20 words, Greek) that ties this prompt theme to a working broker's Friday afternoon. NO motivational fluff. Calm. Settled. Like a friend asking before drinks.`;
      const userMsg = `Theme: ${prompt.theme}. Greek-waters yacht broker, 5 months into business. Friday 18:00 Athens. Generate intro line.`;
      const out = await aiChat(sys, userMsg, { maxTokens: 60, temperature: 0.6 });
      if (out && out.trim().length > 5 && out.trim().length < 200) {
        intro = out.trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* fallback intro is fine */
    }

    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const date = new Date().toISOString().slice(0, 10);

    const lines = [
      `📓 <b>Friday Reflection — ${date}</b>`,
      ``,
      `<i>${escape(intro)}</i>`,
      ``,
      `<b>${escape(prompt.question)}</b>`,
      ``,
      `<i>Δεν περιμένω απάντηση. Δεν κάνεις dashboard. Απλά σκέψου το 30 δευτερόλεπτα. Αν θες να κρατήσεις τη σκέψη, σημείωσέ τη — με τον καιρό αυτές γίνονται blog seeds, talking points, ή απλά μια καλύτερη εκδοχή σου.</i>`,
      ``,
      `<i>Καλό weekend, George.</i>`,
    ];

    await sendTelegram(lines.join("\n")).catch(() => {});

    await sb.from("settings").upsert({
      key: `founders_friday_${date}`,
      value: JSON.stringify({ theme: prompt.theme, question: prompt.question, intro, week: weekNumber }),
    });

    return NextResponse.json({
      ok: true,
      theme: prompt.theme,
      week: weekNumber,
    });
  } catch (e: any) {
    console.error("[founders-friday] FAILED:", e);
    return NextResponse.json({ error: e?.message ?? "unknown" }, { status: 500 });
  }
}

export async function GET(): Promise<Response> {
  return observeCron("founders-friday", _observedImpl);
}
