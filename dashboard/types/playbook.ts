export enum PlaybookStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived"
}

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  instructions?: string | null;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface Playbook {
  id: string;
  name: string;
  description?: string | null;
  instructions?: string | null;
  status: PlaybookStatus;
  organization_id: string;
  agents?: Agent[];
  created_at: Date;
  updated_at: Date;
}

export interface CreatePlaybookInput {
  name: string;
  description?: string;
  instructions?: string;
  status?: PlaybookStatus;
  agentIds?: string[];
}

export interface UpdatePlaybookInput {
  name?: string;
  description?: string;
  instructions?: string;
  status?: PlaybookStatus;
  agentIds?: string[];
}