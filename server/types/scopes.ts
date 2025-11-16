/**
 * Scopes and permissions system for resource-based access control
 *
 * Scopes follow the format: "resource:action"
 * Resources represent entities or features
 * Actions represent operations (read, create, update, delete, manage)
 */

// ============================================================================
// RESOURCES
// ============================================================================

export const RESOURCES = {
  // Core entities
  CONVERSATIONS: "conversations",
  MESSAGES: "messages",
  CUSTOMERS: "customers",
  DOCUMENTS: "documents",
  EMBEDDINGS: "embeddings",

  // AI & Automation
  AGENTS: "agents",
  PLAYBOOKS: "playbooks",
  SOURCES: "sources",

  // Organization & Team
  ORGANIZATIONS: "organizations",
  ORGANIZATION_MEMBERS: "organization_members",
  ORGANIZATION_INVITATIONS: "organization_invitations",
  ORGANIZATION_SETTINGS: "organization_settings",

  // System
  API_KEYS: "api_keys",
  PLUGINS: "plugins",
  ANALYTICS: "analytics",
  AUDIT_LOGS: "audit_logs",

  // Wildcards
  ALL: "*",
} as const;

export type Resource = typeof RESOURCES[keyof typeof RESOURCES];

// ============================================================================
// ACTIONS
// ============================================================================

export const ACTIONS = {
  // Standard CRUD
  READ: "read",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",

  // Extended operations
  MANAGE: "manage",      // Full control (create, read, update, delete)
  EXECUTE: "execute",    // Run or trigger (for agents, playbooks, etc.)
  PUBLISH: "publish",    // Publish content (playbooks, etc.)
  INVITE: "invite",      // Invite users
  EXPORT: "export",      // Export data
  IMPORT: "import",      // Import data

  // Wildcards
  ALL: "*",
} as const;

export type Action = typeof ACTIONS[keyof typeof ACTIONS];

// ============================================================================
// SCOPE HELPERS
// ============================================================================

/**
 * Build a scope string from resource and action
 */
export function buildScope(resource: Resource, action: Action): string {
  return `${resource}:${action}`;
}

/**
 * Parse a scope string into resource and action
 */
export function parseScope(scope: string): { resource: string; action: string } {
  const [resource, action] = scope.split(":");
  return { resource, action };
}

/**
 * Check if a scope matches a required scope (with wildcard support)
 */
export function matchesScope(
  requiredScope: string,
  availableScopes: string[],
): boolean {
  const { resource: reqResource, action: reqAction } = parseScope(requiredScope);

  return availableScopes.some((availableScope) => {
    const { resource: availResource, action: availAction } = parseScope(availableScope);

    // Check resource match (exact or wildcard)
    const resourceMatches =
      availResource === reqResource ||
      availResource === RESOURCES.ALL;

    // Check action match (exact or wildcard)
    const actionMatches =
      availAction === reqAction ||
      availAction === ACTIONS.ALL;

    return resourceMatches && actionMatches;
  });
}

// ============================================================================
// COMMON SCOPE SETS
// ============================================================================

/**
 * Default scopes for viewer role
 */
export const VIEWER_SCOPES = [
  buildScope(RESOURCES.CONVERSATIONS, ACTIONS.READ),
  buildScope(RESOURCES.MESSAGES, ACTIONS.READ),
  buildScope(RESOURCES.CUSTOMERS, ACTIONS.READ),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.READ),
  buildScope(RESOURCES.AGENTS, ACTIONS.READ),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.READ),
  buildScope(RESOURCES.ANALYTICS, ACTIONS.READ),
  buildScope(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.READ),
];

/**
 * Default scopes for member role
 */
export const MEMBER_SCOPES = [
  buildScope(RESOURCES.CONVERSATIONS, ACTIONS.ALL),
  buildScope(RESOURCES.MESSAGES, ACTIONS.ALL),
  buildScope(RESOURCES.CUSTOMERS, ACTIONS.ALL),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.READ),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.CREATE),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.UPDATE),
  buildScope(RESOURCES.SOURCES, ACTIONS.READ),
  buildScope(RESOURCES.SOURCES, ACTIONS.CREATE),
  buildScope(RESOURCES.SOURCES, ACTIONS.UPDATE),
  buildScope(RESOURCES.AGENTS, ACTIONS.READ),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.READ),
  buildScope(RESOURCES.ANALYTICS, ACTIONS.READ),
  buildScope(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.READ),
];

