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
    throw new Error(
      "PLUGIN_ENCRYPTION_KEY or JWT_SECRET must be set for encryption"
    );
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
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  
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
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  
  return decrypted.toString("utf8");
}

/**
 * Encrypt sensitive values in a config object based on schema
 */
export function encryptConfig(
  config: Record<string, any>,
  schema: Record<string, any>
): Record<string, any> {
  const encrypted: Record<string, any> = {};
  
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
export function decryptConfig(
  config: Record<string, any>
): Record<string, any> {
  const decrypted: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(config)) {
    if (value && typeof value === "object" && value.encrypted) {
      // Decrypt encrypted values
      try {
        decrypted[key] = decryptValue(value.value);
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
export function isEncrypted(value: any): boolean {
  return value && typeof value === "object" && value.encrypted === true;
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