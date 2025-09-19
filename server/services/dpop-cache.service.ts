import { v4 as uuidv4 } from "uuid";

export class DPoPCacheService {
  private readonly NONCE_PREFIX = "nonce:";
  private readonly JTI_PREFIX = "dpop:jti:";
  private readonly NONCE_TTL = 1800000; // 30 minutes in milliseconds
  private readonly JTI_TTL = 600000; // 10 minutes in milliseconds

  private readonly nonces = new Map<string, { nonce: string; expiry: number }>();
  private readonly jtis = new Map<string, number>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
  }

  /**
   * Generate and store a new nonce for a conversation
   */
  async generateNonce(conversationId: string): Promise<string> {
    const nonce = uuidv4();
    const expiry = Date.now() + this.NONCE_TTL;
    const key = `${this.NONCE_PREFIX}${conversationId}`;

    this.nonces.set(key, { nonce, expiry });

    return nonce;
  }

  /**
   * Verify and rotate a nonce for a conversation
   * Returns the new nonce if verification succeeds, null otherwise
   */
  async verifyAndRotateNonce(conversationId: string, providedNonce: string): Promise<string | null> {
    const key = `${this.NONCE_PREFIX}${conversationId}`;
    const stored = this.nonces.get(key);

    // Check if nonce exists, matches, and hasn't expired
    if (!stored || stored.nonce !== providedNonce || stored.expiry < Date.now()) {
      return null;
    }

    // Generate new nonce
    const newNonce = uuidv4();
    const expiry = Date.now() + this.NONCE_TTL;
    this.nonces.set(key, { nonce: newNonce, expiry });

    return newNonce;
  }

  /**
   * Check if a JTI has been used (replay protection)
   * Returns true if JTI is new and was successfully stored, false if already used
   */
  async checkAndStoreJTI(jti: string): Promise<boolean> {
    const key = `${this.JTI_PREFIX}${jti}`;

    // Check if JTI already exists and hasn't expired
    if (this.jtis.has(key)) {
      const expiry = this.jtis.get(key)!;
      if (expiry > Date.now()) {
        return false; // Already used
      }
    }

    // Store new JTI with expiry
    const expiry = Date.now() + this.JTI_TTL;
    this.jtis.set(key, expiry);

    return true;
  }

  /**
   * Get the current nonce for a conversation (without rotating)
   */
  async getCurrentNonce(conversationId: string): Promise<string | null> {
    const key = `${this.NONCE_PREFIX}${conversationId}`;
    const stored = this.nonces.get(key);

    if (!stored || stored.expiry < Date.now()) {
      return null;
    }

    return stored.nonce;
  }

  /**
   * Clear all cached data for a conversation
   */
  async clearConversationCache(conversationId: string): Promise<void> {
    const key = `${this.NONCE_PREFIX}${conversationId}`;
    this.nonces.delete(key);
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();

    // Cleanup expired nonces
    for (const [key, value] of this.nonces.entries()) {
      if (value.expiry < now) {
        this.nonces.delete(key);
      }
    }

    // Cleanup expired JTIs
    for (const [key, expiry] of this.jtis.entries()) {
      if (expiry < now) {
        this.jtis.delete(key);
      }
    }
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Export singleton instance
export const dpopCacheService = new DPoPCacheService();