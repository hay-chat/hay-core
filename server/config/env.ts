import dotenv from "dotenv";
import path from "path";

// Load environment variables
// In production, the compiled code is in server/dist/server/config, so we need to go up 4 levels to project root
// In development, the source is in server/config, so we need to go up 2 levels to project root
const envPath = __dirname.includes("dist")
  ? path.resolve(__dirname, "../../../../.env") // Production: server/dist/server/config -> project root
  : path.resolve(__dirname, "../../.env"); // Development: server/config -> project root
dotenv.config({ path: envPath });

export const config = {
  env: process.env.NODE_ENV || "development",
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",

  server: {
    port: parseInt(process.env.PORT || "3001", 10),
    host: process.env.HOST || "localhost",
    wsPort: parseInt(process.env.WS_PORT || process.env.PORT || "3001", 10), // WebSocket port, defaults to same as server port
  },

  domain: {
    base:
      process.env.BASE_DOMAIN ||
      (process.env.NODE_ENV === "development" ? "hay.local" : "hay.chat"),
    protocol: process.env.APP_PROTOCOL || "http",
  },

  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") || [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
      "https://hay.chat",
      "https://app.hay.chat",
      "https://api.hay.chat",
      "https://ws.hay.chat",
    ],
    credentials: true,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10), // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || "debug",
  },

  organization: {
    extractionMethods: (process.env.ORGANIZATION_EXTRACTION_METHOD || "subdomain,header,jwt").split(
      ",",
    ),
    defaultOrganization: process.env.DEFAULT_ORGANIZATION || "default",
  },

  database: {
    type: "postgres" as const,
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    username: process.env.DB_USERNAME || "hay",
    password: process.env.DB_PASSWORD || "hay_password",
    database: process.env.DB_NAME || "hay_db",
    ssl: process.env.DB_SSL === "true",
    synchronize: false, // Never use synchronize in production
    logging: process.env.DB_LOGGING === "true",
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || "10", 10),
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || "60000", 10),
  },

  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  },

  jwt: {
    secret: process.env.JWT_SECRET || "default-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "default-refresh-secret-change-in-production",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },

  orchestrator: {
    interval: parseInt(process.env.ORCHESTRATOR_INTERVAL || "5000", 10),
  },

  conversation: {
    cooldownInterval: parseInt(process.env.CONVERSATION_COOLDOWN_INTERVAL || "10000", 10),
    inactivityInterval: parseInt(process.env.CONVERSATION_INACTIVITY_INTERVAL || "1800000", 10),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    models: {
      embedding: {
        model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
        dimensions: parseInt(process.env.EMBEDDING_DIM || "1536"),
        temperature: parseFloat(process.env.OPENAI_EMBEDDING_TEMPERATURE || "0.7"),
        maxTokens: parseInt(process.env.OPENAI_EMBEDDING_MAX_TOKENS || "2000"),
        organizationId: process.env.OPENAI_EMBEDDING_ORG_ID || "",
      },
      chat: {
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4o",
        temperature: parseFloat(process.env.OPENAI_CHAT_TEMPERATURE || "0.7"),
        maxTokens: parseInt(process.env.OPENAI_CHAT_MAX_TOKENS || "2000"),
        organizationId: process.env.OPENAI_CHAT_ORG_ID || "",
      },
    },
  },

  smtp: {
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_AUTH_USER || "",
      pass: process.env.SMTP_AUTH_PASS || "",
    },
    from: {
      email: process.env.SMTP_FROM_EMAIL || "noreply@updates.hay.chat",
      name: process.env.SMTP_FROM_NAME || "Hay",
    },
    enabled: process.env.SMTP_ENABLED === "true",
  },
} as const;

export type Config = typeof config;
