// v3 Pillar 7 — Charter Lifecycle Engine.
//
// Once a deal is `Closed Won + paid + signed`, generate the 17 timed
// milestones from T-60 to T+annual. Each milestone has:
//   - a due_date computed from charter_start_date or charter_end_date
//   - an auto_action description
//   - a draft template (for milestones that produce a Gmail draft)
//   - a signature flag (T-14 video is mandatory, not optional)

export type MilestoneType =
  | "T-60"
  | "T-45"
  | "T-40"
  | "T-30"
  | "T-21"
  | "T-15"
  | "T-14"
  | "T-7"
  | "T-3"
  | "T-1"
  | "T+0"
  | "T+midpoint"
  | "T+disembark+1"
  | "T+7"
  | "T+30"
  | "T+90"
  | "T+annual";

export interface MilestonePlan {
  milestone_type: MilestoneType;
  due_date: string;              // YYYY-MM-DD
  auto_action: string;
  draft_template_key: string | null;
  is_signature: boolean;         // mandatory checkpoint, not optional
  needs_calendar_block: boolean; // T-14 inspection visit
}

function daysAgo(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysAfter(iso: string, n: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function midpoint(startISO: string, endISO: string): string {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  return new Date((s + e) / 2).toISOString().slice(0, 10);
}
function annualOf(endISO: string): string {
  const d = new Date(endISO);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the 17-milestone plan for a charter. Pure function — no DB.
 * Caller persists the rows + handles dedup via the
 * uq_milestone_per_deal_type unique constraint.
 */
export function planMilestones(args: {
  charter_start_date: string;
  charter_end_date: string;
}): MilestonePlan[] {
  const { charter_start_date: start, charter_end_date: end } = args;
  return [
    {
      milestone_type: "T-60",
      due_date: daysAgo(start, 60),
      auto_action:
        "Charter activated. Reference research begins for the client + their guests.",
      draft_template_key: null,
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-45",
      due_date: daysAgo(start, 45),
      auto_action:
        "Draft reference list — pull historical reviews + comparable charter testimonials.",
      draft_template_key: "T-45_reference_list",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-40",
      due_date: daysAgo(start, 40),
      auto_action:
        "Send the reference list and open the trip-prep dialogue with the client.",
      draft_template_key: "T-40_send_references",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-30",
      due_date: daysAgo(start, 30),
      auto_action:
        "Organise the PIF (Preference & Information Form). Schedule a video call between client and the vessel captain.",
      draft_template_key: "T-30_pif_and_captain_call",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-21",
      due_date: daysAgo(start, 21),
      auto_action:
        "Status check: PIF received? Itinerary draft ready? Special-occasion details captured?",
      draft_template_key: null,
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-15",
      due_date: daysAgo(start, 15),
      auto_action:
        "Provisioning, dietary, water-toy preferences finalized?",
      draft_template_key: null,
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-14",
      due_date: daysAgo(start, 14),
      auto_action:
        "Schedule physical inspection visit. Send personal video to client from the dock — George's signature service.",
      draft_template_key: "T-14_personal_video",
      is_signature: true,
      needs_calendar_block: true,
    },
    {
      milestone_type: "T-7",
      due_date: daysAgo(start, 7),
      auto_action:
        "Final logistics — embarkation time, transfer, weather brief, captain handoff.",
      draft_template_key: "T-7_final_logistics",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-3",
      due_date: daysAgo(start, 3),
      auto_action:
        "Send the pre-departure 'looking forward' message + final captain WhatsApp.",
      draft_template_key: "T-3_looking_forward",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T-1",
      due_date: daysAgo(start, 1),
      auto_action:
        "Tomorrow's embarkation. Confirm everything one last time.",
      draft_template_key: null,
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+0",
      due_date: start,
      auto_action: "Charter starts today. Send the embarkation message.",
      draft_template_key: "T+0_embarkation",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+midpoint",
      due_date: midpoint(start, end),
      auto_action:
        "Mid-charter check-in. Soft message to client + brief WhatsApp to captain.",
      draft_template_key: "T+midpoint_checkin",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+disembark+1",
      due_date: daysAfter(end, 1),
      auto_action: "Post-charter thank-you. Send within 24h of disembark.",
      draft_template_key: "T+disembark+1_thank_you",
      is_signature: true,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+7",
      due_date: daysAfter(end, 7),
      auto_action:
        "Testimonial request. Personal note + light prompt for review.",
      draft_template_key: "T+7_testimonial",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+30",
      due_date: daysAfter(end, 30),
      auto_action:
        "Light check-in: 'Hope you're settled, looking forward to next time.'",
      draft_template_key: "T+30_settled",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+90",
      due_date: daysAfter(end, 90),
      auto_action:
        "Anniversary nudge: 'Thinking of you — any plans for next season?'",
      draft_template_key: "T+90_next_season",
      is_signature: false,
      needs_calendar_block: false,
    },
    {
      milestone_type: "T+annual",
      due_date: annualOf(end),
      auto_action:
        "1-year anniversary memory message. Fires for EVERY guest (Pillar 9). The compounding engine.",
      draft_template_key: "T+annual_anniversary",
      is_signature: true,
      needs_calendar_block: false,
    },
  ];
}

// ─── 17 milestone templates ────────────────────────────────────────

export interface MilestoneTemplate {
  subject: string;
  body: string;
  recipient: "client" | "captain" | "guest";
}

export interface TemplateContext {
  client_first_name: string;
  guest_first_name?: string;       // for T+annual fires per guest
  vessel_name: string;
  charter_start_date: string;       // formatted "27 June"
  charter_end_date: string;
  embark_port: string;
  captain_name?: string;
  region?: string;                  // "the Saronic", "the Cyclades"
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

const TEMPLATES: Record<string, (c: TemplateContext) => MilestoneTemplate> = {
  "T-45_reference_list": (c) => ({
    recipient: "client",
    subject: `Reference list for your ${c.vessel_name} charter`,
    body: `${c.client_first_name},

I've been preparing for your charter aboard ${c.vessel_name} (${fmt(c.charter_start_date)}–${fmt(c.charter_end_date)}). Attached is a curated reference list of comparable past charters with anonymised feedback — useful context as we shape your week.

Anything specific you'd like me to highlight from these? Happy to set a call if it helps.

Warmly,
George`,
  }),
  "T-40_send_references": (c) => ({
    recipient: "client",
    subject: `Trip prep for ${c.vessel_name}`,
    body: `${c.client_first_name},

Quick note as we move into trip-prep mode for ${fmt(c.charter_start_date)}.

Two things to get going:
• PIF (Preference & Information Form) — I'll send it across in the next few days
• Captain video call — would love to set this up around T-30 so you can meet ${c.captain_name ?? "the captain"} and lock in any specific itinerary asks

Reply with a couple of times that work for you in the next two weeks and I'll align with the captain.

Warmly,
George`,
  }),
  "T-30_pif_and_captain_call": (c) => ({
    recipient: "client",
    subject: `PIF + captain call — ${c.vessel_name}`,
    body: `${c.client_first_name},

We're 30 days out. Two things:

1. PIF attached. Take your time — every detail matters (dietary, allergies, music, any special occasions onboard, water toys, dive certifications, kid-friendly equipment, anything we should know).

2. Captain call: ${c.captain_name ?? "the captain"} can join a video call this week or next. Send me 2–3 windows and I'll coordinate.

Looking forward.

Warmly,
George`,
  }),
  "T-14_personal_video": (c) => ({
    recipient: "client",
    subject: `A quick hello from ${c.vessel_name}`,
    body: `${c.client_first_name},

I'm here at ${c.embark_port} aboard ${c.vessel_name} this morning, going through the final inspection with ${c.captain_name ?? "the captain"} ahead of your arrival. Wanted to send you a quick video so you can see how she's looking.

Everything is on track. ${c.captain_name ?? "The captain"} sends his greetings — he and the crew can't wait to welcome you onboard on ${fmt(c.charter_start_date)}.

If anything's still on your mind, send it now and I'll handle it before you arrive.

Warmly,
George`,
  }),
  "T-7_final_logistics": (c) => ({
    recipient: "client",
    subject: `Final logistics — ${c.vessel_name} embark ${fmt(c.charter_start_date)}`,
    body: `${c.client_first_name},

A week to go. Quick logistics summary:

• Embarkation: ${c.embark_port}, ${fmt(c.charter_start_date)} (afternoon — exact slot to be confirmed)
• Captain: ${c.captain_name ?? "TBC"} (his number to follow)
• Weather brief: I'll send 48h before with the latest forecast and any itinerary tweaks
• Transfer to the dock: shall I arrange? Let me know.

Anything else on your mind, just reply.

Warmly,
George`,
  }),
  "T-3_looking_forward": (c) => ({
    recipient: "client",
    subject: `${c.vessel_name} — looking forward`,
    body: `${c.client_first_name},

Three days. Everything is set on our end. ${c.captain_name ?? "The captain"} and the crew are ready, the vessel has been provisioned per your PIF, and the weather is looking generous.

I'll be in touch tomorrow with the final embarkation slot. Until then — enjoy your last few days and pack light.

Warmly,
George`,
  }),
  "T+0_embarkation": (c) => ({
    recipient: "client",
    subject: `Welcome aboard ${c.vessel_name}`,
    body: `${c.client_first_name},

Today's the day. Welcome aboard ${c.vessel_name}. ${c.captain_name ?? "The captain"} and the crew will look after you beautifully.

I'm a phone call or a WhatsApp away if anything comes up — but trust the crew, they're exceptional.

Have a wonderful week.

Warmly,
George`,
  }),
  "T+midpoint_checkin": (c) => ({
    recipient: "client",
    subject: `Midway check-in`,
    body: `${c.client_first_name},

Halfway through your week aboard ${c.vessel_name}. How's it going so far?

If anything could be better — itinerary tweak, provisioning addition, anything — now's the moment. The crew can pivot.

Otherwise, enjoy the second half. The best swimming spots are usually toward the end of the route.

Warmly,
George`,
  }),
  "T+disembark+1_thank_you": (c) => ({
    recipient: "client",
    subject: `Thank you, ${c.client_first_name}`,
    body: `${c.client_first_name},

A quick thank-you from Athens. It was a real pleasure having you and yours aboard ${c.vessel_name}. ${c.captain_name ?? "The captain"} and the crew shared lovely things about the week.

Hope the journey home was smooth. I'd love your honest reflections whenever you have a moment — what we got right, what could have been better, what you'd want next time.

The door is always open.

Warmly,
George`,
  }),
  "T+7_testimonial": (c) => ({
    recipient: "client",
    subject: `A small ask — your week aboard ${c.vessel_name}`,
    body: `${c.client_first_name},

Hope you're settled back. A small ask — if your week with us was meaningful, would you consider a short note I can share with future clients considering ${c.vessel_name} or this kind of itinerary? Even 2–3 sentences would mean a lot.

No pressure, only if it feels right.

Warmly,
George`,
  }),
  "T+30_settled": (c) => ({
    recipient: "client",
    subject: `Hope you're well, ${c.client_first_name}`,
    body: `${c.client_first_name},

It's been a month since you stepped off ${c.vessel_name}. Hoping you're back in your routines and that the memories from Greece are still vivid.

Whenever you're ready to start thinking about the next one — solo, family, friends — you know where I am.

Warmly,
George`,
  }),
  "T+90_next_season": (c) => ({
    recipient: "client",
    subject: `Thinking ahead to next season`,
    body: `${c.client_first_name},

Three months on. The Greek summer feels far away from here, but believe it or not the booking calendar for next season is already filling up — particularly the prime weeks in late June and early July.

Any thoughts forming for ${new Date(c.charter_start_date).getUTCFullYear() + 1}? Happy to start sketching options whenever you'd like — same vessel, new region, larger group, smaller, anything.

Warmly,
George`,
  }),
  "T+annual_anniversary": (c) => {
    const guestName = c.guest_first_name ?? c.client_first_name;
    return {
      recipient: "guest",
      subject: `One year ago today`,
      body: `${guestName},

One year ago today, your time aboard ${c.vessel_name}${c.region ? " in " + c.region : ""} was wrapping up. Hope the memories are still vivid — the swims, the sunsets, the meals on deck.

If you're thinking about Greek waters again — alone, with the family, or with friends — you know where I am.

Warmly,
George`,
    };
  },
};

export function generateMilestoneDraft(
  templateKey: string,
  ctx: TemplateContext,
): MilestoneTemplate | null {
  const fn = TEMPLATES[templateKey];
  if (!fn) return null;
  return fn(ctx);
}
