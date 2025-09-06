// Basic types for orchestrator services compatibility

export interface ToolCall {
  name: string;
  args: Record<string, any>;
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
  data: Record<string, any>;
  startedAt: string;
  history: Array<{ stepId: string; ts: string; notes?: string }>;
}

export interface ConversationContext {
  version: "v1";
  lastTurn: number;
  activePlaybook?: PlaybookState;
  perception?: any;
  rag?: RagPack | null;
  toolLog: Array<{
    turn: number;
    name: string;
    input: any;
    ok: boolean;
    result?: any;
    errorClass?: string;
    latencyMs: number;
    idempotencyKey: string;
  }>;
}