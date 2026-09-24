"use client";

// The Helm — the BOOKING panel on a won request (2026-09-24, George: "ποιο
// σκάφος πήραν, κατάσταση πληρωμής, σε ποια εταιρεία ανήκει, και εκεί να
// ανεβαίνουν τα συμβόλαια, τα διαβατήρια, το preference list, όλα μέσα").
//
// One card, three parts:
//   1. The booking facts: yacht taken, owning house (INTERNAL, never client
//      facing), payment status + notes, white label switch, the linked Cabin.
//   2. The papers: upload to the private bucket (mirrored to Google Drive),
//      open, remove. Passports and contracts never get a public URL.
//   3. The two WON next-step drafts (MYBA request to the agency, confirmation
//      to the client), unchanged from before.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Doc = {
  id: string; type: string; name: string; size: number; mime: string;
  uploaded_at: string; drive_link: string | null; drive_error: string | null;
};
type Booking = {
  vessel: string | null; owner_company: string | null; payment_status: string;
  payment_notes: string; white_label: boolean; cabin_id: string | null;
  documents: Doc[]; drive_folder_link: string | null;
};
type CabinLite = {
  id: string; status: string; vessel_name: string; charter_period_from: string;
  charter_period_to: string; principal_charterer_name: string; myba_contract_number: string | null;
  deleted_at: string | null;
};
type Payload = {
  booking: Booking;
  cabin: CabinLite | null;
  cabins: { id: string; label: string; status: string }[];
  drive: { granted: boolean };
};

const PAYMENT_OPTIONS = [
  ["unpaid", "Unpaid"], ["deposit_paid", "Deposit paid"], ["balance_paid", "Balance paid"],
  ["apa_paid", "APA paid"], ["settled", "Settled"],
] as const;
const DOC_TYPES = [
  ["contract", "Contract (MYBA)"], ["passport", "Passport / ID"], ["preference_sheet", "Preference sheet"],
  ["crew_list", "Crew list"], ["invoice", "Invoice"], ["payment_proof", "Payment proof"], ["other", "Other"],
] as const;
const DOC_LABEL: Record<string, string> = Object.fromEntries(DOC_TYPES);
const MAX_MB = 4;

function fmtSize(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
function fmtWhen(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });
}

