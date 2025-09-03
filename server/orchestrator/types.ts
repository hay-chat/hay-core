export type Intent =
  | "greet"
  | "question"
  | "request"
  | "handoff"
  | "close_satisfied"
  | "close_unsatisfied"
  | "other"
  | "unknown";

export type Sentiment = "positive" | "neutral" | "negative";

export type Step = "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";

export interface Perception {
  intent: { label: Intent; score: number; rationale?: string };
  sentiment: { label: Sentiment; score: number };
  playbookCandidates: Array<{ id: string; score: number; rationale?: string }>;
}

export interface RagPack {
  query: string;
  results: Array<{
    docId: string;
    chunkId: string;
    sim: number;
    content: string;      // Full document content instead of snippet
    title?: string;       // Document title or filename
    source?: string;      // Source of the document
  }>;
  version: string; // index/version for cache/invalidation
}

export interface PlaybookState {
  id: string;
  stepId: string;
  data: Record<string, any>;
  startedAt: string;
  history: Array<{ stepId: string; ts: string; notes?: string }>;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

export interface PlannerOutput {
  step: Step;
  userMessage?: string; // for ASK or RESPOND
  tool?: ToolCall; // for CALL_TOOL
  handoff?: { reason: string; fields?: Record<string, any> };
  close?: { reason?: string };
  rationale?: string; // store, don't show
}

export interface ConversationContext {
  version: "v1";
  lastTurn: number;
  activePlaybook?: PlaybookState;
  perception?: Perception;
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
