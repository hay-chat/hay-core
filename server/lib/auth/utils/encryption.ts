import crypto from "crypto";

import { createLogger } from "@server/lib/logger";

const logger = createLogger("encryption");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Marks ciphertext written by encryptValue. Values without it are either
 * ciphertext from before the prefix existed (same layout, decrypted the same
 * way) or legacy plaintext credentials stored before encryption was added.
 */
export const CIPHERTEXT_PREFIX = "enc:v2:";

let warnedJwtFallback = false;

/**
 * The key new values are encrypted with. Production requires a dedicated
 * PLUGIN_ENCRYPTION_KEY (enforced at startup by validateProductionConfig);
 * other environments fall back to JWT_SECRET.
 */
function getEncryptionKey(): string {
  if (process.env.PLUGIN_ENCRYPTION_KEY) {
    return process.env.PLUGIN_ENCRYPTION_KEY;
  }
  if (process.env.NODE_ENV !== "production" && process.env.JWT_SECRET) {
    if (!warnedJwtFallback) {
      warnedJwtFallback = true;
      logger.warn("PLUGIN_ENCRYPTION_KEY not set — falling back to JWT_SECRET for encryption");
    }
    return process.env.JWT_SECRET;
  }
  throw new Error("PLUGIN_ENCRYPTION_KEY must be set for encryption");
}

/**
 * Keys tried when decrypting: the current key, then PLUGIN_ENCRYPTION_KEY_PREVIOUS
 * while a key rotation is in progress (see scripts/reencrypt-secrets.ts).
 */
function getDecryptionKeys(): string[] {
  const keys = [getEncryptionKey()];
  const previous = process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS;
  if (previous && previous !== keys[0]) {
    keys.push(previous);
  }
  return keys;
}

/**
 * Derives a key from a password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
}

/**
 * Encrypt a string value using AES-256-GCM
 */
export function encryptValue(text: string): string {
  const password = getEncryptionKey();

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from password and salt
  const key = deriveKey(password, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the text
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);

  // Get the auth tag
  const tag = cipher.getAuthTag();

  // Combine salt + iv + tag + encrypted
  const combined = Buffer.concat([salt, iv, tag, encrypted]);

  return CIPHERTEXT_PREFIX + combined.toString("base64");
}

