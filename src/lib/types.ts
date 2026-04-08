// ─── Database Types ─────────────────────────────────────────────────────────

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  color: string;
  created_at: string;
}

export interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  linkedin_url: string | null;
  source: string | null;
  pipeline_stage_id: string | null;
  yachts_viewed: YachtViewed[] | null;
  time_on_site: number | null;
  last_activity_at: string | null;
  merged_from: string | null;
  notes: string | null;
  charter_end_date: string | null;
  post_charter_step: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  pipeline_stage?: PipelineStage | null;
  contact_tags?: { tag: Tag }[] | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Activity {
  id: string;
  contact_id: string;
  type: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Note {
  id: string;
  contact_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface YachtViewed {
  name: string;
  url?: string;
  viewed_at?: string;
}

export interface Session {
  id: string;
  session_id: string | null;
  contact_id: string | null;
  country: string | null;
  city: string | null;
  device_type: string | null;
  referrer: string | null;
  pages_visited: string[];
  yachts_viewed: YachtViewed[];
  time_on_site: number;
  is_hot_lead: boolean;
  lead_captured: boolean;
  started_at: string;
  ended_at: string | null;
}
