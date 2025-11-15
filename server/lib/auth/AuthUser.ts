import { User } from "@server/entities/user.entity";
import { UserOrganization } from "@server/entities/user-organization.entity";
import type { ApiKeyScope } from "@server/types/auth.types";

/**
 * AuthUser class represents an authenticated user in the tRPC context
 * This class wraps the User entity and adds authentication-specific methods
 * Supports multi-organization with org-scoped roles and permissions
 */
export class AuthUser {
  public readonly id: string;
  public readonly email: string;
  public readonly isActive: boolean;
  public readonly lastLoginAt?: Date;

  // Authentication metadata
  public readonly authMethod: "basic" | "jwt" | "apikey";
  public readonly sessionId?: string;
  public readonly apiKeyId?: string;
  public readonly scopes?: ApiKeyScope[];

  // Organization context
  public readonly organizationId?: string;
  public readonly userOrganization?: UserOrganization;

  private readonly _user: User;

  constructor(
    user: User,
    authMethod: "basic" | "jwt" | "apikey",
    metadata?: {
      sessionId?: string;
      apiKeyId?: string;
      scopes?: ApiKeyScope[];
      organizationId?: string;
      userOrganization?: UserOrganization;
    },
  ) {
    this._user = user;
    this.id = user.id;
    this.email = user.email;
    this.isActive = user.isActive;
    this.lastLoginAt = user.lastLoginAt;

    this.authMethod = authMethod;
    this.sessionId = metadata?.sessionId;
    this.apiKeyId = metadata?.apiKeyId;
    this.scopes = metadata?.scopes;
    this.organizationId = metadata?.organizationId;
    this.userOrganization = metadata?.userOrganization;
  }

  /**
   * Check if the user has a specific scope
   * For API key auth: checks API key scopes
   * For JWT/Basic auth with org context: checks organization-scoped role
   * For JWT/Basic auth without org context: falls back to user role
   */
  hasScope(resource: string, action: string): boolean {
    // For API key auth, check the API key scopes
    if (this.authMethod === "apikey") {
      if (!this.scopes || this.scopes.length === 0) {
        return true; // No scopes means full access
      }

      return this.scopes.some(
        (scope) =>
          (scope.resource === resource || scope.resource === "*") &&
          (scope.actions.includes(action) || scope.actions.includes("*")),
      );
    }

    // For JWT/Basic auth with organization context, use UserOrganization permissions
    if (this.userOrganization) {
      return this.userOrganization.hasScope(resource, action);
    }

    // Fallback to user-level permissions (legacy support)
    return this._user.hasScope(resource, action);
  }

  /**
   * Check if the user can access a specific resource
   */
  canAccess(resource: string, action: string = "read"): boolean {
    if (!this.isActive) {
      return false;
    }

    // If we have organization context, check if user is active in that org
    if (this.userOrganization && !this.userOrganization.isActive) {
      return false;
    }

    return this.hasScope(resource, action);
  }

  /**
   * Get the user's role in the current organization
   * Note: Use scope checks (hasScope) for permission validation, not role checks
   */
  getRole(): "owner" | "admin" | "member" | "viewer" | "contributor" | undefined {
    if (this.userOrganization) {
      return this.userOrganization.role;
    }

    // Fallback to user-level role (legacy support)
    return this._user.role;
  }

  /**
   * Check if user belongs to the specified organization
   */
  belongsToOrganization(organizationId: string): boolean {
    return this.organizationId === organizationId;
  }

  /**
   * Get the underlying User entity
   */
  getUser(): User {
    return this._user;
  }

  /**
   * Convert to JSON-safe object (removes sensitive data)
   */
  toJSON(): Omit<AuthUser, "_user" | "getUser" | "userOrganization"> & {
    role?: string;
    organizationId?: string;
  } {
    return {
      id: this.id,
      email: this.email,
      isActive: this.isActive,
      lastLoginAt: this.lastLoginAt,
      authMethod: this.authMethod,
      sessionId: this.sessionId,
      apiKeyId: this.apiKeyId,
      scopes: this.scopes,
      organizationId: this.organizationId,
      role: this.getRole(),
      hasScope: this.hasScope.bind(this),
      canAccess: this.canAccess.bind(this),
      getRole: this.getRole.bind(this),
      belongsToOrganization: this.belongsToOrganization.bind(this),
      toJSON: this.toJSON.bind(this),
    };
  }
}
