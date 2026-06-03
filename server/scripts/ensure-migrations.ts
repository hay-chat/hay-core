#!/usr/bin/env node
import { DataSource } from "typeorm";
import { AppDataSource } from "../database/data-source";

async function ensureMigrations() {
  let dataSource: DataSource | null = null;

  try {
    console.log("🔍 Checking migration status...");

    dataSource = await AppDataSource.initialize();

    const hasPendingMigrations = await dataSource.showMigrations();

    if (hasPendingMigrations) {
      console.log("📦 Found pending migrations. Running migrations...");
      await dataSource.runMigrations();
      console.log("✅ Migrations completed successfully");
    } else {
      console.log("✅ All migrations are up to date");
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not exist")) {
      console.log("🗄️  Database or migrations table not found. Running initial migrations...");
      try {
        if (dataSource) {
          await dataSource.runMigrations();
          console.log("✅ Initial migrations completed successfully");
          process.exit(0);
        }
      } catch (runError) {
        console.error("❌ Failed to run initial migrations:", runError);
        process.exit(1);
      }
    } else {
      console.error("❌ Migration check failed:", error);
      process.exit(1);
    }
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

ensureMigrations();