function decryptWithKey(combined: Buffer, password: string): string {
  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, TAG_POSITION);
  const tag = combined.subarray(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = combined.subarray(ENCRYPTED_POSITION);

  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(password, salt), iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Decrypt a string value encrypted with encryptValue. Throws when no
 * configured key can decrypt it.
 */
export function decryptValue(encryptedText: string): string {
  const body = encryptedText.startsWith(CIPHERTEXT_PREFIX)
    ? encryptedText.slice(CIPHERTEXT_PREFIX.length)
    : encryptedText;
  const combined = Buffer.from(body, "base64");

  let lastError: unknown;
  for (const password of getDecryptionKeys()) {
    try {
      return decryptWithKey(combined, password);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Whether a stored string has the shape of encryptValue output (prefixed, or
 * unprefixed base64 long enough to hold salt + iv + tag). Anything else is
 * plaintext written before encryption was introduced.
 */
export function looksLikeCiphertext(value: string): boolean {
  if (value.startsWith(CIPHERTEXT_PREFIX)) {
    return true;
  }
  return (
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length > ENCRYPTED_POSITION
  );
}

/**
 * Encrypt sensitive values in a config object based on schema
 */
export interface ConfigSchema {
  [key: string]: {
    encrypted?: boolean;
    [key: string]: unknown;
  };
}

interface EncryptedValue {
  encrypted: true;
  value: string;
}

export function encryptConfig(
  config: Record<string, unknown>,
  schema: ConfigSchema,
): Record<string, unknown> {
  const encrypted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (schema[key]?.encrypted && value !== null && value !== undefined) {
      // Skip already-encrypted values to prevent double-encryption.
      // (enablePlugin encrypts via this fn and then calls upsertInstance which
      // re-runs encryptConfig — without this guard the second pass would
      // String()-coerce the wrapped object to "[object Object]".)
      if (
        typeof value === "object" &&
        value !== null &&
        (value as { encrypted?: boolean }).encrypted === true
      ) {
        encrypted[key] = value;
        continue;
      }
      // Encrypt sensitive values
      encrypted[key] = {
        encrypted: true,
        value: encryptValue(String(value)),
      };
    } else {
      // Keep non-sensitive values as-is
      encrypted[key] = value;
    }
  }

  return encrypted;
}

/**
 * Decrypt sensitive values in a config object
 */
export function decryptConfig(config: Record<string, unknown>): Record<string, unknown> {
  const decrypted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (isEncrypted(value)) {
      // Decrypt encrypted values
      try {
        decrypted[key] = decryptValue(value.value);
      } catch (error) {
        logger.error({ err: error, key }, "Failed to decrypt config key");
        decrypted[key] = null;
      }
    } else {
      // Keep non-encrypted values as-is
      decrypted[key] = value;
    }
  }

  return decrypted;
}

/**
 * Check if a value is encrypted
 */
export function isEncrypted(value: unknown): value is EncryptedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { encrypted?: unknown }).encrypted === true &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

/**
 * TypeORM transformer specifically for AuthState that encrypts all fields in credentials
 */
export class AuthStateEncryptedTransformer {
  /**
   * Transform value to database (encrypt all credentials)
   */
  to(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    // AuthState structure: { methodId: string, credentials: Record<string, unknown> }
    const encrypted: Record<string, unknown> = { ...(value as Record<string, unknown>) };

    if (encrypted.credentials && typeof encrypted.credentials === "object") {
      const encryptedCredentials: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(encrypted.credentials)) {
        if (val !== null && val !== undefined) {
          // Encrypt all non-null credential values
          if (typeof val === "string") {
            encryptedCredentials[key] = encryptValue(val);
          } else {
            // For non-string values, convert to JSON string then encrypt
            encryptedCredentials[key] = encryptValue(JSON.stringify(val));
          }
        } else {
          encryptedCredentials[key] = val;
        }
      }

      encrypted.credentials = encryptedCredentials;
    }

    return encrypted;
  }

  /**
   * Transform value from database (decrypt all credentials)
   */
  from(value: unknown): unknown {
    if (!value || typeof value !== "object") {
      return value;
    }

    const decrypted: Record<string, unknown> = { ...(value as Record<string, unknown>) };

    if (decrypted.credentials && typeof decrypted.credentials === "object") {
      const decryptedCredentials: Record<string, unknown> = {};

      for (const [key, val] of Object.entries(decrypted.credentials)) {
        if (val && typeof val === "string") {
          try {
            // Try to decrypt - all fields in credentials SHOULD be encrypted
            const decryptedVal = decryptValue(val);

            // Try to parse as JSON if it looks like JSON
            if (decryptedVal.startsWith("{") || decryptedVal.startsWith("[")) {
              try {
                decryptedCredentials[key] = JSON.parse(decryptedVal);
              } catch {
                // Not JSON, keep as string
                decryptedCredentials[key] = decryptedVal;
              }
            } else {
              decryptedCredentials[key] = decryptedVal;
            }
          } catch (error) {
            if (looksLikeCiphertext(val)) {
              // Ciphertext no configured key can open (wrong or rotated key):
              // never hand it on as if it were the credential.
              logger.error({ err: error, key }, "Failed to decrypt credential");
              decryptedCredentials[key] = null;
            } else {
              // Plaintext stored before credentials were encrypted; it is
              // encrypted on the next save (or by scripts/reencrypt-secrets.ts).
              logger.warn({ key }, "Unencrypted legacy credential found");
              decryptedCredentials[key] = val;
            }
          }
        } else {
          decryptedCredentials[key] = val;
        }
      }

      decrypted.credentials = decryptedCredentials;
    }

    return decrypted;
  }
}
