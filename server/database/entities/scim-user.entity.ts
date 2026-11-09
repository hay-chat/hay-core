import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";
import { User } from "@server/entities/user.entity";

/** What the identity provider calls a person in one organization: its own id for them. */
@Entity("scim_users")
@Index("uq_scim_users_organization_user", ["organizationId", "userId"], { unique: true })
@Index("uq_scim_users_organization_external_id", ["organizationId", "externalId"], {
  unique: true,
  where: '"external_id" IS NOT NULL',
})
export class ScimUser extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;

  @Column({ type: "varchar", length: 255, nullable: true })
  externalId?: string | null;
}
