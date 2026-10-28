import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type { BusinessHoursClosure, WeeklyInterval } from "@server/types/business-hours.types";

/**
 * When the team answers a channel (D5-6). An organization can have several:
 * each covers a list of channel ids ("web" or a channel plugin's manifest
 * `channel`); the one with no channels is the default for every channel that
 * has no schedule of its own. A channel with no schedule at all (and no
 * default) is treated as always within hours.
 *
 * Outside hours the AI keeps answering; only the human queue waits.
 */
@Entity("business_hours_schedules")
@Index("idx_business_hours_schedules_organization", ["organization_id"])
export class BusinessHoursSchedule {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  organization_id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  /** IANA zone the intervals and closures are written in. */
  @Column({ type: "varchar", length: 64 })
  timezone!: string;

  /** Channel ids this schedule covers; empty = the organization's default schedule. */
  @Column({ type: "text", array: true, default: () => "'{}'" })
  channels!: string[];

  /** Weekly opening intervals in local time. An end at or before the start runs past midnight. */
  @Column({ type: "jsonb", default: () => "'[]'" })
  weekly_hours!: WeeklyInterval[];

  /** Whole local days the team is closed (holidays, one-off closures). */
  @Column({ type: "jsonb", default: () => "'[]'" })
  closures!: BusinessHoursClosure[];

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
