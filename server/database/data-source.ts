import fs from "fs";
import { DataSource } from "typeorm";
import { User } from "../entities/user.entity";
import { ApiKey } from "../entities/apikey.entity";
import { Organization } from "../entities/organization.entity";
import { UserOrganization } from "../entities/user-organization.entity";
import { OrganizationInvitation } from "../entities/organization-invitation.entity";
import { Document } from "../entities/document.entity";
import { DocumentSource } from "../entities/document-source.entity";
import { Job } from "../entities/job.entity";
import { Session } from "../entities/session.entity";
import { Embedding } from "../entities/embedding.entity";
import { Playbook } from "./entities/playbook.entity";
import { PlaybookVersion } from "./entities/playbook-version.entity";
import { Conversation } from "./entities/conversation.entity";
import { Message } from "./entities/message.entity";
import { Customer } from "./entities/customer.entity";
import { Source } from "./entities/source.entity";
import { MessageFeedback } from "./entities/message-feedback.entity";
import { PluginRegistry } from "../entities/plugin-registry.entity";
import { PluginInstance } from "../entities/plugin-instance.entity";
import { PluginWebhookRoute } from "../entities/plugin-webhook-route.entity";
import { AuditLog } from "../entities/audit-log.entity";
import { PrivacyRequest } from "../entities/privacy-request.entity";
import { Upload } from "../entities/upload.entity";
import { ScheduledJob } from "../entities/scheduled-job.entity";
import { ScheduledJobHistory } from "../entities/scheduled-job-history.entity";
import { WebchatSettings } from "./entities/webchat-settings.entity";
import { AuthCode } from "../entities/auth-code.entity";
import { GitConnection } from "../entities/git-connection.entity";
import { Product } from "../entities/product.entity";
import { ProductVariant } from "../entities/product-variant.entity";
import { ProductEmbedding } from "../entities/product-embedding.entity";
import { ConversationTakeoverEvent } from "./entities/conversation-takeover-event.entity";
import { ConversationOutcome } from "./entities/conversation-outcome.entity";
import { OperatorEventRecord } from "./entities/operator-event.entity";
import { SitePage } from "./entities/site-page.entity";
import { UserMfa } from "./entities/user-mfa.entity";
import { InsightIssue } from "./entities/insight-issue.entity";
import { PushSubscription } from "./entities/push-subscription.entity";
import { NotificationDelivery } from "./entities/notification-delivery.entity";
import { ActionLog } from "./entities/action-log.entity";
import { SimulationRun } from "./entities/simulation-run.entity";
import { SimulationRunItem } from "./entities/simulation-run-item.entity";
import { TestTranscript } from "./entities/test-transcript.entity";
import { TestCase } from "./entities/test-case.entity";
import { PendingAction } from "./entities/pending-action.entity";
import { BusinessHoursSchedule } from "./entities/business-hours-schedule.entity";
import { OrderConversationLink } from "./entities/order-conversation-link.entity";
import { Dispute } from "./entities/dispute.entity";
import { PluginState } from "./entities/plugin-state.entity";
import { EmailSendingDomain } from "./entities/email-sending-domain.entity";
import { CustomerMergeDismissal } from "./entities/customer-merge-dismissal.entity";
import { TeamQuestion } from "./entities/team-question.entity";
import { MessageDelivery } from "./entities/message-delivery.entity";
import { OrderLinkMessageSubscriber } from "./subscribers/order-link-message.subscriber";
import { SnakeNamingStrategy } from "./naming-strategy";
import { config, databaseTlsError } from "../config/env";
import { createLogger } from "@server/lib/logger";
import "reflect-metadata";

const logger = createLogger("database");

/**
 * TLS options for the Postgres connection. With DB_SSL_CA (PEM text or a path
 * to a PEM file) the server certificate is verified; without it the link is
 * encrypted but unverified, which only local and private-network hosts allow.
 */
