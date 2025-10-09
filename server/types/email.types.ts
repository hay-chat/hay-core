export enum EmailStatus {
  PENDING = "pending",
  SENT = "sent",
  FAILED = "failed",
  RETRY = "retry",
}

export interface EmailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
  encoding?: string;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: {
    email: string;
    name?: string;
  };
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
  priority?: "high" | "normal" | "low";
}

export interface EmailTemplateOptions extends Omit<EmailOptions, "html" | "text"> {
  template: string;
  variables?: Record<string, any>;
  locale?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  variables: string[];
  description?: string;
  category?: string;
  isMjml?: boolean;
}

export interface EmailQueueItem {
  id: string;
  options: EmailOptions;
  status: EmailStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  sentAt?: Date;
  error?: string;
  organizationId?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  response?: string;
}

export interface TemplateVariable {
  name: string;
  value: any;
  type?: "string" | "number" | "boolean" | "date" | "array" | "object";
  required?: boolean;
  default?: any;
}

export interface TemplateRenderOptions {
  template: string;
  variables: Record<string, any>;
  useCache?: boolean;
  stripComments?: boolean;
  minify?: boolean;
}