import { BaseEntity } from './base.entity';

export interface SessionEntity extends BaseEntity {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  lastActivity: Date;
  ipAddress?: string;
  userAgent?: string;
}

export class Session implements SessionEntity {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  lastActivity: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(data: SessionEntity) {
    this.id = data.id;
    this.userId = data.userId;
    this.refreshTokenHash = data.refreshTokenHash;
    this.expiresAt = data.expiresAt;
    this.lastActivity = data.lastActivity;
    this.ipAddress = data.ipAddress;
    this.userAgent = data.userAgent;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }
}