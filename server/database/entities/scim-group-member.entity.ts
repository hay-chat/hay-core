import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { Organization } from "@server/entities/organization.entity";
import { User } from "@server/entities/user.entity";
import { ScimGroup } from "./scim-group.entity";

@Entity("scim_group_members")
@Index("uq_scim_group_members_group_user", ["groupId", "userId"], { unique: true })
@Index("idx_scim_group_members_organization_user", ["organizationId", "userId"])
export class ScimGroupMember extends OrganizationScopedEntity {
  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization?: Organization;

  @Column({ type: "uuid" })
  groupId!: string;

  @ManyToOne(() => ScimGroup, { onDelete: "CASCADE" })
  @JoinColumn()
  group?: ScimGroup;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  user?: User;
}
