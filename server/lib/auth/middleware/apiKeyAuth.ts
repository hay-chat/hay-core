import { User } from "@server/entities/user.entity";
import { ApiKey } from "@server/entities/apikey.entity";
import { Organization } from "@server/entities/organization.entity";
import { AuthUser } from "@server/lib/auth/AuthUser";
import { extractApiKeyFromHeader, hashApiKey } from "@server/lib/auth/utils/hashing";
import { AppDataSource } from "@server/database/data-source";
import { apiTokenUserId } from "@server/lib/auth/api-token-actor";

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

  // Keys are 256-bit random values stored as SHA-256, so look them up directly by hash.
  const apiKeyRepository = AppDataSource.getRepository(ApiKey);
  const matchedApiKey = await apiKeyRepository.findOne({
    where: { keyHash: await hashApiKey(apiKey), isActive: true },
    relations: { organization: true },
  });

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

  if (matchedApiKey.organization.suspendedAt) {
    throw new Error("Associated organization is suspended");
  }

  // Record use, at most once a minute so API traffic doesn't turn into row writes.
  const now = new Date();
  if (!matchedApiKey.lastUsedAt || now.getTime() - matchedApiKey.lastUsedAt.getTime() > 60_000) {
    await apiKeyRepository.update({ id: matchedApiKey.id }, { lastUsedAt: now });
  }

  // Create a synthetic user representing the organization's API access
  // This user won't have a real user ID but will have organization context
  const syntheticUser = new User();
  syntheticUser.id = apiTokenUserId(matchedApiKey.id);
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
