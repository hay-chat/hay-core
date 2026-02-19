import { redisService } from "./redis.service";

const KEY_PREFIX = "hay:conv:secrets:";
const TTL_SECONDS = 60 * 60 * 24; // 24 hours

function key(conversationId: string): string {
  return `${KEY_PREFIX}${conversationId}`;
}

export class ConversationSecretService {
  async setSecrets(conversationId: string, secrets: Record<string, string>): Promise<void> {
    const client = redisService.getClient();
    if (!client) throw new Error("Redis client not available");
    await client.set(key(conversationId), JSON.stringify(secrets), "EX", TTL_SECONDS);
  }

  async getSecrets(conversationId: string): Promise<Record<string, string>> {
    const client = redisService.getClient();
    if (!client) return {};
    const raw = await client.get(key(conversationId));
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async getSecretKeys(conversationId: string): Promise<string[]> {
    const secrets = await this.getSecrets(conversationId);
    return Object.keys(secrets);
  }

  async deleteSecrets(conversationId: string): Promise<void> {
    const client = redisService.getClient();
    if (!client) return;
    await client.del(key(conversationId));
  }
}

export const conversationSecretService = new ConversationSecretService();
