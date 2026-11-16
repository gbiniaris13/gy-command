# Build brief: "Next Follow-up" AI engine for The Helm (GY Command Center)

You are the developer of The Helm (GY Command Center), the internal CRM of George Yachts (luxury crewed yacht charters, Athens; ~90% of clients are US HNW/UHNW families, their assistants, family offices and travel advisors). You already built the current follow-up features. I want to upgrade them into an AI follow-up engine based on a large research study I commissioned.

Two files come with this prompt. Put them in the repo exactly here:

| File | Path in repo | Role |
|---|---|---|
| `SKILL.md` (the playbook) | `.claude/skills/yacht-followup/SKILL.md` | **Single source of truth** for how follow-ups are decided and written. The app must load this file **at runtime** as the system prompt of every follow-up generation, so when I edit the playbook, behavior changes without code changes. You (Claude Code) also follow it whenever you work on follow-up code. |
| `followup-research.md` (the full research report) | `docs/followup/followup-research.md` | Evidence, sources, scenario playbooks, example cadences with dates. Reference for you; not sent to the model on every call. |

---

## Step 0: before writing any code

1. Read both files completely.
2. Audit the codebase and tell me:
   - where leads/requests, clients, yachts, proposals and notes live (schema);
   - what follow-up logic already exists and what it does;
   - how Gmail is connected today (API? OAuth scopes? sync or not?);
   - how WhatsApp Business is connected today (Cloud API? only the WhatsApp Business App on the phone? a third-party tool?);
   - what scheduler / queue / notification system exists;
   - where and how AI calls happen today.
3. Compare our data with the `DATA FIELDS` section of the playbook and list what is missing.
4. Send me a short report **in Greek** with: what exists, what's missing, risks, and a phased plan. **Wait for my OK before any schema migration or anything destructive.**

---

## What I want (user experience)

### A. A "Next Follow-up" button on every lead/request page

When I press it:

1. **Sync** fresh data for this lead:
   - **Gmail:** every thread with the client's email address(es), plus the spouse, assistant, family office or travel advisor addresses we know of, including emails I wrote manually outside The Helm. Detect new addresses that appear in cc and suggest linking them.
   - **WhatsApp Business:** every message with the client's number(s) (E.164 matching).
   - **The Helm:** request details, dates, guests, budget, yachts proposed with availability/option/early-booking fields, notes, stage, every past touch.
2. **Build one unified timeline** in chronological order: deduplicated, each item tagged with channel, direction (in/out), author, timestamp.
3. **Compute the deterministic parts in code** (see "Division of labor" below): lead-time bucket, decision deadline, allowed send windows in client local time, US blackout days, channel caps, which touch types were used recently.
4. **Call Claude** with the playbook as system prompt and the lead package as input.
5. **Show me:**
   - **Lead Snapshot** (in Greek, 3–6 lines): where we are, what the client last said and when, what we owe them / what they owe us, open questions, objections, temperature, scenario, lead-time bucket, days to the decision deadline.
   - **Recommended next touch:** channel, exact send time (client local + Athens), touch type, why (1–2 lines in Greek), and the draft in English: subject + body for email, or text / voice-note script for WhatsApp.
   - **2 alternative drafts** with different angles.
   - **The forward plan:** the next 3–5 planned touches with dates, recomputed every time.
   - **Warnings:** missing data (e.g. "no option expiry stored, so the draft uses no urgency"), blackout days, compliance issues, and anything marked `requires_human` (discounts, commission, legal).
6. **Actions:**
   - `Send via Gmail` (as a reply inside the same thread: threadId + In-Reply-To/References headers)
   - `Schedule` (at the recommended time or one I pick)
   - `Edit` (inline editor; my edits are saved, see "Learning my voice")
   - `Regenerate, different angle`
   - `Open in WhatsApp` (a `https://wa.me/<number>?text=<urlencoded>` deep link + a copy button; after I send, one click logs it as sent)
   - `Mark`: client replied / not interested / booked / lost to another broker / snooze until a date

### B. A "Follow-up Queue" page, my daily cockpit

- All leads with a touch due today or overdue, sorted by priority: short lead time first, then temperature, then value.
- `Prepare all drafts` button: generates the drafts for the whole queue (use the cheaper model for bulk if needed).
- A fast review mode: one lead per screen, snapshot on top, draft below, keyboard shortcuts (A = approve/send, E = edit, R = regenerate, S = skip, N = snooze).
- Counters: due today, overdue, replied waiting for me, new requests not yet answered.

### C. Background automation

