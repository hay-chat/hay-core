import { AppDataSource } from "@server/database/data-source";
import {
  decryptValue,
  encryptValue,
  isCurrentCiphertext,
  isEncrypted,
  looksLikeCiphertext,
} from "@server/lib/auth/utils/encryption";

export interface RotationCounts {
  /** Values rewritten under the current key (or that would be, on a dry run). */
  rotated: number;
  /** Plaintext credentials encrypted for the first time. */
  encrypted: number;
  /** Values no configured key can open. Left as they are. */
  failed: number;
}

interface RotationReport extends RotationCounts {
  failures: string[];
}

const BATCH_SIZE = 200;

/** New value for an encrypted string, or null when it is already current. */
function rotated(value: string): string | null {
  return isCurrentCiphertext(value) ? null : encryptValue(decryptValue(value));
}

/** Pages through a table by id. */
async function forEachRow(
  table: string,
  columns: string,
  visit: (row: { id: string } & Record<string, unknown>) => Promise<void>,
): Promise<void> {
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows: Array<{ id: string } & Record<string, unknown>> = await AppDataSource.query(
      `SELECT id, ${columns} FROM ${table} WHERE id > $1 ORDER BY id LIMIT ${BATCH_SIZE}`,
      [lastId],
    );
    if (rows.length === 0) return;
    for (const row of rows) await visit(row);
    lastId = rows[rows.length - 1].id;
  }
}

/**
 * Re-encrypts every stored secret under the current key, and encrypts plugin
 * credentials saved before encryption existed. Lists what it would change
 * unless `apply` is set. A row changed by the running app between the read and
 * the write is left for the next run. Safe to run again.
 */
export async function rotateStoredSecrets(options: { apply: boolean }): Promise<RotationReport> {
  const report: RotationReport = { rotated: 0, encrypted: 0, failed: 0, failures: [] };

  const convert = (where: string, value: string): string | null => {
    try {
      const next = rotated(value);
      if (next) report.rotated++;
      return next;
    } catch {
      report.failed++;
      report.failures.push(where);
      return null;
    }
  };

  /** Writes a jsonb column back only if it still holds what was read. */
  const saveJson = async (
    table: string,
    column: string,
    id: string,
    before: unknown,
    after: unknown,
  ) => {
    if (!options.apply) return;
    await AppDataSource.query(
      `UPDATE ${table} SET ${column} = $1::jsonb WHERE id = $2 AND ${column} = $3::jsonb`,
      [JSON.stringify(after), id, JSON.stringify(before)],
    );
  };

  /** Writes a text column back only if it still holds what was read. */
  const saveText = async (
    table: string,
    column: string,
    id: string,
    before: string,
    after: string,
  ) => {
    if (!options.apply) return;
    await AppDataSource.query(
      `UPDATE ${table} SET ${column} = $1 WHERE id = $2 AND ${column} = $3`,
      [after, id, before],
    );
  };

  await forEachRow("plugin_instances", "auth_state, config", async (row) => {
    const authState = row.auth_state as { credentials?: Record<string, unknown> } | null;
    if (authState?.credentials && typeof authState.credentials === "object") {
      const credentials = { ...authState.credentials };
      let changed = false;
      for (const [key, value] of Object.entries(credentials)) {
        if (typeof value !== "string" || !value) continue;
        if (!looksLikeCiphertext(value)) {
          credentials[key] = encryptValue(value);
          report.encrypted++;
          changed = true;
          continue;
        }
        const next = convert(`plugin_instances.auth_state ${row.id} ${key}`, value);
        if (next) {
          credentials[key] = next;
          changed = true;
        }
      }
      if (changed) {
        await saveJson("plugin_instances", "auth_state", row.id, authState, {
          ...authState,
          credentials,
        });
      }
    }

    const config = row.config as Record<string, unknown> | null;
    if (config && typeof config === "object") {
      const next = { ...config };
      let changed = false;
      for (const [key, value] of Object.entries(config)) {
        if (!isEncrypted(value)) continue;
        const newValue = convert(`plugin_instances.config ${row.id} ${key}`, value.value);
        if (newValue) {
          next[key] = { ...value, value: newValue };
          changed = true;
        }
      }
      if (changed) await saveJson("plugin_instances", "config", row.id, config, next);
    }
  });

  await forEachRow("plugin_states", "value", async (row) => {
    const value = row.value as string;
    const next = convert(`plugin_states ${row.id}`, value);
    if (next) await saveText("plugin_states", "value", row.id, value, next);
  });

  await forEachRow("webchat_settings", "identity_secret", async (row) => {
    const value = row.identity_secret as string | null;
    if (!value) return;
    const next = convert(`webchat_settings ${row.id}`, value);
    if (next) await saveText("webchat_settings", "identity_secret", row.id, value, next);
  });

  await forEachRow("organizations", "settings", async (row) => {
    const settings = row.settings as {
      llm?: { chat?: { apiKeyEncrypted?: string } };
    } | null;
    const value = settings?.llm?.chat?.apiKeyEncrypted;
    if (!settings || !value) return;
    const next = convert(`organizations.settings ${row.id}`, value);
    if (next) {
      await saveJson("organizations", "settings", row.id, settings, {
        ...settings,
        llm: { ...settings.llm, chat: { ...settings.llm?.chat, apiKeyEncrypted: next } },
      });
    }
  });

  return report;
}
