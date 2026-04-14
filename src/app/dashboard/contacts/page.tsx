import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase";
import ContactsClient from "./ContactsClient";
import type { Contact, PipelineStage } from "@/lib/types";

export default async function ContactsPage() {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  const [contactsRes, stagesRes] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "*, pipeline_stage:pipeline_stages(*), contact_tags(tag:tags(*))"
      )
      .order("last_activity_at", { ascending: false }),
    supabase
      .from("pipeline_stages")
      .select("*")
      .order("position", { ascending: true }),
  ]);

  const contacts = (contactsRes.data ?? []) as Contact[];
  const stages = (stagesRes.data ?? []) as PipelineStage[];

  // Collect unique countries and sources for filters
  const countries = Array.from(
    new Set(contacts.map((c) => c.country).filter(Boolean))
  ).sort() as string[];

  const sources = Array.from(
    new Set(contacts.map((c) => c.source).filter(Boolean))
  ).sort() as string[];

  const contactTypes = Array.from(
    new Set(contacts.map((c) => c.contact_type).filter(Boolean))
  ).sort() as string[];

  return (
    <ContactsClient
      contacts={contacts}
      stages={stages}
      countries={countries}
      sources={sources}
      contactTypes={contactTypes}
    />
  );
}
