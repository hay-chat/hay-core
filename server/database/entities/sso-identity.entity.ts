import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";
import { User } from "@server/entities/user.entity";

/** Links a provider's stable subject id to a Hay user, so a changed email cannot redirect a login. */
@Entity("sso_identities")
@Index("uq_sso_identities_subject", ["organizationId", "issuer", "subject"], { unique: true })
@Index("uq_sso_identities_user", ["organizationId", "userId"], { unique: true })
@Index("idx_sso_identities_user_id", ["userId"])
export class SsoIdentity extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  @Column({ type: "varchar", length: 512 })
  issuer!: string;

  @Column({ type: "varchar", length: 255 })
  subject!: string;

  @Column({ type: "timestamptz", nullable: true })
  lastLoginAt?: Date | null;
}
