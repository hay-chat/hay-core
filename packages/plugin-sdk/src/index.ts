/**
 * @hay/plugin-sdk
 *
 * TypeScript SDK for building Hay plugins with process isolation and HTTP communication
 *
 * This package provides the base classes and utilities needed to create plugins
 * that extend Hay's functionality through various capabilities:
 * - Routes: Register HTTP endpoints for webhooks
 * - Messages: Receive and send messages
 * - Customers: Manage customer data
 * - Sources: Register as message sources
 * - MCP: Connect Model Context Protocol servers
 */

// Main exports
export { HayPlugin } from './HayPlugin';
export { PluginSDK } from './PluginSDK';
export { startPluginWorker } from './startPluginWorker';
export { MCPServerManager } from './MCPServerManager';

// Type exports
export type {
  // Plugin metadata
  PluginMetadata,
  PluginCapabilityType,
  ConfigFieldDefinition,

  // SDK configuration
  PluginSDKConfig,

  // Messages capability
  ReceiveMessageOptions,
  ReceiveMessageResult,
  SendMessageOptions,
  SendMessageResult,
  Message,

  // Customers capability
  Customer,
  UpsertCustomerOptions,

  // Sources capability
  RegisterSourceOptions,

  // MCP capability
  LocalMCPConfig,
  RemoteMCPConfig,
  MCPToolDefinition,

  // Route registration
  RouteMethod,
  RouteHandler,

  // Express re-exports
  Request,
  Response,
  NextFunction,
} from './types';
