// LinkedIn safety limits — non-negotiable per George's brief.
// George's LinkedIn is his most valuable asset; if it gets banned the
// whole B2B engine breaks. These caps are enforced at every action.

export const LINKEDIN_DAILY_LIMITS = {
  // Hard ceilings from LinkedIn's own action limits
  profile_view: 100,
  connection_request: 25,
  connection_message: 50, // includes welcome messages to new connections
  comment: 4,             // brief explicitly says max 4/day
  catch_up_message: 10,
  like: 50,
} as const;

export type LinkedInActionType = keyof typeof LINKEDIN_DAILY_LIMITS;

// Comment templates from the brief — used as fallback if AI generation
// fails. Three rotations based on the connection's headline industry.
export const CONNECTION_TEMPLATES = {
  default:
    "Hey {{first_name}}! Great to connect. I run a luxury yacht charter brokerage in Greece — crewed motor yachts, private itineraries, the full experience. If you or your clients ever think about Greece by sea, I'd love to chat. georgeyachts.com",
  travel_hospitality:
    "Hey {{first_name}}! Great to connect. I work with travel professionals who have clients looking at Greece — we handle everything from yacht sourcing to crew briefing, and your client gets a white-glove experience. Happy to share our Partnership Programme if relevant. georgeyachts.com",
  yacht_marine:
    "Hey {{first_name}}! Great to connect — always good to expand the network in the charter world. Based in Athens, focused on Greek waters. Let's stay in touch. georgeyachts.com",
} as const;

// Catch-up message templates from the brief
export const CATCH_UP_TEMPLATES = {
  work_anniversary:
    "Congrats on the milestone, {{first_name}}! {{years}} year(s) at {{company}} — that's impressive. Here's to many more. 🥂",
  birthday: "Happy birthday, {{first_name}}! Hope you have a fantastic day. 🎂",
  new_position:
    "Congrats on the new role, {{first_name}}! Exciting move — wishing you all the best with it. 🚀",
  // 2-3 day follow-up for travel/luxury/yacht industry contacts
  industry_followup:
    "By the way {{first_name}}, if you ever have clients looking at Greece by sea — happy to be a resource. No pressure, just wanted you to know the door's open. 🤝",
} as const;

// Industry classification — picks the right connection template based
// on the headline string LinkedIn shows under each profile name.
export function classifyIndustry(headline: string | null | undefined):
  | "travel_hospitality"
  | "yacht_marine"
  | "default" {
  const h = (headline ?? "").toLowerCase();
  if (
    /(yacht|charter|marine|maritime|captain|broker)/.test(h)
  ) {
    return "yacht_marine";
  }
  if (
    /(travel|advisor|concierge|luxury|hospitality|family\s+office)/.test(h)
  ) {
    return "travel_hospitality";
  }
  return "default";
}

export function fillTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(vars[key] ?? `{{${key}}}`)
  );
}

// AI prompt for strategic comments — straight from the brief, modified
// only to enforce JSON-free plain-text output for direct posting.
export function commentPrompt(post: {
  text: string;
  authorIndustry?: string | null;
}): string {
  return `You are George Biniaris, Managing Broker at George Yachts, a luxury yacht charter brokerage in Athens, Greece. You specialize in crewed motor yacht charters in Greek waters (Cyclades, Ionian, Saronic).

Write a LinkedIn comment on the following post. The comment must:
1. Be 2-4 sentences max
2. Add a genuine insight or perspective related to the post topic
3. Subtly position George as a Greek waters expert WITHOUT selling
4. Never include links or business names in the comment
5. Sound natural, not robotic
6. Be warm but professional
7. NEVER start with generic openers like "Great post", "Interesting", "Thanks for sharing"

Post to comment on:
${post.text}

The poster's industry: ${post.authorIndustry ?? "unknown"}

Reply with ONLY the comment text — no quotes, no markdown, no preamble.`;
}
