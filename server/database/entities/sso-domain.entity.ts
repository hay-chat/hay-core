import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";

/** An email domain an organization claims. It counts only once its DNS record has been seen. */
@Entity("sso_domains")
@Index("uq_sso_domains_organization_domain", ["organizationId", "domain"], { unique: true })
@Index("uq_sso_domains_verified_domain", ["domain"], {
  unique: true,
  where: '"verified_at" IS NOT NULL',
})
export class SsoDomain extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  /** Lowercase hostname. */
  @Column({ type: "varchar", length: 253 })
  domain!: string;

  @Column({ type: "varchar", length: 64 })
  verificationToken!: string;

  @Column({ type: "timestamptz", nullable: true })
  verifiedAt?: Date | null;
}
