"use client";

// The Helm — SUPPLIER REPLIES, auto-matched to this request (2026-07-17).
// George sends inquiries to five suppliers across three requests and the
// answers used to land as an unsorted pile in his inbox. Now every reply that
// belongs to THIS request appears here by itself (bound Gmail threads + the
// Ref-code sweep), each with one Import button that drops it into the
// supplier text ready for Extract. No more reading whole emails to figure
// out which client they are about.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Reply = { id: string; from: string; subject: string; date: string; snippet: string; imported: boolean };
type Group = { supplier: string; replies: Reply[] };

function fmtWhen(dateHeader: string): string {
  const d = new Date(dateHeader);
  if (isNaN(d.getTime())) return dateHeader;
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
}

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim();
}

export default function SupplierReplies({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [code, setCode] = useState("");
  const [newCount, setNewCount] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load"); setErr(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/supplier-replies`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setGroups(j.groups || []);
      setCode(j.code || "");
      setNewCount(j.newCount || 0);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  async function importReply(messageId: string) {
    setBusy(messageId); setErr(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/gmail-import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", messageIds: [messageId], readBrochures: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "import failed");
      await load();
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  const label: React.CSSProperties = { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", fontWeight: 700 };
  const hasAnything = (groups?.length ?? 0) > 0;

  return (
    <section style={{ background: "#fff", border: "1px solid rgba(13,27,42,0.08)", borderRadius: 2, padding: "14px 16px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={label}>Supplier replies · matched to this request</span>
        {newCount > 0 && (
          <span style={{ background: "#C9A84C", color: "#0D1B2A", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "2px 10px" }}>
            {newCount} new
          </span>
        )}
        {code && <span style={{ fontSize: 11, color: "#9CA3AF" }}>Ref {code}</span>}
        <button type="button" onClick={load} disabled={busy !== null}
          style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(13,27,42,0.2)", borderRadius: 2, padding: "4px 10px", fontSize: 11, cursor: "pointer", color: "#0D1B2A" }}>
          {busy === "load" ? "Checking…" : "Refresh"}
        </button>
      </div>

      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 8 }}>{err}</p>}
      {groups === null && !err && <p style={{ color: "#9CA3AF", fontSize: 12.5, marginTop: 8 }}>Checking your suppliers&apos; threads…</p>}
      {groups !== null && !hasAnything && (
        <p style={{ color: "#9CA3AF", fontSize: 12.5, fontStyle: "italic", marginTop: 8 }}>
          No supplier inquiries sent from this request yet. Send one below (Ask the suppliers) and every reply will appear here by itself.
        </p>
      )}

      {(groups || []).map((g, gi) => (
        <div key={`${g.supplier}-${gi}`} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1f2937" }}>
            {g.supplier}
            {g.replies.length === 0 && <span style={{ color: "#9CA3AF", fontWeight: 400 }}> · no reply yet</span>}
          </div>
          {g.replies.map((m) => (
            <div key={m.id} style={{
              display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", marginTop: 6,
              background: m.imported ? "rgba(58,107,71,0.06)" : "rgba(201,168,76,0.08)", borderRadius: 2,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: "#1f2937" }}>
                  <b>{senderName(m.from)}</b> · <span style={{ color: "#6b7280" }}>{fmtWhen(m.date)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.snippet}
                </div>
              </div>
              {m.imported ? (
                <span style={{ fontSize: 11, color: "#3A6B47", fontWeight: 700, flexShrink: 0, paddingTop: 3 }}>✓ imported</span>
              ) : (
                <button type="button" onClick={() => importReply(m.id)} disabled={busy !== null}
                  style={{ flexShrink: 0, background: "#0D1B2A", color: "#fff", border: "none", borderRadius: 2, padding: "6px 12px", fontSize: 11, cursor: "pointer" }}>
                  {busy === m.id ? "Importing…" : "Import"}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
