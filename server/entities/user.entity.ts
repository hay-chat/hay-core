import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('users')
@Index('idx_users_email', ['email'])
@Index('idx_users_is_active', ['isActive'])
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  password!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt?: Date;

  // Helper methods
  toJSON(): any {
    const { password, ...userWithoutPassword } = this;
    return userWithoutPassword;
  }

  hasScope(resource: string, action: string): boolean {
    // This will be used when checking API key scopes
    return true; // Default for normal users
  }

  canAccess(resource: string): boolean {
    return this.isActive;
  }
}

