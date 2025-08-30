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
  logging: config.database.logging,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
  entities: [User, ApiKey, Organization, Document, Job, Session, Embedding, Agent, Playbook, Conversation, Message],
  migrations: ["./database/migrations/*.ts"],
  subscribers: [],
});

// Initialize the data source
export async function initializeDatabase() {
  try {
    await AppDataSource.initialize();

    // Enable required extensions if not already enabled
    await AppDataSource.query("CREATE EXTENSION IF NOT EXISTS vector");
    await AppDataSource.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    console.log("✅ Database connection established");
    console.log("✅ pgvector and pgcrypto extensions enabled");
    return true;
  } catch (error) {
    console.error("❌ Error during Data Source initialization:", error);
    console.warn(
      "⚠️  Running without database connection - authentication will not work properly"
    );
    return false;
  }
}
