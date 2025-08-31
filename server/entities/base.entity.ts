import {
  BaseEntity as TypeOrmBaseEntity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
} from "typeorm";

// Base entity class with common fields
export abstract class BaseEntity extends TypeOrmBaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn({ type: "timestamptz", name: "createdAt" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz", name: "updatedAt" })
  updatedAt!: Date;

  @Column({ type: "varchar", nullable: true, name: "createdBy" })
  createdBy?: string;

  @Column({ type: "varchar", nullable: true, name: "updatedBy" })
  updatedBy?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;

  validateEntity(): void {
    // Implement validation logic here if needed
  }
}

export abstract class OrganizationScopedEntity extends BaseEntity {
  @Column({ type: "uuid", name: "organizationId" })
  organizationId!: string;
}
