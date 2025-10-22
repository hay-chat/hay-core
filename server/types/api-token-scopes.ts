/**
 * API Token Scopes
 * Define all available scopes for organization API tokens
 */

export enum ApiTokenScope {
  // Conversations & Messages
  CONVERSATIONS_READ = "conversations:read",
  CONVERSATIONS_WRITE = "conversations:write",
  MESSAGES_READ = "messages:read",
  MESSAGES_WRITE = "messages:write",

  // Customers
  CUSTOMERS_READ = "customers:read",
  CUSTOMERS_WRITE = "customers:write",

  // Content
  DOCUMENTS_READ = "documents:read",
  DOCUMENTS_WRITE = "documents:write",
  AGENTS_READ = "agents:read",
  PLAYBOOKS_READ = "playbooks:read",

  // Analytics
  ANALYTICS_READ = "analytics:read",

  // Privacy & DSAR (Data Subject Access Requests)
  PRIVACY_READ = "privacy:read",
  PRIVACY_WRITE = "privacy:write",
  PRIVACY_EXPORT = "privacy:export",
  PRIVACY_DELETE = "privacy:delete",

  // Settings
  SETTINGS_READ = "settings:read",
  SETTINGS_WRITE = "settings:write",

  // Full Access
  ALL = "*:*",
}

/**
 * Scope groups for UI organization
 */
export const API_TOKEN_SCOPE_GROUPS = {
  "Conversations & Messages": [
    ApiTokenScope.CONVERSATIONS_READ,
    ApiTokenScope.CONVERSATIONS_WRITE,
    ApiTokenScope.MESSAGES_READ,
    ApiTokenScope.MESSAGES_WRITE,
  ],
  Customers: [ApiTokenScope.CUSTOMERS_READ, ApiTokenScope.CUSTOMERS_WRITE],
  Content: [
    ApiTokenScope.DOCUMENTS_READ,
    ApiTokenScope.DOCUMENTS_WRITE,
    ApiTokenScope.AGENTS_READ,
    ApiTokenScope.PLAYBOOKS_READ,
  ],
  Analytics: [ApiTokenScope.ANALYTICS_READ],
  "Privacy & DSAR": [
    ApiTokenScope.PRIVACY_READ,
    ApiTokenScope.PRIVACY_WRITE,
    ApiTokenScope.PRIVACY_EXPORT,
    ApiTokenScope.PRIVACY_DELETE,
  ],
  Settings: [ApiTokenScope.SETTINGS_READ, ApiTokenScope.SETTINGS_WRITE],
  "Full Access": [ApiTokenScope.ALL],
} as const;

/**
 * Scope descriptions for UI
 */
export const API_TOKEN_SCOPE_DESCRIPTIONS: Record<ApiTokenScope, string> = {
  [ApiTokenScope.CONVERSATIONS_READ]: "Read conversations",
  [ApiTokenScope.CONVERSATIONS_WRITE]: "Create and update conversations",
  [ApiTokenScope.MESSAGES_READ]: "Read messages",
  [ApiTokenScope.MESSAGES_WRITE]: "Send and update messages",
  [ApiTokenScope.CUSTOMERS_READ]: "Read customer data",
  [ApiTokenScope.CUSTOMERS_WRITE]: "Create and update customers",
  [ApiTokenScope.DOCUMENTS_READ]: "Read documents",
  [ApiTokenScope.DOCUMENTS_WRITE]: "Upload and modify documents",
  [ApiTokenScope.AGENTS_READ]: "Read agent configurations",
  [ApiTokenScope.PLAYBOOKS_READ]: "Read playbooks",
  [ApiTokenScope.ANALYTICS_READ]: "Access analytics data",
  [ApiTokenScope.PRIVACY_READ]: "View privacy requests",
  [ApiTokenScope.PRIVACY_WRITE]: "Create and manage privacy requests",
  [ApiTokenScope.PRIVACY_EXPORT]: "Export user data (DSAR)",
  [ApiTokenScope.PRIVACY_DELETE]: "Request user deletion (DSAR)",
  [ApiTokenScope.SETTINGS_READ]: "View organization settings",
  [ApiTokenScope.SETTINGS_WRITE]: "Modify organization settings",
  [ApiTokenScope.ALL]: "Full access to all resources",
};

/**
 * Helper to check if a scope string is valid
 */
export function isValidScope(scope: string): scope is ApiTokenScope {
  return Object.values(ApiTokenScope).includes(scope as ApiTokenScope);
}

/**
 * Helper to parse scope string into resource and action
 */
export function parseScope(scope: string): { resource: string; action: string } {
  const [resource, action] = scope.split(":");
  return { resource: resource || "*", action: action || "*" };
}

/**
 * Helper to check if a scope matches a required scope
 * Supports wildcards (e.g., "*:*" matches everything)
 */
export function matchesScope(
  grantedScope: string,
  requiredResource: string,
  requiredAction: string,
): boolean {
  const granted = parseScope(grantedScope);

  // Check for wildcard matches
  const resourceMatches = granted.resource === "*" || granted.resource === requiredResource;
  const actionMatches = granted.action === "*" || granted.action === requiredAction;

  return resourceMatches && actionMatches;
}
