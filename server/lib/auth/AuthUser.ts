import { User } from "@server/entities/user.entity";
import type { ApiKeyScope } from "@server/types/auth.types";

/**
 * AuthUser class represents an authenticated user in the tRPC context
 * This class wraps the User entity and adds authentication-specific methods
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
  public readonly organizationId?: string;

  private readonly _user: User;

  constructor(
    user: User,
    authMethod: "basic" | "jwt" | "apikey",
    metadata?: {
      sessionId?: string;
      apiKeyId?: string;
      scopes?: ApiKeyScope[];
      organizationId?: string;
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
  }

  /**
   * Check if the user has a specific scope for API key authentication
   */
  hasScope(resource: string, action: string): boolean {
    // For JWT and Basic auth, users have full access
    if (this.authMethod !== "apikey") {
      return true;
    }

    // For API key auth, check the scopes
    if (!this.scopes || this.scopes.length === 0) {
      return true; // No scopes means full access
    }

    return this.scopes.some(
      (scope) =>
        (scope.resource === resource || scope.resource === "*") &&
        (scope.actions.includes(action) || scope.actions.includes("*")),
    );
  }

  /**
   * Check if the user can access a specific resource
   */
  canAccess(resource: string, action: string = "read"): boolean {
    if (!this.isActive) {
      return false;
    }

    return this.hasScope(resource, action);
  }

  /**
   * Check if the user can perform administrative actions
   */
  isAdmin(): boolean {
    // For now, only JWT and Basic auth users can be admins
    // API key users cannot have admin privileges
    return this.authMethod !== "apikey" && this.isActive;
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
  toJSON(): Omit<AuthUser, "_user" | "getUser"> {
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
      hasScope: this.hasScope.bind(this),
      canAccess: this.canAccess.bind(this),
      isAdmin: this.isAdmin.bind(this),
      toJSON: this.toJSON.bind(this),
    };
  }
}