export function buildSslOptions(
  ssl: boolean,
  sslCa: string,
): false | { rejectUnauthorized: boolean; ca?: string } {
  const tlsError = databaseTlsError();
  if (tlsError) {
    throw new Error(tlsError);
  }
  if (!ssl) {
    return false;
  }
  if (!sslCa) {
    return { rejectUnauthorized: false };
  }
  const ca = sslCa.includes("-----BEGIN") ? sslCa : fs.readFileSync(sslCa, "utf8");
  return { rejectUnauthorized: true, ca };
}

/** The TypeORM migration CLI and migration:check load this file too; they need the owner role and no query limits. */
const isMigrationProcess = process.argv.some(
  (arg) => arg.startsWith("migration:") || /ensure-migrations\.[jt]s$/.test(arg),
);
const useMigratorRole = isMigrationProcess && !!config.database.migratorUsername;

const connectionOptions = ["-c hnsw.iterative_scan=relaxed_order"];
if (!isMigrationProcess) {
  connectionOptions.push(
    `-c statement_timeout=${config.database.statementTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${config.database.idleInTransactionTimeoutMs}`,
  );
}

export const AppDataSource = new DataSource({
  type: config.database.type,
  host: config.database.host,
  port: config.database.port,
  username: useMigratorRole ? config.database.migratorUsername : config.database.username,
  password: useMigratorRole ? config.database.migratorPassword : config.database.password,
  database: config.database.database,
  synchronize: false, // IMPORTANT: Never use synchronize in production, always use migrations
  logging: false, // Disable verbose logging
  ssl: buildSslOptions(config.database.ssl, config.database.sslCa),
  poolSize: config.database.maxConnections,
  connectTimeoutMS: config.database.connectionTimeout,
  // hnsw.iterative_scan: keeps probing the HNSW graph until LIMIT is satisfied
  // post-filter (e.g. WHERE organization_id = ...). Required for correct top-K
  // results on small tenants. Available in pgvector ≥ 0.8.
  extra: {
    options: connectionOptions.join(" "),
  },
  entities: [
    User,
    ApiKey,
    Organization,
    UserOrganization,
    OrganizationInvitation,
    Document,
    DocumentSource,
    Job,
    Session,
    Embedding,
    Playbook,
    PlaybookVersion,
    Conversation,
    Message,
    Customer,
    Source,
    MessageFeedback,
    PluginRegistry,
    PluginInstance,
    PluginWebhookRoute,
    AuditLog,
    PrivacyRequest,
    Upload,
    ScheduledJob,
    ScheduledJobHistory,
    WebchatSettings,
    AuthCode,
    GitConnection,
    Product,
    ProductVariant,
    ProductEmbedding,
    ConversationTakeoverEvent,
    PushSubscription,
    NotificationDelivery,
    ConversationOutcome,
    InsightIssue,
    ActionLog,
    PendingAction,
    BusinessHoursSchedule,
    OrderConversationLink,
    Dispute,
    PluginState,
    EmailSendingDomain,
    CustomerMergeDismissal,
    TeamQuestion,
    MessageDelivery,
    SimulationRun,
    SimulationRunItem,
    TestTranscript,
    TestCase,
    OperatorEventRecord,
    SitePage,
    UserMfa,
  ],
  migrations: __filename.includes("dist")
    ? [__dirname + "/migrations/*.js"] // Production: compiled JS files in same relative location
    : ["./database/migrations/*.ts"], // Development: TypeScript files
  subscribers: [OrderLinkMessageSubscriber],
  namingStrategy: new SnakeNamingStrategy(),
});

// Initialize the data source with retry mechanism
export async function initializeDatabase(maxRetries = 3, retryDelay = 2000) {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info({ attempt, maxRetries }, "Attempting database connection");
      await AppDataSource.initialize();
      logger.info("Database connection established");
      return true;
    } catch (error) {
      lastError = error;
      logger.error({ err: error, attempt, maxRetries }, "Database connection attempt failed");

      // If this wasn't the last attempt, wait before retrying
      if (attempt < maxRetries) {
        logger.info({ retryDelaySeconds: retryDelay / 1000 }, "Retrying database connection");
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  // All retries failed
  logger.error(
    { maxRetries },
    "Failed to connect to database after all attempts. Database connection is required. Please check your configuration and ensure PostgreSQL is running.",
  );

  // Throw the last error to prevent server from starting
  throw lastError;
}
