import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { UserOrganization } from "./user-organization.entity";
import { getDefaultScopesForRole, hasRequiredScope, type Resource, type Action } from "@server/types/scopes";

@Entity("users")
@Index("idx_users_email", ["email"])
@Index("idx_users_is_active", ["isActive"])
@Index("idx_users_organization", ["organizationId"])
@Index("idx_users_last_seen_at", ["lastSeenAt"])
export class User extends BaseEntity {
  @Column({ type: "varchar", length: 255, unique: true })
  email!: string;

  @Column({ type: "varchar", length: 255 })
  password!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  firstName?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  lastName?: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  avatarUrl?: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastSeenAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  deletedAt?: Date;

  @Column({ type: "varchar", length: 20, default: "available" })
  status!: "available" | "away";

  @Column({ type: "uuid", nullable: true })
  organizationId?: string;

  @Column({ type: "varchar", length: 50, default: "member" })
  role!: "owner" | "admin" | "member" | "viewer" | "contributor" | "agent";

  @Column({ type: "jsonb", nullable: true })
  permissions?: string[];

  // Email verification fields
  @Column({ type: "varchar", length: 255, nullable: true })
  pendingEmail?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  emailVerificationTokenHash?: string;

  @Column({ type: "timestamptz", nullable: true })
  emailVerificationExpiresAt?: Date;

  // Relationships
  @ManyToOne(() => Organization, (organization) => organization.users, {
    nullable: true,
  })
  @JoinColumn()
  organization?: Organization;

  // Many-to-many relationship with organizations (new multi-org support)
  @OneToMany(() => UserOrganization, (userOrg) => userOrg.user)
  userOrganizations!: UserOrganization[];

  // Helper methods
  toJSON(): any {
    const { password: _password, ...userWithoutPassword } = this;
    return userWithoutPassword;
  }

  /**
   * Check if user has a specific scope (legacy user-level permissions)
   * This is used as a fallback when there's no organization context
   * Uses the same scope matching system as UserOrganization
   */
  hasScope(resource: string, action: string): boolean {
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

    // Use the scope matching system to check permissions
    return hasRequiredScope(resource as Resource, action as Action, allScopes);
  }

  /**
   * Get all scopes for the user (legacy user-level permissions)
   * Combines role-based default scopes with custom permissions
   */
  getScopes(): string[] {
    const defaultScopes = getDefaultScopesForRole(this.role);
    return [
      ...defaultScopes,
      ...(this.permissions || []),
    ];
  }

  /**
   * Check if user can access a specific resource (legacy user-level check)
   * Validates user is active and has organization context
   */
  canAccess(resource: string, action: string = "read"): boolean {
    if (!this.isActive || !this.organizationId) {
      return false;
    }
    return this.hasScope(resource, action);
  }

  getFullName(): string {
    if (this.firstName && this.lastName) {
      return `${this.firstName} ${this.lastName}`;
    }
    return this.firstName || this.lastName || this.email;
  }

  /**
   * Check if user is currently online
   * User is online if: lastSeenAt < 120 seconds ago AND status = 'available'
   */
  isOnline(): boolean {
    if (!this.lastSeenAt || this.status !== "available") {
      return false;
    }
    const now = new Date();
    const timeDiff = now.getTime() - this.lastSeenAt.getTime();
    return timeDiff < 120000; // 120 seconds in milliseconds
  }

  /**
   * Update last seen timestamp to now
   */
  updateLastSeen(): void {
    this.lastSeenAt = new Date();
  }

  /**
   * Get user's online status
   * - 'online': lastSeenAt < 120 seconds AND status = 'available'
   * - 'away': status = 'away' (regardless of lastSeenAt)
   * - 'offline': lastSeenAt > 120 seconds
   */
  getOnlineStatus(): "online" | "away" | "offline" {
    if (this.status === "away") {
      return "away";
    }
    return this.isOnline() ? "online" : "offline";
  }

  /**
   * Check if user has a pending email change that can be verified
   */
  hasPendingEmailChange(): boolean {
    return (
      !!this.pendingEmail &&
      !!this.emailVerificationTokenHash &&
      !!this.emailVerificationExpiresAt &&
      this.emailVerificationExpiresAt > new Date()
    );
  }

  /**
   * Clear email verification fields
   */
  clearEmailVerification(): void {
    this.pendingEmail = null as any;
    this.emailVerificationTokenHash = null as any;
    this.emailVerificationExpiresAt = null as any;
  }

  /**
   * Check if user has been soft deleted
   */
  isDeleted(): boolean {
    return !!this.deletedAt;
  }

  /**
   * Soft delete the user
   */
  softDelete(): void {
    this.deletedAt = new Date();
    this.isActive = false;
  }
}
