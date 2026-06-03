// DocumentSource — a per-org connection to a remote document source (Confluence, Notion, GDocs). Kept distinct from the messaging Source entity in server/entities/source.entity.ts to avoid namespace collision.

import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { OrganizationScopedEntity } from "./base.entity";
import { PluginInstance } from "./plugin-instance.entity";

export enum DocumentSourceSyncStatus {
  IDLE = "idle",
  RUNNING = "running",
  SUCCESS = "success",
  ERROR = "error",
  PARTIAL = "partial",
}

@Entity("document_sources")
@Index(["organizationId", "sourceType"])
@Index(["enabled"], { where: "enabled = true" })
export class DocumentSource extends OrganizationScopedEntity {
  @Column({ type: "varchar", length: 100 })
  pluginId!: string;

  @Column({ type: "uuid", nullable: true })
  pluginInstanceId?: string;

  @ManyToOne(() => PluginInstance, { onDelete: "CASCADE" })
  @JoinColumn()
  pluginInstance?: PluginInstance;

  @Column({ type: "varchar", length: 50 })
  sourceType!: string;

  @Column({ type: "varchar", length: 255 })
  displayName!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  externalRootId?: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  externalRootLabel?: string;

  @Column({ type: "jsonb", default: {} })
  config!: Record<string, unknown>;

  @Column({ type: "integer", nullable: true })
  syncIntervalMs?: number;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  lastSyncedAt?: Date;

  @Column({ type: "varchar", length: 1024, nullable: true })
  lastSyncCursor?: string;

  @Column({
    type: "enum",
    enum: DocumentSourceSyncStatus,
    default: DocumentSourceSyncStatus.IDLE,
  })
  lastSyncStatus!: DocumentSourceSyncStatus;

  @Column({ type: "text", nullable: true })
  lastSyncError?: string;

  @Column({ type: "jsonb", nullable: true })
  lastSyncStats?: {
    created?: number;
    updated?: number;
    deleted?: number;
    failed?: number;
  } | null;

  @Column({ type: "timestamptz", nullable: true })
  lastFullSweepAt?: Date;
}
