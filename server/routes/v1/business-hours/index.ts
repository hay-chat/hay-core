import { t, scopedProcedure } from "@server/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AppDataSource } from "@server/database/data-source";
import { BusinessHoursSchedule } from "@server/database/entities/business-hours-schedule.entity";
import { RESOURCES, ACTIONS } from "@server/types/scopes";
import { scheduleInputSchema, type ScheduleInput } from "@server/types/business-hours.types";
import { getAvailability } from "@server/services/business-hours.service";

/**
 * Business-hours schedules (D5-6): one per channel or the organization default
 * (no channels). A channel may belong to at most one schedule, and there is at
 * most one default.
 */

function repository() {
  return AppDataSource.getRepository(BusinessHoursSchedule);
}

function toDto(row: BusinessHoursSchedule) {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    channels: row.channels,
    weeklyHours: row.weekly_hours,
    closures: row.closures,
  };
}

async function assertNoOverlap(
  organizationId: string,
  input: ScheduleInput,
  excludeId?: string,
): Promise<void> {
  const others = (await repository().find({ where: { organization_id: organizationId } })).filter(
    (row) => row.id !== excludeId,
  );
  if (input.channels.length === 0 && others.some((row) => row.channels.length === 0)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "There is already a default schedule. Pick the channels this one covers.",
    });
  }
  const taken = input.channels.filter((channel) =>
    others.some((row) => row.channels.includes(channel)),
  );
  if (taken.length) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `These channels already have a schedule: ${taken.join(", ")}`,
    });
  }
}

function toColumns(input: ScheduleInput) {
  return {
    name: input.name,
    timezone: input.timezone,
    channels: [...new Set(input.channels)],
    weekly_hours: input.weeklyHours,
    closures: input.closures.map((c) => ({
      date: c.date,
      endDate: c.endDate || null,
      label: c.label?.trim() || null,
    })),
  };
}

export const businessHoursRouter = t.router({
  list: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ).query(async ({ ctx }) => {
    const rows = await repository().find({
      where: { organization_id: ctx.organizationId! },
      order: { created_at: "ASC" },
    });
    return rows.map(toDto);
  }),

  create: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(scheduleInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertNoOverlap(ctx.organizationId!, input);
      const row = await repository().save(
        repository().create({ organization_id: ctx.organizationId!, ...toColumns(input) }),
      );
      return toDto(row);
    }),

  update: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(scheduleInputSchema.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const row = await repository().findOne({
        where: { id, organization_id: ctx.organizationId! },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
      await assertNoOverlap(ctx.organizationId!, rest, id);
      Object.assign(row, toColumns(rest));
      return toDto(await repository().save(row));
    }),

  delete: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.UPDATE)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await repository().delete({
        id: input.id,
        organization_id: ctx.organizationId!,
      });
      return { deleted: (result.affected ?? 0) > 0 };
    }),

  /** What a shopper on this channel would see right now (preview on the settings page). */
  availability: scopedProcedure(RESOURCES.ORGANIZATION_SETTINGS, ACTIONS.READ)
    .input(z.object({ channel: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const availability = await getAvailability({
        organizationId: ctx.organizationId!,
        channel: input.channel,
      });
      return { ...availability, nextOpening: availability.nextOpening?.toISOString() ?? null };
    }),
});