- **Inbound reply detected** (Gmail or WhatsApp) → immediately cancel every queued touch for that lead, move the stage, and notify me: "Client replied, reply within 60 min."
- **New request arrives** → generate the first-response draft immediately and notify me (speed-to-lead is the strongest finding of the research).
- **Nightly job** → recompute the next due touch for all open leads; flag leads that have no next step.
- **Opt-out detection** ("unsubscribe", "stop", "remove me", "not interested", "please don't contact") → stage `do_not_contact` (or nurture with no marketing) and notify me.
- **Default mode = ASSISTED:** nothing is ever sent without my approval. Later I may enable AUTO **only** for email nurture and transactional/utility emails. WhatsApp/SMS are never auto-sent.

---

## Data ingestion details

### Gmail
- Gmail API with OAuth for the George Yachts mailbox (read + send + modify scopes). Use push notifications (watch + Pub/Sub) or polling every 2–5 minutes.
- Store per message: message id, thread id, from, to, cc, date, subject, clean plain text (strip quoted history and signatures), attachment names.
- Match messages to leads by every known address of the client and their people.

### WhatsApp: check carefully first
- If we only use the **WhatsApp Business App** on the phone, there is **no API access** to its history. Options, in order of preference:
  1. **WhatsApp Cloud API "coexistence"** onboarding: keeps the phone app working and mirrors messages to the API via webhooks, with a history import at onboarding. Check the current Meta documentation for eligibility and limits, and tell me what it needs from me.
  2. **Fallback:** import an exported chat (.txt/.zip) per lead. Write a robust parser for both iOS and Android export formats.
  3. **Last resort:** a "paste conversation" box on the lead page.
- **Sending:** through the API, free-form messages are allowed only inside the 24-hour window after the client's last message; outside it you need approved (paid) templates. So the default for personal follow-ups is `Open in WhatsApp` with prefilled text that I send myself. Log the send when I confirm it, or automatically from the coexistence webhook echo.

### The Helm
- Use the existing tables. Add the missing fields from the playbook's `DATA FIELDS` section, especially: `client_timezone` (IANA), `contact_role`, `decision_makers`, `whatsapp_opt_in`, `sms_ok`, `marketing_consent`, `stage`, `client_requested_followup_date`, and per proposed yacht: `availability_status`, `option_type`, `option_expires_at`, `early_booking_deadline`, `early_booking_pct`, `all_in_estimate`.
- New table **`touches`** (one row per outbound or inbound message): lead_id, direction, channel, touch_type, angle, subject, opening_line, body, sent_at, generated_by (ai / ai_edited / manual), approved_by, response_received, response_latency_hours. It powers variation (never repeat a type/subject/angle) and the KPIs.
- If the timezone is unknown, infer it from the phone area code / signature / city in the request, mark it "inferred", and show it to me for confirmation.

---

## Division of labor: code vs. AI

**The model must not do date math.** Code is deterministic; the model writes and chooses angles.

**In code:**
- lead time L, bucket, decision deadline DD;
- cadence offsets → candidate send dates;
- time zones with IANA/DST (watch the US/EU mismatch weeks: 14–27 Mar 2027 and 31 Oct–6 Nov 2027);
- US blackout calendar (use a holidays library; also Thanksgiving Wed–Sun and 23 Dec–1 Jan);
- business hours and send windows;
- channel caps (max 1 unanswered WhatsApp per 72 h, max 3 consecutive unanswered on one channel);
- opt-outs;
- the list of touch types/subjects/angles already used.

**Passed to the model:** the lead package plus `constraints` (allowed channels, allowed send window, forbidden touch types, whether real urgency exists and from which dated field).

**Validated in code after the model:**
- JSON schema;
- word limits;
- banned phrases;
- the send time is inside the allowed window;
- no urgency claim without a dated field;
- no price or availability that isn't in Helm data.

On failure: one automatic retry with the error message, then show the draft to me with a warning.

---

## AI call

- Anthropic Claude API. Model configurable in settings; default `claude-opus-5-5` for single-lead generation, `claude-sonnet-5-5` allowed for bulk queue drafts.
- System prompt = the content of `.claude/skills/yacht-followup/SKILL.md`, read from disk at runtime (cache it, but reload when the file changes).
- User message = one JSON object:

