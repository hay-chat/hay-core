import "reflect-metadata";
import { AppDataSource } from "./database/data-source";

async function runMigrations() {
  try {
    await AppDataSource.initialize();
    console.log("✅ Database connected");
    
    console.log("\n📋 Running migrations...");
    const migrations = await AppDataSource.runMigrations();
    
    if (migrations.length === 0) {
      console.log("No new migrations to run.");
    } else {
      console.log(`Successfully ran ${migrations.length} migration(s):`);
      migrations.forEach(m => {
        console.log(`  ✓ ${m.name}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error running migrations:", error);
    process.exit(1);
  }
}

runMigrations();