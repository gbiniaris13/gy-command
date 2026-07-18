// gy-command dashboard — The Helm: request detail.
// Server component; reads via service-role.

import Link from "next/link";
import { getRequest, getMessages, isEmailOnNewsletter } from "@/lib/helm-admin";
import { phoneCountry } from "@/lib/phone-country";
import StatusTransitions from "./StatusTransitions";
import HelmDetailActions from "./HelmDetailActions";
import GeneratePanel from "./GeneratePanel";
import CombinedPanel from "./CombinedPanel";
import HelmMedia from "./HelmMedia";
import HelmSend from "./HelmSend";
import HelmFollowUp from "./HelmFollowUp";
import HelmWhatsApp from "./HelmWhatsApp";
import HelmReply from "./HelmReply";
import HelmBooking from "./HelmBooking";
import HelmAgencyInquiry from "./HelmAgencyInquiry";
import GmailImport from "./GmailImport";
import { HelmFlow, Quiet } from "./HelmFlow";
import SupplierReplies from "./SupplierReplies";
import SupplierYachtPicker from "./SupplierYachtPicker";
import { refCode } from "@/lib/helm/refcode";
import { isCloudinaryConfigured } from "@/lib/helm/cloudinary";
import { resolveAgencyRecipients } from "@/lib/helm/recipients";
import { agencyAlreadySent } from "@/lib/helm/agency";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function fmtWhen(iso: string) {
  // Athens explicitly: the server renders in UTC, and George reads the
  // conversation history in his own clock (matches the GY ref codes too).
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens",
  });
}

