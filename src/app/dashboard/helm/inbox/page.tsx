// GY INBOX: drop a paper, it files itself. What it could not place waits here.
import { inboxOverview } from "@/lib/helm/inbox-documents";
import InboxClient from "./InboxClient";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { pending, charters } = await inboxOverview();
  return <InboxClient pending={pending} charters={charters} />;
}
