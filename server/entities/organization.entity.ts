import { Entity, Column, Index, OneToMany, ManyToOne, JoinColumn, OneToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { User } from "./user.entity";
import { UserOrganization } from "./user-organization.entity";
import { Document } from "./document.entity";
import { ApiKey } from "./apikey.entity";
import { Job } from "./job.entity";
import { Agent } from "../database/entities/agent.entity";
import { Upload } from "./upload.entity";
import { SupportedLanguage, DEFAULT_LANGUAGE } from "../types/language.types";
import {
  DateFormat,
  TimeFormat,
  Timezone,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIMEZONE,
  type OrganizationSettings,
} from "../types/organization-settings.types";

@Entity("organizations")
@Index("idx_organizations_slug", ["slug"])
@Index("idx_organizations_is_active", ["isActive"])
export class Organization extends BaseEntity {
  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 255, unique: true })
  slug!: string;

  @Column({ type: "varchar", length: 500, nullable: true })
  description?: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  website?: string;

  // Logo upload relationship
  @OneToOne(() => Upload, { nullable: true, eager: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "logo_upload_id" })
  logoUpload?: Upload;

  @Column({ type: "uuid", nullable: true })
  logoUploadId?: string;

  @Column({ type: "jsonb", nullable: true })
  settings?: OrganizationSettings;

  @Column({ type: "jsonb", nullable: true })
  limits?: {
    maxUsers?: number;
    maxDocuments?: number;
    maxApiKeys?: number;
    maxJobs?: number;
    maxStorageGb?: number;
  };

  @Column({ type: "varchar", length: 255, nullable: true })
  contactEmail?: string;

  @Column({
    type: "enum",
    enum: SupportedLanguage,
    default: DEFAULT_LANGUAGE,
  })
  defaultLanguage!: SupportedLanguage;

  @Column({
    type: "enum",
    enum: DateFormat,
    default: DEFAULT_DATE_FORMAT,
  })
  dateFormat!: DateFormat;

  @Column({
    type: "enum",
    enum: TimeFormat,
    default: DEFAULT_TIME_FORMAT,
  })
  timeFormat!: TimeFormat;

  @Column({
    type: "enum",
    enum: Timezone,
    default: DEFAULT_TIMEZONE,
  })
  timezone!: Timezone;

  @Column({ type: "uuid", nullable: true })
  defaultAgentId?: string | null;

  // Relationships
  @ManyToOne(() => Agent, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "default_agent_id" })
  defaultAgent?: Agent | null;

  @OneToMany(() => User, (user) => user.organization)
  users!: User[];

  // Many-to-many relationship with users (new multi-org support)
  @OneToMany(() => UserOrganization, (userOrg) => userOrg.organization)
  userOrganizations!: UserOrganization[];

  @OneToMany(() => Document, (document) => document.organization)
  documents!: Document[];

  @OneToMany(() => ApiKey, (apiKey) => apiKey.organization)
  apiKeys!: ApiKey[];

  @OneToMany(() => Job, (job) => job.organization)
  jobs!: Job[];

  // Helper methods
  canAddUser(currentUserCount: number): boolean {
    if (!this.limits?.maxUsers) return true;
    return currentUserCount < this.limits.maxUsers;
  }

  canAddDocument(currentDocumentCount: number): boolean {
    if (!this.limits?.maxDocuments) return true;
    return currentDocumentCount < this.limits.maxDocuments;
  }

  canAddApiKey(currentApiKeyCount: number): boolean {
    if (!this.limits?.maxApiKeys) return true;
    return currentApiKeyCount < this.limits.maxApiKeys;
  }

  hasOnlineUsers(): boolean {
    if (!this.users || this.users.length === 0) return false;
    return this.users.some((user) => user.isOnline());
  }

  toJSON(): any {
    const {
      users: _users,
      documents: _documents,
      apiKeys: _apiKeys,
      jobs: _jobs,
      ...organizationData
    } = this;
    return organizationData;
  }
}
