export enum PlaybookStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived",
}

export enum PlaybookVersionStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived",
}

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  instructions?: unknown;
  tone?: string | null;
  avoid?: string | null;
  trigger?: string | null;
  enabled: boolean;
  organization_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown; // Allow additional properties from API
}

export interface Playbook {
  id: string;
  title: string;
  description?: string | null;
  instructions?: unknown;
  required_fields?: string[] | null;
  trigger?: string;
  status?: PlaybookStatus;
  organization_id?: string | null;
  active_version_id?: string | null;
  draft_version_id?: string | null;
  agents?: Agent[];
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown; // Allow additional properties from API
}

export interface PlaybookVersion {
  id: string;
  playbook_id: string;
  version_number: number;
  status: PlaybookVersionStatus;
  instructions?: unknown;
  prompt_template?: string | null;
  required_fields?: string[] | null;
  publish_note?: string | null;
  created_by_id?: string | null;
  created_by?: { id: string; firstName?: string; lastName?: string; email: string } | null;
  published_by_id?: string | null;
  published_by?: { id: string; firstName?: string; lastName?: string; email: string } | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
}
