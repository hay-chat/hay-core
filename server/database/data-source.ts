import { DataSource } from "typeorm";
import { User } from "../entities/user.entity";
import { ApiKey } from "../entities/apikey.entity";
import { Organization } from "../entities/organization.entity";
import { Document } from "../entities/document.entity";
import { Job } from "../entities/job.entity";
import { Session } from "../entities/session.entity";
import { config } from "../config/env";
import "reflect-metadata";

export const AppDataSource = new DataSource({
  type: config.database.type,
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password,
  database: config.database.database,
  synchronize: config.database.synchronize,
  logging: config.database.logging,
  entities: [User, ApiKey, Organization, Document, Job, Session],
  migrations: ["./database/migrations/*.ts"],
  subscribers: [],
});

// Initialize the data source
export async function initializeDatabase() {
  try {
    await AppDataSource.initialize();

    // Enable pgvector extension if not already enabled
    await AppDataSource.query("CREATE EXTENSION IF NOT EXISTS vector");

    console.log("✅ Database connection established");
    console.log("✅ pgvector extension enabled");
    return true;
  } catch (error) {
    console.error("❌ Error during Data Source initialization:", error);
    console.warn(
      "⚠️  Running without database connection - authentication will not work properly"
    );
    return false;
  }
}
