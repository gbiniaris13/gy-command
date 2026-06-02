"use client";

// The Helm — edit an existing request. Pre-filled from the request; saves via
// PATCH /api/helm/:id (auth-gated, allow-listed fields). Does NOT touch the
// extraction / review / generated proposal state - editing these fields just
// updates the request record. Mirrors the New-request form fields, plus the
// central agency email. Separate component from New (New is left unchanged).

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type EditInitial = {
  request_type: "direct_client" | "travel_agent";
  client_name: string;
  client_title: string;
  client_surname: string;
  client_is_family: boolean;
  client_email: string;
  client_whatsapp: string;
  central_agency_email: string;
  occasion: string;
  party_size: string;
  dates_from: string;
  dates_to: string;
  area: string;
  brief: string;
  supplier_raw: string;
  mode: "single" | "combined";
  no_myba: boolean;
  show_ghost_credit: boolean;
};

export default function EditHelmForm({ requestId, initial }: { requestId: string; initial: EditInitial }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<EditInitial>(initial);

  function set<K extends keyof EditInitial>(k: K, v: EditInitial[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  const agent = f.request_type === "travel_agent";

  async function save() {
    setBusy(true); setError(null);
    try {
      const payload = {
        request_type: f.request_type,
        client_name: f.client_name, client_title: f.client_title, client_surname: f.client_surname,
        client_is_family: f.client_is_family, client_email: f.client_email, client_whatsapp: f.client_whatsapp,
        central_agency_email: f.central_agency_email,
        occasion: f.occasion, party_size: f.party_size, area: f.area,
        dates_from: f.dates_from || null, dates_to: f.dates_to || null,
        brief: f.brief, supplier_raw: f.supplier_raw,
        mode: f.mode, no_myba: f.no_myba, show_ghost_credit: f.show_ghost_credit,
      };
      const r = await fetch(`/api/helm/${requestId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "save-failed");
      router.push(`/dashboard/helm/${requestId}`);
      router.refresh();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <Link href={`/dashboard/helm/${requestId}`} style={{ color: "#0D1B2A", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>
        ← Back to request
      </Link>
      <header style={{ marginTop: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>The Helm · Edit request</div>
        <h1 style={{ margin: "6px 0 0 0", fontSize: 26, fontWeight: 300 }}>Edit charter request</h1>
      </header>

      {/* request type */}
      <section style={card}>
        <div style={cardLabel}>Request type</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {([
            ["direct_client", "Direct Client", "The client receives the full George Yachts proposal."],
            ["travel_agent", "Travel Agent", "White-label PDF (no George Yachts identity). The contact below is the agent."],
          ] as const).map(([key, label, hint]) => (
            <label key={key} style={{
              flex: "1 1 260px", display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
              border: `1px solid ${f.request_type === key ? "#0D1B2A" : "rgba(13,27,42,0.15)"}`,
              background: f.request_type === key ? "rgba(13,27,42,0.03)" : "#fff", padding: "10px 12px",
            }}>
              <input type="radio" name="request_type" checked={f.request_type === key}
                onChange={() => { set("request_type", key); if (key === "travel_agent") set("client_is_family", false); }}
                style={{ marginTop: 3 }} />
              <span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "#6b7280", marginTop: 2 }}>{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* client / agent */}
      <section style={card}>
        <div style={cardLabel}>{agent ? "Travel agent — the agent's details (the proposal PDF is white-labeled)" : "Client — formal addressing (never a bare first name)"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 12 }}>
          <label style={{ display: "block" }}>
            <div style={fieldLabel}>Title</div>
            <select value={f.client_title} onChange={(e) => set("client_title", e.target.value)}
              style={{ width: "100%", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", marginTop: 4, background: "#fff" }}>
              {["Mr", "Mrs", "Ms", "Dr", "Mx"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Input label={agent ? "Agent surname (required to send)" : "Surname (required to send)"} value={f.client_surname} onChange={(v) => set("client_surname", v)} placeholder="Reynolds" />
          <Input label={agent ? "Agent first name (optional)" : "First name (optional · internal)"} value={f.client_name} onChange={(v) => set("client_name", v)} placeholder="James" />
        </div>
        {!agent && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", margin: "12px 0" }}>
            <input type="checkbox" checked={f.client_is_family} onChange={(e) => set("client_is_family", e.target.checked)} />
            Family booking (address as the {f.client_surname || "[Surname]"} Family)
          </label>
        )}
        <div style={grid2}>
          <Input label={agent ? "Agent email" : "Email"} type="email" value={f.client_email} onChange={(v) => set("client_email", v)} placeholder="name@example.com" />
          <Input label={agent ? "Agent WhatsApp / phone" : "WhatsApp / phone"} value={f.client_whatsapp} onChange={(v) => set("client_whatsapp", v)} placeholder="+1 …" />
          <Input label="Occasion" value={f.occasion} onChange={(v) => set("occasion", v)} placeholder="wedding · birthday · family · corporate" />
          <Input label="Party size" value={f.party_size} onChange={(v) => set("party_size", v)} placeholder="up to 10 guests" />
          <Input label="Area" value={f.area} onChange={(v) => set("area", v)} placeholder="Cyclades · Greek waters" />
          <Input label="Dates from" type="date" value={f.dates_from} onChange={(v) => set("dates_from", v)} />
          <Input label="Dates to" type="date" value={f.dates_to} onChange={(v) => set("dates_to", v)} />
        </div>
      </section>

      {/* central agency */}
      <section style={card}>
        <div style={cardLabel}>Central agency (supplier) — for broker-to-supplier inquiries, never shown to the client</div>
        <Input label="Central agency email(s) — comma-separate multiple" type="text" value={f.central_agency_email} onChange={(v) => set("central_agency_email", v)} placeholder="bookings@agency.com, ops@agency.com" />
      </section>

      {/* brief */}
      <section style={card}>
        <div style={cardLabel}>The brief — what the client wants + your notes</div>
        <textarea value={f.brief} onChange={(e) => set("brief", e.target.value)} rows={4} style={textarea} />
      </section>

      {/* supplier */}
      <section style={card}>
        <div style={cardLabel}>Supplier email(s) — paste raw; stays internal, never shown to the client</div>
        <textarea value={f.supplier_raw} onChange={(e) => set("supplier_raw", e.target.value)} rows={8} style={textarea} />
        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6, fontStyle: "italic" }}>
          Changing this does not re-run extraction automatically. Re-extract from the request page after saving if the numbers changed.
        </p>
      </section>

      {/* proposal options */}
      <section style={card}>
        <div style={cardLabel}>Proposal options</div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={fieldLabel}>Format</div>
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              {(["single", "combined"] as const).map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="radio" name="mode" checked={f.mode === m} onChange={() => set("mode", m)} />
                  {m === "single" ? "Single yacht (6-page)" : "Combined (tiered selection)"}
                </label>
              ))}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={f.no_myba} onChange={(e) => set("no_myba", e.target.checked)} />
            No MYBA block (daily / bareboat)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={f.show_ghost_credit} onChange={(e) => set("show_ghost_credit", e.target.checked)} />
            Show Ghost colophon
          </label>
        </div>
      </section>

      {error && <p style={{ color: "#b91c1c", fontSize: 13, marginTop: 12 }}>{error}</p>}

      <div style={{ marginTop: 18, display: "flex", gap: 12 }}>
        <button type="button" onClick={save} disabled={busy} style={{
          background: "#0D1B2A", color: "#F8F5F0", border: "1px solid #C9A84C",
          padding: "12px 24px", fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase", cursor: busy ? "default" : "pointer",
        }}>{busy ? "Saving…" : "Save changes"}</button>
        <Link href={`/dashboard/helm/${requestId}`} style={{
          padding: "12px 24px", fontSize: 11, letterSpacing: 2.5, textTransform: "uppercase",
          color: "#6b7280", textDecoration: "none", border: "1px solid rgba(13,27,42,0.12)",
        }}>Cancel</Link>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={fieldLabel}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: 9, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", marginTop: 4 }} />
    </label>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid rgba(13,27,42,0.08)", padding: "14px 16px", marginTop: 14 };
const cardLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase", color: "#6b7280", marginBottom: 12 };
const fieldLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" };
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const textarea: React.CSSProperties = { width: "100%", padding: 10, border: "1px solid rgba(13,27,42,0.15)", fontSize: 13, fontFamily: "inherit", resize: "vertical" };