/**
 * Default scopes for contributor role
 */
export const CONTRIBUTOR_SCOPES = [
  buildScope(RESOURCES.CONVERSATIONS, ACTIONS.ALL),
  buildScope(RESOURCES.MESSAGES, ACTIONS.ALL),
  buildScope(RESOURCES.CUSTOMERS, ACTIONS.ALL),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.READ),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.CREATE),
  buildScope(RESOURCES.DOCUMENTS, ACTIONS.UPDATE),
  buildScope(RESOURCES.SOURCES, ACTIONS.READ),
  buildScope(RESOURCES.SOURCES, ACTIONS.CREATE),
  buildScope(RESOURCES.SOURCES, ACTIONS.UPDATE),
  buildScope(RESOURCES.AGENTS, ACTIONS.READ),
  buildScope(RESOURCES.AGENTS, ACTIONS.CREATE),
  buildScope(RESOURCES.AGENTS, ACTIONS.UPDATE),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.READ),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.CREATE),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.UPDATE),
  buildScope(RESOURCES.ANALYTICS, ACTIONS.READ),
  buildScope(RESOURCES.ORGANIZATION_MEMBERS, ACTIONS.READ),
  // Note: Contributors cannot publish or delete - requires admin approval
];

/**
 * Default scopes for admin role
 */
export const ADMIN_SCOPES = [
  buildScope(RESOURCES.ALL, ACTIONS.ALL), // Full access to all resources
];

/**
 * Default scopes for owner role
 */
export const OWNER_SCOPES = ADMIN_SCOPES; // Same as admin

/**
 * Default scopes for agent role
 * Agents are support staff who can handle conversations but not edit content
 */
export const AGENT_SCOPES = [
  buildScope(RESOURCES.CONVERSATIONS, ACTIONS.READ),
  buildScope(RESOURCES.CONVERSATIONS, ACTIONS.CREATE),
  buildScope(RESOURCES.CONVERSATIONS, ACTIONS.UPDATE),
  buildScope(RESOURCES.MESSAGES, ACTIONS.READ),
  buildScope(RESOURCES.MESSAGES, ACTIONS.CREATE),
  buildScope(RESOURCES.CUSTOMERS, ACTIONS.READ),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.READ),
  buildScope(RESOURCES.PLAYBOOKS, ACTIONS.EXECUTE),
];

/**
 * Get default scopes for a role
 */
export function getDefaultScopesForRole(
  role: "owner" | "admin" | "member" | "viewer" | "contributor" | "agent",
): string[] {
  switch (role) {
    case "owner":
      return OWNER_SCOPES;
    case "admin":
      return ADMIN_SCOPES;
    case "contributor":
      return CONTRIBUTOR_SCOPES;
    case "member":
      return MEMBER_SCOPES;
    case "viewer":
      return VIEWER_SCOPES;
    case "agent":
      return AGENT_SCOPES;
    default:
      return [];
  }
}

/**
 * Check if user has required scope
 */
export function hasRequiredScope(
  requiredResource: Resource,
  requiredAction: Action,
  userScopes: string[],
): boolean {
  const requiredScope = buildScope(requiredResource, requiredAction);
  return matchesScope(requiredScope, userScopes);
}

// ============================================================================
// SCOPE VALIDATION
// ============================================================================

/**
 * Validate if a scope string is well-formed
 */
export function isValidScope(scope: string): boolean {
  const parts = scope.split(":");
  if (parts.length !== 2) return false;

  const [resource, action] = parts;
  return !!resource && !!action;
}

/**
 * Validate an array of scope strings
 */
export function validateScopes(scopes: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const scope of scopes) {
    if (!isValidScope(scope)) {
      errors.push(`Invalid scope format: "${scope}". Expected format: "resource:action"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
