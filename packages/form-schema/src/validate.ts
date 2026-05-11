import type { FormField, FormSchema, FormResponse } from "./types";

// Plain TypeScript on purpose: the webchat widget ships this file and its
// size budget has no room for zod. The server and dashboard parse schemas
// with zod (schema.ts); responses are checked here on every side.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** The error for one field's value, or null when it passes. */
function fieldError(field: FormField, value: unknown): string | null {
  if (isBlank(value)) {
    return field.required ? "Required" : null;
  }
  const { validation } = field;

  switch (field.type) {
    case "checkbox":
      return typeof value === "boolean" ? null : "Expected boolean, received " + typeof value;
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return "Expected number, received " + typeof value;
      }
      if (validation?.min !== undefined && value < validation.min) {
        return `Number must be greater than or equal to ${validation.min}`;
      }
      if (validation?.max !== undefined && value > validation.max) {
        return `Number must be less than or equal to ${validation.max}`;
      }
      return null;
    }
    default:
      break;
  }

  if (typeof value !== "string") {
    return "Expected string, received " + typeof value;
  }

  switch (field.type) {
    case "email":
      if (!EMAIL_PATTERN.test(value)) return "Must be a valid email";
      break;
    case "date":
      if (!DATE_PATTERN.test(value)) return "Date must be in YYYY-MM-DD format";
      break;
    case "select": {
      const allowed = (field.options ?? []).map((o) => o.value);
      if (allowed.length > 0 && !allowed.includes(value)) {
        return `Invalid enum value. Expected ${allowed.map((v) => `'${v}'`).join(" | ")}, received '${value}'`;
      }
      break;
    }
    case "text":
    case "textarea":
      if (validation?.min !== undefined && value.length < validation.min) {
        return `String must contain at least ${validation.min} character(s)`;
      }
      if (validation?.max !== undefined && value.length > validation.max) {
        return `String must contain at most ${validation.max} character(s)`;
      }
      break;
    default:
      break;
  }

  if (validation?.pattern && !new RegExp(validation.pattern).test(value)) {
    return "Invalid";
  }
  return null;
}

export interface ValidationResult {
  success: boolean;
  /** The checked values (every field present, missing optional ones null); empty on failure. */
  data: FormResponse;
  /** One message per failing field, keyed by field name; empty on success. */
  errors: Record<string, string>;
}

/**
 * Check a response against its schema. Unknown keys are dropped; a missing
 * optional field comes back as null.
 */
export function validateResponse(schema: FormSchema, response: unknown): ValidationResult {
  const input =
    response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const data: FormResponse = {};

  for (const field of schema.fields) {
    const value = input[field.name];
    const error = fieldError(field, value);
    if (error) {
      errors[field.name] = error;
      continue;
    }
    data[field.name] = isBlank(value) ? null : (value as string | number | boolean);
  }

  const success = Object.keys(errors).length === 0;
  return { success, data: success ? data : {}, errors };
}
