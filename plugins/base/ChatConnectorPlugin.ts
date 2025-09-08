import { HayPlugin, PluginContext, PluginMessage } from "./HayPlugin";
import type { HayPluginManifest } from "./types";

export interface CustomerIdentifier {
  externalId: string;
  type: "email" | "phone" | "username" | "id" | "anonymous";
  platform: string;
  metadata?: Record<string, any>;
}

export interface IncomingMessage {
  id: string;
  conversationId: string;
  userId: string;
  customer?: CustomerIdentifier;
  text?: string;
  attachments?: Array<{
    type: "image" | "video" | "audio" | "document";
    url: string;
    name?: string;
    size?: number;
  }>;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface OutgoingMessage {
  conversationId: string;
  text?: string;
  attachments?: Array<{
    type: "image" | "video" | "audio" | "document";
    url: string;
    name?: string;
  }>;
  buttons?: Array<{
    text: string;
    type: "url" | "postback" | "call";
    value: string;
  }>;
  quickReplies?: string[];
  metadata?: Record<string, any>;
}

export interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
  query: Record<string, string>;
}

export interface WebhookResponse {
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

export interface PublicAsset {
  path: string;
  content: string | Buffer;
  contentType: string;
  cache?: boolean;
}

export abstract class ChatConnectorPlugin extends HayPlugin {
  protected conversationMap: Map<string, string> = new Map();
  protected customerMap: Map<string, CustomerIdentifier> = new Map();

  constructor(manifest: HayPluginManifest) {
    if (!manifest.type.includes("channel")) {
      throw new Error("Plugin must have channel type");
    }
    super(manifest);
  }

  /**
   * Handle incoming message from external platform
   */
  protected abstract onMessageReceived(message: IncomingMessage): Promise<void>;

  /**
   * Send outgoing message to external platform
   */
  protected abstract sendOutgoingMessage(
    message: OutgoingMessage
  ): Promise<void>;

  /**
   * Handle webhook requests from external platform
   */
  protected abstract handleWebhook(
    request: WebhookRequest
  ): Promise<WebhookResponse>;

  /**
   * Get public assets to serve (widget scripts, stylesheets, etc.)
   */
  protected abstract getPublicAssets(): Promise<PublicAsset[]>;

  /**
   * Render configuration UI component
   * Returns Vue SFC template as string
   */
  protected abstract renderConfiguration(): Promise<string>;

  /**
   * Verify webhook signature if required
   */
  protected async verifyWebhookSignature(
    request: WebhookRequest,
    secret: string
  ): Promise<boolean> {
    return true;
  }

  /**
   * Initialize real-time connection if supported
   */
  protected async initializeRealtime(): Promise<void> {
    const realtimeConfig = this.manifest.capabilities?.chat_connector?.realtime;
    if (realtimeConfig) {
      this.log("info", `Initializing ${realtimeConfig.type} connection`);
    }
  }

  /**
   * Map external conversation ID to internal conversation ID
   */
  protected mapConversation(externalId: string, internalId: string): void {
    this.conversationMap.set(externalId, internalId);
  }

  /**
   * Get internal conversation ID from external ID
   */
  protected getInternalConversationId(externalId: string): string | undefined {
    return this.conversationMap.get(externalId);
  }

  /**
   * Identify or create customer
   */
  protected async identifyCustomer(
    identifier: CustomerIdentifier
  ): Promise<string> {
    const customerKey = `${identifier.platform}:${identifier.externalId}`;

    // Check if we already have this customer mapped
    const existing = this.customerMap.get(customerKey);
    if (existing) {
      return customerKey;
    }

    // Store the customer identifier
    this.customerMap.set(customerKey, identifier);

    // Notify the system about the customer
    super.sendMessage({
      type: "custom",
      payload: {
        action: "customer_identified",
        data: identifier,
      },
    });

    return customerKey;
  }

  /**
   * Get customer identifier
   */
  protected getCustomer(customerKey: string): CustomerIdentifier | undefined {
    return this.customerMap.get(customerKey);
  }

  /**
   * Generate anonymous customer ID
   */
  protected generateAnonymousCustomerId(): string {
    return `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Forward message to Hay conversation system
   */
  protected async forwardToHay(message: IncomingMessage): Promise<void> {
    super.sendMessage({
      type: "custom",
      payload: {
        action: "incoming_message",
        data: message,
      },
    });
  }

  /**
   * Handle outgoing message from Hay
   */
  async handleOutgoingMessage(message: OutgoingMessage): Promise<void> {
    try {
      await this.sendOutgoingMessage(message);
      this.reportMetric("messages_sent", 1, {
        platform: this.getName(),
      });
    } catch (error) {
      this.log("error", "Failed to send message", { error, message });
      throw error;
    }
  }

  /**
   * Process webhook request
   */
  async processWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    try {
      const response = await this.handleWebhook(request);
      this.reportMetric("webhooks_processed", 1, {
        platform: this.getName(),
        status: String(response.status),
      });
      return response;
    } catch (error) {
      this.log("error", "Webhook processing failed", { error, request });
      return {
        status: 500,
        body: { error: "Internal server error" },
      };
    }
  }

  /**
   * Lifecycle implementation
   */
  protected async onInitialize(config?: Record<string, any>): Promise<void> {
    this.log("info", "Initializing channel", { config });
    await this.initializeRealtime();
  }

  protected async onExecute(action: string, payload?: any): Promise<any> {
    switch (action) {
      case "send_message":
        return this.handleOutgoingMessage(payload);
      case "process_webhook":
        return this.processWebhook(payload);
      case "get_assets":
        return this.getPublicAssets();
      case "get_configuration":
        return this.renderConfiguration();
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  protected async onShutdown(): Promise<void> {
    this.log("info", "Shutting down channel");
    this.conversationMap.clear();
  }

  /**
   * Helper method to generate embed script
   */
  protected generateEmbedScript(config: Record<string, any>): string {
    const baseUrl = this.getEnvVar("BASE_URL", "http://localhost:3000");
    const instanceId = this.context?.instanceId;
    const organizationId = this.context?.organizationId;

    return `
(function() {
  const config = ${JSON.stringify(config)};
  const baseUrl = '${baseUrl}';
  const instanceId = '${instanceId}';
  const organizationId = '${organizationId}';
  
  const script = document.createElement('script');
  script.src = baseUrl + '/plugins/assets/${this.getName()}/widget.js';
  script.dataset.instanceId = instanceId;
  script.dataset.organizationId = organizationId;
  script.dataset.config = JSON.stringify(config);
  document.body.appendChild(script);
})();
    `.trim();
  }
}
