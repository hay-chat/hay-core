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
/**
 * Sensitive field names that should be redacted at any nesting depth.
 * We generate paths for depths 0, 1, and 2 (i.e., field, *.field, *.*.field).
 */
const SENSITIVE_FIELDS = [
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
  "webhookSecret",

  // Personal data (aligned with privacy.service.ts sensitiveFields)
  "email",
  "newEmail",
  "oldEmail",
  "userEmail",
  "toEmail",
  "fromEmail",
  "firstName",
  "first_name",
  "lastName",
  "last_name",
  "name",
  "address",
  "phone",
  "phoneNumber",
  "phone_number",
  "ipAddress",
  "ip_address",
  "ip",
  "userAgent",
  "user_agent",
  "ssn",
  "creditCard",
  "credit_card",
  "bankAccount",
  "bank_account",

  // Email message fields (recipient/sender addresses)
  "to",
  "from",
  "fromAddress",
  "replyTo",
  "cc",
  "bcc",

  // URLs/keys that may embed tokens or PII
  "verificationUrl",
  "resetUrl",
  "callbackUrl",
  "key",
];

function buildRedactPaths(): string[] {
  const paths: string[] = [];

  // Generate field, *.field, *.*.field for each sensitive field
  for (const field of SENSITIVE_FIELDS) {
    paths.push(field);
    paths.push(`*.${field}`);
    paths.push(`*.*.${field}`);
  }

  // Headers at top level and one level deep
  const headerFields = ["authorization", "Authorization", "cookie", "Cookie"];
  for (const h of headerFields) {
    paths.push(`headers.${h}`);
    paths.push(`*.headers.${h}`);
  }

  return paths;
}

export const REDACT_PATHS: string[] = buildRedactPaths();

export const REDACT_CENSOR = "[REDACTED]";

// --- Layer 2: Regex-based string sanitization ---

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const US_PHONE_REGEX = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const INTL_PHONE_REGEX = /\+\d{1,3}[-.\s]?(?:\d[-.\s]?){4,14}\d/g;
const JWT_REGEX = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Redact PII and secret patterns from a string message.
 * Catches email addresses, phone numbers, JWTs, and Bearer tokens in freeform text.
 */
export function redactString(input: string): string {
  return input
    .replace(JWT_REGEX, "[TOKEN_REDACTED]")
    .replace(BEARER_REGEX, "Bearer [TOKEN_REDACTED]")
    .replace(EMAIL_REGEX, "[EMAIL_REDACTED]")
    .replace(INTL_PHONE_REGEX, "[PHONE_REDACTED]")
    .replace(US_PHONE_REGEX, "[PHONE_REDACTED]");
}
