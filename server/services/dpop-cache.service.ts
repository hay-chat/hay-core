import { v4 as uuidv4 } from "uuid";
import type Redis from "ioredis";
import { createLogger } from "@server/lib/logger";
import { redisService } from "@server/services/redis.service";

const logger = createLogger("dpop-cache");

const NONCE_PREFIX = "nonce:";
const JTI_PREFIX = "dpop:jti:";
const NONCE_TTL_SECONDS = 1800;
const JTI_TTL_SECONDS = 600;

const ROTATE_NONCE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;

/**
 * One-time proof ids and per-conversation nonces, shared between instances
 * through Redis. The in-process maps only serve while Redis is unreachable,
 * so the widget keeps working on a single instance during an outage.
 */
export class DPoPCacheService {
  private readonly nonces = new Map<string, { nonce: string; expiry: number }>();
  private readonly jtis = new Map<string, number>();

  private async withRedis<T>(
    useRedis: (client: Redis) => Promise<T>,
    useMemory: () => T,
  ): Promise<T> {
    const client = redisService.isConnected() ? redisService.getClient() : null;
    if (client) {
      try {
        return await useRedis(client);
      } catch (err) {
        logger.warn({ err }, "Redis unavailable for DPoP state, using this instance's memory");
      }
    }
    return useMemory();
  }

  private setMemoryNonce(key: string, nonce: string): void {
    this.nonces.set(key, { nonce, expiry: Date.now() + NONCE_TTL_SECONDS * 1000 });
  }

  /**
   * Generate and store a new nonce for a conversation
   */
  async generateNonce(conversationId: string): Promise<string> {
    const nonce = uuidv4();
    const key = `${NONCE_PREFIX}${conversationId}`;

    await this.withRedis(
      async (client) => {
        await client.set(key, nonce, "EX", NONCE_TTL_SECONDS);
      },
      () => this.setMemoryNonce(key, nonce),
    );

    return nonce;
  }

  /**
   * Verify and rotate a nonce for a conversation
   * Returns the new nonce if verification succeeds, null otherwise
   */
  async verifyAndRotateNonce(
    conversationId: string,
    providedNonce: string,
  ): Promise<string | null> {
    const key = `${NONCE_PREFIX}${conversationId}`;
    const newNonce = uuidv4();

    const rotated = await this.withRedis(
      async (client) =>
        (await client.eval(
          ROTATE_NONCE_SCRIPT,
          1,
          key,
          providedNonce,
          newNonce,
          NONCE_TTL_SECONDS,
        )) === 1,
      () => {
        const stored = this.nonces.get(key);
        if (!stored || stored.nonce !== providedNonce || stored.expiry < Date.now()) return false;
        this.setMemoryNonce(key, newNonce);
        return true;
      },
    );

    return rotated ? newNonce : null;
  }

  /**
   * Check if a JTI has been used (replay protection)
   * Returns true if JTI is new and was successfully stored, false if already used
   */
  async checkAndStoreJTI(jti: string): Promise<boolean> {
    const key = `${JTI_PREFIX}${jti}`;

    return this.withRedis(
      async (client) => (await client.set(key, "1", "EX", JTI_TTL_SECONDS, "NX")) === "OK",
      () => {
        const expiry = this.jtis.get(key);
        if (expiry && expiry > Date.now()) return false;
        this.jtis.set(key, Date.now() + JTI_TTL_SECONDS * 1000);
        return true;
      },
    );
  }

  /**
   * Clean up expired in-memory entries
   * Called by scheduled job: 'dpop-cache-cleanup'
   */
  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    let noncesDeleted = 0;
    let jtisDeleted = 0;

    for (const [key, value] of this.nonces.entries()) {
      if (value.expiry < now) {
        this.nonces.delete(key);
        noncesDeleted++;
      }
    }

    for (const [key, expiry] of this.jtis.entries()) {
      if (expiry < now) {
        this.jtis.delete(key);
        jtisDeleted++;
      }
    }

    if (noncesDeleted > 0 || jtisDeleted > 0) {
      logger.debug({ noncesDeleted, jtisDeleted }, "Cleanup completed");
    }
  }
}

// Export singleton instance
export const dpopCacheService = new DPoPCacheService();
