import "reflect-metadata";
import crypto, { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import { decryptValue, encryptValue } from "../../lib/auth/utils/encryption";
import { rotateStoredSecrets } from "../../services/encryption-rotation.service";

const OLD = "o".repeat(40);
const NEW = "n".repeat(40);

function v2(text: string, password: string): string {
  const salt = crypto.randomBytes(64);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256"),
    iv,
  );
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return "enc:v2:" + Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

/** Real rows and raw SQL: the job is exactly that no stored format is missed. */
describe("stored secret rotation", () => {
  const orgId = randomUUID();
  const pluginId = `rotation-test-${orgId}`;
  const originalEnv = { ...process.env };
  let instanceId: string;
  const value = async (sql: string, ...params: unknown[]) =>
    (await AppDataSource.query(sql, params))[0].v as string;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    process.env.PLUGIN_ENCRYPTION_KEY = OLD;
    delete process.env.PLUGIN_ENCRYPTION_KEYS;

    const fromOldV3 = encryptValue("v3-secret");
    await AppDataSource.query(
      `INSERT INTO organizations (id, name, slug, settings) VALUES ($1, 'rotation', $2, $3::jsonb)`,
      [
        orgId,
        `rotation-${orgId}`,
        JSON.stringify({
          llm: { chat: { provider: "openai", apiKeyEncrypted: v2("llm-key", OLD) } },
        }),
      ],
    );
    const [registry] = await AppDataSource.query(
      `INSERT INTO plugin_registry (plugin_id, name, version, plugin_path, manifest)
       VALUES ($1, 'rotation', '1.0.0', 'x', '{}'::jsonb) RETURNING id`,
      [pluginId],
    );
    const [instance] = await AppDataSource.query(
      `INSERT INTO plugin_instances (organization_id, plugin_id, auth_state, config)
       VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
      [
        orgId,
        registry.id,
        JSON.stringify({
          methodId: "apiKey",
          credentials: { v3: fromOldV3, plain: "shpat_plain", number: 5, empty: "" },
        }),
        JSON.stringify({
          secret: { encrypted: true, value: v2("config-secret", OLD) },
          open: "not-secret",
        }),
      ],
    );
    instanceId = instance.id;
    await AppDataSource.query(
      `INSERT INTO plugin_states (organization_id, plugin_id, key, value) VALUES ($1, $2, 'k', $3)`,
      [orgId, pluginId, v2('{"a":1}', OLD)],
    );
    await AppDataSource.query(
      `INSERT INTO webchat_settings (organization_id, identity_secret) VALUES ($1, $2)`,
      [orgId, v2("identity", OLD)],
    );
  });

  afterAll(async () => {
    process.env = originalEnv;
    await AppDataSource.query(`DELETE FROM plugin_states WHERE plugin_id = $1`, [pluginId]);
    await AppDataSource.query(`DELETE FROM webchat_settings WHERE organization_id = $1`, [orgId]);
    await AppDataSource.query(`DELETE FROM plugin_instances WHERE id = $1`, [instanceId]);
    await AppDataSource.query(`DELETE FROM plugin_registry WHERE plugin_id = $1`, [pluginId]);
    await AppDataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await AppDataSource.destroy();
  });

  it("changes nothing on a dry run, then moves every value to the new key", async () => {
    process.env.PLUGIN_ENCRYPTION_KEYS = `k1:${NEW},k0:${OLD}`;
    const before = await value(
      `SELECT auth_state::text AS v FROM plugin_instances WHERE id=$1`,
      instanceId,
    );

    const dry = await rotateStoredSecrets({ apply: false });
    expect(dry.failed).toBe(0);
    expect(dry.encrypted).toBeGreaterThanOrEqual(1);
    expect(
      await value(`SELECT auth_state::text AS v FROM plugin_instances WHERE id=$1`, instanceId),
    ).toBe(before);

    const applied = await rotateStoredSecrets({ apply: true });
    expect(applied.failed).toBe(0);

    // The old key is gone: everything must open with the new one alone.
    delete process.env.PLUGIN_ENCRYPTION_KEY;
    process.env.PLUGIN_ENCRYPTION_KEYS = `k1:${NEW}`;

    const [{ auth_state: auth, config }] = await AppDataSource.query(
      `SELECT auth_state, config FROM plugin_instances WHERE id=$1`,
      [instanceId],
    );
    expect(decryptValue(auth.credentials.v3)).toBe("v3-secret");
    expect(decryptValue(auth.credentials.plain)).toBe("shpat_plain");
    expect(auth.credentials.number).toBe(5);
    expect(auth.credentials.empty).toBe("");
    expect(decryptValue(config.secret.value)).toBe("config-secret");
    expect(config.open).toBe("not-secret");
    expect(
      decryptValue(
        await value(`SELECT value AS v FROM plugin_states WHERE plugin_id=$1`, pluginId),
      ),
    ).toBe('{"a":1}');
    expect(
      decryptValue(
        await value(
          `SELECT identity_secret AS v FROM webchat_settings WHERE organization_id=$1`,
          orgId,
        ),
      ),
    ).toBe("identity");
    expect(
      decryptValue(
        await value(
          `SELECT settings->'llm'->'chat'->>'apiKeyEncrypted' AS v FROM organizations WHERE id=$1`,
          orgId,
        ),
      ),
    ).toBe("llm-key");

    const again = await rotateStoredSecrets({ apply: true });
    expect(again).toMatchObject({ rotated: 0, encrypted: 0, failed: 0 });
  });

  it("reports values no key can open and leaves them untouched", async () => {
    const unreadable = v2("lost", "x".repeat(40));
    await AppDataSource.query(
      `UPDATE webchat_settings SET identity_secret=$1 WHERE organization_id=$2`,
      [unreadable, orgId],
    );
    const report = await rotateStoredSecrets({ apply: true });
    expect(report.failed).toBe(1);
    expect(
      await value(
        `SELECT identity_secret AS v FROM webchat_settings WHERE organization_id=$1`,
        orgId,
      ),
    ).toBe(unreadable);
  });
});
