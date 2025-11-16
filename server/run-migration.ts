import { AppDataSource } from "./database/data-source";

async function runMigration() {
  try {
    await AppDataSource.initialize();
    console.log("✅ Database connected");

    await AppDataSource.query('ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL');
    console.log("✅ Migration successful: user_id column is now nullable");

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
