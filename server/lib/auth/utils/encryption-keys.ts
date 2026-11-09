export interface EncryptionKey {
  id: string;
  secret: string;
}

/** The id PLUGIN_ENCRYPTION_KEY goes by. Use it to keep that key as a previous one while rotating. */
export const SINGLE_KEY_ID = "k0";

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** Parses `PLUGIN_ENCRYPTION_KEYS` (`id:secret,id:secret`, current key first). */
export function parseEncryptionKeys(raw: string): EncryptionKey[] {
  const keys = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      const id = entry.slice(0, Math.max(separator, 0));
      const secret = entry.slice(separator + 1);
      if (!KEY_ID.test(id) || !secret) {
        throw new Error("PLUGIN_ENCRYPTION_KEYS entries must look like id:secret");
      }
      return { id, secret };
    });
  if (new Set(keys.map((key) => key.id)).size !== keys.length) {
    throw new Error("PLUGIN_ENCRYPTION_KEYS has a repeated key id");
  }
  return keys;
}

/**
 * Configured keys, the one new values are written with first. Every other key
 * is only used to read values written before a rotation.
 */
export function configuredEncryptionKeys(): EncryptionKey[] {
  const keys = parseEncryptionKeys(process.env.PLUGIN_ENCRYPTION_KEYS || "");
  const single = process.env.PLUGIN_ENCRYPTION_KEY;
  if (single && !keys.some((key) => key.id === SINGLE_KEY_ID)) {
    keys.push({ id: SINGLE_KEY_ID, secret: single });
  }
  return keys;
}
