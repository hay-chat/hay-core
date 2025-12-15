import { Entity, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { PluginRegistry } from "./plugin-registry.entity";
import { Organization } from "./organization.entity";
import type { AuthState, PluginInstanceRuntimeState } from "../types/plugin-sdk-v2.types";

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

  // SDK v2: Auth state (separate from config)
  @Column({ type: "jsonb", nullable: true })
  authState?: AuthState;

  @Column({ type: "timestamptz", nullable: true })
  authValidatedAt?: Date;

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

  // Legacy status field (kept for backwards compatibility)
  @Column({ type: "varchar", length: 50, default: "stopped" })
  status!: "stopped" | "starting" | "running" | "stopping" | "error";

  // SDK v2: Org-scoped runtime state (worker lifecycle per org+plugin)
  @Column({
    type: "varchar",
    length: 50,
    default: "stopped"
  })
  runtimeState!: PluginInstanceRuntimeState;

  @Column({ type: "timestamptz", nullable: true })
  lastActivityAt?: Date;

  @Column({ type: "integer", default: 0 })
  priority!: number;

  @Column({ type: "varchar", length: 50, nullable: true })
  authMethod?: "api_key" | "oauth";
}
