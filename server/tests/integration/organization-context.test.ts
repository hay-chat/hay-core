import "reflect-metadata";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { AppDataSource } from "../../database/data-source";
import {
  getDatabaseContext,
  runAsSystem,
  runInOrganization,
  withContextTransaction,
} from "../../database/organization-context";

/** Runs against real Postgres: the guarantee is the transaction-local setting. */
const SHOW = `SELECT current_setting('app.organization_id', true) AS org`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const orgIn = (manager: { query: (q: string) => Promise<{ org: string | null }[]> }) =>
  manager.query(SHOW).then((rows) => rows[0].org);

describe("organization database context", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  });
  afterAll(async () => {
    await AppDataSource.destroy();
  });

  it("sets the organization inside, and leaves it empty outside and on the next pooled use", async () => {
    const org = randomUUID();
    const inside = await runInOrganization(org, () => withContextTransaction(orgIn));
    expect(inside).toBe(org);

    // Force every pooled connection to be reused, none may still carry the setting.
    const after = await Promise.all(
      Array.from({ length: 25 }, () => AppDataSource.query(SHOW).then((r) => r[0].org)),
    );
    for (const value of after) expect(value === null || value === "").toBe(true);
    const bare = await AppDataSource.transaction((m) => orgIn(m));
    expect(bare === null || bare === "").toBe(true);
  });

  it("refuses database work with no context", () => {
    expect(() => withContextTransaction(async () => 1)).toThrow(/No database context/);
  });

  it("rejects a malformed organization id", async () => {
    await expect(
      runInOrganization("not-a-uuid", () => withContextTransaction(async () => 1)),
    ).rejects.toThrow(/not a UUID/);
  });

  it("sets nothing in a system context and records its reason", async () => {
    await runAsSystem("test: cross-tenant scan", async () => {
      expect(getDatabaseContext()).toEqual({ kind: "system", reason: "test: cross-tenant scan" });
      const value = await withContextTransaction(orgIn);
      expect(value === null || value === "").toBe(true);
    });
    expect(() => runAsSystem("  ", () => 1)).toThrow(/reason/);
  });

  it("joins an open transaction when nested in the same context", async () => {
    const org = randomUUID();
    await runInOrganization(org, () =>
      withContextTransaction(async (outer) => {
        await withContextTransaction(async (inner) => {
          expect(inner).toBe(outer);
          expect(await orgIn(inner)).toBe(org);
        });
      }),
    );
  });

  it("a nested different organization gets its own transaction and the outer one is unchanged", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await runInOrganization(a, () =>
      withContextTransaction(async (outer) => {
        const inner = await runInOrganization(b, () => withContextTransaction(orgIn));
        expect(inner).toBe(b);
        expect(await orgIn(outer)).toBe(a);
      }),
    );
    expect(getDatabaseContext()).toBeUndefined();
  });

  it("keeps concurrent contexts for different organizations apart", async () => {
    const orgs = Array.from({ length: 20 }, () => randomUUID());
    const seen = await Promise.all(
      orgs.map((org, i) =>
        runInOrganization(org, async () => {
          await sleep((i % 4) * 5);
          return withContextTransaction(async (m) => {
            await sleep(((i * 7) % 5) * 5);
            return orgIn(m);
          });
        }),
      ),
    );
    expect(seen).toEqual(orgs);
  });

  it("rolls back work and the setting together when the work throws", async () => {
    const org = randomUUID();
    await expect(
      runInOrganization(org, () =>
        withContextTransaction(async (m) => {
          await m.query(`CREATE TEMP TABLE ctx_rollback (n int)`);
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
    const after = await AppDataSource.query(SHOW);
    expect(after[0].org === null || after[0].org === "").toBe(true);
    const gone = await AppDataSource.query(`SELECT to_regclass('pg_temp.ctx_rollback') AS t`);
    expect(gone[0].t).toBeNull();
  });
});
