import { Entity, Column, Index, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Document } from './document.entity';
import { ApiKey } from './apikey.entity';
import { Job } from './job.entity';

@Entity('organizations')
@Index('idx_organizations_slug', ['slug'])
@Index('idx_organizations_is_active', ['isActive'])
export class Organization extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  logo?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string;

  @Column({ type: 'jsonb', nullable: true })
  settings?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  limits?: {
    maxUsers?: number;
    maxDocuments?: number;
    maxApiKeys?: number;
    maxJobs?: number;
    maxStorageGb?: number;
  };

  @Column({ type: 'varchar', length: 50, default: 'free' })
  plan!: 'free' | 'starter' | 'professional' | 'enterprise';

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  billingEmail?: string;

  // Relationships
  @OneToMany(() => User, (user) => user.organization)
  users!: User[];

  @OneToMany(() => Document, (document) => document.organization)
  documents!: Document[];

  @OneToMany(() => ApiKey, (apiKey) => apiKey.organization)
  apiKeys!: ApiKey[];

  @OneToMany(() => Job, (job) => job.organization)
  jobs!: Job[];

  // Helper methods
  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

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

  isTrialExpired(): boolean {
    if (!this.trialEndsAt) return false;
    return new Date() > this.trialEndsAt;
  }

  toJSON(): any {
    const { users, documents, apiKeys, jobs, ...organizationData } = this;
    return organizationData;
  }
}