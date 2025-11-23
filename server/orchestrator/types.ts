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
}
