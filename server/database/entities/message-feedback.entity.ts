import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Message } from "./message.entity";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { FeedbackRating } from "../../types/message-feedback.types";

@Entity("message_feedback")
export class MessageFeedback {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  messageId!: string;

  @ManyToOne(() => Message, { onDelete: "CASCADE" })
  @JoinColumn()
  message!: Message;

  @Column({ type: "uuid" })
  organizationId!: string;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn()
  organization!: Organization;

  @Column({ type: "uuid" })
  reviewerId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn()
  reviewer!: User;

  @Column({
    type: "enum",
    enum: FeedbackRating,
  })
  rating!: FeedbackRating;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
