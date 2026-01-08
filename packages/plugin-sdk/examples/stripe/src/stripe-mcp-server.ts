/**
 * Mock Stripe MCP Server
 *
 * This demonstrates how to create a local MCP server that exposes
 * Stripe operations as MCP tools (functions callable by AI agents).
 *
 * Purpose:
 * - Show MCP server lifecycle (start/stop)
 * - Demonstrate how to integrate external API clients (StripeClient)
 * - Provide examples of MCP tool definitions
 *
 * In production, this would:
 * - Implement the full MCP protocol (JSON-RPC over stdio or SSE)
 * - Expose tools like "create_payment_link", "list_customers", etc.
 * - Handle tool invocations from Hay's orchestrator
 */

/**
 * Logger interface (matches HayLogger from SDK)
 */
interface Logger {
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

export interface StripeMcpServerOptions {
  apiKey: string;
  logger: Logger;
}

/**
 * Mock MCP Server Instance
 *
 * Implements the McpServerInstance interface from the SDK.
 *
 * In a real implementation, this would:
 * 1. Start an MCP server process or HTTP endpoint
 * 2. Register tools (functions) that agents can call
 * 3. Handle tool invocations by calling Stripe APIs
 * 4. Return results to the orchestrator
 *
 * For this example, we:
 * - Simulate server startup
 * - Track running state
 * - Log lifecycle events
 * - Provide a stop() method for cleanup
 */
export class StripeMcpServer {
  private logger: Logger;
  private isRunning: boolean = false;

  constructor(options: StripeMcpServerOptions) {
    // In production, this would initialize the Stripe client:
    // this.client = new StripeClient({ apiKey: options.apiKey });
    this.logger = options.logger;
  }

  /**
   * Start the MCP server
   *
   * Called by the SDK's mcp.startLocal() method.
   *
   * In production:
   * - Initialize MCP protocol handler
   * - Register available tools (see getTools() below)
   * - Start listening for requests
   */
  async start(): Promise<void> {
    this.logger.info("Starting Stripe MCP server");

    // Simulate server initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.isRunning = true;

    this.logger.info("Stripe MCP server started", {
      tools: this.getToolNames(),
    });
  }

  /**
   * Stop the MCP server
   *
   * Called automatically by the SDK on worker shutdown.
   *
   * In production:
   * - Close MCP connections
   * - Clean up resources
   * - Cancel in-flight requests
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info("Stopping Stripe MCP server");

    // Simulate graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 50));

    this.isRunning = false;

    this.logger.info("Stripe MCP server stopped");
  }

  /**
   * Get available tool names
   *
   * In a real MCP server, these would be registered as callable tools.
   * Each tool would have:
   * - Name (e.g., "stripe_create_payment_link")
   * - Description (for AI context)
   * - Input schema (JSON Schema)
   * - Handler function (calls Stripe API)
   *
   * Example tool handlers would look like:
   *
   * async handleCreatePaymentLink(params: {
   *   amount: number;
   *   currency: string;
   *   description: string;
   * }): Promise<{ url: string; id: string }> {
   *   // 1. Validate inputs
   *   // 2. Call Stripe API via this.client
   *   // 3. Return result to agent
   *   const result = await stripeClient.paymentLinks.create({ amount, currency });
   *   return { id: result.id, url: result.url };
   * }
   *
   * async handleListCustomers(params: { limit?: number }) {
   *   return await stripeClient.customers.list({ limit });
   * }
   */
  private getToolNames(): string[] {
    return [
      "stripe_create_payment_link",
      "stripe_list_customers",
      "stripe_get_customer",
      "stripe_list_charges",
      "stripe_refund_charge",
    ];
  }

  /**
   * Health check
   *
   * Useful for debugging and monitoring
   */
  isHealthy(): boolean {
    return this.isRunning;
  }
}
