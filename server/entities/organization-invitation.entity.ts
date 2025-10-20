import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import { Organization } from "./organization.entity";
import { User } from "./user.entity";

/**
 * OrganizationInvitation entity - Manages invitations to join organizations
 * Supports inviting both existing users and new users by email
 */
@Entity("organization_invitations")
@Index("idx_organization_invitations_email", ["email"])
@Index("idx_organization_invitations_organization", ["organizationId"])
@Index("idx_organization_invitations_status", ["status"])
@Index("idx_organization_invitations_token", ["tokenHash"])
@Index("idx_organization_invitations_invited_user", ["invitedUserId"])
export class OrganizationInvitation extends BaseEntity {
  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "uuid", nullable: true })
  invitedUserId?: string;

  @Column({ type: "uuid", nullable: true })
  invitedBy?: string;

  @Column({ type: "varchar", length: 50, default: "member" })
  role!: "owner" | "admin" | "member" | "viewer" | "contributor";

  @Column({ type: "jsonb", nullable: true })
  permissions?: string[];

  @Column({ type: "varchar", length: 255 })
  tokenHash!: string;

  @Column({ type: "varchar", length: 20, default: "pending" })
  status!: "pending" | "accepted" | "declined" | "expired" | "cancelled";

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  acceptedAt?: Date;

  @Column({ type: "text", nullable: true })
  message?: string;

  // Relationships
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn()
  invitedUser?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn()
  invitedByUser?: User;

  // Helper methods
  isExpired(): boolean {
    return this.expiresAt < new Date();
  }

  isPending(): boolean {
    return this.status === "pending" && !this.isExpired();
  }

  canAccept(): boolean {
    return this.isPending();
  }

  accept(): void {
    if (!this.canAccept()) {
      throw new Error("Invitation cannot be accepted");
    }
    this.status = "accepted";
    this.acceptedAt = new Date();
  }

  decline(): void {
    if (this.status !== "pending") {
      throw new Error("Only pending invitations can be declined");
    }
    this.status = "declined";
  }

  cancel(): void {
    if (this.status !== "pending") {
      throw new Error("Only pending invitations can be cancelled");
    }
    this.status = "cancelled";
  }

  markExpired(): void {
    if (this.status === "pending" && this.isExpired()) {
      this.status = "expired";
    }
  }

  toJSON(): any {
    return {
      id: this.id,
      organizationId: this.organizationId,
      email: this.email,
      invitedUserId: this.invitedUserId,
      invitedBy: this.invitedBy,
      role: this.role,
      permissions: this.permissions,
      status: this.status,
      expiresAt: this.expiresAt,
      acceptedAt: this.acceptedAt,
      message: this.message,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
