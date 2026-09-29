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

// The name The Helm SHOWS for a request (George 29/9: "θέλω ονοματεπώνυμο,
// όχι Mr. Chavez"). Title, first name, surname, without repeating what the
// extraction already folded into client_name ("Mr. Bray", "the Clem Family",
// "Mr. Matthew" + surname Colford). Unknown first name shows title + surname.
export function helmDisplayName(r: {
  client_title?: string | null;
  client_name?: string | null;
  client_surname?: string | null;
  client_email?: string | null;
}): string {
  const title = (r.client_title || "").toString().trim().replace(/\.$/, "");
  const surname = (r.client_surname || "").toString().trim();
  let first = (r.client_name || "").toString().trim();
  first = first.replace(/^(mr|mrs|ms|miss|dr|mx)\.?\s+/i, "").trim();
  const fam = first.match(/^the\s+(.+?)\s+family$/i);
  if (fam) first = fam[1] === surname ? "" : fam[1];
  if (surname && first.toLowerCase() === surname.toLowerCase()) first = "";
  if (surname && first && first.toLowerCase().endsWith(" " + surname.toLowerCase())) {
    first = first.slice(0, -surname.length).trim();
  }
  const parts = [title ? `${title}.` : "", first, surname].filter(Boolean);
  if (!surname && !first) return (r.client_email || "").toString() || "(unnamed)";
  return parts.join(" ");
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
