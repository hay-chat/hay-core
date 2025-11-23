export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  type: MessageType;
  usage_metadata?: Record<string, unknown> | null;
  sender?: string | null;
  deliveryState?: "pending" | "sent" | "failed"; // Client-side delivery state for optimistic updates
  errorMessage?: string; // Error message if delivery failed
  metadata?: {
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    confidence?: number;
    confidenceBreakdown?: {
      grounding: number;
      retrieval: number;
      certainty: number;
    };
    confidenceTier?: "high" | "medium" | "low";
    confidenceDetails?: string;
    documentsUsed?: Array<{ id: string; title: string; similarity: number }>;
    recheckAttempted?: boolean;
    recheckCount?: number;
    originalMessage?: string; // Original message before fallback replacement
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
    // Conversation management metadata
    isInactivityWarning?: boolean;
    warningTimestamp?: string;
    reason?: string;
    inactivity_duration_ms?: number;
    isClosureMessage?: boolean;
    closureReason?: string;
    blockReason?: string;
    // Handoff metadata
    isHandoffMessage?: boolean;
    handoffType?: string;
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
