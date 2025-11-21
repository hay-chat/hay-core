import { Entity, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { PluginRegistry } from "./plugin-registry.entity";
import { Organization } from "./organization.entity";

@Entity("plugin_instances")
@Index(["organizationId", "pluginId"], { unique: true })
export class PluginInstance extends OrganizationScopedEntity {
  @Column({ type: "uuid" })
  pluginId!: string;

  @ManyToOne(() => PluginRegistry)
  @JoinColumn()
  plugin!: PluginRegistry;

  @ManyToOne(() => Organization)
  @JoinColumn()
  organization!: Organization;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  @Column({ type: "jsonb", nullable: true })
  config?: Record<string, unknown>;

  @Column({ type: "boolean", default: false })
  running!: boolean;

  @Column({ type: "varchar", nullable: true })
  processId?: string;

  @Column({ type: "timestamptz", nullable: true })
  lastStartedAt?: Date;

  @Column({ type: "timestamptz", nullable: true })
  lastStoppedAt?: Date;

  @Column({ type: "text", nullable: true })
  lastError?: string;

  @Column({ type: "integer", default: 0 })
  restartCount!: number;

  @Column({ type: "timestamptz", nullable: true })
  lastHealthCheck?: Date;

  @Column({ type: "varchar", length: 50, default: "stopped" })
  status!: "stopped" | "starting" | "running" | "stopping" | "error";

  @Column({ type: "timestamptz", nullable: true })
  lastActivityAt?: Date;

  @Column({ type: "integer", default: 0 })
  priority!: number;

  @Column({ type: "varchar", length: 50, nullable: true })
  authMethod?: "api_key" | "oauth";
}
