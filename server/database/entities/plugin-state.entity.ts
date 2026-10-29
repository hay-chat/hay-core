import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * One key of a plugin worker's persisted state (H4), scoped to the
 * organization and the authenticated plugin id. `value` is encrypted JSON.
 */
@Entity("plugin_states")
export class PluginState {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "varchar", length: 255 })
  pluginId!: string;

  @Column({ type: "varchar", length: 255 })
  key!: string;

  @Column({ type: "text" })
  value!: string;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
