// Read-only: for every lost or stalled Helm request, gather the facts and let the model name the
// reason from the actual conversation. Writes JSONL to the path in argv[2]. Nothing is stored in the CRM.
import fs from "node:fs";
import { createServiceClient } from "../../src/lib/supabase-server";
import { readGmailByAddress } from "../../src/lib/helm/followup/context";
import { aiChat } from "../../src/lib/ai";
import { parseLooseJson } from "../../src/lib/helm/json";

const CATS = ["budget", "short_or_day_charter", "out_of_scope", "dates_or_availability", "chose_other_broker", "changed_plans_or_destination", "personal_reasons", "never_replied", "went_silent_after_talking", "unclear"];
(async () => {
  const out = process.argv[2];
  const db = createServiceClient();
  const { data } = await db.from("helm_requests").select("id,status,request_type,lost_reason,budget,party_size,dates_from,dates_to,area,brief,created_at,last_activity_at,client_name,client_surname,client_email,pipe:extraction->pipeline").limit(2000);
  const now = Date.now();
  const rows = (data ?? []).filter((r: any) => {
    const nm = `${r.client_name ?? ""} ${r.client_surname ?? ""} ${r.client_email ?? ""}`.toLowerCase();
    if (/biniaris|test|example\.com/.test(nm)) return false;
    if (r.status === "lost") return true;
    const stale = ["sent", "in_conversation", "negotiating"].includes(r.status) && now - Date.parse(r.last_activity_at ?? r.created_at) > 30 * 86400000;
    return stale;
  });
  fs.writeFileSync(out, "");
  let i = 0;
  for (const r of rows as any[]) {
    i++;
    let gm: Awaited<ReturnType<typeof readGmailByAddress>> = { items: [], newAddresses: [], ok: false } as any;
    try { gm = await readGmailByAddress([r.client_email ?? ""], r.created_at, 30); } catch {}
    const items = gm.items.sort((a, b) => a.ts.localeCompare(b.ts));
    const inbound = items.filter((x) => x.direction === "in");
    const outbound = items.filter((x) => x.direction === "out");
    const firstOut = outbound[0]?.ts ?? r.pipe?.sent_at ?? null;
    const convo = items.slice(-8).map((x) => `${x.ts.slice(0, 10)} ${x.direction === "in" ? "CLIENT" : "GEORGE"}: ${x.text.slice(0, 600)}`).join("\n---\n");
    const prompt = `A yacht charter request that did not book. Name the main reason from the evidence. Categories: ${CATS.join(", ")}.
George charters fully crewed yachts BY THE WEEK only, in Athens/Saronic/Cyclades/Ionian, from about EUR 17,000 a week.
Return JSON: {"category": one of the categories, "reason_el": "one short line in Greek", "client_budget_eur_week": number or null, "evidence": "short quote"}.

George's note why lost: ${r.lost_reason ?? "(none)"}
Request: type=${r.request_type}; budget=${r.budget ?? "?"}; party=${r.party_size ?? "?"}; dates=${r.dates_from ?? "?"} to ${r.dates_to ?? "?"}; area=${String(r.area ?? "?").slice(0, 120)}
Brief: ${String(r.brief ?? "").slice(0, 900)}
Messages (latest 8):
${convo || "(no email found)"}`;
    let cls: any = {};
    try { cls = parseLooseJson(await aiChat("You classify lost sales requests. JSON only.", prompt, { maxTokens: 4096, temperature: 0.1 })); } catch (e) { cls = { category: "unclear", reason_el: "σφάλμα μοντέλου" }; }
    const rec = {
      id: r.id, status: r.status, request_type: r.request_type, created: r.created_at?.slice(0, 10), dates_from: r.dates_from, dates_to: r.dates_to,
      nights: r.dates_from && r.dates_to ? Math.round((Date.parse(r.dates_to) - Date.parse(r.dates_from)) / 86400000) : null,
      lead_days: r.dates_from ? Math.round((Date.parse(r.dates_from) - Date.parse(r.created_at)) / 86400000) : null,
      party: r.party_size, budget: r.budget, area: String(r.area ?? "").slice(0, 60),
      inbound: inbound.length, outbound: outbound.length,
      first_reply_hours: firstOut ? Math.round((Date.parse(firstOut) - Date.parse(r.created_at)) / 3600000) : null,
      had_note: !!r.lost_reason, category: cls.category ?? "unclear", reason_el: cls.reason_el ?? "", budget_eur_week: cls.client_budget_eur_week ?? null, evidence: String(cls.evidence ?? "").slice(0, 200),
      email: r.client_email, name: `${r.client_name ?? ""} ${r.client_surname ?? ""}`.trim(),
    };
    fs.appendFileSync(out, JSON.stringify(rec) + "\n");
    if (i % 10 === 0) console.log(`${i}/${rows.length}`);
  }
  console.log("done", rows.length);
})().catch((e) => { console.error(e); process.exit(1); });
