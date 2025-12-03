/**
 * The API surface exposed to plugins
 * This is the ONLY way plugins can interact with the platform
 *
 * Plugins receive this context object during initialization and can only
 * access capabilities they explicitly declare in their manifest.
 */
export interface PluginContext {
  // Metadata
  organizationId: string;
  pluginId: string;

  // Configuration (decrypted and parsed from plugin instance)
  config: Record<string, any>;

  // Service APIs (only included if plugin declares capability in manifest)
  email?: EmailAPI;

  // TODO: [PLUGIN-API] Future capabilities - uncomment as we build them
  // scheduler?: SchedulerAPI;      // Cron jobs and scheduled tasks
  // storage?: StorageAPI;           // Key-value storage scoped to plugin
  // accounts?: AccountsAPI;         // Read/write account data
  // events?: EventsAPI;             // Subscribe to platform events
  // http?: HttpAPI;                 // Make external HTTP requests with rate limiting

  // Logging (always available)
  logger: {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
  };
}

/**
 * Email API for sending emails via platform's email service
 *
 * Plugins with `email` capability can send emails using the platform's
 * configured SMTP service. Recipients can be provided at call-time or
 * will default to the plugin's configured recipients.
 */
export interface EmailAPI {
  /**
   * Send email using platform's email service
   *
   * @param options Email options (subject, body, recipients)
   * @returns Promise with result containing success status and messageId
   *
   * @example
   * ```typescript
   * const result = await api.email.send({
   *   subject: "Welcome to our platform",
   *   text: "Thank you for signing up!",
   *   // to: optional, will use plugin config recipients if not provided
   * });
   *
   * if (result.success) {
   *   console.log(`Email sent: ${result.messageId}`);
   * }
   * ```
   */
  send(options: EmailSendOptions): Promise<EmailResult>;
}

/**
 * Options for sending an email
 */
export interface EmailSendOptions {
  /**
   * Recipients (optional - will use plugin config if not provided)
   * Can be a single email or an array of emails
   */
  to?: string | string[];

  /** Email subject line (required) */
  subject: string;

  /** Plain text email body (optional if html is provided) */
  text?: string;

  /** HTML email body (optional if text is provided) */
  html?: string;

  /** CC recipients (optional) */
  cc?: string | string[];

  /** BCC recipients (optional) */
  bcc?: string | string[];
}

/**
 * Result of sending an email
 */
export interface EmailResult {
  /** Whether the email was sent successfully */
  success: boolean;

  /** Message ID from email service (if successful) */
  messageId?: string;

  /** Error message (if failed) */
  error?: string;
}

// TODO: [PLUGIN-API] Add SchedulerAPI interface
// export interface SchedulerAPI {
//   /**
//    * Register a cron job for this plugin
//    * Jobs are scoped to the plugin and auto-cleaned on unload
//    */
//   registerCron(schedule: string, handler: () => Promise<void>): string;
//   unregisterCron(jobId: string): void;
//   listJobs(): Array<{ id: string; schedule: string; nextRun: Date }>;
// }

// TODO: [PLUGIN-API] Add StorageAPI interface
// export interface StorageAPI {
//   /**
//    * Key-value storage scoped to this plugin
//    * Keys are automatically prefixed with plugin ID to prevent conflicts
//    */
//   get(key: string): Promise<any>;
//   set(key: string, value: any): Promise<void>;
//   delete(key: string): Promise<void>;
//   list(prefix?: string): Promise<string[]>;
//   clear(): Promise<void>;
// }

// TODO: [PLUGIN-API] Add AccountsAPI interface
// export interface AccountsAPI {
//   /**
//    * Get account details (sanitized - no sensitive fields)
//    */
//   getCurrentAccount(): Promise<Account>;
//   getAccountMetadata(key: string): Promise<any>;
//   setAccountMetadata(key: string, value: any): Promise<void>;
// }

// TODO: [PLUGIN-API] Add EventsAPI interface
// export interface EventsAPI {
//   /**
//    * Subscribe to app events
//    */
//   on(event: 'message.created' | 'conversation.updated' | 'customer.created', handler: (data: any) => Promise<void>): void;
//   off(event: string, handler: (data: any) => Promise<void>): void;
//
//   /**
//    * Emit custom plugin events (namespaced to plugin)
//    */
//   emit(event: string, data: any): void;
// }

// TODO: [PLUGIN-API] Add HttpAPI interface
// export interface HttpAPI {
//   /**
//    * Make external HTTP requests (rate-limited per plugin)
//    */
//   fetch(url: string, options?: RequestInit): Promise<Response>;
//
//   /**
//    * Register webhook endpoints for this plugin
//    * Available at /api/plugins/{pluginId}/webhook/{path}
//    */
//   registerWebhook(path: string, handler: (req: Request) => Promise<Response>): void;
//   unregisterWebhook(path: string): void;
// }

/**
 * HTTP-based Plugin API for external MCP plugins
 * Used when plugins run in separate processes and need to call back to the server
 */

export interface PluginAPITokenPayload {
  pluginId: string;
  organizationId: string;
  capabilities: string[];
  iat?: number;
  exp?: number;
}

export interface PluginAPIClientConfig {
  apiUrl: string;
  pluginId: string;
  organizationId: string;
  apiToken: string;
}

/**
 * HTTP Request/Response types for Plugin API endpoints
 */
export interface PluginAPIHttpResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SendEmailHttpRequest {
  to?: string[];
  subject: string;
  body?: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
}

export interface SendEmailHttpResponse {
  messageId?: string;
  recipients: string[];
}
