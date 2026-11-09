# Database Conventions

PostgreSQL 16 + pgvector, accessed through TypeORM. Read this before touching entities,
migrations, indexes or raw SQL.

## Naming

- **Database**: snake_case tables (plural) and columns: `site_pages`, `organization_id`, `created_at`.
- **TypeScript**: camelCase properties: `organizationId`, `createdAt`.
- `SnakeNamingStrategy` (`database/naming-strategy.ts`, wired in `database/data-source.ts`) converts
  between them. Don't pass `name:` to `@Column`; set the table name explicitly in `@Entity("table_name")`.
- Constraint/index names: `pk_<table>`, `fk_<table>_<target>`, `idx_<table>_<cols>`, `uq_<table>_<cols>`.
- Known deviation: `ActionLog` (`database/entities/action-log.entity.ts`) uses snake_case properties.
  Don't copy it.

## Entities

- Two directories, both in use: `server/entities/` (older core entities) and
  `server/database/entities/` (newer ones; put new entities here).
- Every entity is listed explicitly in the `entities` array of `database/data-source.ts`; add new ones there.
- Extend `BaseEntity` (uuid `id`, `createdAt`/`updatedAt` as `timestamptz`) or, for tenant data,
  `OrganizationScopedEntity` (`entities/base.entity.ts`), which adds `organizationId`.
- Org-scoped reads by id go through `findByIdAndOrganization(id, organizationId)`, never `findById`
  followed by a manual `organizationId` check.
- `synchronize` is always `false`. Schema only changes through migrations.

### jsonb

Type jsonb columns with a real TypeScript type, not `any`:

```ts
@Column({ type: "jsonb", default: () => "'[]'" })
orderRefs!: string[];

@Column({ type: "jsonb", nullable: true })
result?: Record<string, unknown>;
```

### Indexes

Every index created in a migration is mirrored on the entity with `@Index`, using the same name, so
`migration:generate` doesn't try to drop or recreate it:

```ts
@Index("uq_site_pages_org_url", ["organizationId", "url"], { unique: true })
```

## Migrations

- Location: `server/database/migrations/<timestamp>-<PascalName>.ts`. The timestamp is epoch
  milliseconds and must be greater than every existing one; the class is `<PascalName><timestamp>` and
  sets `name` to the same string.
- Hand-write SQL with `queryRunner.query`. Review anything from `migration:generate` before keeping it.
- Make them idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `DROP ... IF EXISTS`. Always provide a working `down`.
- **Migrations are run by hand after deploy.** Production deploys every merge to `master`
  automatically, and the new code runs before its migration does. Code must keep working while a
  migration is pending: add columns as nullable or with defaults, don't read a new column/table on a
  path that would fail without it, and drop or rename old columns only in a later release once nothing
  reads them. If a change can't meet this, say so in the PR's deploy notes.
- Never rename or edit a migration that has been applied.
- Backfills on large tables run in batches, each in its own transaction, so one `UPDATE` doesn't
  hold row locks and WAL for the whole table. `HardenAuditLogs` (1793292146423) predates this and
  backfills `audit_logs` in one statement: on a large table, run it in a quiet window.
- A migration whose `down` can't restore data says so in the PR's deploy notes.
  `ReplaceAgentsWithOrgAssistant` (1793700000000) drops `agents` and `playbook_agents`; its `down`
  brings back schema only, so take a backup before applying it and restore from that to roll back.
- Known duplicate timestamps (already applied; leave them as they are, TypeORM tracks them by class
  name): `1761000000000` (AddMultiOrganizationSupport, CreatePrivacyRequestsAndUserDeletion),
  `1781100000000` (AddEditorDocuments, ConvertConversationChannelToVarchar), `1784500000000`
  (AddOrganizationAgentPause, AddPushSubscriptions). Don't add new ones.

```bash
cd server
npm run migration:show                       # status
npm run migration:run                        # apply pending
npm run migration:revert                     # revert the last one
npm run migration:generate -- ./database/migrations/Name   # draft from entity diff
```

## Raw SQL

- Raw SQL uses snake_case column names.
- Values are always parameters: `$1, $2` in `query()`, `:name` in QueryBuilder. Never interpolate
  values into SQL strings.
- Identifiers (column/relation names) can't be parameters. When one is dynamic (filters, sort,
  search fields), validate it with `assertSafeIdentifier(name, context)` from
  `repositories/base.repository.ts` before interpolating it, or map it from a fixed allow-list.

```ts
await queryRunner.query(`SELECT id FROM documents WHERE organization_id = $1 AND status = $2`, [
  organizationId,
  status,
]);
```
