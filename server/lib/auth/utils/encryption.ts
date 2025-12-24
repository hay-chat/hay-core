import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Get the encryption key from environment or generate a default one
 */
function getEncryptionKey(): string {
  const key = process.env.PLUGIN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) {
    throw new Error("PLUGIN_ENCRYPTION_KEY or JWT_SECRET must be set for encryption");
  }
  return key;
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

  // Return as base64
  return combined.toString("base64");
}

/**
 * Decrypt a string value encrypted with encryptValue
 */
export function decryptValue(encryptedText: string): string {
  const password = getEncryptionKey();

  // Decode from base64
  const combined = Buffer.from(encryptedText, "base64");

  // Extract components
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, TAG_POSITION);
  const tag = combined.slice(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = combined.slice(ENCRYPTED_POSITION);

  // Derive key from password and salt
  const key = deriveKey(password, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // Decrypt
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return decrypted.toString("utf8");
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
    if (value && typeof value === "object" && (value as any).encrypted) {
      // Decrypt encrypted values
      try {
        decrypted[key] = decryptValue((value as any).value);
      } catch (error) {
        console.error(`Failed to decrypt config key ${key}:`, error);
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
  return !!(value && typeof value === "object" && (value as any).encrypted === true);
}

/**
 * Hash a value for comparison (non-reversible)
 */
export function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Generate a random encryption key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

/**
 * TypeORM transformer that encrypts/decrypts specific fields in a JSONB column
 */
export class EncryptedTransformer {
  constructor(private fieldsToEncrypt: string[]) {}

  /**
   * Transform value to database (encrypt)
   */
  to(value: any): any {
    if (!value || typeof value !== "object") {
      return value;
    }

    const encrypted = { ...value };
    for (const field of this.fieldsToEncrypt) {
      if (encrypted[field] && typeof encrypted[field] === "string") {
        encrypted[field] = encryptValue(encrypted[field]);
      }
    }
    return encrypted;
  }

  /**
   * Transform value from database (decrypt)
   */
  from(value: any): any {
    if (!value || typeof value !== "object") {
      return value;
    }

    const decrypted = { ...value };
    for (const field of this.fieldsToEncrypt) {
      if (decrypted[field] && typeof decrypted[field] === "string") {
        try {
          decrypted[field] = decryptValue(decrypted[field]);
        } catch (error) {
          console.error(`Failed to decrypt field ${field}:`, error);
          // Keep encrypted value if decryption fails
        }
      }
    }
    return decrypted;
  }
}

/**
 * TypeORM transformer specifically for AuthState that encrypts all fields in credentials
 */
export class AuthStateEncryptedTransformer {
  /**
   * Transform value to database (encrypt all credentials)
   */
  to(value: any): any {
    if (!value || typeof value !== "object") {
      return value;
    }

    // AuthState structure: { methodId: string, credentials: Record<string, unknown> }
    const encrypted = { ...value };

    if (encrypted.credentials && typeof encrypted.credentials === "object") {
      const encryptedCredentials: Record<string, any> = {};

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
  from(value: any): any {
    if (!value || typeof value !== "object") {
      return value;
    }

    const decrypted = { ...value };

    if (decrypted.credentials && typeof decrypted.credentials === "object") {
      const decryptedCredentials: Record<string, any> = {};

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
            // Decryption failed - this is legacy plaintext data from before encryption
            // Return as-is for backwards compatibility (will be encrypted on next save)
            decryptedCredentials[key] = val;
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
