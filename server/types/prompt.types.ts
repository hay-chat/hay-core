export interface PromptMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
}

export interface PromptContent {
  metadata: PromptMetadata;
  content: string;
  variables: string[];
}

export interface PromptOptions {
  organizationId?: string;
  conversationId?: string;
  language?: string;
  variables: Record<string, any>;
}

export interface PromptCache {
  content: PromptContent;
  timestamp: number;
}

export type PromptVariableType = string | number | boolean | any[] | Record<string, any> | null | undefined;

export interface PromptConfig {
  supportedLanguages: string[];
  defaultLanguage: string;
  cacheTTL: number;
  promptsDirectory: string;
}