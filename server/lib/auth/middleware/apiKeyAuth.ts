import { User } from '@/entities/user.entity';
import { ApiKey } from '@/entities/apikey.entity';
import { AuthUser } from '@/lib/auth/AuthUser';
import { extractApiKeyFromHeader, verifyApiKey } from '@/lib/auth/utils/hashing';
import { AppDataSource } from '@/database/data-source';

/**
 * Authenticate a user using API Key
 * Returns the authenticated user with API key scopes
 */
export async function authenticateApiKeyAuth(authHeader?: string): Promise<AuthUser | null> {
  if (!authHeader) {
    return null;
  }

  const apiKey = extractApiKeyFromHeader(authHeader);
  if (!apiKey) {
    // Not an API key authentication attempt
    return null;
  }

  // Find the API key by comparing hashes
  const apiKeyRepository = AppDataSource.getRepository(ApiKey);
  const apiKeys = await apiKeyRepository.find({
    where: { isActive: true },
    relations: ['user'],
  });

  // Find matching API key by verifying against all active keys
  let matchedApiKey: ApiKey | null = null;
  for (const key of apiKeys) {
    if (verifyApiKey(apiKey, key.keyHash)) {
      matchedApiKey = key;
      break;
    }
  }

  if (!matchedApiKey) {
    throw new Error('Invalid API key');
  }

  // Check if API key is expired
  if (matchedApiKey.isExpired()) {
    throw new Error('API key has expired');
  }

  // Check if the associated user exists and is active
  if (!matchedApiKey.user) {
    // If user is not loaded via relation, fetch it
    const userRepository = AppDataSource.getRepository(User);
    matchedApiKey.user = await userRepository.findOne({
      where: { id: matchedApiKey.userId },
    }) || undefined;
  }

  if (!matchedApiKey.user) {
    throw new Error('Associated user not found');
  }

  if (!matchedApiKey.user.isActive) {
    throw new Error('Associated user account is deactivated');
  }

  // Update last used timestamp
  matchedApiKey.lastUsedAt = new Date();
  await apiKeyRepository.save(matchedApiKey);

  // Create AuthUser instance with API key metadata
  const authUser = new AuthUser(matchedApiKey.user, 'apikey', {
    apiKeyId: matchedApiKey.id,
    scopes: matchedApiKey.scopes,
  });

  return authUser;
}

/**
 * Validate an API key without fetching the full user
 * Used for quick authorization checks
 */
export async function validateApiKey(authHeader?: string): Promise<{ apiKeyId: string; userId: string } | null> {
  if (!authHeader) {
    return null;
  }

  const apiKey = extractApiKeyFromHeader(authHeader);
  if (!apiKey) {
    return null;
  }

  // Find the API key
  const apiKeyRepository = AppDataSource.getRepository(ApiKey);
  const apiKeys = await apiKeyRepository.find({
    where: { isActive: true },
    select: ['id', 'userId', 'keyHash', 'expiresAt'],
  });

  // Find matching API key
  for (const key of apiKeys) {
    if (verifyApiKey(apiKey, key.keyHash)) {
      // Check expiration
      if (key.expiresAt && new Date() > key.expiresAt) {
        return null;
      }
      
      return {
        apiKeyId: key.id,
        userId: key.userId,
      };
    }
  }

  return null;
}

/**
 * Check if an API key has a specific scope
 */
export async function checkApiKeyScope(
  apiKeyId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const apiKeyRepository = AppDataSource.getRepository(ApiKey);
  const apiKey = await apiKeyRepository.findOne({
    where: { id: apiKeyId, isActive: true },
  });

  if (!apiKey) {
    return false;
  }

  return apiKey.hasScope(resource, action);
}