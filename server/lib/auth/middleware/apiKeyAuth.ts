import { User } from "@server/entities/user.entity";
import { ApiKey } from "@server/entities/apikey.entity";
import { Organization } from "@server/entities/organization.entity";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { extractApiKeyFromHeader, verifyApiKey } from "@server/lib/auth/utils/hashing";
import { AppDataSource } from "@server/database/data-source";

/**
 * Authenticate using Organization API Token
 * Returns a synthetic AuthUser representing the organization
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
    relations: ["organization"],
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
    throw new Error("Invalid API key");
  }

  // Check if API key is expired
  if (matchedApiKey.isExpired()) {
    throw new Error("API key has expired");
  }

  // Check if the associated organization exists and is active
  if (!matchedApiKey.organization) {
    // If organization is not loaded via relation, fetch it
    const organizationRepository = AppDataSource.getRepository(Organization);
    const org = await organizationRepository.findOne({
      where: { id: matchedApiKey.organizationId },
    });

    if (!org) {
      throw new Error("Associated organization not found");
    }

    matchedApiKey.organization = org;
  }

  if (!matchedApiKey.organization) {
    throw new Error("Associated organization not found");
  }

  if (!matchedApiKey.organization.isActive) {
    throw new Error("Associated organization is deactivated");
  }

  // Update last used timestamp
  matchedApiKey.lastUsedAt = new Date();
  await apiKeyRepository.save(matchedApiKey);

  // Create a synthetic user representing the organization's API access
  // This user won't have a real user ID but will have organization context
  const syntheticUser = new User();
  syntheticUser.id = `api-token-${matchedApiKey.id}`; // Synthetic ID for API token
  syntheticUser.email = `api-token@${matchedApiKey.organization.slug}.internal`;
  syntheticUser.isActive = true;
  syntheticUser.organizationId = matchedApiKey.organizationId;
  syntheticUser.role = "member"; // API tokens have member-level access by default

  // Create AuthUser instance with API key metadata
  const authUser = new AuthUser(syntheticUser, "apikey", {
    apiKeyId: matchedApiKey.id,
    scopes: matchedApiKey.scopes,
    organizationId: matchedApiKey.organizationId,
  });

  return authUser;
}

/**
 * Validate an API key without fetching the full organization
 * Used for quick authorization checks
 */
export async function validateApiKey(
  authHeader?: string,
): Promise<{ apiKeyId: string; organizationId: string } | null> {
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
    select: ["id", "organizationId", "keyHash", "expiresAt"],
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
        organizationId: key.organizationId,
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
  action: string,
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