function fmtShort(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function nightsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const n = Math.round((b - a) / 86400000);
  return n >= 0 ? n : null;
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

  // At-a-glance context, in the same visual language as the pipeline list, so
  // opening a request feels continuous (George 2026-07-17: "κάνε φιλικό το μέσα").
  const pc = phoneCountry(r.client_whatsapp);
  const isAgent = r.request_type === "travel_agent";
  const onNewsletter = await isEmailOnNewsletter(r.client_email);
  const nights = nightsBetween(r.dates_from, r.dates_to);
  const isDay = nights !== null && nights <= 1;
  const year = r.dates_from ? new Date(r.dates_from).getUTCFullYear() : null;
  const futureYear = !!year && year > new Date().getFullYear();
  const proposalKind = r.mode === "combined" ? "Multiple yachts" : r.mode === "single" ? "Single yacht" : null;

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
        <h1 style={{ margin: "8px 0 0 0", fontSize: 26, fontWeight: 300 }}>
          {pc?.flag ? `${pc.flag} ` : ""}{name}
        </h1>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          <span style={{
            fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "2px 8px", borderRadius: 3,
            background: isAgent ? "rgba(109,40,217,0.10)" : "rgba(13,110,90,0.10)",
            color: isAgent ? "#6D28D9" : "#0d6e5a",
            border: `1px solid ${isAgent ? "rgba(109,40,217,0.25)" : "rgba(13,110,90,0.25)"}`,
          }}>{isAgent ? "Travel advisor" : "Direct client"}</span>
          {isAgent && (
            <span style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "2px 8px", borderRadius: 3, background: "#6D28D9", color: "#fff" }}>
              white-label PDF
            </span>
          )}
          {onNewsletter && (
            <span title="Already on the newsletter list" style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", padding: "2px 8px", borderRadius: 3, background: "rgba(201,168,76,0.12)", color: "#A8873B", border: "1px solid rgba(201,168,76,0.35)" }}>
              ✉ Newsletter
            </span>
          )}
          {pc?.country && <span style={{ fontSize: 12, color: "#9CA3AF" }}>{pc.country}</span>}
        </div>
        <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          {r.client_email}{r.client_whatsapp ? ` · ${r.client_whatsapp}` : ""}
          <span style={{ marginLeft: 10, fontFamily: "monospace", fontSize: 12, color: "#C9A84C", fontWeight: 700 }}>
            Ref {refCode(r.created_at)}
          </span>
        </div>
      </header>

      {/* the brief */}
      <HelmFlow
        hasSupplier={!!r.supplier_raw}
        hasExtraction={!!(r.extraction && (r.extraction as { yachts?: unknown[] }).yachts?.length)}
        hasPdf={!!r.proposal_pdf_path}
        status={r.status}
      />

      <section style={card} id="flow-request">
        <div style={cardLabel}>The brief</div>
        {/* the essentials, calm and legible, in the same language as the list */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 30px" }}>
          <Tile k="Guests" v={r.party_size} />
          <Tile k="Budget" v={r.budget} strong />
          <Tile k="Dates">
            {r.dates_from ? (
              <span>
                {fmtShort(r.dates_from)}{r.dates_to ? ` – ${fmtShort(r.dates_to)}` : ""}
                {year && (
                  <span style={{ marginLeft: 8, display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 999, background: futureYear ? "#C9A84C" : "rgba(13,27,42,0.08)", color: futureYear ? "#0D1B2A" : "#6b7280" }}>{year}</span>
                )}
                <span style={{ marginLeft: 8, fontSize: 11.5, color: "#9CA3AF" }}>{isDay ? "day charter" : nights ? `${nights} nights` : ""}</span>
              </span>
            ) : <span style={{ color: "#cbd5e1" }}>—</span>}
          </Tile>
          <Tile k="Occasion" v={r.occasion} />
          {proposalKind && <Tile k="Proposal" v={proposalKind} />}
        </div>
        <div style={{ marginTop: 14 }}>
          <Tile k="Route" v={r.area} block />
        </div>
        {r.brief && (
          <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#1f2937", marginTop: 14 }}>
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

      {/* Gmail import — George picks the exact supplier emails; bodies land
          in supplier_raw below, PDF brochures are saved + read once. */}
      <div id="flow-yachts" />
      {/* Two-phase picker: paste a supplier email → tick the yachts you want →
          only those are extracted and added. Repeat per supplier. */}
      <SupplierYachtPicker requestId={r.id} hasImported={!!r.supplier_raw} />
      <SupplierReplies requestId={r.id} />
      <GmailImport
        requestId={r.id}
        hasThread={!!r.gmail_thread_id}
      />

      {/* supplier source (internal only) — folded: reference material, not a step */}
      <Quiet title="Supplier source" hint="the raw emails and brochure facts behind the yachts · internal only">
        {r.supplier_raw
          ? <pre style={{
              whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5,
              fontFamily: "inherit", color: "#374151", margin: 0, maxHeight: 320, overflow: "auto",
              background: "rgba(13,27,42,0.03)", padding: 12, borderRadius: 2,
            }}>{r.supplier_raw}</pre>
          : <p style={{ color: "#9CA3AF", fontStyle: "italic", fontSize: 13 }}>No supplier text pasted.</p>}
      </Quiet>

      {/* email the central agency (supplier) — broker-to-supplier inquiry */}
      <Quiet title="Ask the suppliers" hint="broker-to-supplier availability inquiry · tick from your saved list">
      <HelmAgencyInquiry requestId={r.id} agencyEmail={resolveAgencyRecipients(r.central_agency_email, r.supplier_raw, r.client_email).join(", ") || null} alreadySentTo={agencyAlreadySent(messages)} />
      </Quiet>

      {/* media — single mode: one vessel's photos + brochure here.
          Combined mode: media is PER YACHT, on each yacht's card in the
          generate panel (after Extract), so this single-yacht box is hidden. */}
      {r.mode === "combined" ? (
        <Quiet title="Where do photos go?" hint="each yacht's photos live on its card below">
        <section style={{ margin: 0 }}>
          <div style={cardLabel}>Media · per yacht</div>
          <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6 }}>
            This is a combined (multi-yacht) proposal, so each yacht has its own photo and brochure.
            Click <b>Extract all yachts</b> below — a card appears for each yacht, and you add that yacht&apos;s
            photo and brochure link directly on its card.
          </p>
        </section>
        </Quiet>
      ) : (
        <HelmMedia
          requestId={r.id}
          initialPhotos={Array.isArray(r.vessel_photos) ? r.vessel_photos : []}
          initialBrochureUrl={r.brochure_url ?? null}
          cloudinaryConfigured={isCloudinaryConfigured()}
        />
      )}

      {/* generate proposal (extract -> review numbers -> generate PDF).
          Combined mode shows one card per yacht; single mode the classic flow. */}
      <div id="flow-review" />
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
          initialDraft={r.review_draft ?? null}
          isAgent={r.request_type === "travel_agent"}
          initialWhiteLabel={!!(r.extraction && typeof r.extraction === "object" && (r.extraction as Record<string, unknown>).white_label === true)}
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
          initialDraft={r.review_draft ?? null}
          isAgent={r.request_type === "travel_agent"}
          initialWhiteLabel={!!(r.extraction && typeof r.extraction === "object" && (r.extraction as Record<string, unknown>).white_label === true)}
        />
      )}

      {/* open signal — did the client follow the shared proposal link? */}
      {r.proposal_pdf_path && <OpenSignal extraction={r.extraction} />}

      <div id="flow-send" />
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
          isAgent={isAgent}
        />
      )}

      {/* after the proposal is sent: WhatsApp nudge, reply, follow up (in-thread, never auto) */}
      {r.gmail_thread_id && (() => {
        const sentFollowups = messages.filter((m) => m.direction === "outbound" && (m.body ?? "").startsWith("[Follow-up")).length;
        const hasInbound = messages.some((m) => m.direction === "inbound" && (m.body ?? "").trim());
        return (
          <>
            <Quiet title="WhatsApp nudge" hint="a short casual message with a tap-to-open link">
              <HelmWhatsApp requestId={r.id} clientWhatsapp={r.client_whatsapp ?? null} />
            </Quiet>
            {hasInbound && (
              <HelmReply
                requestId={r.id}
                clientEmail={r.client_email ?? null}
                isAgent={r.request_type === "travel_agent"}
                hasInbound={hasInbound}
              />
            )}
            <Quiet title="Follow-up" hint="draft the next nudge in the client's thread · never auto-sent">
              <HelmFollowUp
                requestId={r.id}
                clientEmail={r.client_email ?? null}
                isAgent={r.request_type === "travel_agent"}
                nextNumber={sentFollowups + 1}
                sentCount={sentFollowups}
                followUpAt={r.follow_up_at ?? null}
              />
            </Quiet>
          </>
        );
      })()}

      {/* won: booking next steps (MYBA contract request + confirmation drafts) */}
      {r.status === "won" && <HelmBooking requestId={r.id} />}

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

