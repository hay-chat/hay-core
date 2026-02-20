import dotenv from "dotenv";
import path from "path";

// Load environment variables
// In production, the compiled code is in server/dist/config, so we need to go up 3 levels to project root
// In development, the source is in server/config, so we need to go up 2 levels to project root
// Try to find .env file up to 4 levels above __dirname
let envPath: string | null = null;
for (let i = 1; i <= 4; i++) {
  const tryPath = path.resolve(__dirname, Array(i).fill("..").join("/"), ".env");
  if (require("fs").existsSync(tryPath)) {
    envPath = tryPath;
    break;
  }
}
// Fallback to .env at project root even if not found, for backward compatibility
dotenv.config({ path: envPath || path.resolve(__dirname, "../../../../.env") });

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
    base: process.env.BASE_DOMAIN || (process.env.NODE_ENV === "development" ? "localhost" : ""),
    protocol: process.env.APP_PROTOCOL || "http",
    // Service-specific domains - required in production
    api: process.env.API_DOMAIN || (process.env.NODE_ENV === "development" ? "localhost:3001" : ""),
    dashboard:
      process.env.DASHBOARD_DOMAIN ||
      (process.env.NODE_ENV === "development" ? "localhost:3000" : ""),
    cdn: process.env.CDN_DOMAIN || "",
    useSSL: process.env.USE_SSL === "true" || process.env.NODE_ENV === "production",
  },

  cors: {
    origin:
      process.env.CORS_ORIGIN?.split(",") ||
      (() => {
        const useSSL = process.env.USE_SSL === "true" || process.env.NODE_ENV === "production";
        const protocol = useSSL ? "https" : "http";

        // Build dynamic CORS origins
        const origins: string[] = [];

        // Development localhost origins
        if (process.env.NODE_ENV === "development") {
          origins.push(
            "http://localhost:3000",
            "http://localhost:3001",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
            "http://127.0.0.1:5173",
          );
        }

        // Add configured domains (required in production)
        if (process.env.BASE_DOMAIN) {
          origins.push(`${protocol}://${process.env.BASE_DOMAIN}`);
        }
        if (process.env.DASHBOARD_DOMAIN) {
          origins.push(`${protocol}://${process.env.DASHBOARD_DOMAIN}`);
        }
        if (process.env.API_DOMAIN) {
          origins.push(`${protocol}://${process.env.API_DOMAIN}`);
        }

        return origins;
      })(),
    credentials: true,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10), // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || "debug",
    debug: process.env.DEBUG === "true",
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
    secret: process.env.JWT_SECRET || "",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },

  orchestrator: {
    interval: parseInt(process.env.ORCHESTRATOR_INTERVAL || "5000", 10),
  },

  conversation: {
    cooldownInterval: parseInt(process.env.CONVERSATION_COOLDOWN_INTERVAL || "10000", 10),
    inactivityInterval: parseInt(process.env.CONVERSATION_INACTIVITY_INTERVAL || "1800000", 10),
  },

  staleMessageDetection: {
    enabled: process.env.STALE_MESSAGE_DETECTION_ENABLED !== "false",
    thresholdMs: 30000, // Fixed: 30 seconds
    checkIntervalMs: 5000, // Fixed: 5 seconds
    maxRecoveryAttempts: 5, // Fixed: 5 attempts before escalation
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
    // Automatically disable SMTP in test environment (unless explicitly enabled via SMTP_ENABLED=true)
    // In other environments, require explicit SMTP_ENABLED=true to send emails
    enabled: process.env.NODE_ENV === "test" ? false : process.env.SMTP_ENABLED === "true",
  },

  storage: {
    local: {
      uploadDir: process.env.LOCAL_UPLOAD_PATH || "./server/uploads",
      get baseUrl() {
        return `${getApiUrl()}/uploads`;
      },
    },
    s3: {
      endpoint: process.env.S3_ENDPOINT || null,
      region: process.env.S3_REGION || null,
      bucket: process.env.S3_BUCKET || null,
      accessKeyId: process.env.S3_ACCESS_KEY_ID || null,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || null,
    },
    limits: {
      maxFileSize: parseInt(process.env.UPLOAD_MAX_SIZE_MB || "10", 10) * 1024 * 1024,
    },
  },

  privacy: {
    downloadIpRestriction: process.env.PRIVACY_DOWNLOAD_IP_RESTRICTION === "true",
    maxDownloadCount: parseInt(process.env.PRIVACY_MAX_DOWNLOAD_COUNT || "1", 10),
    exportRetentionDays: parseInt(process.env.PRIVACY_EXPORT_RETENTION_DAYS || "7", 10),
    verificationExpiryHours: parseInt(process.env.PRIVACY_VERIFICATION_EXPIRY_HOURS || "24", 10),
  },

  plugins: {
    maxUploadSizeMB: parseInt(process.env.PLUGIN_MAX_UPLOAD_SIZE_MB || "50", 10),
    allowCustomPlugins: process.env.ALLOW_CUSTOM_PLUGINS !== "false",
  },
} as const;

