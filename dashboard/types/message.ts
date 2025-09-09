export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  type: MessageType;
  usage_metadata?: Record<string, any> | null;
  sender?: string | null;
  metadata?: {
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    confidence?: number;
    toolStatus?: string;
    toolName?: string;
    toolArgs?: Record<string, any>;
    toolResult?: Record<string, any>;
    tool_call?: {
      tool_name: string;
      arguments: Record<string, any>;
    };
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
  TOOL_CALL = "ToolCall",
  TOOL_RESPONSE = "ToolResponse",
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
