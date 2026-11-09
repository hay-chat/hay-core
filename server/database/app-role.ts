import type { DataSource } from "typeorm";

/** Only this shape can reach the DDL below, which can't take bind parameters. */
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Creates (or updates) the role the application connects as: it can read and
 * write rows and run the two audit functions, and cannot change the schema,
 * triggers or migration history. Connect `dataSource` as the role that owns the
 * tables, after migrations. Safe to run after every migration.
 */
export async function provisionAppRole(
  dataSource: DataSource,
  role: string,
  password: string,
): Promise<void> {
  if (!ROLE_NAME.test(role)) {
    throw new Error(`Invalid database role name: ${role}`);
  }
  if (!password) {
    throw new Error("A password is required for the application database role");
  }
  const [{ exists }] = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
    [role],
  );
  const attributes = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quoteLiteral(password)}`;
  await dataSource.query(`${exists ? "ALTER" : "CREATE"} ROLE "${role}" WITH ${attributes}`);

  const [{ database }] = await dataSource.query(`SELECT current_database() AS database`);
  const statements = [
    `GRANT CONNECT ON DATABASE "${database}" TO "${role}"`,
    `GRANT USAGE ON SCHEMA public TO "${role}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    `REVOKE INSERT, UPDATE, DELETE ON migrations FROM "${role}"`,
    `GRANT EXECUTE ON FUNCTION audit_logs_purge(timestamptz, timestamptz) TO "${role}"`,
    `GRANT EXECUTE ON FUNCTION audit_logs_verify_chain(uuid) TO "${role}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
  ];
  for (const statement of statements) {
    await dataSource.query(statement);
  }
}
