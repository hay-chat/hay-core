export enum SourceCategory {
  TEST = "test",
  MESSAGING = "messaging",
  SOCIAL = "social",
  EMAIL = "email",
  HELPDESK = "helpdesk",
}

export interface SourceMetadata {
  [key: string]: unknown;
}

export interface CreateSourceInput {
  id: string;
  name: string;
  description?: string;
  category: SourceCategory;
  pluginId?: string;
  icon?: string;
  metadata?: SourceMetadata;
}
