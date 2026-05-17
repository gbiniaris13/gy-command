// gy-command — admin chat view for one cabin. Reuses the same
// polling pattern as the client side, dressed in the admin shell.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCabin } from "@/lib/cabin-admin";
import AdminChat from "./AdminChat";

export const dynamic = "force-dynamic";

export default async function CabinChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cabin = await getCabin(id);
  if (!cabin) notFound();

  return (
    <div style={{ padding: 24, maxWidth: 920, margin: "0 auto" }}>
      <Link href={`/dashboard/cabins/${id}`} style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#6b7280", textDecoration: "none" }}>
        ← Back to cabin
      </Link>
      <header style={{ marginTop: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#C9A84C" }}>
          Private chat
        </div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 24, fontWeight: 300 }}>
          {cabin.principal_charterer_name} · <em style={{ color: "#C9A84C", fontStyle: "italic" }}>{cabin.vessel_name}</em>
        </h1>
        <p style={{ color: "#6b7280", fontSize: 13.5, fontStyle: "italic" }}>
          Only you and the principal charterer see this conversation. Guests
          do not have access.
        </p>
      </header>
      <AdminChat cabinId={id} />
    </div>
  );
}
