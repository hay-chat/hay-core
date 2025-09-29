import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { organizationService } from "@server/services/organization.service";
import { TRPCError } from "@trpc/server";
import { SupportedLanguage } from "@server/types/language.types";
import {
  DateFormat,
  TimeFormat,
  Timezone,
} from "@server/types/organization-settings.types";

const updateSettingsSchema = z.object({
  defaultLanguage: z.nativeEnum(SupportedLanguage).optional(),
  dateFormat: z.nativeEnum(DateFormat).optional(),
  timeFormat: z.nativeEnum(TimeFormat).optional(),
  timezone: z.nativeEnum(Timezone).optional(),
});

export const organizationsRouter = t.router({
  getSettings: authenticatedProcedure.query(async ({ ctx }) => {
    const organization = await organizationService.findOne(ctx.organizationId!);

    if (!organization) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found",
      });
    }

    return {
      defaultLanguage: organization.defaultLanguage,
      dateFormat: organization.dateFormat,
      timeFormat: organization.timeFormat,
      timezone: organization.timezone,
    };
  }),

  updateSettings: authenticatedProcedure
    .input(updateSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const organization = await organizationService.findOne(ctx.organizationId!);

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const updatedOrg = await organizationService.update(ctx.organizationId!, {
        ...input,
      });

      return {
        success: true,
        message: "Settings updated successfully",
        data: {
          defaultLanguage: updatedOrg.defaultLanguage,
          dateFormat: updatedOrg.dateFormat,
          timeFormat: updatedOrg.timeFormat,
          timezone: updatedOrg.timezone,
        },
      };
    }),
});