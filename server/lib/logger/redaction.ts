/**
 * PII Redaction Module
 *
 * Provides two layers of redaction:
 * 1. Path-based field redaction (for structured log data) - used by Pino's `redact` option
 * 2. Regex-based string sanitization (for freeform log messages)
 */

// --- Layer 1: Path-based field redaction ---

/**
 * Pino redact paths - fields that will be censored in structured log data.
 * Aligned with the sensitive fields list from privacy.service.ts.
 */
export const REDACT_PATHS: string[] = [
  // Auth & credentials
  "password",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "apiKey",
  "api_key",
  "secret",
  "clientSecret",
  "client_secret",

  // Personal data
  "email",
  "phone",
  "phoneNumber",
  "phone_number",
  "ssn",
  "creditCard",
  "credit_card",
  "bankAccount",
  "bank_account",

  // Headers
  "headers.authorization",
  "headers.Authorization",
  "headers.cookie",
  "headers.Cookie",

  // Wildcard nested paths (one level deep)
  "*.password",
  "*.token",
  "*.accessToken",
  "*.access_token",
  "*.refreshToken",
  "*.refresh_token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.clientSecret",
  "*.client_secret",
  "*.email",
  "*.phone",
  "*.phoneNumber",
  "*.phone_number",
  "*.ssn",
  "*.creditCard",
  "*.credit_card",
];

export const REDACT_CENSOR = "[REDACTED]";

// --- Layer 2: Regex-based string sanitization ---

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const US_PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const INTL_PHONE_REGEX = /\+\d{1,3}[-.\s]?(?:\d[-.\s]?){4,14}\d/g;

/**
 * Redact PII patterns from a string message.
 * Catches email addresses and phone numbers embedded in freeform text.
 */
export function redactString(input: string): string {
  return input
    .replace(EMAIL_REGEX, "[EMAIL_REDACTED]")
    .replace(INTL_PHONE_REGEX, "[PHONE_REDACTED]")
    .replace(US_PHONE_REGEX, "[PHONE_REDACTED]");
}
