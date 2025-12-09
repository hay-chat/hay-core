import {
  PluginSDKConfig,
  ReceiveMessageOptions,
  ReceiveMessageResult,
  SendMessageOptions,
  SendMessageResult,
  Message,
  Customer,
  UpsertCustomerOptions,
  RegisterSourceOptions,
  LocalMCPConfig,
  RemoteMCPConfig,
} from './types';

/**
 * Plugin SDK - HTTP Client for communicating with main Hay application
 *
 * This class provides a simple interface for plugins to interact with the main
 * application through HTTP requests. All requests are authenticated with JWT tokens
 * and capabilities are checked on each request.
 */
export class PluginSDK {
  private config: PluginSDKConfig;

  constructor(config: PluginSDKConfig) {
    this.config = config;
  }

  /**
   * Messages capability
   *
   * Allows plugins to receive and send messages through the Hay platform
   */
  get messages() {
    this.requireCapability('messages');

    return {
      /**
       * Receive an incoming message from a customer
       * This creates/updates customer, finds/creates conversation, and adds the message
       */
      receive: async (data: ReceiveMessageOptions): Promise<ReceiveMessageResult> => {
        return await this.request('POST', '/plugin-api/messages/receive', data);
      },

      /**
       * Send an outgoing message to a customer
       * This adds the message to the conversation and triggers delivery
       */
      send: async (data: SendMessageOptions): Promise<SendMessageResult> => {
        return await this.request('POST', '/plugin-api/messages/send', data);
      },

      /**
       * Get all messages in a conversation
       */
      getByConversation: async (conversationId: string): Promise<Message[]> => {
        return await this.request('GET', `/plugin-api/messages/conversation/${conversationId}`);
      },
    };
  }

  /**
   * Customers capability
   *
   * Allows plugins to manage customer data
   */
  get customers() {
    this.requireCapability('customers');

    return {
      /**
       * Get a customer by their internal ID
       */
      get: async (customerId: string): Promise<Customer | null> => {
        return await this.request('GET', `/plugin-api/customers/${customerId}`);
      },

      /**
       * Find a customer by their external ID (e.g., WhatsApp phone number)
       */
      findByExternalId: async (externalId: string, channel: string): Promise<Customer | null> => {
        return await this.request('POST', '/plugin-api/customers/find-by-external-id', {
          externalId,
          channel,
        });
      },

      /**
       * Create or update a customer
       * If customer with externalId exists, updates it. Otherwise creates new.
       */
      upsert: async (data: UpsertCustomerOptions): Promise<Customer> => {
        return await this.request('POST', '/plugin-api/customers/upsert', data);
      },
    };
  }

  /**
   * Sources capability
   *
   * Allows plugins to register themselves as message sources
   */
  async registerSource(source: RegisterSourceOptions): Promise<void> {
    this.requireCapability('sources');

    await this.request('POST', '/plugin-api/sources/register', source);
  }

  /**
   * MCP capability
   *
   * Allows plugins to register Model Context Protocol servers
   */
  get mcp() {
    this.requireCapability('mcp');

    return {
      /**
       * Register a local MCP server (runs on same machine)
       */
      registerLocalMCP: async (config: LocalMCPConfig): Promise<void> => {
        await this.request('POST', '/v1/plugin-api/mcp/register-local', config);
      },

      /**
       * Register a remote MCP server (connects via HTTP/SSE/WebSocket)
       */
      registerRemoteMCP: async (config: RemoteMCPConfig): Promise<void> => {
        await this.request('POST', '/v1/plugin-api/mcp/register-remote', config);
      },
    };
  }

  /**
   * Internal: Make HTTP request to main app
   */
  private async request<T = any>(
    method: string,
    path: string,
    data?: any
  ): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Plugin API error (${response.status}): ${error}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      // For non-JSON responses, return text (mostly for void endpoints)
      return (await response.text()) as any as T;
    } catch (error) {
      console.error(`[PluginSDK] Request failed: ${method} ${path}`, error);
      throw error;
    }
  }

  /**
   * Check if capability is declared in plugin metadata
   */
  private requireCapability(capability: string): void {
    if (!this.config.capabilities.includes(capability)) {
      throw new Error(
        `Plugin does not declare '${capability}' capability. ` +
        `Add to capabilities array in constructor.`
      );
    }
  }
}
