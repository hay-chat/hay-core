import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";

/**
 * The bearer token an identity provider uses to provision people into one
 * organization over SCIM. One per organization; creating another replaces it.
 * Only a hash is stored: the token is shown once, when it is created.
 */
@Entity("scim_tokens")
@Index("uq_scim_tokens_organization", ["organizationId"], { unique: true })
@Index("uq_scim_tokens_token_hash", ["tokenHash"], { unique: true })
export class ScimToken extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  /** sha256 of the token. The token is 256 random bits, so a fast hash is enough. */
  @Column({ type: "varchar", length: 64 })
  tokenHash!: string;

  /** First characters of the token, so an owner can tell tokens apart. */
  @Column({ type: "varchar", length: 16 })
  tokenPrefix!: string;

  @Column({ type: "timestamptz", nullable: true })
  lastUsedAt?: Date | null;
}
