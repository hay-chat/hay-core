/**
 * Canonical, provider-neutral LLM contract.
 *
 * This module is the single source of truth for how the rest of the server talks
 * to an LLM. Concrete adapters (OpenAI-compatible, Anthropic, Gemini) implement
 * `ChatProvider` / `EmbeddingProvider`; `LLMProviderFactory` resolves which one a
 * given organization uses. Nothing here imports a provider SDK or a DB entity, so
 * it stays a pure contract that both sides can depend on.
 *
 * Mirrors the existing git-provider seam (server/lib/git/git-provider.interface.ts).
 *
 * @module services/llm/provider.types
 */

/** Task-complexity tier. Call sites pick a tier; the org config maps it to a model. */
export type ModelTier = "easy" | "medium" | "hard";

export type MessageRole = "system" | "user" | "assistant";

/**
 * Provider-neutral chat message. LLMService converts DB `Message[]` (including the
 * TOOL-output flattening it does today) into `ChatMessage[]`; providers never see
 * entity types or any OpenAI-specific message shape.
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/** Normalized token usage, returned on EVERY chat + embedding result. */
export interface UsageRecord {
  promptTokens: number;
  /** 0 for embeddings. */
  completionTokens: number;
  totalTokens: number;
  /**
   * True when the provider did NOT report usage and the adapter token-estimated.
   * Present from day one so metering can flag estimated rows. Defaults false.
   */
  estimated: boolean;
}

/** Structured-output request. The adapter guarantees `ChatResult.content` parses as JSON. */
export interface StructuredOutputSpec {
  schema: Record<string, unknown>;
  /** Default true. Downgraded automatically when the provider can't guarantee strict. */
  strict?: boolean;
  /** Schema name sent to providers that require one. Default "structured_response". */
  name?: string;
}

/**
 * Per-model behavior flags. These vary by MODEL within a single provider (e.g. an
 * OpenAI reasoning model rejects `temperature` while gpt-4o-mini accepts it), so
 * they ride on the request rather than on the provider-level capability descriptor.
 * The factory attaches them when it resolves a tier → concrete model.
 */
export interface ModelFlags {
  /** Reasoning model: omit sampling params and (usually) use max_completion_tokens. */
  reasoningModel?: boolean;
  /** Emit `max_completion_tokens` instead of the legacy `max_tokens`. */
  usesMaxCompletionTokens?: boolean;
  /** Whether the model accepts temperature/top_p. Default true; false => omit them. */
  acceptsSampling?: boolean;
}

/**
 * Resolved, provider-facing chat request. `model` is ALREADY tier-resolved by
 * LLMService; the provider is a dumb transport. No `organizationId` here — org
 * resolution happens upstream in LLMService/factory.
 */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Optional: omitted entirely for models that reject sampling params. */
  temperature?: number;
  maxTokens: number;
  structured?: StructuredOutputSpec;
  flags?: ModelFlags;
  /** Cancels the in-flight HTTP call (wired to the adapter's timeout). */
  signal?: AbortSignal;
}

export type FinishReason = "stop" | "length" | "content_filter" | "error" | "other";

export interface ChatResult {
  /** Always a string; when structured, a schema-valid JSON string. */
  content: string;
  usage: UsageRecord;
  model: string;
  /** The provider id that served the request (echoed for metering/debugging). */
  provider: string;
  finishReason: FinishReason;
}

/** Terminal metadata for a streamed chat, resolved once the stream is drained. */
export interface StreamCompletionMeta {
  usage: UsageRecord;
  model: string;
  provider: string;
  finishReason: FinishReason;
}

export interface ChatStreamResult {
  stream: AsyncIterable<string>;
  /** Resolves after the stream is fully consumed. */
  completion: Promise<StreamCompletionMeta>;
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  /** Requested output dimension; providers that support it (e.g. Gemini) honor it. */
  dimensions?: number;
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  /** One vector per input, in input order. */
  embeddings: number[][];
  /** completionTokens is always 0 for embeddings. */
  usage: UsageRecord;
  model: string;
  provider: string;
  /**
   * Vector dimension actually returned. The factory asserts this equals the
   * pgvector column dimension and throws on mismatch, so a misconfigured embedding
   * model fails loudly at write time instead of corrupting the HNSW index.
   */
  dimensions: number;
}

/**
 * Static capability descriptor — drives structured-output rung selection with no
 * exception-probing. One instance per provider configuration.
 */
export interface ProviderCapabilities {
  /** Provider guarantees schema-valid JSON (OpenAI Structured Outputs et al). Rung 1. */
  strictJsonSchema: boolean;
  /** Loose JSON-object mode (response_format json_object or equivalent). Rung 2. */
  jsonObjectMode: boolean;
  /** Can force a single tool whose input_schema is the JSON Schema. Rung 3. */
  toolForcedJson: boolean;
  streaming: boolean;
  /** Responses carry token counts. When false the adapter estimates and sets estimated=true. */
  reportsUsage: boolean;
  /**
   * Where the system prompt goes. "top-level" (Anthropic/Gemini) means the adapter
   * must split the leading system message out of `messages[]` into a top-level param.
   */
  systemRole: "message" | "top-level";
  supportedTiers: ModelTier[];
}

/** Chat transport. Mirrors GitProvider: id + behavior, resolved per-org by the factory. */
export interface ChatProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(req: ChatRequest): Promise<ChatResult>;
  chatStream(req: ChatRequest): Promise<ChatStreamResult>;
}

/** Embedding transport. Managed-only; `dimensions` is fixed and asserted by the factory. */
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

/**
 * Thrown when structured output cannot be coerced to a schema-valid object. Callers
 * do `JSON.parse(invoke(...))`; this gives them a typed failure instead of an opaque
 * SyntaxError, and carries the raw text for debugging.
 */
export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
    public readonly schemaName: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

// ─── Org-level provider config (stored at Organization.settings.llm) ──────────

export interface TierModelMap {
  easy: string;
  medium: string;
  hard: string;
}

export type ChatProviderId = "openai-compatible" | "anthropic" | "gemini";

/** Which OpenAI-compatible vendor (selects a capability profile). */
export type OpenAICompatibleVendor = "openai" | "mistral" | "grok" | "custom";

export interface OrgLlmConfig {
  chat: {
    provider: ChatProviderId;
    /** BYO only; OSS/Auto leave undefined and the factory injects the env/Hay key. */
    apiKeyEncrypted?: string;
    /** openai-compatible only (OpenAI / Mistral / Grok / custom vendor). */
    baseUrl?: string;
    /** openai-compatible only: selects the vendor capability profile. Defaults to "openai". */
    vendor?: OpenAICompatibleVendor;
    tiers: TierModelMap;
  };
  embedding: {
    provider: "openai-compatible";
    /** Must yield a vector of the pgvector column dimension (asserted at runtime). */
    model: string;
  };
}
