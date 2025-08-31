import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index
} from "typeorm";
import { Organization } from "../../entities/organization.entity";
import { Conversation } from "./conversation.entity";

@Entity("customers")
@Index(["organization_id", "external_id"], { unique: true })
@Index(["organization_id", "email"])
export class Customer {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  external_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  email!: string | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  phone!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  name!: string | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "jsonb", nullable: true })
  external_metadata!: Record<string, any> | null;

  @Column({ type: "uuid" })
  organization_id!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @OneToMany(() => Conversation, conversation => conversation.customer)
  conversations!: Conversation[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}