export type Config = typeof config;

/**
 * Helper functions to get full URLs for services
 */
export function getProtocol(): "http" | "https" {
  return config.domain.useSSL ? "https" : "http";
}

export function getWebSocketProtocol(): "ws" | "wss" {
  return config.domain.useSSL ? "wss" : "ws";
}

export function getApiUrl(): string {
  return `${getProtocol()}://${config.domain.api}`;
}

export function getWebSocketUrl(): string {
  return `${getWebSocketProtocol()}://${config.domain.api}/ws`;
}

export function getDashboardUrl(): string {
  // Remove protocol if accidentally included in domain config
  const domain = config.domain.dashboard.replace(/^https?:\/\//, "");
  return `${getProtocol()}://${domain}`;
}

export function getCdnUrl(): string {
  // Remove protocol if accidentally included in domain config
  const domain = config.domain.cdn.replace(/^https?:\/\//, "");
  return `${getProtocol()}://${domain}`;
}

const JWT_MIN_LENGTH = 32;

const KNOWN_INSECURE_DEFAULTS = [
  "default-secret-change-in-production",
  "default-refresh-secret-change-in-production",
  "your-secret-key-change-in-production",
  "your-refresh-secret-change-in-production",
  "secret",
  "changeme",
];

/**
 * Validates that JWT secrets meet minimum security requirements.
 * Enforced in ALL environments (except test) to prevent insecure defaults.
 * Throws an error at startup if secrets are missing, too short, or use known defaults.
 *
 * Generate secure secrets with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
 */
export function validateJwtSecrets(): void {
  if (config.isTest) {
    return;
  }

  const errors: string[] = [];

  for (const [label, value] of [
    ["JWT_SECRET", config.jwt.secret],
    ["JWT_REFRESH_SECRET", config.jwt.refreshSecret],
  ] as const) {
    if (!value) {
      errors.push(`${label} is required but not set.`);
      continue;
    }

    if (KNOWN_INSECURE_DEFAULTS.includes(value)) {
      errors.push(`${label} is using an insecure default value. Generate a secure random string.`);
      continue;
    }

    if (value.length < JWT_MIN_LENGTH) {
      errors.push(
        `${label} must be at least ${JWT_MIN_LENGTH} characters (current: ${value.length}).`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `JWT secret validation failed:\n` +
        `  ${errors.join("\n  ")}\n\n` +
        `Generate secure secrets with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`,
    );
  }
}

/**
 * Validates that required environment variables are set in production.
 * Throws an error if any required variables are missing.
 * Should be called at application startup.
 */
export function validateProductionConfig(): void {
  // JWT secrets are validated in all environments (except test)
  validateJwtSecrets();

  if (config.env === "development" || config.env === "test") {
    return;
  }

  const missingVars: string[] = [];

  if (!config.domain.api) {
    missingVars.push("API_DOMAIN");
  }
  if (!config.domain.dashboard) {
    missingVars.push("DASHBOARD_DOMAIN");
  }
  if (!config.openai.apiKey) {
    missingVars.push("OPENAI_API_KEY");
  }

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables for production:\n` +
        `  ${missingVars.join("\n  ")}\n\n` +
        `Please set these variables in your .env file or environment.`,
    );
  }
}
