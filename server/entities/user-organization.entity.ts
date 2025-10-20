import { Entity, Column, Index, ManyToOne, JoinColumn, Unique } from "typeorm";
import { BaseEntity } from "./base.entity";
import { User } from "./user.entity";
import { Organization } from "./organization.entity";

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
  @JoinColumn()
  user!: User;

  @ManyToOne(() => Organization, (organization) => organization.userOrganizations, {
    onDelete: "CASCADE",
  })
  @JoinColumn()
  organization!: Organization;

  // Helper methods
  hasScope(resource: string, action: string): boolean {
    // Check role-based permissions
    if (this.role === "owner" || this.role === "admin") {
      return true;
    }

    // Check specific permissions
    if (this.permissions && this.permissions.length > 0) {
      return this.permissions.includes(`${resource}:${action}`);
    }

    // Default permissions based on role
    if (this.role === "member") {
      return ["read", "create", "update"].includes(action);
    }

    if (this.role === "contributor") {
      // Contributors can create/edit drafts but not publish
      return ["read", "create", "update"].includes(action);
    }

    if (this.role === "viewer") {
      return action === "read";
    }

    return false;
  }

  canAccess(resource: string): boolean {
    return this.isActive;
  }

  isOwner(): boolean {
    return this.role === "owner";
  }

  isAdmin(): boolean {
    return this.role === "owner" || this.role === "admin";
  }

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
