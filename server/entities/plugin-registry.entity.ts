import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("plugin_registry")
@Index(["pluginId"], { unique: true })
export class PluginRegistry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  pluginId!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 50 })
  version!: string;

  @Column({ type: "jsonb" })
  manifest!: Record<string, any>;

  @Column({ type: "boolean", default: false })
  installed!: boolean;

  @Column({ type: "boolean", default: false })
  built!: boolean;

  @Column({ type: "text", nullable: true })
  lastInstallError?: string;

  @Column({ type: "text", nullable: true })
  lastBuildError?: string;

  @Column({ type: "timestamptz", nullable: true })
  installedAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  builtAt?: Date;

  @Column({ type: "varchar", length: 64, nullable: true })
  checksum?: string;

  @Column({ type: "integer", default: 10 })
  maxConcurrentInstances!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}