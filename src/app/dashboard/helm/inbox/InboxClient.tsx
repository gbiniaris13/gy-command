"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Pending } from "@/lib/helm/inbox-documents";

type CharterLite = { id: string; client: string; vessel: string; from: string; to: string };
const TYPES: [string, string][] = [["contract", "Contract (MYBA)"], ["passport", "Passport"], ["payment_proof", "Payment proof"], ["invoice", "Invoice"], ["crew_list", "Crew / guest list"], ["preference_sheet", "Preference sheet"], ["other", "Other"]];

export default function InboxClient({ pending, charters }: { pending: Pending[]; charters: CharterLite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [over, setOver] = useState(false);
  const [choice, setChoice] = useState<Record<string, { request_id: string; type: string }>>({});

  async function drop(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      setBusy(f.name);
      try {
        const fd = new FormData(); fd.append("file", f);
        const r = await fetch("/api/helm/inbox", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "failed");
        if (j.filed) setLog((l) => [{ ok: true, text: `${f.name}: filed as ${label(j.filed.type)} under ${j.filed.client}, ${j.filed.vessel}.` }, ...l]);
        else setLog((l) => [{ ok: false, text: `${f.name}: I was not sure whose it is${j.suggestion ? ` (my guess: ${j.suggestion.client})` : ""}. Decide below.` }, ...l]);
      } catch (e) {
        setLog((l) => [{ ok: false, text: `${f.name}: ${(e as Error).message}` }, ...l]);
      } finally { setBusy(null); }
    }
    router.refresh();
  }

  async function fileIt(p: Pending) {
    const c = choice[p.key] ?? { request_id: guessId(p), type: p.reading?.type ?? "other" };
    if (!c.request_id) return;
    setBusy(p.key);
    try {
      const r = await fetch("/api/helm/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "file", key: p.key, request_id: c.request_id, type: c.type }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "failed");
      const ch = charters.find((x) => x.id === c.request_id);
      setLog((l) => [{ ok: true, text: `${p.name}: filed as ${label(c.type)} under ${ch?.client ?? "the charter"}.` }, ...l]);
      router.refresh();
    } catch (e) { setLog((l) => [{ ok: false, text: `${p.name}: ${(e as Error).message}` }, ...l]); } finally { setBusy(null); }
  }
  async function discard(p: Pending) {
    if (!window.confirm(`Forget ${p.name}? The email itself stays in Gmail.`)) return;
    setBusy(p.key);
    try { await fetch("/api/helm/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard", key: p.key }) }); router.refresh(); } finally { setBusy(null); }
  }
  function guessId(p: Pending): string {
    if (!p.guess) return "";
    const g = p.guess.split(" · ")[0];
    return charters.find((c) => c.client === g)?.id ?? "";
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>The Helm · GY Inbox</div>
          <h1 style={{ margin: "6px 0 0 0", fontSize: 28, fontWeight: 300 }}>Drop a paper, it files itself</h1>
          <div style={{ marginTop: 6, fontSize: 13, color: "#6B7280", maxWidth: 640, lineHeight: 1.5 }}>
            Contracts, passports, payment proofs, invoices. I read what it is and whose it is, and put it under the charter, in the Helm and in Drive.
            Papers that reach your Gmail from a client, or that you forward to yourself with <b>GY INBOX</b> in the subject, arrive here on their own.
          </div>
        </div>
        <Link href="/dashboard/helm" style={ghost}>← Requests</Link>
      </header>

      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) void drop(e.dataTransfer.files); }}
        style={{ display: "block", border: `2px dashed ${over ? "#C9A84C" : "rgba(13,27,42,0.25)"}`, background: over ? "rgba(201,168,76,0.08)" : "#fff", padding: "38px 20px", textAlign: "center", cursor: "pointer", marginBottom: 18 }}>
        <div style={{ fontSize: 15, color: "#0D1B2A" }}>{busy && !busy.includes(":") ? `Reading ${busy}…` : "Drop papers here, or click to choose"}</div>
        <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>PDF, JPG, PNG, HEIC · up to 4 MB each · larger ones by email with GY INBOX in the subject</div>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.length) void drop(e.target.files); e.target.value = ""; }} />
      </label>

      {log.length > 0 && (
        <div style={{ marginBottom: 18, display: "grid", gap: 6 }}>
          {log.slice(0, 8).map((l, i) => (
            <div key={i} style={{ fontSize: 13, padding: "8px 12px", background: l.ok ? "rgba(58,107,71,0.08)" : "rgba(176,122,44,0.08)", border: `1px solid ${l.ok ? "rgba(58,107,71,0.35)" : "rgba(176,122,44,0.4)"}` }}>{l.text}</div>
          ))}
        </div>
      )}

      <section>
        <div style={{ fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#0D1B2A", fontWeight: 600, marginBottom: 10 }}>Waiting for a word from you · {pending.length}</div>
        {pending.length === 0 ? (
          <div style={{ fontSize: 13, color: "#6B7280" }}>Nothing is waiting. Everything that arrived found its charter.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {pending.map((p) => {
              const c = choice[p.key] ?? { request_id: guessId(p), type: p.reading?.type ?? "other" };
              return (
                <div key={p.key} style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.12)", padding: "12px 14px", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 14, color: "#0D1B2A" }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 2 }}>
                        {[p.from ? `from ${p.from}` : "dropped here", p.received_at ? new Date(p.received_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "", p.reading?.summary].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {p.guess && <div style={{ fontSize: 11.5, color: "#B07A2C" }}>My guess: {p.guess}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={c.request_id} onChange={(e) => setChoice((o) => ({ ...o, [p.key]: { ...c, request_id: e.target.value } }))} style={sel}>
                      <option value="">Whose is it?</option>
                      {charters.map((ch) => <option key={ch.id} value={ch.id}>{ch.client} · {ch.vessel} · {ch.from}</option>)}
                    </select>
                    <select value={c.type} onChange={(e) => setChoice((o) => ({ ...o, [p.key]: { ...c, type: e.target.value } }))} style={sel}>
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <button type="button" disabled={busy !== null || !c.request_id} onClick={() => fileIt(p)} style={{ ...primary, cursor: "pointer", opacity: c.request_id ? 1 : 0.5 }}>{busy === p.key ? "Filing…" : "File it"}</button>
                    <button type="button" disabled={busy !== null} onClick={() => discard(p)} style={{ background: "none", border: "none", color: "#9CA3AF", fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>Forget it</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function label(t: string) { return TYPES.find(([v]) => v === t)?.[1] ?? t; }
const ghost: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.25)", padding: "9px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", textDecoration: "none", display: "inline-block" };
const primary: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase" };
const sel: React.CSSProperties = { padding: "7px 8px", border: "1px solid rgba(13,27,42,0.2)", fontSize: 12.5, fontFamily: "inherit", background: "#fff", maxWidth: 360 };
