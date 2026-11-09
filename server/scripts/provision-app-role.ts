#!/usr/bin/env node
/**
 * Creates or updates the application's database role (DB_USERNAME) when
 * migrations run as a separate owner role (DB_MIGRATOR_USERNAME). Does nothing
 * when one role is used for everything. Run after migrations.
 */
import { DataSource } from "typeorm";
import { config } from "../config/env";
import { buildSslOptions } from "../database/data-source";
import { provisionAppRole } from "../database/app-role";

async function main(): Promise<void> {
  const { migratorUsername, migratorPassword, username, password } = config.database;
  if (!migratorUsername || migratorUsername === username) {
    console.log("DB_MIGRATOR_USERNAME is not set to a separate role; nothing to do");
    return;
  }
  const owner = new DataSource({
    type: "postgres",
    host: config.database.host,
    port: config.database.port,
    username: migratorUsername,
    password: migratorPassword,
    database: config.database.database,
    ssl: buildSslOptions(config.database.ssl, config.database.sslCa),
  });
  await owner.initialize();
  try {
    await provisionAppRole(owner, username, password);
    console.log(`Database role ${username} is up to date`);
  } finally {
    await owner.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
