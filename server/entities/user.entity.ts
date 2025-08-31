import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { Organization } from "./organization.entity";

@Entity("users")
@Index("idx_users_email", ["email"])
@Index("idx_users_is_active", ["isActive"])
@Index("idx_users_organization", ["organizationId"])
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

  @Column({ type: "uuid", nullable: true })
  organizationId?: string;

  @Column({ type: "varchar", length: 50, default: "member" })
  role!: "owner" | "admin" | "member" | "viewer";

  @Column({ type: "jsonb", nullable: true })
  permissions?: string[];

  // Relationships
  @ManyToOne(() => Organization, (organization) => organization.users, {
    nullable: true,
  })
  @JoinColumn()
  organization?: Organization;

  // Helper methods
  toJSON(): any {
    const { password, ...userWithoutPassword } = this;
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

  canAccess(resource: string): boolean {
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
}
