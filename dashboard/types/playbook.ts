export enum PlaybookStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  ARCHIVED = "archived",
}

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  instructions?: any;
  tone?: string | null;
  avoid?: string | null;
  trigger?: string | null;
  enabled: boolean;
  organization_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any; // Allow additional properties from API
}

export interface Playbook {
  id: string;
  title: string;
  description?: string | null;
  instructions?: any;
  required_fields?: string[] | null;
  trigger?: string;
  status?: PlaybookStatus;
  organization_id?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any; // Allow additional properties from API
}
