import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import ContactsClient from "./ContactsClient";
import type { Contact, PipelineStage } from "@/lib/types";

export default async function ContactsPage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // Starred-only by design — see ContactsClient header copy. Non-starred
  // contacts are noise; the inbox-star-sync nightly cron and live star
  // endpoint keep this list aligned with George's Gmail starred state.
  const [contactsRes, stagesRes] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "*, pipeline_stage:pipeline_stages(*), contact_tags(tag:tags(*))",
      )
      .eq("inbox_starred", true)
      .order("last_activity_at", { ascending: false })
      .limit(2000),
    supabase
      .from("pipeline_stages")
      .select("*")
      .order("position", { ascending: true }),
  ]);

  const contacts = (contactsRes.data ?? []) as Contact[];
  const stages = (stagesRes.data ?? []) as PipelineStage[];

  const countries = Array.from(
    new Set(contacts.map((c) => c.country).filter(Boolean)),
  ).sort() as string[];

  return (
    <ContactsClient
      contacts={contacts}
      stages={stages}
      countries={countries}
    />
  );
}