// Tracked-link open signal. extraction.opens is written by /p/<token>
// when a real human follows the shared proposal link (preview crawlers
// are ignored). Shows a gold chip with the count + first-open date, or
// a muted "not opened yet" once a proposal exists.
function OpenSignal({ extraction }: { extraction: unknown }) {
  const ex =
    extraction && typeof extraction === "object"
      ? (extraction as Record<string, unknown>)
      : null;
  // The MAGAZINE open (extraction.salon) is the real client signal, and the /p
  // event route already excludes George's own logged-in previews. The legacy
  // extraction.opens (PDF-link) is ignored so George's test-opens never read as
  // the client's (2026-07-18: "δεν το έχω στείλει, γιατί λέει opened 2x").
  const salon =
    ex && ex.salon && typeof ex.salon === "object"
      ? (ex.salon as { views?: number; first_at?: string })
      : null;
  const count = salon?.views ?? 0;

  if (count > 0) {
    return (
      <div style={{
        marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8,
        padding: "6px 12px", background: "rgba(201,168,76,0.12)",
        border: "1px solid rgba(201,168,76,0.45)", borderRadius: 2,
        fontSize: 12, color: "#0D1B2A",
      }}>
        <span style={{ color: "#C9A84C", fontSize: 14, lineHeight: 1 }}>●</span>
        <span>
          Client opened the proposal · {count} time{count === 1 ? "" : "s"}
          {salon?.first_at ? ` · first ${fmtDate(salon.first_at)}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 14, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase",
      color: "#9CA3AF",
    }}>
      Not opened yet
    </div>
  );
}

function Tile({ k, v, strong, block, children }: {
  k: string; v?: string | null; strong?: boolean; block?: boolean; children?: React.ReactNode;
}) {
  const empty = !children && !v;
  return (
    <div style={block ? { width: "100%" } : undefined}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: "#9CA3AF" }}>{k}</div>
      <div style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 600 : 400, color: empty ? "#cbd5e1" : "#1f2937", marginTop: 3, lineHeight: 1.4 }}>
        {children ?? (v || "—")}
      </div>
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
