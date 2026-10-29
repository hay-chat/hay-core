#!/usr/bin/env node
/**
 * Re-encrypt every stored secret with the current PLUGIN_ENCRYPTION_KEY.
 *
 * Use when moving to a new key (including the move off the JWT_SECRET
 * fallback). Rollout:
 *   1. Set PLUGIN_ENCRYPTION_KEY=<new key> and
 *      PLUGIN_ENCRYPTION_KEY_PREVIOUS=<old key, or the JWT_SECRET value if no
 *      dedicated key was set before>, then deploy. Reads try both keys; new
 *      writes use the new key.
 *   2. Run this script (dry run first). It decrypts each value with either
 *      key and writes it back encrypted with the new one. Plaintext plugin
 *      credentials left from before encryption existed are encrypted too.
 *   3. When it reports 0 failures, unset PLUGIN_ENCRYPTION_KEY_PREVIOUS and
 *      redeploy.
 *
 *   npm run secrets:reencrypt              # dry run, reports what would change
 *   npm run secrets:reencrypt -- --apply   # writes the changes
 *
 * Safe to run again: values already encrypted with the current key are skipped.
 */
import { AppDataSource } from "../database/data-source";
import {
  CIPHERTEXT_PREFIX,
  decryptValue,
  encryptValue,
  isEncrypted,
  looksLikeCiphertext,
} from "../lib/auth/utils/encryption";

type Outcome = "unchanged" | "reencrypted" | "encrypted-plaintext" | "failed";

const apply = process.argv.includes("--apply");
const counts: Record<Outcome, number> = {
  unchanged: 0,
  reencrypted: 0,
  "encrypted-plaintext": 0,
  failed: 0,
};

/** True when the value already decrypts with the current key alone. */
function isCurrent(value: string): boolean {
  if (!value.startsWith(CIPHERTEXT_PREFIX)) return false;
  const previous = process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS;
  delete process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS;
  try {
    decryptValue(value);
    return true;
  } catch {
    return false;
  } finally {
    if (previous !== undefined) process.env.PLUGIN_ENCRYPTION_KEY_PREVIOUS = previous;
  }
}

/**
 * Re-encrypt one stored value with the current key. `next` is the value to
 * write back, or null when nothing changes. `allowPlaintext` is for plugin
 * credentials, which predate encryption.
 */
export function rotateSecret(
  value: string,
  allowPlaintext = false,
): { outcome: Outcome; next: string | null } {
  if (isCurrent(value)) {
    return { outcome: "unchanged", next: null };
  }
  try {
    return { outcome: "reencrypted", next: encryptValue(decryptValue(value)) };
  } catch {
    if (allowPlaintext && !looksLikeCiphertext(value)) {
      return { outcome: "encrypted-plaintext", next: encryptValue(value) };
    }
    return { outcome: "failed", next: null };
  }
}

function rotate(value: string, where: string, allowPlaintext = false): string | null {
  const { outcome, next } = rotateSecret(value, allowPlaintext);
  counts[outcome]++;
  if (outcome === "failed") {
    console.error(`  could not decrypt ${where} with the current or previous key`);
  }
  return next;
}

async function rotatePluginInstances(): Promise<void> {
  const rows: Array<{
    id: string;
    config: Record<string, unknown> | null;
    auth_state: { credentials?: Record<string, unknown> } | null;
  }> = await AppDataSource.query(`SELECT id, config, auth_state FROM plugin_instances`);

  for (const row of rows) {
    let changed = false;

    const config = row.config ? { ...row.config } : null;
    for (const [key, value] of Object.entries(config ?? {})) {
      if (!isEncrypted(value)) continue;
      const next = rotate(value.value, `plugin_instances ${row.id} config.${key}`);
      if (next) {
        config![key] = { ...value, value: next };
        changed = true;
      }
    }

    const authState = row.auth_state ? { ...row.auth_state } : null;
    if (authState?.credentials) {
      const credentials = { ...authState.credentials };
      for (const [key, value] of Object.entries(credentials)) {
        if (typeof value !== "string" || !value) continue;
        const next = rotate(value, `plugin_instances ${row.id} credentials.${key}`, true);
        if (next) {
          credentials[key] = next;
          changed = true;
        }
      }
      authState.credentials = credentials;
    }

    if (changed && apply) {
      await AppDataSource.query(
        `UPDATE plugin_instances SET config = $2, auth_state = $3 WHERE id = $1`,
        [row.id, config, authState],
      );
    }
  }
}

async function rotateTextColumn(table: string, column: string): Promise<void> {
  const rows: Array<{ id: string; value: string }> = await AppDataSource.query(
    `SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`,
  );
  for (const row of rows) {
    const next = rotate(row.value, `${table} ${row.id} ${column}`);
    if (next && apply) {
      await AppDataSource.query(`UPDATE ${table} SET ${column} = $2 WHERE id = $1`, [row.id, next]);
    }
  }
}

async function rotateOrganizationLlmKeys(): Promise<void> {
  const rows: Array<{ id: string; value: string }> = await AppDataSource.query(
    `SELECT id, settings #>> '{llm,chat,apiKeyEncrypted}' AS value
     FROM organizations
     WHERE settings #>> '{llm,chat,apiKeyEncrypted}' IS NOT NULL`,
  );
  for (const row of rows) {
    const next = rotate(row.value, `organizations ${row.id} settings.llm.chat.apiKeyEncrypted`);
    if (next && apply) {
      await AppDataSource.query(
        `UPDATE organizations
         SET settings = jsonb_set(settings, '{llm,chat,apiKeyEncrypted}', to_jsonb($2::text))
         WHERE id = $1`,
        [row.id, next],
      );
    }
  }
}

async function main() {
  if (!process.env.PLUGIN_ENCRYPTION_KEY) {
    throw new Error("Set PLUGIN_ENCRYPTION_KEY (the new key) before running");
  }
  await AppDataSource.initialize();

  console.log(apply ? "Re-encrypting secrets..." : "Dry run (pass --apply to write):");
  await rotatePluginInstances();
  await rotateTextColumn("plugin_states", "value");
  await rotateTextColumn("webchat_settings", "identity_secret");
  await rotateOrganizationLlmKeys();

  console.log(
    `Already current: ${counts.unchanged}, re-encrypted: ${counts.reencrypted}, ` +
      `plaintext encrypted: ${counts["encrypted-plaintext"]}, failed: ${counts.failed}`,
  );
  await AppDataSource.destroy();
  if (counts.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Re-encrypting secrets failed:", error);
    process.exit(1);
  });
}
