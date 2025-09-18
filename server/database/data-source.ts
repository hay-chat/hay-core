import { DataSource } from "typeorm";
import { User } from "../entities/user.entity";
import { ApiKey } from "../entities/apikey.entity";
import { Organization } from "../entities/organization.entity";
import { Document } from "../entities/document.entity";
import { Job } from "../entities/job.entity";
import { Session } from "../entities/session.entity";
import { Embedding } from "../entities/embedding.entity";
import { Agent } from "./entities/agent.entity";
import { Playbook } from "./entities/playbook.entity";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { Customer } from "./entities/customer.entity";
import { PluginRegistry } from "../entities/plugin-registry.entity";
import { PluginInstance } from "../entities/plugin-instance.entity";
import { SnakeNamingStrategy } from "./naming-strategy";
import { config } from "../config/env";
import "reflect-metadata";

export const AppDataSource = new DataSource({
  type: config.database.type,
  host: config.database.host,
  port: config.database.port,
  username: config.database.username,
  password: config.database.password,
  database: config.database.database,
  synchronize: false, // IMPORTANT: Never use synchronize in production, always use migrations
  logging: false, // Disable verbose logging
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  entities: [
    User,
    ApiKey,
    Organization,
    Document,
    Job,
    Session,
    Embedding,
    Agent,
    Playbook,
    Conversation,
    Message,
    Customer,
    PluginRegistry,
    PluginInstance,
  ],
  migrations: __filename.includes("dist")
    ? [__dirname + "/migrations/*.js"] // Production: compiled JS files in same relative location
    : ["./database/migrations/*.ts"], // Development: TypeScript files
  subscribers: [],
  namingStrategy: new SnakeNamingStrategy(),
});

// Initialize the data source
export async function initializeDatabase() {
  // Log database configuration for debugging
  console.log("🔍 Database Configuration:");
  console.log("  - Type:", config.database.type);
  console.log("  - Host:", config.database.host);
  console.log("  - Port:", config.database.port);
  console.log("  - Database:", config.database.database);
  console.log("  - Username:", config.database.username);
  console.log("  - SSL:", config.database.ssl);
  console.log("  - Connection Timeout:", config.database.connectionTimeout, "ms");
  console.log("  - Max Connections:", config.database.maxConnections);

  try {
    console.log("🔄 Attempting to connect to database...");
    await AppDataSource.initialize();

    // Enable required extensions if not already enabled
    console.log("🔄 Enabling database extensions...");
    await AppDataSource.query("CREATE EXTENSION IF NOT EXISTS vector");
    await AppDataSource.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    console.log("✅ Database connection established");
    console.log("✅ pgvector and pgcrypto extensions enabled");
    return true;
  } catch (error) {
    console.error("❌ Error during Data Source initialization:");

    // Log detailed error information
    interface DbError extends Error {
      code?: string;
      errno?: number;
      syscall?: string;
      address?: string;
      port?: number;
    }

    if (error instanceof Error) {
      const dbError = error as DbError;
      console.error("  - Error message:", dbError.message);
      console.error("  - Error name:", dbError.name);
      if (dbError.code) {
        console.error("  - Error code:", dbError.code);
      }
      if (dbError.errno) {
        console.error("  - Error errno:", dbError.errno);
      }
      if (dbError.syscall) {
        console.error("  - Error syscall:", dbError.syscall);
      }
      if (dbError.address) {
        console.error("  - Error address:", dbError.address);
      }
      if (dbError.port) {
        console.error("  - Error port:", dbError.port);
      }
    } else {
      console.error("  - Full error:", error);
    }

    console.warn("⚠️  Running without database connection - authentication will not work properly");
    return false;
  }
}