```json
{
  "now_utc": "...", "now_athens": "...",
  "mode": "ASSISTED",
  "lead": { "...all lead fields..." },
  "yachts_proposed": [ { "...": "..." } ],
  "timeline": [ { "ts": "...", "channel": "email|whatsapp|call|note", "direction": "in|out", "author": "...", "text": "..." } ],
  "touches_log": [ { "ts": "...", "channel": "...", "touch_type": "...", "angle": "...", "subject": "...", "response_received": false } ],
  "computed": { "L_days": 0, "bucket": "...", "decision_deadline": "...", "scenario_hint": "...", "consecutive_unanswered": 0 },
  "constraints": { "allowed_channels": [], "send_window_client_local": [], "forbidden_touch_types": [], "real_urgency": { "exists": false, "source_field": null, "date": null } },
  "george_voice_samples": [ "3-5 recent emails George wrote himself" ]
}
```

- Long timelines: keep every inbound message, the last 15 outbound in full, and a summary of older ones.
- Output: the strict JSON defined in the playbook (`OUTPUT` section). Validate it with zod/pydantic.

---

## Learning my voice

- Pass 3–5 of my own recent outbound emails as `george_voice_samples`.
- Whenever I edit a draft before sending, store the original and the final version. Show me a monthly "what George changes" summary that I can turn into new rules in the playbook. Don't modify the playbook automatically.

---

## Hard guardrails (in code, not only in the prompt)

1. WhatsApp/SMS are never auto-sent.
2. If an inbound message arrived after a draft was generated, block sending and regenerate.
3. No price, discount, availability, option or deadline that isn't stored in The Helm.
4. Banned-phrase check (list in the playbook).
5. Discounts, commission rebates, contract/legal topics, and complaints → `requires_human = true`, never auto.
6. Nurture/marketing emails get the physical address and an unsubscribe line. Opt-outs are honored the same day.
7. At most one touch per lead per day (except the ULTRA_SHORT bucket). Never send to a lead with stage `booked` from the sales cadence (use the post-booking flow instead).
8. Every send is logged with its lawful basis (pre-contractual reply / consent / existing-customer soft opt-in).

---

## KPIs page

- Speed-to-lead (median, business hours vs. outside).
- Reply rate per touch number, per channel, per touch type, per subject line (for A/B).
- Conversion by lead-time bucket and channel.
- Ghost rate and revival rate.
- Discount rate and average concession.
- Opt-out / complaint rate.
- Repeat and referral rate.

---

## Acceptance tests: must pass before I use it

Build fixtures and automated tests for:

1. **Request 16/11/2026, charter mid-January 2027, Greece** → bucket SHORT. The first draft asks one clarifying question about destination/dates (Greece in January is off-season). No sends 25–29/11. Plan is close to the playbook's SHORT cadence and capped at the decision deadline.
2. **Request 15/9/2026 for 11–18/9/2027** → bucket LONG. Touches are anchored to market events (rate cards in October, first business days of January, etc.). Early-booking urgency appears only if `early_booking_deadline` is set.
3. **7 consecutive unanswered touches** → next touch is the breakup (no-oriented) message; after it, stage moves to `nurture` and the cadence becomes 45–60 days.
4. **Client replied, then 3 days of silence** → GHOSTED cadence (+2, +5, +10, +20, +35).
5. **Client asks for 20% off** → the draft gives no discount; it labels, asks for the target number and offers trades; `requires_human = true`.
6. **Client says "let's talk in January"** → exactly one touch on the first US business day after 1 January (10:00 client time), nothing before it.
7. **Inbound arrives while a touch is scheduled** → scheduled touch canceled, notification sent.
8. **Limits** → no draft contains a banned phrase; email body 50–150 words; WhatsApp ≤45 words.
9. **Time zones** → a Los Angeles client gets emails 08:30–11:00 PT; mismatch-week DST handled correctly.
10. **Variation** → two consecutive generated touches never share a touch_type, and a subject line is never reused for the same lead.
11. **Assistant/advisor contact** → the draft is a forwardable summary (1 paragraph, ≤3 options, 1 question) and never bypasses the advisor.

---

## Phases (commit and show me each one)

- **P1:** data model + touches table + Gmail sync + unified timeline + "Next Follow-up" button with snapshot, draft, alternatives and plan (ASSISTED).
- **P2:** WhatsApp ingestion (coexistence or import) + Open-in-WhatsApp flow + logging.
- **P3:** Follow-up Queue page + background inbound detection + new-request instant draft + notifications.
- **P4:** KPIs page + A/B tracking of touch types and subject lines + "what George changes" report.
- **P5 (only when I say so):** AUTO mode for email nurture only.

## Working style

- Talk to me in Greek. Client-facing drafts are in English (or in the client's own language if they write in another one).
- Ask before migrations or anything destructive. Never send a real message to a client during development or tests: use a sandbox address/number.
