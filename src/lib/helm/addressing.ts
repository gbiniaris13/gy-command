// How The Helm addresses the request's counterparty when George writes to them:
// a DIRECT CLIENT gets the formal address ("Dear Mr. Smith,"); a TRAVEL AGENT is
// a partner we write to by first name ("Hey Dimitar,"). Shared by the follow-up,
// reply and booking routes so the voice is consistent everywhere.

import { formalAddress } from "./build";

export function agentFirstName(r: { client_name?: string | null; client_surname?: string | null }): string {
  const raw = (r.client_name || r.client_surname || "").toString().trim();
  const noTitle = raw.replace(/^(mr|mrs|ms|miss|dr|mx|sir|madam)\.?\s+/i, "").trim();
  return noTitle.split(/\s+/)[0] || "there";
}

export function helmSalutation(r: {
  request_type?: string | null;
  client_name?: string | null;
  client_title?: string | null;
  client_surname?: string | null;
  client_is_family?: boolean | null;
}): { salutation: string; isAgent: boolean } {
  const isAgent = r.request_type === "travel_agent";
  if (isAgent) return { salutation: `Hey ${agentFirstName(r)},`, isAgent };
  const addr = formalAddress({ title: r.client_title, surname: r.client_surname, isFamily: r.client_is_family });
  return { salutation: addr.salutation || "Dear Guests,", isAgent };
}
