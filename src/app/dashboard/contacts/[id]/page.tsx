import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase";
import ContactDetailClient from "./ContactDetailClient";
import type { Contact, PipelineStage, Activity, Note, Tag } from "@/lib/types";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  const [contactRes, activitiesRes, notesRes, stagesRes, tagsRes, contactTagsRes] =
    await Promise.all([
      supabase
        .from("contacts")
        .select("*, pipeline_stage:pipeline_stages(*)")
        .eq("id", id)
        .single(),
      supabase
        .from("activities")
        .select("*")
        .eq("contact_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("notes")
        .select("*")
        .eq("contact_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("pipeline_stages")
        .select("*")
        .order("position", { ascending: true }),
      supabase.from("tags").select("*").order("name"),
      supabase
        .from("contact_tags")
        .select("tag:tags(*)")
        .eq("contact_id", id),
    ]);

  if (contactRes.error || !contactRes.data) {
    notFound();
  }

  const contact = contactRes.data as Contact;
  const activities = (activitiesRes.data ?? []) as Activity[];
  const notes = (notesRes.data ?? []) as Note[];
  const stages = (stagesRes.data ?? []) as PipelineStage[];
  const allTags = (tagsRes.data ?? []) as Tag[];
  const contactTags = (contactTagsRes.data ?? []).map(
    (ct: Record<string, unknown>) => ct.tag as Tag
  );

  return (
    <ContactDetailClient
      contact={contact}
      activities={activities}
      notes={notes}
      stages={stages}
      allTags={allTags}
      contactTags={contactTags}
    />
  );
}
