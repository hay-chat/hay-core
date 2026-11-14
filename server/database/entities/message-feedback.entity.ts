import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Message } from "./message.entity";
import { Organization } from "../../entities/organization.entity";
import { User } from "../../entities/user.entity";
import { FeedbackRating, FeedbackSource } from "../../types/message-feedback.types";

@Entity("message_feedback")
// A visitor has one rating per AI answer: rating again replaces it.
@Index("uq_message_feedback_visitor_message", ["messageId"], {
  unique: true,
  where: `"source" = 'visitor'`,
})
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

  /** The team member who rated; null for visitor feedback. */
  @Column({ type: "uuid", nullable: true })
  reviewerId!: string | null;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: true })
  @JoinColumn()
  reviewer!: User | null;

  @Column({ type: "varchar", length: 16, default: FeedbackSource.OPERATOR })
  source!: FeedbackSource;

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
