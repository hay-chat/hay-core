/**
 * Represents the orchestration plan for conversation processing.
 * Determines the execution path and required resources.
 */
export interface OrchestrationPlan {
  /** The execution path to use */
  path: "docqa" | "playbook";
  /** The ID of the agent handling the conversation */
  agentId: string;
  /** The ID of the playbook to execute (if using playbook path) */
  playbookId?: string;
  /** Fields required for execution */
  requiredFields?: string[];
  /** Fields that are missing from the request */
  missingFields?: string[];
}

/**
 * Represents the result of executing an orchestration plan.
 * Contains the response content and associated metadata.
 */
export interface ExecutionResult {
  /** The generated response content */
  content: string;
  /** Metadata about the execution */
  metadata?: {
    /** The AI model used for generation */
    model?: string;
    /** Number of tokens in the prompt */
    prompt_tokens?: number;
    /** Number of tokens in the completion */
    completion_tokens?: number;
    /** Total number of tokens used */
    total_tokens?: number;
    /** Response generation latency in milliseconds */
    latency_ms?: number;
    /** The execution plan used */
    plan?: string;
    /** The execution path taken */
    path?: "docqa" | "playbook";
    /** Tools used during execution */
    tools?: string[];
    /** The ID of the playbook used */
    playbook_id?: string;
    /** Confidence score of the response */
    confidence?: number;
    /** Error message if execution failed */
    error?: string;
  };
  /** Whether to include an ender message */
  includeEnder?: boolean;
  /** Status to set for the conversation */
  setStatus?: "open" | "pending-human" | "resolved";
}

/**
 * Contains all context needed for conversation processing.
 * Aggregates conversation data, messages, and user input.
 */
export interface ConversationContext {
  /** The ID of the conversation */
  conversationId: string;
  /** The ID of the organization */
  organizationId: string;
  /** The conversation entity object */
  conversation: any;
  /** Array of conversation messages */
  messages: any[];
  /** The ID of the assigned agent */
  agentId: string;
  /** The user's current message */
  userMessage: string;
}

/**
 * Metadata about conversation resolution status.
 * Tracks whether and why a conversation was resolved.
 */
export interface ResolutionMetadata {
  /** Whether the conversation is resolved */
  resolved: boolean;
  /** Confidence level in the resolution */
  confidence: number;
  /** Reason for the resolution status */
  reason: string;
}

/**
 * Orchestration state types for conversation processing
 */
export type OrchestrationState = 
  | "waiting_for_user" 
  | "analyzing_intent" 
  | "searching_documents" 
  | "executing_playbook" 
  | "cooldown"
  | "processing"
  | "error";

/**
 * Information about the currently active playbook
 */
export interface PlaybookStatus {
  id: string;
  title: string;
  trigger: string;
  started_at: string;
  selection_confidence?: number;
  selection_reasoning?: string;
}

/**
 * Document retrieved and used in the response
 */
export interface DocumentUsed {
  id?: string;
  content: string;
  relevance: number;
  source?: string;
}

/**
 * Results of intent analysis on user messages
 */
export interface IntentAnalysis {
  detected_intents: string[];
  confidence: number;
  last_analyzed: string;
  raw_analysis?: string;
}

/**
 * Processing details for the conversation
 */
export interface ProcessingDetails {
  locked_by?: string;
  locked_until?: string;
  cooldown_until?: string;
  error?: string;
}

/**
 * Context tracking for avoiding duplicate system messages
 */
export interface ContextTracking {
  agents: string[];        // IDs of agents with system messages
  playbooks: string[];     // IDs of playbooks with system messages
  documents: string[];     // IDs of documents with system messages
  tools: string[];         // IDs of tools with system messages
  last_context_update: string;
}

/**
 * Complete orchestration status for a conversation
 * Provides real-time visibility into AI processing
 */
export interface OrchestrationStatus {
  state: OrchestrationState;
  current_playbook?: PlaybookStatus;
  documents_used?: DocumentUsed[];
  intent_analysis?: IntentAnalysis;
  processing_details?: ProcessingDetails;
  context_tracking?: ContextTracking;
  last_updated: string;
}