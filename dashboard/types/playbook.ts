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
  created_at: string;
  updated_at: string;
}

export interface Playbook {
  id: string;
  title: string;
  trigger: string;
  description?: string | null;
  instructions?: any;
  status: PlaybookStatus;
  organization_id: string;
  agents?: Agent[];
  created_at: string;
  updated_at: string;
}

export interface CreatePlaybookInput {
  title: string;
  trigger: string;
  description?: string;
  instructions?: any;
  status?: PlaybookStatus;
  agentIds?: string[];
}

export interface UpdatePlaybookInput {
  title?: string;
  trigger?: string;
  description?: string;
  instructions?: any;
  status?: PlaybookStatus;
  agentIds?: string[];
}