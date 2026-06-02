// gy-command dashboard — The Helm: request detail.
// Server component; reads via service-role.

import Link from "next/link";
import { getRequest, getMessages } from "@/lib/helm-admin";
import StatusTransitions from "./StatusTransitions";
import HelmDetailActions from "./HelmDetailActions";
import GeneratePanel from "./GeneratePanel";
import CombinedPanel from "./CombinedPanel";
import HelmMedia from "./HelmMedia";
import HelmSend from "./HelmSend";
import HelmAgencyInquiry from "./HelmAgencyInquiry";
import { isCloudinaryConfigured } from "@/lib/helm/cloudinary";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default async function HelmDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await getRequest(id);

  if (!r) {
    return (
      <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
        <Link href="/dashboard/helm" style={{ color: "#0D1B2A", fontSize: 12 }}>← All requests</Link>
        <p style={{ marginTop: 20, color: "#6b7280", fontStyle: "italic" }}>Request not found.</p>
      </div>
    );
  }

  const messages = await getMessages(id);
  const name = r.client_name || r.client_email || "(unnamed)";

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/dashboard/helm" style={{ color: "#0D1B2A", fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase" }}>
          ← All requests
        </Link>
        <Link href={`/dashboard/helm/${r.id}/edit`} style={{ color: "#0D1B2A", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", border: "1px solid rgba(13,27,42,0.2)", padding: "6px 14px", textDecoration: "none" }}>
          Edit request
        </Link>
      </div>

      <header style={{ marginTop: 14, marginBottom: 6 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C", fontWeight: 500 }}>
          The Helm · Request
        </div>
        {r.request_type === "travel_agent" && (
          <div style={{ display: "inline-block", marginTop: 8, padding: "3px 10px", background: "#6D28D9", color: "#fff", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase" }}>
            Travel Agent · white-label PDF
          </div>
        )}
        <h1 style={{ margin: "6px 0 0 0", fontSize: 26, fontWeight: 300 }}>{name}</h1>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
          {r.client_email}{r.client_whatsapp ? ` · ${r.client_whatsapp}` : ""}
        </div>
      </header>

      {/* the brief */}
      <section style={card}>
        <div style={cardLabel}>The brief</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field k="Occasion" v={r.occasion} />
          <Field k="Party size" v={r.party_size} />
          <Field k="Area" v={r.area} />
          <Field k="Budget" v={r.budget} />
          <Field k="From" v={fmtDate(r.dates_from)} />
          <Field k="To" v={fmtDate(r.dates_to)} />
          <Field k="Mode" v={r.mode} />
        </div>
        {r.brief && (
          <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#1f2937", marginTop: 4 }}>
            {r.brief}
          </p>
        )}
        {r.special_requests && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>Special requests</div>
            <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#1f2937", marginTop: 2 }}>{r.special_requests}</p>
          </div>
        )}
      </section>

      {/* supplier source (internal only) */}
      <section style={card}>
        <div style={cardLabel}>Supplier source · internal only, never shown to the client raw</div>
        {r.supplier_raw
          ? <pre style={{
              whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5,
              fontFamily: "inherit", color: "#374151", margin: 0, maxHeight: 320, overflow: "auto",
              background: "rgba(13,27,42,0.03)", padding: 12, borderRadius: 2,
            }}>{r.supplier_raw}</pre>
          : <p style={{ color: "#9CA3AF", fontStyle: "italic", fontSize: 13 }}>No supplier text pasted.</p>}
      </section>

      {/* email the central agency (supplier) — broker-to-supplier inquiry */}
      <HelmAgencyInquiry requestId={r.id} agencyEmail={r.central_agency_email ?? null} />

      {/* media — vessel photos + brochure (Cloudinary) */}
      <HelmMedia
        requestId={r.id}
        initialPhotos={Array.isArray(r.vessel_photos) ? r.vessel_photos : []}
        initialBrochureUrl={r.brochure_url ?? null}
        cloudinaryConfigured={isCloudinaryConfigured()}
      />

      {/* generate proposal (extract -> review numbers -> generate PDF).
          Combined mode shows one card per yacht; single mode the classic flow. */}
      {r.mode === "combined" ? (
        <CombinedPanel
          requestId={r.id}
          surname={r.client_surname ?? null}
          initialExtraction={r.extraction && r.extraction.yachts ? r.extraction : null}
          pdfPath={r.proposal_pdf_path ?? null}
          emailSubject={r.email_subject ?? null}
          emailIntro={r.email_intro ?? null}
          initialMedia={(r.combined_media && typeof r.combined_media === "object") ? r.combined_media : {}}
          cloudinaryConfigured={isCloudinaryConfigured()}
        />
      ) : (
        <GeneratePanel
          requestId={r.id}
          hasSupplier={!!r.supplier_raw}
          surname={r.client_surname ?? null}
          mode={r.mode ?? null}
          initialExtraction={r.extraction ?? null}
          pdfPath={r.proposal_pdf_path ?? null}
          emailSubject={r.email_subject ?? null}
          emailIntro={r.email_intro ?? null}
        />
      )}

      {/* send proposal + capture replies (after the PDF is generated) */}
      {r.proposal_pdf_path && (
        <HelmSend
          requestId={r.id}
          clientEmail={r.client_email ?? null}
          initialSubject={r.email_subject ?? null}
          initialBody={r.email_intro ?? null}
          status={r.status}
          followUpAt={r.follow_up_at ?? null}
          threadId={r.gmail_thread_id ?? null}
        />
      )}

      {/* pipeline */}
      <StatusTransitions requestId={r.id} current={r.status} />

      {/* conversation log */}
      <section style={card}>
        <div style={cardLabel}>Conversation & notes</div>
        {messages.length === 0
          ? <p style={{ color: "#9CA3AF", fontStyle: "italic", fontSize: 13 }}>Nothing logged yet.</p>
          : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((m) => (
                <li key={m.id} style={{
                  borderLeft: `2px solid ${m.direction === "outbound" ? "#C9A84C" : m.direction === "inbound" ? "#60A5FA" : "rgba(13,27,42,0.15)"}`,
                  paddingLeft: 12,
                }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>
                    {m.channel || "note"}{m.direction ? ` · ${m.direction}` : ""} · {fmtWhen(m.created_at)}
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", color: "#1f2937", marginTop: 2 }}>
                    {m.body}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

      {/* actions */}
      <HelmDetailActions requestId={r.id} />
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>{k}</div>
      <div style={{ fontSize: 14, color: v ? "#1f2937" : "#cbd5e1", marginTop: 2 }}>{v || "—"}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid rgba(13,27,42,0.08)",
  padding: "14px 16px", marginTop: 14,
};
const cardLabel: React.CSSProperties = {
  fontSize: 10, letterSpacing: 2.5, textTransform: "uppercase",
  color: "#6b7280", marginBottom: 10,
};
