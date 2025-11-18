/**
 * Auth Strategy Interface
 * Abstraction for handling different authentication methods
 */

/**
 * Auth strategy for plugin instances
 */
export interface AuthStrategy {
  /**
   * Get authentication headers for HTTP requests (remote MCP servers)
   */
  getHeaders(): Promise<Record<string, string>>;

  /**
   * Get environment variables for local processes (local MCP servers)
   */
  getEnvironmentVariables(): Promise<Record<string, string>>;

  /**
   * Check if authentication is valid and not expired
   */
  isValid(): Promise<boolean>;

  /**
   * Refresh authentication if needed
   * Returns true if refresh was successful or not needed
   */
  refresh(): Promise<boolean>;
}
