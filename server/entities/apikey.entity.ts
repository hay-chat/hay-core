import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity } from "./base.entity";
import type { ApiKeyScope } from "../types/auth.types";
import { User } from "./user.entity";
import { Organization } from "./organization.entity";

@Entity("api_keys")
@Index("idx_api_keys_user_id", ["userId"])
@Index("idx_api_keys_key_hash", ["keyHash"])
@Index("idx_api_keys_is_active", ["isActive"])
@Index("idx_api_keys_organization", ["organizationId"])
export class ApiKey extends BaseEntity {
  @Column({ type: "uuid", name: "user_id" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "uuid", nullable: true, name: "organization_id" })
  organizationId?: string;

  @ManyToOne(() => Organization, (organization) => organization.apiKeys, {
    nullable: true,
  })
  @JoinColumn({ name: "organization_id" })
  organization?: Organization;

  @Column({ type: "varchar", length: 255, name: "key_hash" })
  keyHash!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "timestamptz", nullable: true, name: "last_used_at" })
  lastUsedAt?: Date;

  @Column({ type: "timestamptz", nullable: true, name: "expires_at" })
  expiresAt?: Date;

  @Column({ type: "jsonb", default: [] })
  scopes!: ApiKeyScope[];

  @Column({ type: "boolean", default: true, name: "is_active" })
  isActive!: boolean;

  isExpired(): boolean {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
  }

  hasScope(resource: string, action: string): boolean {
    if (!this.scopes || this.scopes.length === 0) return true;

    return this.scopes.some(
      (scope) =>
        scope.resource === resource &&
        (scope.actions.includes(action) || scope.actions.includes("*"))
    );
  }
}
