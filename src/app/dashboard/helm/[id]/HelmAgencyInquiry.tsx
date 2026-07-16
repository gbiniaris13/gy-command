"use client";

// The Helm — email the CENTRAL AGENCY (the supplier). Broker-to-supplier B2B:
// full George Yachts identity, end client kept anonymous. The supplier book
// is a PHONEBOOK-STYLE LIST (2026-07-16, George's spec): company name, email
// under it, and one line per boat CATEGORY with its net-charter-fee range
// ("Catamarans: EUR 10-60k/wk"), so a non-broker employee holding "all-in
// EUR 25k, wants a catamaran" picks the right suppliers at a glance. Name and
// categories are editable per row (pencil). New addresses are saved forever.
// One separate email per recipient, never a shared To/CC/BCC. Nothing is
// ever auto-sent.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Entry = { email: string; name: string; info: string };

export default function HelmAgencyInquiry({
  requestId, agencyEmail, alreadySentTo,
}: {
  requestId: string;
  agencyEmail: string | null;
  alreadySentTo: string[];
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ---- supplier book + this request's own addresses ----
  const fieldList = (agencyEmail || "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const sentSet = new Set((alreadySentTo || []).map((e) => e.toLowerCase()));
  const [book, setBook] = useState<Entry[]>([]);
  const [bookLoaded, setBookLoaded] = useState(false);
  // Pre-tick the request's own agencies that have NOT been contacted yet;
  // an already-contacted one starts unticked (re-ticking it = deliberate resend).
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(fieldList.filter((e) => !sentSet.has(e))),
  );
  const [newAddr, setNewAddr] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/helm/supplier-book`)
      .then((r) => r.json())
      .then((j) => { if (alive && Array.isArray(j.entries)) setBook(j.entries); })
      .catch(() => { /* book unavailable -> the request's own addresses still work */ })
      .finally(() => { if (alive) setBookLoaded(true); });
    return () => { alive = false; };
  }, []);

  // The visible list = saved book ∪ this request's own addresses.
  const bookEmails = new Set(book.map((b) => b.email));
  const roster: Entry[] = [
    ...book,
    ...fieldList.filter((e) => !bookEmails.has(e)).map((e) => ({ email: e, name: "", info: "" })),
  ].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const q = filter.trim().toLowerCase();
  const visible = q
    ? roster.filter((r) => r.email.includes(q) || r.name.toLowerCase().includes(q) || r.info.toLowerCase().includes(q))
    : roster;
  const chosen = roster.filter((r) => selected.has(r.email)).map((r) => r.email);

  function toggle(e: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e); else next.add(e);
      return next;
    });
  }

  async function addAddress() {
    const e = newAddr.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e)) { setErr("That does not look like an email address."); return; }
    setErr(null);
    setBook((prev) => (prev.some((x) => x.email === e) ? prev : [...prev, { email: e, name: "", info: "" }]));
    setSelected((prev) => new Set(prev).add(e));
    setNewAddr("");
    setEditing(e); // straight into naming it
    // Persist right away so it is there next time, even before any send.
    try {
      await fetch(`/api/helm/supplier-book`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", email: e }),
      });
    } catch { /* send will re-save it anyway */ }
  }

  async function removeAddress(e: string) {
    if (!confirm(`Remove ${e} from your saved suppliers?\n\n(Only the saved list changes - no request is touched.)`)) return;
    setBook((prev) => prev.filter((x) => x.email !== e));
    setSelected((prev) => { const n = new Set(prev); n.delete(e); return n; });
    try {
      await fetch(`/api/helm/supplier-book`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", email: e }),
      });
    } catch { /* it will reappear on reload; harmless */ }
  }

  function editEntry(e: string, patch: Partial<Entry>) {
    setBook((prev) => prev.map((x) => (x.email === e ? { ...x, ...patch } : x)));
  }

  async function persistEntry(e: string) {
    const entry = book.find((x) => x.email === e);
    if (!entry) return;
    try {
      await fetch(`/api/helm/supplier-book`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", email: e, name: entry.name, info: entry.info }),
      });
    } catch { /* kept locally; saved again on next edit */ }
  }

  async function generate() {
    setBusy("generate"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/agency-inquiry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setSubject(j.subject || "");
      setBody(j.body || "");
      setMsg("Draft generated. Review and edit before sending.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function send() {
    if (!chosen.length) return;
    const resends = chosen.filter((e) => sentSet.has(e));
    const resendNote = resends.length ? `\nAlready contacted, will receive it AGAIN: ${resends.join(", ")}\n` : "";
    const ok = confirm(`Send a SEPARATE inquiry email to EACH of these suppliers?\n\n${chosen.join("\n")}\n${resendNote}\nNo recipient sees the others (no shared To, no Cc, no Bcc). Sent from your George Yachts inbox.`);
    if (!ok) return;
    setBusy("send"); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/agency-inquiry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", subject, body, to: chosen }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "send-failed");
      const n = j.sent ?? 0;
      setMsg(n === 0
        ? (j.message || "Nothing was sent.")
        : `Sent ${n} separate email${n === 1 ? "" : "s"} (one per supplier, no one sees the others). Logged, and every address is saved in your supplier list.`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(body); setMsg("Inquiry text copied."); }
    catch { setMsg("Select the text and copy manually."); }
  }

  return (
    <section style={card}>
      <div style={cardLabel}>Email the central agency · broker-to-supplier inquiry</div>

      {/* Supplier book — phonebook list: tick who receives this inquiry */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={fieldLabel}>Your suppliers · tick who gets this inquiry</div>
          {roster.length > 6 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter… (e.g. catamaran, 25k, istion)"
              style={{ ...input, marginTop: 0, width: 240, padding: "5px 8px", fontSize: 12 }}
            />
          )}
        </div>
        {!bookLoaded && <div style={{ fontSize: 12.5, color: "#9CA3AF", marginTop: 6 }}>Loading your supplier list…</div>}
        {bookLoaded && roster.length === 0 && (
          <div style={{ fontSize: 12.5, color: "#7c4a03", marginTop: 6 }}>No saved suppliers yet - add the first one below and it stays for every next request.</div>
        )}
        <div style={{ marginTop: 8, maxHeight: 420, overflow: "auto", border: roster.length ? "1px solid rgba(13,27,42,0.08)" : "none", borderRadius: 2 }}>
          {visible.map((r) => {
            const isSel = selected.has(r.email);
            const wasSent = sentSet.has(r.email);
            const isEditing = editing === r.email;
            const infoLines = r.info.split("|").map((s) => s.trim()).filter(Boolean);
            return (
              <div key={r.email} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px",
                background: isSel ? "rgba(13,27,42,0.05)" : "transparent",
                borderBottom: "1px solid rgba(13,27,42,0.05)",
              }}>
                <input type="checkbox" checked={isSel} onChange={() => toggle(r.email)} style={{ flexShrink: 0, cursor: "pointer", marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <>
                      <input
                        value={r.name}
                        maxLength={60}
                        autoFocus
                        onChange={(e) => editEntry(r.email, { name: e.target.value })}
                        placeholder="Company name, e.g. Istion Yachting"
                        style={{ ...input, marginTop: 0, fontWeight: 700, fontSize: 13 }}
                      />
                      <textarea
                        value={r.info}
                        maxLength={400}
                        rows={3}
                        onChange={(e) => editEntry(r.email, { info: e.target.value })}
                        placeholder={'One line per category, separated by "|", e.g.\nCatamarans: EUR 10-60k/wk | Motor yachts: EUR 30-500k/wk'}
                        style={{ ...textarea, marginTop: 6, fontSize: 12, rows: 3 } as React.CSSProperties}
                      />
                      <button
                        type="button"
                        onClick={() => { setEditing(null); persistEntry(r.email); }}
                        style={{ ...ghostBtn, marginTop: 6, padding: "5px 10px" }}
                      >Done</button>
                    </>
                  ) : (
                    <div onClick={() => toggle(r.email)} style={{ cursor: "pointer" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2937" }}>
                        {r.name || r.email}
                        {wasSent && <span style={{ color: "#B45309", fontWeight: 500, fontSize: 11.5 }}> · already contacted</span>}
                      </div>
                      {r.name && <div style={{ fontSize: 11, color: "#9CA3AF", overflowWrap: "anywhere" }}>{r.email}</div>}
                      {infoLines.length > 0 ? (
                        <div style={{ marginTop: 3 }}>
                          {infoLines.map((line, i) => {
                            const ci = line.indexOf(":");
                            const cat = ci > 0 ? line.slice(0, ci) : "";
                            const rest = ci > 0 ? line.slice(ci + 1).trim() : line;
                            return (
                              <div key={i} style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
                                {cat ? <b style={{ color: "#0D1B2A" }}>{cat}:</b> : null} {rest}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "#b7bcc5", fontStyle: "italic", marginTop: 2 }}>
                          No fleet/budget noted yet - press ✎ to add it.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!isEditing && (
                  <span title="Edit name and categories" onClick={() => setEditing(r.email)}
                    style={{ cursor: "pointer", opacity: 0.5, flexShrink: 0, fontSize: 13 }}>✎</span>
                )}
                <span title="Remove from saved suppliers" onClick={() => removeAddress(r.email)}
                  style={{ cursor: "pointer", opacity: 0.45, fontWeight: 700, flexShrink: 0, padding: "0 4px" }}>×</span>
              </div>
            );
          })}
          {bookLoaded && visible.length === 0 && roster.length > 0 && (
            <div style={{ fontSize: 12.5, color: "#9CA3AF", padding: 10 }}>Nothing matches the filter.</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 460 }}>
          <input
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newAddr.trim()) addAddress(); }}
            placeholder="Add a supplier email - saved for next time"
            style={{ ...input, marginTop: 0, flex: 1 }}
          />
          <button type="button" onClick={addAddress} disabled={!newAddr.trim()} style={ghostBtn}>Add</button>
        </div>
      </div>

      <button type="button" onClick={generate} disabled={busy !== null} style={primaryBtn}>
        {busy === "generate" ? "Generating…" : body ? "Regenerate draft" : "Generate inquiry"}
      </button>

      {(subject || body) && (
        <>
          <label style={{ ...fieldLabel, marginTop: 12, display: "block" }}>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} style={input} />

          <label style={{ ...fieldLabel, marginTop: 10, display: "block" }}>
            Inquiry (George voice, full George Yachts identity · the client stays anonymous to the supplier)
          </label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} style={textarea} />

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={send} disabled={busy !== null || chosen.length === 0 || !body.trim() || !subject.trim()} style={primaryBtn}>
              {busy === "send" ? "Sending…" : chosen.length === 0 ? "Tick at least one supplier" : `Send to ${chosen.length} supplier${chosen.length === 1 ? "" : "s"}`}
            </button>
            <button type="button" onClick={copy} disabled={!body.trim()} style={ghostBtn}>Copy text</button>
          </div>
        </>
      )}

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 10, fontStyle: "italic" }}>
        Goes to the suppliers from your inbox, never to the client. Each ticked supplier gets a SEPARATE email (no one sees the others). Suppliers already contacted for this request start unticked and are marked - tick one again only if you want a resend. Press ✎ on any supplier to edit their name and boat categories. Your Gmail signature is added automatically. Nothing sends without the button. No attachment.
      </p>
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const input: React.CSSProperties = { width: "100%", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", marginTop: 4 };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 4, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "9px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
