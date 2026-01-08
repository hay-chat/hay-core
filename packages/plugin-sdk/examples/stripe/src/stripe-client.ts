/**
 * Mock Stripe Client
 *
 * This is a simplified Stripe client for demonstration purposes.
 * In a real plugin, you would use the official Stripe SDK.
 *
 * Purpose:
 * - Demonstrate auth validation by testing API keys
 * - Show how to integrate external API clients
 * - Provide realistic method signatures for plugin hooks
 */

export interface StripeClientOptions {
  apiKey: string;
}

/**
 * Mock Stripe API client
 *
 * In production, this would be replaced with:
 * import Stripe from 'stripe';
 */
export class StripeClient {
  private apiKey: string;

  constructor(options: StripeClientOptions) {
    this.apiKey = options.apiKey;
  }

  /**
   * Verify that the API key is valid
   *
   * In a real implementation, this would:
   * 1. Make a lightweight API call to Stripe (e.g., GET /v1/account)
   * 2. Return true if the call succeeds with valid credentials
   * 3. Return false if the call fails with auth errors
   *
   * Mock behavior:
   * - Valid if apiKey starts with "sk_test_" or "sk_live_"
   * - Invalid otherwise
   */
  async verify(): Promise<boolean> {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mock validation logic
    if (!this.apiKey) {
      return false;
    }

    // Check for valid Stripe key format
    const isValid =
      this.apiKey.startsWith("sk_test_") || this.apiKey.startsWith("sk_live_");

    return isValid;
  }

  /**
   * Retrieve account information
   *
   * Example method to show how you might use the client
   * in your MCP server or route handlers.
   */
  async getAccount(): Promise<{ id: string; email: string }> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    return {
      id: "acct_mock123",
      email: "merchant@example.com",
    };
  }

  /**
   * List recent charges
   *
   * Another example method demonstrating typical Stripe operations
   * that might be exposed via MCP tools.
   */
  async listCharges(limit: number = 10): Promise<Array<{ id: string; amount: number }>> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    return [
      { id: "ch_mock1", amount: 2000 },
      { id: "ch_mock2", amount: 5000 },
    ].slice(0, limit);
  }
}
