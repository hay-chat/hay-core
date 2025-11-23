// Basic types for orchestrator services compatibility

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface RagPack {
  query: string;
  results: Array<{
    docId: string;
    chunkId: string;
    sim: number;
    content: string;
    title?: string;
    source?: string;
  }>;
  version: string;
}

export interface PlaybookState {
  id: string;
  stepId: string;
  data: Record<string, unknown>;
  startedAt: string;
  history: Array<{ stepId: string; ts: string; notes?: string }>;
}

export type ProcessingPhase = "perceiving" | "retrieving" | "executing" | "idle";

export interface ProcessingState {
  phase: ProcessingPhase;
  startedAt: string;
  message?: string;
}

export interface GuardrailLogEntry {
  timestamp: string;
  companyInterest?: {
    passed: boolean;
    violationType: string;
    severity: string;
    shouldBlock: boolean;
    requiresFactCheck: boolean;
    reasoning: string;
  };
  factGrounding?: {
    score: number;
    tier: string;
    breakdown: {
      grounding: number;
      retrieval: number;
      certainty: number;
    };
    documentsUsed: Array<{ id: string; title: string; similarity: number }>;
    recheckAttempted: boolean;
    recheckCount: number;
    details: string;
  };
}

export interface ConversationContext {
  version: "v1";
  lastTurn: number;
  activePlaybook?: PlaybookState;
  perception?: unknown;
  rag?: RagPack | null;
  processingState?: ProcessingState;
  toolLog: Array<{
    turn: number;
    name: string;
    input: unknown;
    ok: boolean;
    result?: unknown;
    errorClass?: string;
    latencyMs: number;
    idempotencyKey: string;
  }>;
  guardrailLog?: GuardrailLogEntry[];
  confidenceLog?: Array<any>; // Legacy, kept for backward compatibility
}
