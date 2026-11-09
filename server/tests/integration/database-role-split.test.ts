import "reflect-metadata";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { DataSource } from "typeorm";
import { AppDataSource } from "../../database/data-source";
import { provisionAppRole } from "../../database/app-role";
import { AddAuditLogOutbox1794300000000 } from "../../database/migrations/1794300000000-AddAuditLogOutbox";
import { config } from "../../config/env";

/** Runs against real Postgres: the guarantees are the database's own permission checks. */
describe("application database role", () => {
  const role = "hay_app_role_test";
  const password = "role-test-pass'word";
  let app: DataSource;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await provisionAppRole(AppDataSource, role, password);
    await provisionAppRole(AppDataSource, role, password); // re-running is safe
    app = new DataSource({
      type: "postgres",
      host: config.database.host,
      port: config.database.port,
      username: role,
      password,
      database: config.database.database,
    });
    await app.initialize();
  });

  afterAll(async () => {
    await app?.destroy();
    await AppDataSource.destroy();
  });

  it("reads and writes rows", async () => {
    const id = randomUUID();
    await app.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'role test', $2)`, [
      id,
      `role-test-${id}`,
    ]);
    await app.query(`UPDATE organizations SET name = 'renamed' WHERE id = $1`, [id]);
    await app.query(`DELETE FROM organizations WHERE id = $1`, [id]);
  });

  it("writes audit rows through the chain trigger and runs both audit functions", async () => {
    await app.query(
      `INSERT INTO audit_logs (action, resource, status) VALUES ('test.role', 'role', 'success')`,
    );
    await expect(app.query(`SELECT * FROM audit_logs_verify_chain(NULL)`)).resolves.toBeDefined();
    await expect(
      app.query(`SELECT audit_logs_purge('1970-01-01'::timestamptz, '1970-01-01'::timestamptz)`),
    ).resolves.toBeDefined();
    await expect(
      app.query(
        `SELECT audit_logs_purge('1970-01-01'::timestamptz, '1970-01-01'::timestamptz, true)`,
      ),
    ).resolves.toBeDefined();
  });

  it("keeps the right to run the purge when a migration changes its signature", async () => {
    const purge = `SELECT audit_logs_purge('1970-01-01'::timestamptz, '1970-01-01'::timestamptz)`;
    const migration = new AddAuditLogOutbox1794300000000();
    const runner = AppDataSource.createQueryRunner();
    try {
      await migration.down(runner);
      await expect(app.query(purge)).resolves.toBeDefined();
    } finally {
      await migration.up(runner);
      await runner.release();
    }
    await expect(app.query(purge)).resolves.toBeDefined();
  });

  it.each([
    ["create a table", `CREATE TABLE role_test (id int)`],
    ["alter a table", `ALTER TABLE organizations ADD COLUMN role_test int`],
    ["disable the audit triggers", `ALTER TABLE audit_logs DISABLE TRIGGER USER`],
    ["truncate the audit trail", `TRUNCATE audit_logs`],
    ["drop a table", `DROP TABLE organizations CASCADE`],
    ["rewrite migration history", `DELETE FROM migrations`],
    ["create an extension", `CREATE EXTENSION IF NOT EXISTS pg_trgm`],
  ])("cannot %s", async (_label, sql) => {
    await expect(app.query(sql)).rejects.toThrow(/permission denied|must be owner/);
  });

  it("cannot delete audit rows by setting the purge flag itself", async () => {
    await expect(
      app.transaction(async (manager) => {
        await manager.query(`SET LOCAL hay.audit_logs_purge = 'on'`);
        await manager.query(`DELETE FROM audit_logs`);
      }),
    ).rejects.toThrow(/cannot be deleted/);
  });
});
