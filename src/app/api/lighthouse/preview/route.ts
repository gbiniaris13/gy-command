// @ts-nocheck
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/google-api";
import { loadPeople, kindsForPerson, holidayDatesForYear, draftFor, HOLIDAY_LABELS, HOLIDAY_OVERRIDES_KEY } from "@/lib/lighthouse";
import { greetingCard } from "@/lib/lighthouse-card";
import { requireUser } from "@/lib/require-user";

// The Lighthouse preview page (George, 6/9/2026, the day before Labor
// Day: "θα ήθελα να δω τι στέλνει. Να δω πώς το έχει γράψει, πώς είναι
// τα γραφικά"). GET renders, for one holiday, exactly what the batch
// send will put in every recipient's inbox: the Edition card with the
// first recipient's name, the subject, the plain-text twin, and the
// full recipient list with emails. The greeting line and subject can
// be edited and saved here (settings lighthouse_holiday_overrides,
// read by the batch route), a test copy can be sent to George alone,
// and the real send stays where it was: the gold button in the
// dashboard.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function readOverrides() {
  try {
    const raw = await getSetting(HOLIDAY_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function GET(request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "";
  const date = url.searchParams.get("date") || "";
  if (!kind || !date) return NextResponse.json({ error: "kind και date απαιτούνται" }, { status: 400 });
  const valid = holidayDatesForYear(Number(date.slice(0, 4)));
  if (valid[kind] !== date) return NextResponse.json({ error: `το ${kind} δεν πέφτει ${date}` }, { status: 400 });

  const overrides = await readOverrides();
  const override = overrides[kind] ?? null;
  const { people } = await loadPeople();
  const seen = new Set();
  const audience = people
    .filter((p) => !p.opt_out && !p.is_minor && p.email && kindsForPerson(p).includes(kind))
    .filter((p) => {
      const e = p.email.toLowerCase();
      if (seen.has(e)) return false;
      seen.add(e);
      return true;
    });
  const sample = audience[0] || { name: "George" };
  const d = draftFor({ kind, person: sample, date, override });
  const defaults = draftFor({ kind, person: sample, date });
  const card = greetingCard({ kind, subject: d.subject, body: d.body });
  const label = HOLIDAY_LABELS[kind] ?? kind;
  const line = override?.line || defaults.body.split(/\n{2,}/)[1] || "";

  const html = `<!DOCTYPE html>
<html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lighthouse · ${esc(label)} · προεπισκόπηση</title>
<style>
  body{margin:0;background:#0B1520;color:#F1EEE7;font-family:-apple-system,Helvetica,Arial,sans-serif;}
  .wrap{max-width:1180px;margin:0 auto;padding:22px 18px 60px;}
  .top{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start;}
  @media(max-width:860px){.top{grid-template-columns:1fr}}
  h1{font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 4px;}
  .muted{color:#97A5B2;font-size:13px;line-height:1.5}
  .box{border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:16px 18px;background:rgba(255,255,255,.03);margin-top:14px;}
  label{display:block;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#A8873B;margin:12px 0 6px}
  input,textarea{width:100%;box-sizing:border-box;background:#0F1D2B;color:#F1EEE7;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:10px 12px;font-size:15px;font-family:Georgia,serif}
  textarea{min-height:110px;line-height:1.5}
  .btn{display:inline-block;border:0;border-radius:999px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;margin:12px 8px 0 0}
  .gold{background:#DAA110;color:#0B1520}
  .ghost{background:transparent;color:#F1EEE7;border:1px solid rgba(255,255,255,.25)}
  .names{columns:2;column-gap:18px;font-size:13px;line-height:1.7;color:#C9D2DA}
  .names div{break-inside:avoid}
  .names small{color:#7C8B99}
  iframe{width:100%;height:1180px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#F1EEE7}
  pre{white-space:pre-wrap;font-family:Georgia,serif;font-size:14px;line-height:1.55;color:#C9D2DA;margin:0}
  #msg{margin-top:10px;font-size:13px;color:#DAA110;min-height:18px}
</style></head><body><div class="wrap">
  <div class="top">
    <div>
      <h1>${esc(label)} · ${esc(date)} · ${audience.length} παραλήπτες</h1>
      <p class="muted">Αυτό ακριβώς φεύγει σε κάθε παραλήπτη, με το δικό του μικρό όνομα στην προσφώνηση. Η κάρτα δεξιά είναι όπως θα τη δει ο πρώτος της λίστας (${esc(sample.name)}). Η πραγματική αποστολή γίνεται μόνο από το χρυσό κουμπί στο Lighthouse.</p>
      <div class="box">
        <label>Θέμα (subject)</label>
        <input id="subject" value="${esc(d.subject)}">
        <label>Η ευχή (μία ή δύο προτάσεις, αγγλικά)</label>
        <textarea id="line">${esc(line)}</textarea>
        <p class="muted">Προσφώνηση «Dear Όνομα,» και υπογραφή «Warm regards, George P. Biniaris» μπαίνουν μόνα τους. Χωρίς μεγάλη παύλα.</p>
        <button class="btn gold" onclick="save()">Αποθήκευση κειμένου</button>
        <button class="btn ghost" onclick="resetText()">Επαναφορά στο αρχικό</button>
        <button class="btn ghost" onclick="testSend()">Στείλε δοκιμή σε μένα</button>
        <div id="msg">${override ? "Ισχύει το δικό σου κείμενο (αποθηκεύτηκε " + esc(String(override.saved_at || "").slice(0, 16).replace("T", " ")) + ")." : "Ισχύει το αρχικό κείμενο του house."}</div>
      </div>
      <div class="box">
        <label>Το απλό κείμενο (για όσους διαβάζουν χωρίς γραφικά)</label>
        <pre>${esc(d.body)}</pre>
      </div>
      <div class="box">
        <label>Οι ${audience.length} παραλήπτες</label>
        <div class="names">${audience.map((p) => `<div>${esc(p.name)} <small>${esc(p.email)}${p.country ? " · " + esc(p.country) : ""}</small></div>`).join("")}</div>
        <p class="muted" style="margin-top:10px">Κάποιος δεν πρέπει να την πάρει; Πες μου το όνομα και μπαίνει opt-out πριν πατήσεις το κουμπί.</p>
      </div>
    </div>
    <div>
      <label style="margin-top:0">Η κάρτα, όπως θα ανοίξει στο inbox</label>
      <iframe id="card" srcdoc="${esc(card)}"></iframe>
    </div>
  </div>
</div>
<script>
  const KIND=${JSON.stringify(kind)}, DATE=${JSON.stringify(date)};
  const msg=(t)=>{document.getElementById("msg").textContent=t;};
  async function post(body){const r=await fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});return r.json();}
  async function save(){
    msg("Αποθηκεύεται…");
    const d=await post({action:"save",kind:KIND,subject:document.getElementById("subject").value,line:document.getElementById("line").value});
    if(d.error){msg("Δεν αποθηκεύτηκε: "+d.error);return;}
    location.reload();
  }
  async function resetText(){
    msg("Επαναφορά…");
    const d=await post({action:"reset",kind:KIND});
    if(d.error){msg("Δεν έγινε: "+d.error);return;}
    location.reload();
  }
  async function testSend(){
    msg("Στέλνεται δοκιμή στο george@georgeyachts.com…");
    const r=await fetch("/api/lighthouse/batch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind:KIND,date:DATE,confirm:true,test:true})});
    const d=await r.json();
    msg(d.error?("Δεν εστάλη: "+d.error):("Η δοκιμή έφυγε στο "+d.sent_to+" (ως "+d.as+"). Κοίτα το inbox σου."));
  }
</script>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const body = await request.json();
  const { action, kind } = body;
  if (!kind || !HOLIDAY_LABELS[kind]) return NextResponse.json({ error: "άγνωστη γιορτή" }, { status: 400 });
  const overrides = await readOverrides();
  if (action === "save") {
    const subject = String(body.subject || "").replace(/—/g, ", ").trim().slice(0, 120);
    const line = String(body.line || "").replace(/—/g, ", ").trim().slice(0, 600);
    if (!line) return NextResponse.json({ error: "η ευχή δεν μπορεί να είναι κενή" }, { status: 400 });
    overrides[kind] = { subject, line, saved_at: new Date().toISOString() };
    await setSetting(HOLIDAY_OVERRIDES_KEY, JSON.stringify(overrides));
    return NextResponse.json({ ok: true });
  }
  if (action === "reset") {
    delete overrides[kind];
    await setSetting(HOLIDAY_OVERRIDES_KEY, JSON.stringify(overrides));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "άγνωστη ενέργεια" }, { status: 400 });
}
