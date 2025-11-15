import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import type { ApiKeyScope } from "../types/auth.types";
import { Organization } from "./organization.entity";

@Entity("api_keys")
@Index("idx_api_keys_organization_id", ["organizationId"])
@Index("idx_api_keys_key_hash", ["keyHash"])
@Index("idx_api_keys_is_active", ["isActive"])
export class ApiKey extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, (organization) => organization.apiKeys)
  @JoinColumn()
  organization!: Organization;

  @Column({ type: "varchar", length: 255 })
  keyHash!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "timestamptz", nullable: true })
  lastUsedAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt?: Date;

  @Column({ type: "jsonb", default: [] })
  scopes!: ApiKeyScope[];

  @Column({ type: "boolean", default: true })
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
        (scope.actions.includes(action) || scope.actions.includes("*")),
    );
  }
}
