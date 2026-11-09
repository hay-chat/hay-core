import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";

/** Roles an identity provider can hand out. Owner is only ever assigned by a person. */
export const SSO_ASSIGNABLE_ROLES = ["admin", "member", "viewer", "contributor", "agent"] as const;
export type SsoAssignableRole = (typeof SSO_ASSIGNABLE_ROLES)[number];

/** An organization's OpenID Connect identity provider. One per organization. */
@Entity("sso_connections")
@Index("uq_sso_connections_organization", ["organizationId"], { unique: true })
export class SsoConnection extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  /** Exact `iss` the provider issues, without a trailing slash. */
  @Column({ type: "varchar", length: 512 })
  issuer!: string;

  @Column({ type: "varchar", length: 255 })
  clientId!: string;

  /** Encrypted with encryptValue; never returned to the dashboard. */
  @Column({ type: "text" })
  clientSecret!: string;

  /** Role of a newly provisioned member when no mapping applies. */
  @Column({ type: "varchar", length: 50, default: "member" })
  defaultRole!: SsoAssignableRole;

  /** Name of the ID token claim holding groups or roles; empty means the default role always applies. */
  @Column({ type: "varchar", length: 100, nullable: true })
  roleClaim?: string | null;

  /** Claim value to role. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  roleMapping!: Record<string, SsoAssignableRole>;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  /** Last successful sign-in through this configuration; enforcing SSO needs one. */
  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date | null;
}
