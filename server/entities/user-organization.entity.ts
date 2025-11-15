import { Entity, Column, Index, ManyToOne, JoinColumn, Unique } from "typeorm";
import { BaseEntity } from "./base.entity";
import { User } from "./user.entity";
import { Organization } from "./organization.entity";
import {
  buildScope,
  getDefaultScopesForRole,
  hasRequiredScope,
  RESOURCES,
  ACTIONS,
  type Resource,
  type Action,
} from "../types/scopes";

/**
 * UserOrganization entity - Join table for many-to-many relationship between users and organizations
 * Stores role and permissions per organization for each user
 */
@Entity("user_organizations")
@Unique("uq_user_organizations_user_org", ["userId", "organizationId"])
@Index("idx_user_organizations_user", ["userId"])
@Index("idx_user_organizations_organization", ["organizationId"])
@Index("idx_user_organizations_role", ["role"])
@Index("idx_user_organizations_is_active", ["isActive"])
export class UserOrganization extends BaseEntity {
  @Column({ type: "uuid" })
  userId!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "varchar", length: 50, default: "member" })
  role!: "owner" | "admin" | "member" | "viewer" | "contributor";

  @Column({ type: "jsonb", nullable: true })
  permissions?: string[];

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  invitedAt?: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  invitedBy?: string;

  @Column({ type: "timestamptz", nullable: true })
  joinedAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastAccessedAt?: Date;

  // Relationships
  @ManyToOne(() => User, (user) => user.userOrganizations, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @ManyToOne(() => Organization, (organization) => organization.userOrganizations, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  // Helper methods

  /**
   * Check if user has permission for a specific resource and action
   * Uses scope-based permission system with role defaults and custom permissions
   */
  hasScope(resource: string, action: string): boolean {
    // Inactive users have no access
    if (!this.isActive) {
      return false;
    }

    // Get default scopes for the user's role
    const defaultScopes = getDefaultScopesForRole(this.role);

    // Combine default role scopes with custom permissions
    const allScopes = [
      ...defaultScopes,
      ...(this.permissions || []),
    ];

    // Check if any of the user's scopes match the required permission
    return hasRequiredScope(resource as Resource, action as Action, allScopes);
  }

  /**
   * Get all scopes for this user in the organization
   */
  getScopes(): string[] {
    const defaultScopes = getDefaultScopesForRole(this.role);
    return [
      ...defaultScopes,
      ...(this.permissions || []),
    ];
  }

  /**
   * Check if user can access a resource (basic read access)
   */
  canAccess(resource: string): boolean {
    return this.isActive && this.hasScope(resource, ACTIONS.READ);
  }

  /**
   * Update last accessed timestamp
   */
  updateLastAccessed(): void {
    this.lastAccessedAt = new Date();
  }

  toJSON(): any {
    return {
      id: this.id,
      userId: this.userId,
      organizationId: this.organizationId,
      role: this.role,
      permissions: this.permissions,
      isActive: this.isActive,
      invitedAt: this.invitedAt,
      joinedAt: this.joinedAt,
      lastAccessedAt: this.lastAccessedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