export default function HelmBooking({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Booking facts (local form state, saved on blur / change).
  const [vessel, setVessel] = useState("");
  const [owner, setOwner] = useState("");
  const [payment, setPayment] = useState("unpaid");
  const [notes, setNotes] = useState("");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Papers
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState("contract");
  const [uploading, setUploading] = useState(false);

  // Drafts (unchanged feature)
  const [agency, setAgency] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [drafting, setDrafting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/helm/${requestId}/booking`, { cache: "no-store" });
      const j = (await r.json()) as Payload & { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      setVessel(j.booking.vessel || "");
      setOwner(j.booking.owner_company || "");
      setPayment(j.booking.payment_status || "unpaid");
      setNotes(j.booking.payment_notes || "");
      setWhiteLabel(!!j.booking.white_label);
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  }, [requestId]);

  useEffect(() => { load(); }, [load]);

  async function post(payload: Record<string, unknown>, key: string) {
    setSaving(key); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/booking`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      await load();
      router.refresh();
      return j;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setSaving(null);
    }
  }

  async function saveFacts(patch: Record<string, unknown>, key: string, okMsg = "Saved.") {
    const j = await post({ action: "save", ...patch }, key);
    if (j) setMsg(okMsg);
  }

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr("Choose a file first."); return; }
    if (f.size > MAX_MB * 1048576) {
      setErr(`${f.name} is ${fmtSize(f.size)}. The limit is ${MAX_MB} MB per file; compress the PDF or upload the pages as JPEG.`);
      return;
    }
    setUploading(true); setErr(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("type", docType);
      const r = await fetch(`/api/helm/${requestId}/booking-docs`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (fileRef.current) fileRef.current.value = "";
      setMsg(
        j.doc?.drive_link
          ? "Uploaded and mirrored to your Drive."
          : j.doc?.drive_error === "DRIVE_SCOPE_MISSING"
            ? "Uploaded to the private box. Drive mirror is waiting for the Google reconnect (see below)."
            : "Uploaded to the private box.",
      );
      await load();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function removeDoc(d: Doc) {
    if (!confirm(`Remove "${d.name}" from the booking? The Drive copy, if any, stays.`)) return;
    setSaving(`rm${d.id}`); setErr(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/booking-docs/${d.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  async function generate() {
    const chosen = vessel.trim();
    if (!chosen) { setErr("Type the chosen yacht first."); return; }
    setDrafting(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/helm/${requestId}/booking`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", chosen_yacht: chosen }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "generate-failed");
      setAgency(j.agency_request || "");
      setConfirmation(j.confirmation || "");
      setMsg("Drafts ready. Review, copy, and send each from your inbox.");
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setDrafting(false); }
  }

  async function copy(t: string) {
    try { await navigator.clipboard.writeText(t); setMsg("Copied."); }
    catch { setMsg("Select the text and copy manually."); }
  }

  const b = data?.booking;
  const pendingDrive = b?.documents.filter((d) => !d.drive_link).length ?? 0;
  const driveMissing = data ? !data.drive.granted : false;

  return (
    <section style={{ ...card, borderColor: "rgba(58,107,71,0.35)", background: "rgba(58,107,71,0.05)" }}>
      <div style={cardLabel}>Won · the booking</div>

      {loadErr && <p style={{ color: "#b91c1c", fontSize: 12.5 }}>Could not load the booking: {loadErr}</p>}

      {/* 1 · Facts */}
      <div style={grid}>
        <div>
          <label style={fieldLabel}>Yacht they took</label>
          <input
            value={vessel}
            onChange={(e) => setVessel(e.target.value)}
            onBlur={() => { if ((b?.vessel || "") !== vessel.trim()) saveFacts({ vessel }, "vessel"); }}
            placeholder="e.g. S/CAT PI2"
            style={input}
          />
        </div>
        <div>
          <label style={fieldLabel} title="Internal. Never shown to the client.">Owning house · internal</label>
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onBlur={() => { if ((b?.owner_company || "") !== owner.trim()) saveFacts({ owner_company: owner }, "owner"); }}
            placeholder="Company that owns or manages the yacht"
            style={input}
          />
        </div>
        <div>
          <label style={fieldLabel}>Payment status</label>
          <select
            value={payment}
            onChange={(e) => { setPayment(e.target.value); saveFacts({ payment_status: e.target.value }, "payment"); }}
            style={{ ...input, cursor: "pointer" }}
          >
            {PAYMENT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label style={fieldLabel}>White label</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#374151", padding: "9px 0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={whiteLabel}
              onChange={(e) => { setWhiteLabel(e.target.checked); saveFacts({ white_label: e.target.checked }, "wl", e.target.checked ? "White label on. The Lighthouse will not greet this client." : "White label off."); }}
            />
            Booked through a partner: the Lighthouse never greets this client
          </label>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={fieldLabel}>Payment notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if ((b?.payment_notes || "") !== notes) saveFacts({ payment_notes: notes }, "notes"); }}
          rows={2}
          placeholder="Deposit received 12 Oct, balance due 4 weeks before…"
          style={{ ...textarea, marginBottom: 0 }}
        />
      </div>

      {/* Cabin link */}
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={fieldLabel}>The Cabin</span>
        {data?.cabin ? (
          <>
            <Link href={`/dashboard/cabins/${data.cabin.id}`} style={{ ...ghostBtn, textDecoration: "none", display: "inline-block" }}>
              Open Cabin · {data.cabin.vessel_name} · {data.cabin.status}
            </Link>
            <button type="button" onClick={() => post({ action: "link_cabin", cabin_id: null }, "unlink")} disabled={saving !== null} style={ghostBtn}>
              Unlink
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => post({ action: "create_cabin", vessel }, "create")} disabled={saving !== null} style={primaryBtn}>
              {saving === "create" ? "Creating…" : "Create the Cabin from this request"}
            </button>
            {data && data.cabins.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) post({ action: "link_cabin", cabin_id: e.target.value }, "link"); }}
                style={{ ...input, flex: "0 1 320px", cursor: "pointer" }}
              >
                <option value="">…or link an existing Cabin</option>
                {data.cabins.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
          </>
        )}
      </div>

      {/* 2 · Papers */}
      <div style={{ marginTop: 18, borderTop: "1px solid rgba(13,27,42,0.08)", paddingTop: 14 }}>
        <div style={cardLabel}>Papers · contract, passports, preference sheet, crew list</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...input, flex: "0 1 200px", cursor: "pointer" }}>
            {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx,.xls,.xlsx" style={{ fontSize: 12 }} />
          <button type="button" onClick={upload} disabled={uploading} style={primaryBtn}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>Private box, max {MAX_MB} MB per file.</span>
        </div>

        {b && b.documents.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 12.5 }}>
            <tbody>
              {b.documents.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid rgba(13,27,42,0.06)" }}>
                  <td style={{ padding: "7px 6px 7px 0", width: 130 }}>
                    <span style={pill}>{DOC_LABEL[d.type] || d.type}</span>
                  </td>
                  <td style={{ padding: "7px 6px" }}>
                    <a href={`/api/helm/${requestId}/booking-docs/${d.id}`} target="_blank" rel="noreferrer" style={{ color: "#0D1B2A", fontWeight: 600 }}>
                      {d.name}
                    </a>
                    <div style={{ fontSize: 10.5, color: "#9CA3AF" }}>{fmtSize(d.size)} · {fmtWhen(d.uploaded_at)}</div>
                  </td>
                  <td style={{ padding: "7px 6px", whiteSpace: "nowrap", fontSize: 11 }}>
                    {d.drive_link
                      ? <a href={d.drive_link} target="_blank" rel="noreferrer" style={{ color: "#A8873B", fontWeight: 600 }}>In Drive ↗</a>
                      : <span style={{ color: "#b45309" }} title={d.drive_error || ""}>Not in Drive</span>}
                  </td>
                  <td style={{ padding: "7px 0 7px 6px", textAlign: "right" }}>
                    <button type="button" onClick={() => removeDoc(d)} disabled={saving !== null} style={{ ...ghostBtn, padding: "5px 10px" }}>
                      {saving === `rm${d.id}` ? "…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          {b?.drive_folder_link && (
            <a href={b.drive_folder_link} target="_blank" rel="noreferrer" style={{ color: "#A8873B", fontWeight: 600 }}>
              Open the Drive folder ↗
            </a>
          )}
          {pendingDrive > 0 && !driveMissing && (
            <button type="button" onClick={() => post({ action: "sync_drive" }, "sync")} disabled={saving !== null} style={ghostBtn}>
              {saving === "sync" ? "Syncing…" : `Sync ${pendingDrive} file${pendingDrive === 1 ? "" : "s"} to Drive`}
            </button>
          )}
          {driveMissing && (
            <span style={{ color: "#b45309" }}>
              Drive mirror is off: the Google connection was made before Drive was added.{" "}
              <a href="/api/auth/gmail" style={{ color: "#0D1B2A", fontWeight: 700 }}>Reconnect Google once</a>
              {" "}and the papers copy themselves into George Yachts / Bookings.
            </span>
          )}
        </div>
      </div>

      {/* 3 · Next-step drafts */}
      <div style={{ marginTop: 18, borderTop: "1px solid rgba(13,27,42,0.08)", paddingTop: 14 }}>
        <div style={cardLabel}>Next steps · drafts</div>
        <div style={{ fontSize: 12.5, color: "#374151", marginBottom: 10 }}>
          The MYBA contract request to the central agency and a confirmation to the client, from the yacht above.
        </div>
        <button type="button" onClick={generate} disabled={drafting} style={primaryBtn}>
          {drafting ? "Generating…" : "Generate next steps"}
        </button>
        {agency && (
          <div style={{ marginTop: 14 }}>
            <label style={fieldLabel}>1 · MYBA contract request — to the central agency</label>
            <textarea value={agency} onChange={(e) => setAgency(e.target.value)} rows={9} style={textarea} />
            <button type="button" onClick={() => copy(agency)} style={ghostBtn}>Copy</button>
          </div>
        )}
        {confirmation && (
          <div style={{ marginTop: 14 }}>
            <label style={fieldLabel}>2 · Confirmation — to the client / agent</label>
            <textarea value={confirmation} onChange={(e) => setConfirmation(e.target.value)} rows={7} style={textarea} />
            <button type="button" onClick={() => copy(confirmation)} style={ghostBtn}>Copy</button>
          </div>
        )}
      </div>

      {msg && <p style={{ color: "#3A6B47", fontSize: 12.5, marginTop: 10 }}>{msg}</p>}
      {err && <p style={{ color: "#b91c1c", fontSize: 12.5, marginTop: 10 }}>{err}</p>}
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 10 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF", display: "block", marginBottom: 4 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 };
const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", background: "#fff" };
const textarea: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical", marginTop: 4, marginBottom: 8, lineHeight: 1.5 };
const primaryBtn: React.CSSProperties = { background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C", padding: "10px 18px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const ghostBtn: React.CSSProperties = { background: "#fff", color: "#0D1B2A", border: "1px solid rgba(13,27,42,0.2)", padding: "8px 14px", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer" };
const pill: React.CSSProperties = { fontSize: 9, letterSpacing: 1, textTransform: "uppercase", padding: "2px 7px", borderRadius: 3, background: "rgba(13,27,42,0.06)", color: "#374151", border: "1px solid rgba(13,27,42,0.12)", whiteSpace: "nowrap" };
