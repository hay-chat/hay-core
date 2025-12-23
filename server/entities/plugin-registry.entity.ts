import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import type { HayPluginManifest } from "../types/plugin.types";
import type { PluginMetadata, PluginMetadataState } from "../types/plugin-sdk-v2.types";
import { Organization } from "./organization.entity";
import { Upload } from "./upload.entity";
import { User } from "./user.entity";

export enum PluginStatus {
  AVAILABLE = "available",
  NOT_FOUND = "not_found",
  DISABLED = "disabled",
}

@Entity("plugin_registry")
@Index(["pluginId"], { unique: true })
@Index(["sourceType"])
@Index(["organizationId"])
@Index(["organizationId", "sourceType"])
@Index(["status"])
export class PluginRegistry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  pluginId!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 50 })
  version!: string;

  @Column({ type: "varchar", length: 255, nullable: false })
  pluginPath!: string;

  @Column({ type: "jsonb" })
  manifest!: HayPluginManifest;

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

  // SDK v2: Plugin-global metadata cache (from /metadata endpoint)
  @Column({ type: "jsonb", nullable: true })
  metadata?: PluginMetadata;

  @Column({ type: "timestamptz", nullable: true })
  metadataFetchedAt?: Date;

  // SDK v2: Plugin-global metadata state (not org-specific)
  @Column({
    type: "varchar",
    length: 50,
    default: "missing",
  })
  metadataState!: PluginMetadataState;

  @Column({ type: "varchar", length: 50, default: PluginStatus.AVAILABLE })
  status!: PluginStatus;

  // Custom plugin fields
  @Column({ type: "varchar", length: 50, default: "core" })
  sourceType!: "core" | "custom";

  @Column({ type: "uuid", nullable: true })
  organizationId?: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "organization_id" })
  organization?: Organization;

  @Column({ type: "varchar", length: 1000, nullable: true })
  zipFilePath?: string;

  @Column({ type: "uuid", nullable: true })
  zipUploadId?: string;

  @ManyToOne(() => Upload, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "zip_upload_id" })
  zipUpload?: Upload;

  @Column({ type: "uuid", nullable: true })
  uploadedById?: string;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "uploaded_by_id" })
  uploadedBy?: User;

  @Column({ type: "timestamptz", nullable: true })
  uploadedAt?: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
