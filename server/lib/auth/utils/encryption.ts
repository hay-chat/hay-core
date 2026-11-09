import crypto from "crypto";

import { createLogger } from "@server/lib/logger";
import {
  configuredEncryptionKeys,
  SINGLE_KEY_ID,
  type EncryptionKey,
} from "@server/lib/auth/utils/encryption-keys";

const logger = createLogger("encryption");

const ALGORITHM = "aes-256-gcm";

// enc:v2 and unprefixed values: PBKDF2 per value, salt + iv + tag + ciphertext.
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;
export const LEGACY_CIPHERTEXT_PREFIX = "enc:v2:";

// enc:v3:<key id>: values: one HKDF key per key id, iv + tag + ciphertext.
const V3_IV_LENGTH = 12;
const V3_ENCRYPTED_POSITION = V3_IV_LENGTH + TAG_LENGTH;
export const CIPHERTEXT_PREFIX = "enc:v3:";

let warnedJwtFallback = false;

/**
 * The keys stored secrets are read and written with, current key first.
 * Deployed servers need PLUGIN_ENCRYPTION_KEY or PLUGIN_ENCRYPTION_KEYS
 * (enforced at startup by validateProductionConfig); development and tests fall
 * back to JWT_SECRET.
 */
function getEncryptionKeys(): EncryptionKey[] {
  const keys = configuredEncryptionKeys();
  if (keys.length > 0) {
    return keys;
  }
  const env = process.env.NODE_ENV;
  if ((env === "development" || env === "test") && process.env.JWT_SECRET) {
    if (!warnedJwtFallback) {
      warnedJwtFallback = true;
      logger.warn("PLUGIN_ENCRYPTION_KEY not set — falling back to JWT_SECRET for encryption");
    }
    return [{ id: SINGLE_KEY_ID, secret: process.env.JWT_SECRET }];
  }
  throw new Error("PLUGIN_ENCRYPTION_KEY must be set for encryption");
}

const subkeys = new Map<string, Buffer>();

/** The AES key for a key id, derived once per process. */
function subkey({ id, secret }: EncryptionKey): Buffer {
  const cacheKey = `${id}\0${secret}`;
  let key = subkeys.get(cacheKey);
  if (!key) {
    key = Buffer.from(crypto.hkdfSync("sha256", secret, "hay:stored-secrets:v3", id, 32));
    subkeys.set(cacheKey, key);
  }
  return key;
}

/**
 * Encrypt a string value using AES-256-GCM under the current key.
 */
export function encryptValue(text: string): string {
  const [key] = getEncryptionKeys();
  const prefix = `${CIPHERTEXT_PREFIX}${key.id}:`;
  const iv = crypto.randomBytes(V3_IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, subkey(key), iv);
  cipher.setAAD(Buffer.from(prefix, "utf8"));
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decryptV3(value: string, keys: EncryptionKey[]): string {
  const separator = value.indexOf(":", CIPHERTEXT_PREFIX.length);
  const keyId = value.slice(CIPHERTEXT_PREFIX.length, separator);
  const key = keys.find((candidate) => candidate.id === keyId);
  if (separator < 0 || !key) {
    throw new Error(`No encryption key configured with id "${keyId}"`);
  }
  const combined = Buffer.from(value.slice(separator + 1), "base64");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    subkey(key),
    combined.subarray(0, V3_IV_LENGTH),
  );
  decipher.setAAD(Buffer.from(value.slice(0, separator + 1), "utf8"));
  decipher.setAuthTag(combined.subarray(V3_IV_LENGTH, V3_ENCRYPTED_POSITION));
  return Buffer.concat([
    decipher.update(combined.subarray(V3_ENCRYPTED_POSITION)),
    decipher.final(),
  ]).toString("utf8");
}

function decryptLegacy(combined: Buffer, password: string): string {
  const salt = combined.subarray(0, SALT_LENGTH);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    combined.subarray(SALT_LENGTH, TAG_POSITION),
  );
  decipher.setAuthTag(combined.subarray(TAG_POSITION, ENCRYPTED_POSITION));
  return Buffer.concat([
    decipher.update(combined.subarray(ENCRYPTED_POSITION)),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Decrypt a string value encrypted with encryptValue, current or older
 * format. Throws when no configured key can decrypt it.
 */
export function decryptValue(encryptedText: string): string {
  const keys = getEncryptionKeys();
  if (encryptedText.startsWith(CIPHERTEXT_PREFIX)) {
    return decryptV3(encryptedText, keys);
  }
  const body = encryptedText.startsWith(LEGACY_CIPHERTEXT_PREFIX)
    ? encryptedText.slice(LEGACY_CIPHERTEXT_PREFIX.length)
    : encryptedText;
  const combined = Buffer.from(body, "base64");
  let lastError: unknown;
  for (const key of keys) {
    try {
      return decryptLegacy(combined, key.secret);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Whether a stored value is already in the current format under the current key. */
export function isCurrentCiphertext(value: string): boolean {
  return value.startsWith(`${CIPHERTEXT_PREFIX}${getEncryptionKeys()[0].id}:`);
}

/**
 * Off by default because deployments may hold credentials saved before they
 * were encrypted. Run the key rotation script, which encrypts them, then enable.
 */
function plaintextCredentialsRefused(): boolean {
  return process.env.PLUGIN_ENCRYPTION_REQUIRE_CIPHERTEXT === "true";
}

/**
 * Whether a stored string has the shape of encryptValue output (prefixed, or
 * unprefixed base64 long enough to hold salt + iv + tag). Anything else is
 * plaintext written before encryption was introduced.
 */
export function looksLikeCiphertext(value: string): boolean {
  if (value.startsWith(CIPHERTEXT_PREFIX) || value.startsWith(LEGACY_CIPHERTEXT_PREFIX)) {
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
              // Ciphertext no configured key can open (wrong or changed key):
              // never hand it on as if it were the credential.
              logger.error({ err: error, key }, "Failed to decrypt credential");
              decryptedCredentials[key] = null;
            } else if (plaintextCredentialsRefused()) {
              logger.error({ key }, "Refusing unencrypted credential");
              decryptedCredentials[key] = null;
            } else {
              // Plaintext stored before credentials were encrypted; it is
              // encrypted on the next save.
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
