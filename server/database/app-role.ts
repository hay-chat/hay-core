import type { DataSource } from "typeorm";

/** Only this shape can reach the DDL below, which can't take bind parameters. */
export const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Creates the role if missing, otherwise resets its attributes. */
async function upsertRole(dataSource: DataSource, role: string, attributes: string): Promise<void> {
  const [{ exists }] = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
    [role],
  );
  await dataSource.query(`${exists ? "ALTER" : "CREATE"} ROLE "${role}" WITH ${attributes}`);
}

/** Table, sequence, function and default privileges shared by the app role and the system role. */
function privilegeStatements(role: string, database: string): string[] {
  return [
    `GRANT CONNECT ON DATABASE "${database}" TO "${role}"`,
    `GRANT USAGE ON SCHEMA public TO "${role}"`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`,
    `REVOKE INSERT, UPDATE, DELETE ON migrations FROM "${role}"`,
    `REVOKE DELETE ON audit_log_outbox FROM "${role}"`,
    `GRANT EXECUTE ON FUNCTION audit_logs_purge(timestamptz, timestamptz, boolean) TO "${role}"`,
    `GRANT EXECUTE ON FUNCTION audit_logs_verify_chain(uuid) TO "${role}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}"`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}"`,
  ];
}

/**
 * Creates (or updates) the role the application connects as: it can read and
 * write rows and run the two audit functions, and cannot change the schema,
 * triggers or migration history. Also creates `systemRole`, a NOLOGIN role
 * without BYPASSRLS that has the same privileges and that row-level security
 * policies can name. The app role may switch to it (SET ROLE) but does not
 * inherit it, so policies for the system role apply only while it is active.
 * Connect `dataSource` as the role that owns the tables, after migrations.
 * Safe to run after every migration.
 */
export async function provisionAppRole(
  dataSource: DataSource,
  role: string,
  password: string,
  systemRole: string,
): Promise<void> {
  if (!ROLE_NAME.test(role)) {
    throw new Error(`Invalid database role name: ${role}`);
  }
  if (!ROLE_NAME.test(systemRole)) {
    throw new Error(`Invalid database role name: ${systemRole}`);
  }
  if (role === systemRole) {
    throw new Error("The system database role must differ from the application role");
  }
  if (!password) {
    throw new Error("A password is required for the application database role");
  }
  await upsertRole(
    dataSource,
    role,
    `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${quoteLiteral(password)}`,
  );
  await upsertRole(
    dataSource,
    systemRole,
    "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS",
  );

  const [{ database }] = await dataSource.query(`SELECT current_database() AS database`);
  const statements = [
    ...privilegeStatements(role, database),
    ...privilegeStatements(systemRole, database),
    `GRANT "${systemRole}" TO "${role}"`,
  ];
  for (const statement of statements) {
    await dataSource.query(statement);
  }
}
