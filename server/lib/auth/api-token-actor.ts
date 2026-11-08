/**
 * API tokens act through a synthetic user whose id is not a real `users.id`.
 * These two functions are the only place that knows the id format.
 */
const API_TOKEN_USER_ID_PREFIX = "api-token-";

export function apiTokenUserId(apiKeyId: string): string {
  return `${API_TOKEN_USER_ID_PREFIX}${apiKeyId}`;
}

/** The API key behind a synthetic user id, or undefined for a real user id. */
export function apiKeyIdFromUserId(userId: string | undefined): string | undefined {
  if (!userId?.startsWith(API_TOKEN_USER_ID_PREFIX)) return undefined;
  return userId.slice(API_TOKEN_USER_ID_PREFIX.length);
}
