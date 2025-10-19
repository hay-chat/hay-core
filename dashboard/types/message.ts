export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  type: MessageType;
  usage_metadata?: Record<string, unknown> | null;
  sender?: string | null;
  metadata?: {
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    confidence?: number;
    // Tool execution metadata
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: Record<string, unknown> | string | number | boolean | null;
    toolLatencyMs?: number;
    httpStatus?: number;
    toolStatus?: string;
    toolExecutedAt?: string;
    // Playbook & Document metadata
    isPlaybook?: boolean;
    playbookId?: string;
    playbookTitle?: string;
    documentId?: string;
    documentTitle?: string;
  } | null;
  sentiment?: MessageSentiment | null;
  intent?: MessageIntent | null;
  created_at: Date;
  updated_at: Date;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
  }>;
  status: MessageStatus;
}

export enum MessageStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  EDITED = "edited",
}

export enum MessageType {
  CUSTOMER = "Customer",
  SYSTEM = "System",
  HUMAN_AGENT = "HumanAgent",
  BOT_AGENT = "BotAgent",
  TOOL = "Tool",
  DOCUMENT = "Document",
  PLAYBOOK = "Playbook",
}

export enum MessageSentiment {
  POSITIVE = "positive",
  NEUTRAL = "neutral",
  NEGATIVE = "negative",
}

export enum MessageIntent {
  GREET = "greet",
  QUESTION = "question",
  REQUEST = "request",
  HANDOFF = "handoff",
  CLOSE_SATISFIED = "close_satisfied",
  CLOSE_UNSATISFIED = "close_unsatisfied",
  OTHER = "other",
  UNKNOWN = "unknown",
}
