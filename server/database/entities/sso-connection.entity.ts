import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";

/** Roles an identity provider can hand out. Owner is only ever assigned by a person. */
export const SSO_ASSIGNABLE_ROLES = ["admin", "member", "viewer", "contributor", "agent"] as const;
export type SsoAssignableRole = (typeof SSO_ASSIGNABLE_ROLES)[number];

export const SSO_PROTOCOLS = ["oidc", "saml"] as const;
export type SsoProtocol = (typeof SSO_PROTOCOLS)[number];

/** An organization's identity provider, OpenID Connect or SAML. One per organization. */
@Entity("sso_connections")
@Index("uq_sso_connections_organization", ["organizationId"], { unique: true })
export class SsoConnection extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  @Column({ type: "varchar", length: 10, default: "oidc" })
  protocol!: SsoProtocol;

  /** OIDC: exact `iss` the provider issues, without a trailing slash. SAML: the provider's entity ID. */
  @Column({ type: "varchar", length: 512 })
  issuer!: string;

  /** OIDC only. */
  @Column({ type: "varchar", length: 255, nullable: true })
  clientId?: string | null;

  /** OIDC only. Encrypted with encryptValue; never returned to the dashboard. */
  @Column({ type: "text", nullable: true })
  clientSecret?: string | null;

  /** SAML only: the provider's single sign-on URL (HTTP-Redirect binding). */
  @Column({ type: "varchar", length: 1024, nullable: true })
  samlEntryPoint?: string | null;

  /** SAML only: PEM certificate(s) the provider signs assertions with. Public, so stored as is. */
  @Column({ type: "text", nullable: true })
  samlCertificate?: string | null;

  /** Role of a newly provisioned member when no mapping applies. */
  @Column({ type: "varchar", length: 50, default: "member" })
  defaultRole!: SsoAssignableRole;

  /** Name of the ID token claim (OIDC) or assertion attribute (SAML) holding groups or roles; empty means the default role always applies. */
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
