/**
 * Plugin API Service Implementations
 *
 * This module contains all the API implementations that are exposed to plugins
 * via the PluginContext interface. Each API is a controlled facade that provides
 * plugins with safe, scoped access to platform capabilities.
 *
 * Architecture:
 * - Plugins declare required capabilities in their manifest
 * - Plugin Manager creates PluginContext with only requested APIs
 * - Each API implementation handles scoping, validation, and rate limiting
 *
 * HTTP-based Plugin API:
 * - For plugins running in separate processes (MCP servers)
 * - Provides secure HTTP endpoints with JWT authentication
 * - Includes client SDK for easy integration
 */

// In-process API implementations (for plugins running in same process)
export { EmailAPIImpl } from "./email.api";

// HTTP-based Plugin API (for external MCP plugins)
export { PluginAPIService } from "./plugin-api.service";
export { PluginAPIClient, createPluginAPIClient } from "./plugin-api-client";

// TODO: [PLUGIN-API] Add SchedulerAPIImpl for cron jobs
// export { SchedulerAPIImpl } from './scheduler.api';

// TODO: [PLUGIN-API] Add StorageAPIImpl for key-value storage
// export { StorageAPIImpl } from './storage.api';

// TODO: [PLUGIN-API] Add AccountsAPIImpl for account data access
// export { AccountsAPIImpl } from './accounts.api';

// TODO: [PLUGIN-API] Add EventsAPIImpl for event subscriptions
// export { EventsAPIImpl } from './events.api';

// TODO: [PLUGIN-API] Add HttpAPIImpl for external requests and webhooks
// export { HttpAPIImpl } from './http.api';
