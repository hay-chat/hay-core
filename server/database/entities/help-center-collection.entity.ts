import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "@server/entities/base.entity";
import { HelpCenter } from "./help-center.entity";

/** A group of articles on the help center: a card on the home page and a page of its own. */
@Entity("help_center_collections")
@Index("idx_help_center_collections_help_center_position", ["helpCenterId", "position"])
export class HelpCenterCollection extends OrganizationScopedEntity {
  @Column({ type: "uuid" })
  helpCenterId!: string;

  @ManyToOne(() => HelpCenter, { onDelete: "CASCADE" })
  @JoinColumn()
  helpCenter?: HelpCenter;

  @Column({ type: "varchar", length: 120 })
  title!: string;

  @Column({ type: "varchar", length: 300, nullable: true })
  description?: string | null;

  /** An emoji shown on the collection's card. */
  @Column({ type: "varchar", length: 16, nullable: true })
  icon?: string | null;

  @Column({ type: "int", default: 0 })
  position!: number;
}
