import "reflect-metadata";
import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { Client, Query } from "pg";
import { DataSource, EntitySchema, type EntityManager } from "typeorm";
import { installOrganizationContextHook } from "../../database/organization-context-hook";
import { config } from "../../config/env";
import { runAsSystem, runInOrganization } from "../../database/organization-context";

/** Real Postgres, a real RLS policy, and a non-owner role so the policy applies. */
const TABLE = `rls_hook_items_${Date.now()}`;
const ROLE = `rls_hook_app_${Date.now()}`;
const SYSTEM_ROLE = `rls_hook_sys_${Date.now()}`;
const PASSWORD = "rls_hook_pw";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Item {
  id: string;
  organizationId: string;
  label: string;
}
const ItemSchema = new EntitySchema<Item>({
  name: "RlsHookItem",
  tableName: TABLE,
  columns: {
    id: { type: "uuid", primary: true },
    organizationId: { type: "uuid", name: "organization_id" },
    label: { type: "text" },
  },
});

/** Every statement that reaches a pg client, with an optional injected failure. */
const sent: string[] = [];
let failNextSet = false;
const realClientQuery = Client.prototype.query;
function countStatements(): () => void {
  (Client.prototype as unknown as { query: unknown }).query = function (
    this: Client,
    ...args: unknown[]
  ) {
    const first = args[0] as string | { text?: string };
    const text = typeof first === "string" ? first : (first?.text ?? "<stream>");
    sent.push(text);
    if (failNextSet && text.includes("set_config")) {
      failNextSet = false;
      return Promise.reject(new Error("injected set_config failure"));
    }
    return (realClientQuery as (...a: unknown[]) => unknown).apply(this, args);
  };
  return () => {
    Client.prototype.query = realClientQuery;
  };
}
const setCount = () => sent.filter((t) => t.includes("set_config('app.organization_id'")).length;

const base = {
  type: "postgres" as const,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  entities: [ItemSchema],
};

