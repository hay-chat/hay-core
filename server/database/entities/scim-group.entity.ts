import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";

/**
 * A group the identity provider pushes. Its name is looked up in the
 * organization's role mapping to decide the role of its members.
 */
@Entity("scim_groups")
@Index("uq_scim_groups_organization_display_name", ["organizationId", "displayName"], {
  unique: true,
})
@Index("uq_scim_groups_organization_external_id", ["organizationId", "externalId"], {
  unique: true,
  where: '"external_id" IS NOT NULL',
})
export class ScimGroup extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  @Column({ type: "varchar", length: 255 })
  displayName!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  externalId?: string | null;
}
