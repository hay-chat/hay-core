/**
 * Structured-output helpers: capability-driven rung selection support + a
 * validate-and-repair pass for providers that can't guarantee schema-valid JSON.
 *
 * Rungs (selected from ProviderCapabilities, never by exception-probing):
 *   1. strict json_schema       — provider guarantees validity, returned verbatim.
 *   2. json_object + schema-in-prompt — loose JSON mode; validate, repair once.
 *   3. forced-tool JSON         — single tool whose input_schema is the schema.
 *   4. prompt-only              — defensive last resort.
 *
 * Rungs 2-4 run validate-and-repair here. Rung 1 needs neither (the provider
 * constrains decoding). Callers always receive a JSON-parseable string or a
 * typed StructuredOutputError.
 *
 * @module services/llm/structured-output
 */

import Ajv, { type ValidateFunction } from "ajv";
import { StructuredOutputError } from "./provider.types";
import type { ChatMessage } from "./provider.types";

const ajv = new Ajv({ allErrors: true, strict: false });

// Compiled validators are keyed by the schema object so repeated calls with the
// same schema (every orchestrator request) don't recompile.
const validatorCache = new WeakMap<object, ValidateFunction>();

function getValidator(schema: Record<string, unknown>): ValidateFunction {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }
  return validate;
}

/** Human-readable schema instruction injected into the system message for rungs 2/4. */
export function renderSchemaInstruction(schema: Record<string, unknown>, name?: string): string {
  const label = name ?? "structured_response";
  return `You must respond with ONLY a JSON object (no prose, no code fences) that conforms to this JSON Schema named "${label}":\n${JSON.stringify(schema)}`;
}

/**
 * Return a copy of `messages` with the schema instruction folded into the system
 * message (merged if one exists, prepended otherwise). Used by message-role
 * providers; top-level-system providers route the instruction differently.
 */
export function injectSchemaIntoMessages(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  name?: string,
): ChatMessage[] {
  const instruction = renderSchemaInstruction(schema, name);
  const idx = messages.findIndex((m) => m.role === "system");
  if (idx === -1) {
    return [{ role: "system", content: instruction }, ...messages];
  }
  const copy = [...messages];
  copy[idx] = { role: "system", content: `${copy[idx].content}\n\n${instruction}` };
  return copy;
}

export interface ValidationResult {
  valid: boolean;
  /** Concatenated ajv errors (empty when valid or unparseable). */
  errors: string;
  /** True when the string wasn't even JSON. */
  parseError: boolean;
}

/** Parse + validate a candidate JSON string against the schema. */
export function validateJsonString(
  schema: Record<string, unknown>,
  content: string,
): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, errors: "response was not valid JSON", parseError: true };
  }
  const validate = getValidator(schema);
  if (validate(parsed)) {
    return { valid: true, errors: "", parseError: false };
  }
  const errors = (validate.errors ?? [])
    .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
    .join("; ");
  return { valid: false, errors, parseError: false };
}

/** Build the messages for a single repair round-trip. */
export function buildRepairMessages(
  original: ChatMessage[],
  rawText: string,
  errors: string,
): ChatMessage[] {
  return [
    ...original,
    { role: "assistant", content: rawText },
    {
      role: "user",
      content: `Your previous response failed JSON Schema validation: ${errors}. Respond again with ONLY the corrected JSON object — no prose, no code fences.`,
    },
  ];
}

export { StructuredOutputError };
