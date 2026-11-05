import { AppDataSource } from "@server/database/data-source";
import type { SetupSettings } from "@server/types/setup.types";

export function emptySetup(): SetupSettings {
  return { toolPluginIds: [], channels: [], questions: [] };
}

function normalize(raw: SetupSettings | null | undefined): SetupSettings {
  return { ...emptySetup(), ...(raw ?? {}) };
}

export async function readSetup(organizationId: string): Promise<SetupSettings> {
  const rows: Array<{ setup: SetupSettings | null }> = await AppDataSource.query(
    `SELECT settings->'setup' AS setup FROM organizations WHERE id = $1`,
    [organizationId],
  );
  return normalize(rows[0]?.setup);
}

/**
 * Read-modify-write of `settings.setup` under a row lock. The crawl-driven check and a person
 * editing answers can overlap, so every write re-reads the stored value inside the lock and
 * hands it to `change`, and only the `setup` key is replaced (other settings are never touched).
 */
export async function updateSetup(
  organizationId: string,
  change: (current: SetupSettings) => SetupSettings,
): Promise<SetupSettings> {
  return AppDataSource.transaction(async (manager) => {
    const rows: Array<{ setup: SetupSettings | null }> = await manager.query(
      `SELECT settings->'setup' AS setup FROM organizations WHERE id = $1 FOR UPDATE`,
      [organizationId],
    );
    const next = change(normalize(rows[0]?.setup));
    await manager.query(
      `UPDATE organizations
          SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{setup}', $2::jsonb, true),
              updated_at = now()
        WHERE id = $1`,
      [organizationId, JSON.stringify(next)],
    );
    return next;
  });
}
