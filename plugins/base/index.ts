export { HayPlugin, type PluginContext, type PluginMessage } from './HayPlugin';
export { 
  ChatConnectorPlugin, 
  type CustomerIdentifier,
  type IncomingMessage, 
  type OutgoingMessage, 
  type WebhookRequest, 
  type WebhookResponse,
  type PublicAsset 
} from './ChatConnectorPlugin';
export type { HayPluginManifest } from './types';