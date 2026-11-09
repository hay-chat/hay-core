import dotenv from "dotenv";
import path from "path";
import { configuredEncryptionKeys } from "../lib/auth/utils/encryption-keys";

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
dotenv.config({ path: envPath || path.resolve(__dirname, "../../../../.env"), quiet: true });

/**
 * Normalize a configured domain to host[:port] form by stripping any leading
 * URL scheme. Domains are stored scheme-less because the protocol is applied
 * separately (getApiUrl/getProtocol); accepting a full URL here would otherwise
 * yield doubled schemes like "http://http://localhost:3001".
 */
function stripScheme(value: string): string {
  return value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

/**
 * S3_SERVER_SIDE_ENCRYPTION: AES256, aws:kms or none. Defaults to AES256 on AWS
 * only: other S3-compatible stores may reject the header.
 */
function s3ServerSideEncryption(): "AES256" | "aws:kms" | undefined {
  const setting = process.env.S3_SERVER_SIDE_ENCRYPTION;
  if (setting === "AES256" || setting === "aws:kms") return setting;
  if (setting === "none") return undefined;
  if (setting) throw new Error("S3_SERVER_SIDE_ENCRYPTION must be AES256, aws:kms or none");
  return process.env.S3_ENDPOINT?.includes("amazonaws.com") ? "AES256" : undefined;
}

export const config = {
  env: process.env.NODE_ENV || "development",
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",
  isTest: process.env.NODE_ENV === "test",

  server: {
    port: parseInt(process.env.PORT || "3001", 10),
    host: process.env.HOST || "localhost",
    // Reverse-proxy hops in front of the server (one reverse proxy = 1). The
    // client IP is read from X-Forwarded-For through this many proxies only,
    // so entries a client adds itself are ignored. 0 = clients connect directly.
    trustProxy: parseInt(
      process.env.TRUST_PROXY || (process.env.NODE_ENV === "production" ? "1" : "0"),
      10,
    ),
  },

  domain: {
    // Service domains are host[:port] only — the protocol is applied separately
    // by getApiUrl()/getProtocol(). Strip a leading scheme so a value like
    // "http://localhost:3001" doesn't produce a doubled "http://http://..." URL.
    base: stripScheme(
      process.env.BASE_DOMAIN || (process.env.NODE_ENV === "development" ? "localhost" : ""),
    ),
    protocol: process.env.APP_PROTOCOL || "http",
    // Service-specific domains - required in production
    api: stripScheme(
      process.env.API_DOMAIN || (process.env.NODE_ENV === "development" ? "localhost:3001" : ""),
    ),
    dashboard: stripScheme(
      process.env.DASHBOARD_DOMAIN ||
        (process.env.NODE_ENV === "development" ? "localhost:3000" : ""),
    ),
    cdn: stripScheme(process.env.CDN_DOMAIN || ""),
    useSSL: process.env.USE_SSL === "true" || process.env.NODE_ENV === "production",
  },

  // Prometheus endpoint, on its own port so no reverse proxy can reach it. A
  // host other than loopback also requires METRICS_TOKEN. Port 0 turns it off.
  metrics: {
    port: parseInt(process.env.METRICS_PORT || "9464", 10),
    host: process.env.METRICS_HOST || "127.0.0.1",
    token: process.env.METRICS_TOKEN || "",
  },

  // Trace export over OTLP/HTTP to a collector. Off unless an endpoint is set.
  // Request headers for the collector come from OTEL_EXPORTER_OTLP_HEADERS.
  otel: {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
    sampleRatio: Math.min(
      1,
      Math.max(0, Number.parseFloat(process.env.OTEL_TRACES_SAMPLE_RATIO || "0.05") || 0),
    ),
    serviceName: process.env.OTEL_SERVICE_NAME || "hay-server",
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

  webchat: {
    // Page tools (WebMCP): tools the host page registers in the browser for the
    // AI to call in the visitor's session. Set WEBCHAT_PAGE_TOOLS=false to turn
    // registration and dispatch off everywhere.
    pageTools: process.env.WEBCHAT_PAGE_TOOLS !== "false",
  },

  // Webchat under-attack mode (D9-10): more than `createThreshold` new
  // conversations for one org within `windowSeconds` challenges every visitor
  // for `hours`.
  underAttack: {
    createThreshold: parseInt(process.env.UNDER_ATTACK_CREATE_THRESHOLD || "30", 10),
    windowSeconds: 5 * 60,
    hours: parseInt(process.env.UNDER_ATTACK_HOURS || "4", 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    debug: process.env.DEBUG === "true",
  },

  database: {
    type: "postgres" as const,
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    username: process.env.DB_USERNAME || "hay",
    password: process.env.DB_PASSWORD || "hay_password",
    database: process.env.DB_NAME || "hay_db",
    ssl: process.env.DB_SSL === "true",
    // CA certificate (PEM text or a path to a PEM file) used to verify the
    // database server when DB_SSL=true. Without it the connection is encrypted
    // but the server certificate is not verified.
    sslCa: process.env.DB_SSL_CA || "",
    // Owner role for migrations. Unset: migrations run as DB_USERNAME (one role for everything).
    migratorUsername: process.env.DB_MIGRATOR_USERNAME || "",
    migratorPassword: process.env.DB_MIGRATOR_PASSWORD || "",
    statementTimeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "30000", 10),
    idleInTransactionTimeoutMs: parseInt(
      process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS || "60000",
      10,
    ),
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

  rabbitmq: {
    url: process.env.RABBITMQ_URL || "amqp://hay:hay_password@localhost:5672/",
  },

  // Root of the purpose-specific signing keys (lib/auth/utils/service-keys).
  serviceKey: process.env.HAY_SERVICE_KEY || "",

  jwt: {
    secret: process.env.JWT_SECRET || "",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "",
  },

  auth: {
    // Self-hosted installs without email delivery set this to "false" so new
    // signups are marked verified and can log in. Hosted Hay keeps the default.
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION !== "false",
    // "false" closes public signup: only the very first account (the instance
    // owner) and people with a pending invitation can register.
    allowSignup: process.env.ALLOW_SIGNUP !== "false",
    // Where people create an account when public signup is closed (hosted Hay:
    // the hay.chat onboarding). The signup page links there instead of a form.
    signupUrl: process.env.SIGNUP_URL?.trim() || null,
  },

  orchestrator: {
    interval: parseInt(process.env.ORCHESTRATOR_INTERVAL || "5000", 10),
  },

  // Web Push (VAPID). All three must be set for push alerts to be enabled;
  // otherwise `notifications.pushPublicKey` returns null and nothing is sent.
  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
    vapidSubject: process.env.VAPID_SUBJECT || "",
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
    /**
     * Base URL for every managed OpenAI call made with OPENAI_API_KEY: embeddings,
     * voice-note transcription, and default chat when LLM_BASE_URL is unset.
     * Empty = api.openai.com. Set to https://eu.api.openai.com/v1 (with a key from
     * an OpenAI EU data residency project) to keep that traffic in the EU.
     */
    baseUrl: process.env.OPENAI_BASE_URL || "",
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
      // Speech-to-text for inbound channel voice notes (`media.upload` with `transcribe`).
      transcription: {
        model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
      },
      // Vision pass on customer photos and PDFs (D8-11). Served by the EU endpoint
      // when configured, else the default OpenAI endpoint for every org (EU-only
      // orgs included: vision is not blocked while no EU inference exists).
      vision: {
        model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
      },
    },
  },

  /**
   * Process-wide chat defaults, used by the bundle the factory serves when a call
   * has no organizationId (crons, system tasks) and by any org that has not
   * configured its own provider. Leave unset to stay on OpenAI with OPENAI_API_KEY.
   *
   * Set all three to move every default call to another OpenAI-compatible host,
   * e.g. DigitalOcean Gradient:
   *   LLM_BASE_URL=https://inference.do-ai.run/v1
   *   LLM_VENDOR=custom-tools
   *   LLM_API_KEY=<DO model access key>
   *   LLM_TIER_HARD=deepseek-3.2
   *   LLM_TIER_MEDIUM=deepseek-4-flash
   *   LLM_TIER_EASY=deepseek-4-flash
   *
   * Embeddings deliberately ignore these — they stay on OPENAI_API_KEY, because
   * the vector column and HNSW index are pinned to EMBEDDING_DIM.
   */
  llm: {
    baseUrl: process.env.LLM_BASE_URL || "",
    vendor: process.env.LLM_VENDOR || "",
    apiKey: process.env.LLM_API_KEY || "",
    /** Tokens an organization's AI may use per UTC day before it hands off. 0 turns this off. */
    orgDailyTokenBudget: Number(process.env.LLM_ORG_DAILY_TOKEN_BUDGET ?? 20_000_000),
  },

  /**
   * Per-org AI processing region (Settings -> AI Models -> "EU only"). Orgs with
   * `settings.aiRegion = "eu"` send every chat, embedding and transcription call
   * here, never to the default bundle. Both values must be set for an org to be
   * able to turn EU on; until then the setting is refused.
   *
   * OpenAI EU data residency: create an EU project, then
   *   OPENAI_EU_BASE_URL=https://eu.api.openai.com/v1
   *   OPENAI_EU_API_KEY=<key from that project>
   * Optional tier overrides (default: OpenAI catalog tiers):
   *   OPENAI_EU_TIER_HARD / OPENAI_EU_TIER_MEDIUM / OPENAI_EU_TIER_EASY
   */
  aiRegion: {
    eu: {
      baseUrl: process.env.OPENAI_EU_BASE_URL || "",
      apiKey: process.env.OPENAI_EU_API_KEY || "",
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
      name: process.env.SMTP_FROM_NAME || "Hay.chat",
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
      // false for buckets with ACLs disabled; public folders then need a bucket policy.
      useAcls: process.env.S3_USE_ACLS !== "false",
      serverSideEncryption: s3ServerSideEncryption(),
    },
    limits: {
      maxFileSize: parseInt(process.env.UPLOAD_MAX_SIZE_MB || "10", 10) * 1024 * 1024,
      // Files sent in conversations (folder conversation-media): Meta allows
      // 16 MB video/audio and 100 MB documents. Plugins send base64 in a JSON
      // body limited to 50 MB, so keep this at or below 35.
      conversationMediaMaxFileSize:
        parseInt(process.env.CONVERSATION_MEDIA_MAX_SIZE_MB || "25", 10) * 1024 * 1024,
    },
    // D8-4: clamd for conversation documents; unset host = no scan.
    clamav: {
      host: process.env.CLAMAV_HOST || null,
      port: parseInt(process.env.CLAMAV_PORT || "3310", 10),
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
    // Organization-supplied (custom/git) plugin code; off unless explicitly enabled
    allowCustomPlugins: process.env.ALLOW_CUSTOM_PLUGINS === "true",
    // Organization-supplied UI bundles run in the dashboard's own page; off unless explicitly enabled
    allowCustomPluginUi: process.env.ALLOW_CUSTOM_PLUGIN_UI === "true",
    // Core plugins were compiled into the image: nothing to install or build at runtime
    prebuilt: process.env.PLUGINS_PREBUILT === "true",
  },

  // Telemetry is entirely optional: with no key the client is never constructed
  // and every capture call is a no-op, so local and self-hosted installs run
  // without PostHog and without network calls.
  posthog: {
    key: process.env.POSTHOG_KEY || "",
    host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com",
  },

  // Refuse new passwords found in known breaches (k-anonymity range lookup).
  passwordBreachCheck:
    process.env.PASSWORD_BREACH_CHECK !== "false" && process.env.NODE_ENV !== "test",

  // SameSite of the dashboard's refresh-token cookie. Keep "strict" when the
  // dashboard and API share a site (app.example.com + api.example.com); "none"
  // is only for a dashboard on a different registrable domain and needs HTTPS.
  authCookie: {
    sameSite: (["strict", "lax", "none"].includes(process.env.AUTH_COOKIE_SAME_SITE ?? "")
      ? process.env.AUTH_COOKIE_SAME_SITE
      : "strict") as "strict" | "lax" | "none",
  },

  // Server-to-server secret for the `internal.*` tRPC procedures (used by an
  // external operator, e.g. a hosted-plan backoffice, to suspend organizations).
  // Empty disables those procedures entirely — the default for self-hosting.
  authCodes: {
    // Refuse exchanges that do not name the destination the code was issued for.
    // Enable once every app calling exchangeAuthCode sends redirectUri.
    requireRedirectUri: process.env.AUTH_CODE_REQUIRE_REDIRECT_URI === "true",
  },

  internal: {
    apiSecret: process.env.INTERNAL_API_SECRET || "",
    // Still accepted during a rotation, then removed.
    previousApiSecret: process.env.INTERNAL_API_PREVIOUS_SECRET || "",
    // Refuse calls that only present the shared secret. Enable once the operator signs requests.
    requireSignature: process.env.INTERNAL_API_REQUIRE_SIGNATURE === "true",
    // Comma-separated client addresses; empty allows any.
    allowedIps: (process.env.INTERNAL_API_ALLOWED_IPS || "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
    // Where core POSTs signed events the operator may need to act on (for
    // example organization.deleted, so the operator can stop billing).
    // Empty disables them.
    operatorEventsUrl: process.env.OPERATOR_EVENTS_URL || "",
  },

  github: {
    appId: process.env.GITHUB_APP_ID || "",
    appPrivateKey: (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    appName: process.env.GITHUB_APP_NAME || "",
    webhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET || "",
  },

  scraper: {
    chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH || "",
    // DevTools URL of a separate browser (http://host:port). Set = never launch locally.
    chromeRemoteUrl: process.env.CHROME_REMOTE_URL || "",
    // Containers can't use Chromium's sandbox; everywhere else it stays on.
    chromeDisableSandbox: process.env.CHROME_DISABLE_SANDBOX === "true",
    puppeteerMaxConcurrent: parseInt(process.env.PUPPETEER_MAX_CONCURRENT || "3", 10),
    puppeteerTimeout: parseInt(process.env.PUPPETEER_TIMEOUT || "30000", 10),
  },

  customMenu: {
    items: (() => {
      const raw = process.env.CUSTOM_MENU;
      if (!raw)
        return [] as Array<{
          title: string;
          url: string;
          icon?: string;
          parent?: string;
          position?: number;
          external?: boolean;
          roles?: string[];
        }>;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as Array<{
          title: string;
          url: string;
          icon?: string;
          parent?: string;
          position?: number;
          external?: boolean;
          roles?: string[];
        }>;
      } catch {
        // eslint-disable-next-line no-console
        console.warn("CUSTOM_MENU env var contains invalid JSON, ignoring");
        return [];
      }
    })(),
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

  // Ensure access and refresh tokens use different signing keys
  if (
    config.jwt.secret &&
    config.jwt.refreshSecret &&
    config.jwt.secret === config.jwt.refreshSecret
  ) {
    errors.push(
      "JWT_SECRET and JWT_REFRESH_SECRET must be different to ensure token type separation.",
    );
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

const MIN_SECRET_LENGTH = 32;
const DEFAULT_DB_PASSWORD = "hay_password";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** A host reached over a network we don't control: not loopback, a private IP or a bare container name. */
export function isRemoteHost(host: string): boolean {
  return !LOCAL_HOSTS.has(host) && !PRIVATE_IPV4.test(host) && host.includes(".");
}

/** What is wrong with the database TLS settings for this environment, or null. */
export function databaseTlsError(): string | null {
  if (config.env === "development" || config.env === "test") return null;
  if (!isRemoteHost(config.database.host)) return null;
  if (!config.database.ssl) return "DB_SSL must be true for a remote database host.";
  if (!config.database.sslCa) {
    return "DB_SSL_CA (PEM text or a path to a PEM file) is required for a remote database host.";
  }
  return null;
}

/**
 * Validates the configuration a production server needs. Throws on settings
 * that would leave the deployment insecure (missing or default secrets) and
 * returns warnings for weaker settings the operator should review.
 * Should be called at application startup.
 */
export function validateProductionConfig(): string[] {
  if (!process.env.NODE_ENV) {
    throw new Error(
      "NODE_ENV must be set (production, development or test): production checks depend on it.",
    );
  }

  // JWT secrets are validated in all environments (except test)
  validateJwtSecrets();

  if (config.env === "development" || config.env === "test") {
    return [];
  }

  const missingVars: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.domain.api) {
    missingVars.push("API_DOMAIN");
  }
  if (!config.domain.dashboard) {
    missingVars.push("DASHBOARD_DOMAIN");
  }
  if (!config.openai.apiKey) {
    missingVars.push("OPENAI_API_KEY");
  }
  if (!process.env.RABBITMQ_URL) {
    missingVars.push("RABBITMQ_URL");
  }

  try {
    const encryptionKeys = configuredEncryptionKeys();
    if (encryptionKeys.length === 0) {
      missingVars.push("PLUGIN_ENCRYPTION_KEY");
    } else if (encryptionKeys.some((key) => key.secret.length < MIN_SECRET_LENGTH)) {
      errors.push(`PLUGIN_ENCRYPTION_KEY must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (config.serviceKey && config.serviceKey.length < MIN_SECRET_LENGTH) {
    errors.push(`HAY_SERVICE_KEY must be at least ${MIN_SECRET_LENGTH} characters when set.`);
  }

  if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === DEFAULT_DB_PASSWORD) {
    errors.push("DB_PASSWORD must be set to a non-default value.");
  }
  if (process.env.RABBITMQ_URL?.includes(`:${DEFAULT_DB_PASSWORD}@`)) {
    errors.push("RABBITMQ_URL must not use the default development credentials.");
  }
  if (config.internal.apiSecret && config.internal.apiSecret.length < MIN_SECRET_LENGTH) {
    errors.push(`INTERNAL_API_SECRET must be at least ${MIN_SECRET_LENGTH} characters when set.`);
  }
  if (
    config.internal.previousApiSecret &&
    config.internal.previousApiSecret.length < MIN_SECRET_LENGTH
  ) {
    errors.push(
      `INTERNAL_API_PREVIOUS_SECRET must be at least ${MIN_SECRET_LENGTH} characters when set.`,
    );
  }

  const tlsError = databaseTlsError();
  if (tlsError) {
    errors.push(tlsError);
  }
  if (!config.redis.password && isRemoteHost(config.redis.host)) {
    errors.push("REDIS_PASSWORD is required for a remote Redis host.");
  }

  if (missingVars.length > 0) {
    errors.unshift(`Missing required environment variables: ${missingVars.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid production configuration:\n` +
        `  ${errors.join("\n  ")}\n\n` +
        `Please set these variables in your .env file or environment.`,
    );
  }

  if (config.logging.level === "debug" || config.logging.level === "trace") {
    warnings.push(`LOG_LEVEL=${config.logging.level} is verbose and may log customer data.`);
  }
  if (config.database.ssl && !config.database.sslCa) {
    warnings.push("DB_SSL is on without DB_SSL_CA; the database certificate is not verified.");
  }
  if (process.env.TRUST_PROXY === undefined) {
    warnings.push(
      `TRUST_PROXY is not set; assuming ${config.server.trustProxy} reverse proxy hop(s). Set it to the real number so client IPs are correct.`,
    );
  }

  return warnings;
}
