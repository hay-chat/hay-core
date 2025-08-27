import bcrypt from "bcrypt";
import argon2 from "argon2";
import crypto from "crypto";
import { authConfig } from "@server/config/auth.config";

// Type for selecting hashing algorithm
export type HashAlgorithm = "bcrypt" | "argon2";

/**
 * Hash a password using the specified algorithm
 */
export async function hashPassword(
  password: string,
  algorithm: HashAlgorithm = "argon2"
): Promise<string> {
  if (algorithm === "bcrypt") {
    return bcrypt.hash(password, authConfig.bcrypt.saltRounds);
  } else {
    return argon2.hash(password, {
      type: authConfig.argon2.type as 0 | 1 | 2,
      memoryCost: authConfig.argon2.memoryCost,
      timeCost: authConfig.argon2.timeCost,
      parallelism: authConfig.argon2.parallelism,
    });
  }
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  // Detect algorithm based on hash format
  if (hash.startsWith("$2a$") || hash.startsWith("$2b$")) {
    return bcrypt.compare(password, hash);
  } else if (hash.startsWith("$argon2")) {
    return argon2.verify(hash, password);
  } else {
    throw new Error("Unknown hash format");
  }
}

/**
 * Generate a secure random API key
 */
export function generateApiKey(
  length: number = authConfig.apiKey.length
): string {
  const key = crypto.randomBytes(length).toString("base64url");
  return `${authConfig.apiKey.prefix}${key}`;
}

/**
 * Hash an API key for storage
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  // Use SHA-256 for API keys (faster than bcrypt/argon2 and secure enough for this use case)
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Verify an API key against its hash
 */
export function verifyApiKey(apiKey: string, hash: string): boolean {
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(apiKeyHash), Buffer.from(hash));
}

/**
 * Generate a secure random token (for sessions, CSRF tokens, etc.)
 */
export function generateSecureToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Generate a secure random session ID
 */
export function generateSessionId(): string {
  return `sess_${generateSecureToken(32)}`;
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Parse Basic Auth header
 */
export function parseBasicAuth(
  authHeader: string
): { email: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return null;
  }

  try {
    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, "base64").toString(
      "utf-8"
    );
    const [email, password] = credentials.split(":");

    if (!email || !password) {
      return null;
    }

    return { email, password };
  } catch {
    return null;
  }
}

/**
 * Extract API key from Authorization header
 */
export function extractApiKeyFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;

  // Support both "ApiKey key" and "Bearer key" formats for API keys
  const parts = authHeader.split(" ");
  if (parts.length !== 2) return null;

  const [scheme, key] = parts;
  const lowerScheme = scheme.toLowerCase();

  if (
    lowerScheme === "apikey" ||
    (lowerScheme === "bearer" && key.startsWith(authConfig.apiKey.prefix))
  ) {
    return key;
  }

  return null;
}
