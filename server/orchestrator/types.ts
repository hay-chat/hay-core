type Intent =
  | "greet"
  | "question"
  | "request"
  | "handoff"
  | "close_satisfied"
  | "close_unsatisfied"
  | "other"
  | "unknown";

type Sentiment = "positive" | "neutral" | "negative";

type Step = "ASK" | "RESPOND" | "CALL_TOOL" | "HANDOFF" | "CLOSE";

interface Perception {
  intent: { label: Intent; score: number; rationale?: string };
  sentiment: { label: Sentiment; score: number };
  playbookCandidates: Array<{ id: string; score: number; rationale?: string }>;
}

interface RagPack {
  query: string;
  results: Array<{
    docId: string;
    chunkId: string;
    sim: number;
    snippet: string;
  }>;
  version: string; // index/version for cache/invalidation
}

interface PlaybookState {
  id: string;
  stepId: string;
  data: Record<string, any>;
  startedAt: string;
  history: Array<{ stepId: string; ts: string; notes?: string }>;
}

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

interface PlannerOutput {
  step: Step;
  userMessage?: string; // for ASK or RESPOND
  tool?: ToolCall; // for CALL_TOOL
  handoff?: { reason: string; fields?: Record<string, any> };
  close?: { reason?: string };
  rationale?: string; // store, don’t show
}

interface ConversationContext {
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
