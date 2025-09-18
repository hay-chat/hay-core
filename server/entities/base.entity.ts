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

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @Column({ type: "varchar", nullable: true })
  createdBy?: string;

  @Column({ type: "varchar", nullable: true })
  updatedBy?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  validateEntity(): void {
    // Implement validation logic here if needed
  }
}

export abstract class OrganizationScopedEntity extends BaseEntity {
  @Column({ type: "uuid" })
  organizationId!: string;
}