describe("organization context hook", () => {
  let owner: DataSource;
  let app: DataSource;
  let single: DataSource;
  let uninstall: () => void;
  let stopCounting: () => void;
  const orgs = Array.from({ length: 20 }, () => randomUUID());

  const labels = (rows: Item[]) => rows.map((r) => r.label).sort();
  const own = (org: string) => [`${org}-a`, `${org}-b`];
  const everyLabel = orgs.flatMap(own).sort();

  beforeAll(async () => {
    owner = await new DataSource({
      ...base,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
    }).initialize();
    await owner.query(
      `CREATE TABLE ${TABLE} (id uuid PRIMARY KEY, organization_id uuid NOT NULL, label text NOT NULL)`,
    );
    await owner.query(`CREATE INDEX ON ${TABLE} (organization_id)`);
    await owner.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
    await owner.query(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await owner.query(
      `CREATE POLICY tenant ON ${TABLE} TO ${ROLE} USING (organization_id::text = current_setting('app.organization_id', true)) WITH CHECK (organization_id::text = current_setting('app.organization_id', true))`,
    );
    await owner.query(`CREATE ROLE ${SYSTEM_ROLE} NOLOGIN`);
    await owner.query(`GRANT ${SYSTEM_ROLE} TO ${ROLE} WITH INHERIT FALSE, SET TRUE`);
    await owner.query(
      `CREATE POLICY system_all ON ${TABLE} TO ${SYSTEM_ROLE} USING (true) WITH CHECK (true)`,
    );
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABLE} TO ${ROLE}, ${SYSTEM_ROLE}`,
    );
    (config.database as { systemRole: string }).systemRole = SYSTEM_ROLE;
    for (const org of orgs) {
      for (const suffix of ["a", "b"]) {
        await owner.query(`INSERT INTO ${TABLE} VALUES ($1, $2, $3)`, [
          randomUUID(),
          org,
          `${org}-${suffix}`,
        ]);
      }
    }
    app = await new DataSource({
      ...base,
      username: ROLE,
      password: PASSWORD,
      poolSize: 3,
    }).initialize();
    single = await new DataSource({
      ...base,
      username: ROLE,
      password: PASSWORD,
      poolSize: 1,
    }).initialize();
    stopCounting = countStatements();
    uninstall = installOrganizationContextHook(true);
  });

  afterAll(async () => {
    uninstall();
    stopCounting();
    await single?.destroy();
    await app?.destroy();
    await owner.query(`DROP TABLE ${TABLE}`);
    await owner.query(`DROP OWNED BY ${ROLE}, ${SYSTEM_ROLE}`);
    await owner.query(`DROP ROLE ${ROLE}, ${SYSTEM_ROLE}`);
    await owner.destroy();
  });

  const SHOW = `SELECT current_setting('app.organization_id', true) AS org`;
  const readers: Record<
    string,
    (ds: DataSource | import("typeorm").EntityManager) => Promise<string[]>
  > = {
    "repository find": async (m) => labels(await m.getRepository(ItemSchema).find()),
    "query builder": async (m) =>
      labels(
        await m
          .getRepository(ItemSchema)
          .createQueryBuilder("i")
          .where("i.label like :p", { p: "%-%" })
          .getMany(),
      ),
    "raw query": async (m) =>
      (await m.query(`SELECT label FROM ${TABLE} WHERE label LIKE $1`, ["%-%"]))
        .map((r: { label: string }) => r.label)
        .sort(),
  };
  const modes: Record<
    string,
    (fn: (m: import("typeorm").EntityManager) => Promise<string[]>) => Promise<string[]>
  > = {
    "no transaction": (fn) => fn(app.manager),
    "AppDataSource.transaction": (fn) => app.transaction(fn),
    "query runner transaction": async (fn) => {
      const qr = app.createQueryRunner();
      try {
        await qr.startTransaction();
        const out = await fn(qr.manager);
        await qr.commitTransaction();
        return out;
      } finally {
        await qr.release();
      }
    },
  };

  for (const [mode, run] of Object.entries(modes)) {
    for (const [name, read] of Object.entries(readers)) {
      it(`${name}, ${mode}: own rows, no foreign rows, nothing without context`, async () => {
        const [a, b] = orgs;
        expect(await runInOrganization(a, () => run(read))).toEqual(own(a));
        expect(await runInOrganization(b, () => run(read))).toEqual(own(b));
        expect(await run(read)).toEqual([]);
        expect(await runAsSystem("test: all rows", () => run(read))).toEqual(everyLabel);
        expect(await runInOrganization(randomUUID(), () => run(read))).toEqual([]);
      });
    }
  }

  it("writes pass the policy for the context organization only", async () => {
    const [a, b] = orgs;
    const repo = app.getRepository(ItemSchema);
    await runInOrganization(a, () =>
      repo.save({ id: randomUUID(), organizationId: a, label: "w-ok" }),
    );
    await expect(
      runInOrganization(a, () =>
        repo.save({ id: randomUUID(), organizationId: b, label: "w-bad" }),
      ),
    ).rejects.toThrow(/row-level security/);
    await runInOrganization(a, () => repo.delete({ label: "w-ok" }));
    expect(await runInOrganization(a, () => readers["repository find"](app.manager))).toEqual(
      own(a),
    );
  });

  it("carries no stale organization after errors, on any pooled connection", async () => {
    const [a] = orgs;
    await expect(
      runInOrganization(a, () => app.query("SELECT * FROM no_such_table")),
    ).rejects.toThrow();
    await expect(
      runInOrganization(a, () =>
        app.transaction(async (m) => {
          await m.query(`SELECT 1`);
          await m.query("SELECT * FROM no_such_table");
        }),
      ),
    ).rejects.toThrow();
    const seen = await Promise.all(
      Array.from({ length: 30 }, () => app.query(SHOW).then((r) => r[0].org)),
    );
    for (const org of seen) expect(org === null || org === "").toBe(true);
    // The pool still serves the org that failed.
    expect(await runInOrganization(a, () => readers["raw query"](app.manager))).toEqual(own(a));
  });

  it("holds under 20 concurrent organizations on a pool of 3, with errors and slow gaps between", async () => {
    const leaks: string[] = [];
    await Promise.all(
      orgs.map((org, i) =>
        runInOrganization(org, async () => {
          for (let round = 0; round < 6; round++) {
            await sleep((i * 7 + round * 3) % 11); // gap with no connection held
            const viaRepo = labels(await app.getRepository(ItemSchema).find());
            if (JSON.stringify(viaRepo) !== JSON.stringify(own(org))) leaks.push(`find ${org}`);
            const viaTx = await app.transaction(async (m) => {
              await sleep(2);
              return (await m.query(SHOW))[0].org as string;
            });
            if (viaTx !== org) leaks.push(`tx ${org}`);
            if (round % 2 === 0)
              await app.query("SELECT * FROM no_such_table").catch(() => undefined);
            const viaRaw = (await app.query(SHOW))[0].org as string;
            if (viaRaw !== org) leaks.push(`raw ${org}`);
          }
        }),
      ),
    );
    expect(leaks).toEqual([]);
  });

  const orgOf = async (m: EntityManager | DataSource) =>
    ((await m.query(SHOW))[0].org as string | null) || "";

  describe("compare-on-use on one physical connection (pool of 1)", () => {
    const withRunner = async <T>(
      work: (runner: ReturnType<DataSource["createQueryRunner"]>) => Promise<T>,
    ): Promise<T> => {
      const runner = single.createQueryRunner();
      try {
        return await work(runner);
      } finally {
        await runner.release();
      }
    };
    const orgOnFreshRunner = (organizationId?: string): Promise<string> => {
      const read = () => withRunner((runner) => orgOf(runner.manager));
      return organizationId ? runInOrganization(organizationId, read) : read();
    };

    it("no-context work on a connection last used by an organization sees nothing", async () => {
      const [a] = orgs;
      expect(await runInOrganization(a, () => readers["raw query"](single.manager))).toEqual(
        own(a),
      );
      expect(await readers["raw query"](single.manager)).toEqual([]);
      expect(await readers["repository find"](single.manager)).toEqual([]);
      expect(await orgOf(single)).toBe("");
      expect(await runAsSystem("test", () => orgOf(single))).toBe("");
      expect(await runInOrganization(a, () => orgOf(single))).toBe(a);
    });

    const roleOf = async (m: EntityManager | DataSource) =>
      (await m.query(`SELECT current_user AS role`))[0].role as string;

    it("system work sees every row and writes; the next no-context query on the connection sees nothing", async () => {
      const [a] = orgs;
      const id = randomUUID();
      const repo = single.getRepository(ItemSchema);
      expect(await runAsSystem("test", () => readers["raw query"](single.manager))).toEqual(
        everyLabel,
      );
      expect(await runAsSystem("test", () => roleOf(single))).toBe(SYSTEM_ROLE);
      await runAsSystem("test", () => repo.save({ id, organizationId: a, label: "system-write" }));
      expect(await readers["raw query"](single.manager)).toEqual([]);
      expect(await roleOf(single)).toBe(ROLE);
      expect(await runInOrganization(a, () => roleOf(single))).toBe(ROLE);
      expect(await runAsSystem("test", async () => (await repo.findOneBy({ id }))?.label)).toBe(
        "system-write",
      );
      await runAsSystem("test", () => repo.delete({ id }));
      expect(await runAsSystem("test", () => readers["raw query"](single.manager))).toEqual(
        everyLabel,
      );
      // An organization after system work sees only its own rows, as the app role.
      expect(await runInOrganization(a, () => readers["raw query"](single.manager))).toEqual(
        own(a),
      );
      expect(await roleOf(single)).toBe(ROLE);
    });

    it("a transaction started in system context sees everything and as the system role", async () => {
      const seen = await runAsSystem("test", () =>
        single.transaction(async (m) => ({
          role: await roleOf(m),
          labels: await readers["raw query"](m),
        })),
      );
      expect(seen).toEqual({ role: SYSTEM_ROLE, labels: everyLabel });
      expect(await readers["raw query"](single.manager)).toEqual([]);
      expect(await roleOf(single)).toBe(ROLE);
    });

    it("system and no context are different states: one statement to switch, none on repeat", async () => {
      await orgOf(single); // no context
      sent.length = 0;
      await runAsSystem("test", () => single.query("SELECT 1"));
      expect(setCount()).toBe(1);
      expect(sent.filter((t) => t.includes("set_config(")).length).toBe(1);
      sent.length = 0;
      await runAsSystem("test", () => single.query("SELECT 1"));
      await runAsSystem("test", () => single.transaction((m) => m.query("SELECT 2")));
      expect(setCount()).toBe(0);
      await single.query("SELECT 1");
      expect(setCount()).toBe(1);
      sent.length = 0;
      await single.query("SELECT 1");
      expect(setCount()).toBe(0);
    });

    it("refuses system and no context on one held runner", async () => {
      const runner = single.createQueryRunner();
      try {
        await runAsSystem("test", () => runner.query("SELECT 1"));
        await expect(runner.query("SELECT 1")).rejects.toThrow(
          "cannot change organization context",
        );
      } finally {
        await runner.release();
      }
    });

    it("refuses a query from a second context on a held runner", async () => {
      const [a, b] = orgs;
      const runner = single.createQueryRunner();
      try {
        const SHOW_ORG = "SELECT current_setting('app.organization_id', true) AS org";
        const seen = await runInOrganization(a, () => runner.query(SHOW_ORG));
        expect(seen[0].org).toBe(a);

        await expect(runInOrganization(b, () => runner.query(SHOW_ORG))).rejects.toThrow(
          "cannot change organization context",
        );
        await expect(runner.query(SHOW_ORG)).rejects.toThrow("cannot change organization context");

        const again = await runInOrganization(a, () => runner.query(SHOW_ORG));
        expect(again[0].org).toBe(a);
      } finally {
        await runner.release();
      }
    });

    it("a rolled back transaction does not corrupt the record", async () => {
      const [a, b] = orgs;
      expect(await runInOrganization(a, () => orgOf(single))).toBe(a);
      await expect(
        runInOrganization(b, () =>
          single.transaction(async (m) => {
            expect(await orgOf(m)).toBe(b);
            throw new Error("boom");
          }),
        ),
      ).rejects.toThrow("boom");
      // The record said b and the database still says b: no-context work corrects it, then a is applied.
      expect(await orgOf(single)).toBe("");
      expect(await runInOrganization(a, () => orgOf(single))).toBe(a);
      expect(await runInOrganization(b, () => orgOf(single))).toBe(b);
      expect(await orgOf(single)).toBe("");
    });

    it("work entering another organization inside an open transaction keeps the transaction's", async () => {
      const [a, b] = orgs;
      const seen = await runInOrganization(a, () =>
        single.transaction(async (m) => runInOrganization(b, () => orgOf(m))),
      );
      expect(seen).toBe(a);
      expect(await runInOrganization(b, () => orgOf(single))).toBe(b);
    });

    it("never sets inside a transaction, and sets once before the outermost BEGIN", async () => {
      const [a] = orgs;
      await orgOf(single); // record is empty
      sent.length = 0;
      await runInOrganization(a, () =>
        single.transaction(async (m) => {
          await m.query("SELECT 1");
          await m.query("SELECT 2");
        }),
      );
      const beginAt = sent.findIndex((t) => /^start transaction/i.test(t));
      expect(sent.map((t, i) => (t.includes("set_config") ? i : -1)).filter((i) => i >= 0)).toEqual(
        [beginAt - 1],
      );
      // Same organization again: nothing extra at all.
      sent.length = 0;
      await runInOrganization(a, () => single.transaction((m) => m.query("SELECT 1")));
      expect(setCount()).toBe(0);
    });

    it("raw BEGIN/ROLLBACK through query() cannot make the record wrong", async () => {
      const [a, b] = orgs;
      // Raw BEGIN sent in no context; entering an organization inside keeps the empty value.
      await withRunner(async (qr) => {
        await qr.query("BEGIN");
        expect(await runInOrganization(a, () => orgOf(qr.manager))).toBe("");
        await qr.query("ROLLBACK");
      });
      expect(await orgOnFreshRunner(a)).toBe(a);

      // Raw BEGIN under a; a set cannot have been undone by the ROLLBACK.
      await runInOrganization(a, () =>
        withRunner(async (qr) => {
          await qr.query("BEGIN");
          expect(await orgOf(qr.manager)).toBe(a);
          await qr.query("ROLLBACK");
        }),
      );
      expect(await orgOnFreshRunner(b)).toBe(b);
      expect(await orgOnFreshRunner()).toBe("");

      // Raw SAVEPOINT/COMMIT.
      await runInOrganization(b, () =>
        withRunner(async (qr) => {
          await qr.query("BEGIN");
          await qr.query("SAVEPOINT s1");
          await qr.query("ROLLBACK TO SAVEPOINT s1");
          await qr.query("COMMIT");
        }),
      );
      expect(await orgOnFreshRunner(a)).toBe(a);
      expect(await orgOf(single)).toBe("");
    });

    it("RESET ALL, DISCARD ALL and SET ROLE mark the record unknown", async () => {
      const [a] = orgs;
      for (const reset of ["RESET ALL", "DISCARD ALL", `SET ROLE ${ROLE}`]) {
        const qr = single.createQueryRunner();
        try {
          await runInOrganization(a, async () => {
            expect(await orgOf(qr.manager)).toBe(a);
            await qr.query(reset);
            expect(await orgOf(qr.manager)).toBe(a);
          });
        } finally {
          await qr.release();
        }
      }
    });

    it("a failed set throws, the statement does not run, and the next use re-applies", async () => {
      const [a, b] = orgs;
      expect(await runInOrganization(a, () => orgOf(single))).toBe(a);
      sent.length = 0;
      failNextSet = true;
      await expect(
        runInOrganization(b, () => single.query("SELECT 'marker-should-not-run'")),
      ).rejects.toThrow(/injected/);
      expect(sent.some((t) => t.includes("marker-should-not-run"))).toBe(false);
      expect(await runInOrganization(b, () => orgOf(single))).toBe(b);
      expect(await runInOrganization(a, () => orgOf(single))).toBe(a);
    });

    it("stream() goes through the same compare", async () => {
      const [a, b] = orgs;
      class FakeStream extends Query {}
      (single.driver as unknown as { loadStreamDependency: () => unknown }).loadStreamDependency =
        () => FakeStream;
      const read = (): Promise<string[]> =>
        withRunner(async (qr) => {
          const stream = await qr.stream(`SELECT label FROM ${TABLE}`);
          const rows: string[] = [];
          await new Promise<void>((resolve, reject) => {
            (stream as unknown as Query).on("row", (r: { label: string }) => rows.push(r.label));
            (stream as unknown as Query).on("end", () => resolve());
            (stream as unknown as Query).on("error", reject);
          });
          return rows.sort();
        });
      expect(await runInOrganization(a, read)).toEqual(own(a));
      expect(await runInOrganization(b, read)).toEqual(own(b));
      expect(await read()).toEqual([]);
    });
  });

  describe("extra statements per query (compare-on-use)", () => {
    const REQUESTS = 200;
    const QUERIES_PER_REQUEST = 6; // 4 plain + 2 inside one transaction
    // Deterministic organization choice per request.
    const many = [...orgs, ...Array.from({ length: 30 }, () => randomUUID())];
    const pick = (n: number, i: number) => many[(i * 7 + 3) % n];
    let big: DataSource;

    beforeAll(async () => {
      big = await new DataSource({
        ...base,
        username: ROLE,
        password: PASSWORD,
        poolSize: 10,
      }).initialize();
    });
    afterAll(async () => big?.destroy());

    const request = async (org: string) =>
      runInOrganization(org, async () => {
        await big.query("SELECT 1");
        await big.getRepository(ItemSchema).find();
        await big.transaction(async (m) => {
          await m.query("SELECT 1");
          await m.query("SELECT 2");
        });
        await big.query("SELECT 3");
        await big.query("SELECT 4");
      });

    const run = async (n: number, concurrency: number) => {
      const next = { i: 0 };
      sent.length = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next.i < REQUESTS) {
            const i = next.i++;
            await request(pick(n, i));
          }
        }),
      );
      return setCount();
    };

    for (const orgCount of [1, 5, 50]) {
      for (const concurrency of [1, 20]) {
        it(`${orgCount} orgs, pool 10, concurrency ${concurrency}`, async () => {
          await run(orgCount, concurrency); // warm the pool
          const extra = await run(orgCount, concurrency);
          const perQuery = extra / (REQUESTS * QUERIES_PER_REQUEST);
          console.log(
            `extra-statements orgs=${orgCount} pool=10 concurrency=${concurrency}: ${extra} extra over ${REQUESTS * QUERIES_PER_REQUEST} queries = ${perQuery.toFixed(3)} per query`,
          );
          // The old design cost 2 extra statements for every non-transactional query.
          expect(perQuery).toBeLessThan(orgCount === 1 ? 0.01 : 1);
        });
      }
    }
  });

  it("changes nothing when not installed", async () => {
    uninstall();
    try {
      const [a] = orgs;
      // A fresh connection: pooled ones may still carry a value applied while installed.
      const fresh = await new DataSource({
        ...base,
        username: ROLE,
        password: PASSWORD,
        poolSize: 1,
      }).initialize();
      try {
        expect(await runInOrganization(a, () => readers["raw query"](fresh.manager))).toEqual([]);
      } finally {
        await fresh.destroy();
      }
      expect(installOrganizationContextHook(false)()).toBeUndefined();
    } finally {
      uninstall = installOrganizationContextHook(true);
    }
  });
});
