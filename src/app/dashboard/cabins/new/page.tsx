// gy-command — create a new Cabin from a MYBA contract paste.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EXAMPLE = JSON.stringify(
  {
    myba_contract_number: "MYBA-2027-0001",
    vessel_name: "M/Y Example",
    vessel_make_model: "Sunreef 50 Power",
    vessel_length: "51 ft",
    vessel_capacity: 10,
    homeport: "Piraeus",
    charter_period_from: "2027-07-15",
    charter_period_to: "2027-07-22",
    port_embarkation: "Piraeus",
    port_disembarkation: "Mykonos",
    cruising_area: "Cyclades",
    principal_charterer_name: "Alessandra Visconti",
    principal_charterer_email: "alessandra@example.com",
    principal_charterer_mobile: "+39 333 555 1212",
    captain_name_internal: "Stavros Manolakis",
    chef_name_internal: "Nikos Papadopoulos",
    hostess_name_internal: "Eleni Aravantinou",
    central_agent_internal: "IYC",
    charter_fee_eur: 38000,
    apa_eur: 9500,
    crew_display: [
      { first_name: "Stavros", role: "Captain", bio: "Twenty-two years across Greek waters." },
      { first_name: "Nikos",   role: "Chef",    bio: "Trained in Crete and Paris." },
      { first_name: "Eleni",   role: "Hostess", bio: "Athenian. Five languages." },
    ],
  },
  null,
  2,
);

export default function NewCabinPage() {
  const router = useRouter();
  const [json, setJson] = useState(EXAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setError("Invalid JSON: " + (err as Error).message);
      setBusy(false);
      return;
    }
    try {
      const r = await fetch("/api/cabins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "create-failed");
      router.push(`/dashboard/cabins/${j.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C" }}>
          The Cabin · Admin
        </div>
        <h1 style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 300 }}>Create a new cabin</h1>
        <p style={{ color: "#6b7280", fontStyle: "italic", margin: "8px 0 0" }}>
          Paste the JSON shape below. Once saved, the principal charterer record is created,
          all 8 empty brief sections are seeded, and you can send the magic link from the
          cabin detail page.
        </p>
      </header>

      <form onSubmit={submit}>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={28}
          style={{
            width: "100%", fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
            fontSize: 12.5, padding: 14, border: "1px solid rgba(13,27,42,0.18)",
            background: "#fff",
          }}
        />
        {error && (
          <p style={{ color: "#b91c1c", margin: "10px 0", fontFamily: "ui-monospace" }}>
            {error}
          </p>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 12 }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: "#0D1B2A", color: "#F8F5F0", padding: "12px 22px",
              fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase",
              border: "1px solid #C9A84C", cursor: "pointer",
            }}
          >
            {busy ? "Creating…" : "Create cabin"}
          </button>
          <button
            type="button"
            onClick={() => setJson(EXAMPLE)}
            style={{
              background: "transparent", padding: "12px 22px",
              fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase",
              border: "1px solid rgba(13,27,42,0.18)", cursor: "pointer",
            }}
          >
            Reset to example
          </button>
        </div>
      </form>
    </div>
  );
}
