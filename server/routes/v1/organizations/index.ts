import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { organizationService } from "@server/services/organization.service";
import { TRPCError } from "@trpc/server";
import { SupportedLanguage } from "@server/types/language.types";
import { DateFormat, TimeFormat, Timezone } from "@server/types/organization-settings.types";

const updateSettingsSchema = z.object({
  defaultLanguage: z.nativeEnum(SupportedLanguage).optional(),
  dateFormat: z.nativeEnum(DateFormat).optional(),
  timeFormat: z.nativeEnum(TimeFormat).optional(),
  timezone: z.nativeEnum(Timezone).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  testModeDefault: z.boolean().optional(),
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
      defaultAgentId: organization.defaultAgentId,
      testModeDefault: organization.settings?.testModeDefault || false,
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

      // Extract testModeDefault from input as it goes into the settings JSONB field
      const { testModeDefault, ...topLevelFields } = input;

      // Prepare update payload
      const updatePayload: any = {
        ...topLevelFields,
      };

      // Handle testModeDefault in settings JSONB field
      if (testModeDefault !== undefined) {
        updatePayload.settings = {
          ...(organization.settings || {}),
          testModeDefault,
        };
      }

      const updatedOrg = await organizationService.update(ctx.organizationId!, updatePayload);

      return {
        success: true,
        message: "Settings updated successfully",
        data: {
          defaultLanguage: updatedOrg.defaultLanguage,
          dateFormat: updatedOrg.dateFormat,
          timeFormat: updatedOrg.timeFormat,
          timezone: updatedOrg.timezone,
          defaultAgentId: updatedOrg.defaultAgentId,
          testModeDefault: updatedOrg.settings?.testModeDefault || false,
        },
      };
    }),
});
