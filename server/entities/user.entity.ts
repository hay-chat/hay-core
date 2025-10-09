import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { Organization } from "./organization.entity";

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

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastSeenAt?: Date;

  @Column({ type: "varchar", length: 20, default: "available" })
  status!: "available" | "away";

  @Column({ type: "uuid", nullable: true })
  organizationId?: string;

  @Column({ type: "varchar", length: 50, default: "member" })
  role!: "owner" | "admin" | "member" | "viewer";

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

  // Helper methods
  toJSON(): any {
    const { password: _password, ...userWithoutPassword } = this;
    return userWithoutPassword;
  }

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

    if (this.role === "viewer") {
      return action === "read";
    }

    return false;
  }

  canAccess(_resource: string): boolean {
    return this.isActive && !!this.organizationId;
  }

  isOrganizationOwner(): boolean {
    return this.role === "owner";
  }

  isOrganizationAdmin(): boolean {
    return this.role === "owner" || this.role === "admin";
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
    this.pendingEmail = undefined;
    this.emailVerificationTokenHash = undefined;
    this.emailVerificationExpiresAt = undefined;
  }
}
