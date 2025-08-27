import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const config = {
  env: process.env.NODE_ENV || "development",
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",

  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    host: process.env.HOST || "localhost",
  },

  domain: {
    base:
      process.env.BASE_DOMAIN ||
      (process.env.NODE_ENV === "development" ? "hay.local" : "hay.ai"),
    protocol: process.env.APP_PROTOCOL || "http",
  },

  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
    credentials: true,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10), // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || "debug",
  },

  tenant: {
    extractionMethods: (
      process.env.TENANT_EXTRACTION_METHOD || "subdomain,header,jwt"
    ).split(","),
    defaultTenant: process.env.DEFAULT_TENANT || "default",
  },

  database: {
    type: "postgres" as const,
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    username: process.env.DB_USERNAME || "hay",
    password: process.env.DB_PASSWORD || "hay_password",
    database: process.env.DB_NAME || "hay_db",
    ssl: process.env.DB_SSL === "true",
    synchronize: true,
    logging: process.env.DB_LOGGING === "true",
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || "10", 10),
    connectionTimeout: parseInt(
      process.env.DB_CONNECTION_TIMEOUT || "60000",
      10
    ),
  },

  jwt: {
    secret: process.env.JWT_SECRET || "default-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ||
      "default-refresh-secret-change-in-production",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },
} as const;

export type Config = typeof config;
