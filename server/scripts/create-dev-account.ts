#!/usr/bin/env node
/**
 * Local development login: a verified user that owns an organization with the
 * default plugins enabled, so a fresh checkout can sign in (and point the `hay`
 * CLI at it) without going through sign-up. `npm run setup` runs it. Safe to
 * run again: an existing account is left as it is.
 *
 * Refuses to run unless NODE_ENV=development and the database is on this
 * machine, because the password is public.
 *
 *   npm run dev:account
 */
import { AppDataSource } from "../database/data-source";
import { config } from "../config/env";
import { User } from "../entities/user.entity";

const DEV_ACCOUNT = {
  email: "dev@hay.local",
  password: "hay-dev-password",
  organizationName: "Hay Dev",
};

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function main() {
  const dbHost = process.env.DB_HOST || "localhost";
  if (!config.isDevelopment || !LOCAL_DB_HOSTS.has(dbHost)) {
    throw new Error(
      `Refusing to create the dev account (NODE_ENV=${config.env}, DB_HOST=${dbHost}): ` +
        "it needs NODE_ENV=development and a local database.",
    );
  }

  await AppDataSource.initialize();
  const existing = await AppDataSource.getRepository(User).findOne({
    where: { email: DEV_ACCOUNT.email },
  });

  if (existing) {
    console.log(`Dev account ${DEV_ACCOUNT.email} already exists.`);
  } else {
    const { createAccount } = await import("../services/account-registration.service");
    const { pluginManagerService } = await import("../services/plugin-manager.service");
    const { enableDefaultPlugins } = await import("../services/default-plugins.service");

    const { organization } = await AppDataSource.transaction((manager) =>
      createAccount(manager, {
        email: DEV_ACCOUNT.email,
        password: DEV_ACCOUNT.password,
        firstName: "Dev",
        organizationName: DEV_ACCOUNT.organizationName,
        emailVerified: true,
      }),
    );
    await pluginManagerService.initialize();
    const enabled = await enableDefaultPlugins(organization!.id);
    console.log(
      `Created dev account ${DEV_ACCOUNT.email} (organization ${organization!.id}); ` +
        `default plugins: ${enabled.join(", ") || "(none)"}`,
    );
  }

  await AppDataSource.destroy();
}

main().catch((error) => {
  console.error("Creating the dev account failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
