import { t, authenticatedProcedure } from "@server/trpc";
import { z } from "zod";
import { organizationService } from "@server/services/organization.service";
import { TRPCError } from "@trpc/server";
import { SupportedLanguage } from "@server/types/language.types";
import {
  DateFormat,
  TimeFormat,
  Timezone,
  DEFAULT_CONFIDENCE_GUARDRAIL_CONFIG,
} from "@server/types/organization-settings.types";

const confidenceGuardrailSchema = z.object({
  highThreshold: z.number().min(0).max(1).optional(),
  mediumThreshold: z.number().min(0).max(1).optional(),
  enableRecheck: z.boolean().optional(),
  enableEscalation: z.boolean().optional(),
  fallbackMessage: z.string().optional(),
  recheckConfig: z
    .object({
      maxDocuments: z.number().int().min(1).max(50).optional(),
      similarityThreshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

const updateSettingsSchema = z.object({
  defaultLanguage: z.nativeEnum(SupportedLanguage).optional(),
  dateFormat: z.nativeEnum(DateFormat).optional(),
  timeFormat: z.nativeEnum(TimeFormat).optional(),
  timezone: z.nativeEnum(Timezone).optional(),
  defaultAgentId: z.string().uuid().nullable().optional(),
  testModeDefault: z.boolean().optional(),
  confidenceGuardrail: confidenceGuardrailSchema.optional(),
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

    // Merge confidence guardrail settings with defaults
    const confidenceGuardrail = organization.settings?.confidenceGuardrail
      ? {
          ...DEFAULT_CONFIDENCE_GUARDRAIL_CONFIG,
          ...organization.settings.confidenceGuardrail,
          // Explicitly ensure boolean values default to true if null/undefined
          enableRecheck:
            organization.settings.confidenceGuardrail.enableRecheck ?? true,
          enableEscalation:
            organization.settings.confidenceGuardrail.enableEscalation ?? true,
        }
      : DEFAULT_CONFIDENCE_GUARDRAIL_CONFIG;

    return {
      defaultLanguage: organization.defaultLanguage,
      dateFormat: organization.dateFormat,
      timeFormat: organization.timeFormat,
      timezone: organization.timezone,
      defaultAgentId: organization.defaultAgentId,
      testModeDefault: organization.settings?.testModeDefault || false,
      confidenceGuardrail,
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

      // Extract settings fields from input as they go into the settings JSONB field
      const { testModeDefault, confidenceGuardrail, ...topLevelFields } = input;

      // Prepare update payload
      const updatePayload: any = {
        ...topLevelFields,
      };

      // Handle settings JSONB field updates
      if (testModeDefault !== undefined || confidenceGuardrail !== undefined) {
        updatePayload.settings = {
          ...(organization.settings || {}),
        };

        if (testModeDefault !== undefined) {
          updatePayload.settings.testModeDefault = testModeDefault;
        }

        if (confidenceGuardrail !== undefined) {
          updatePayload.settings.confidenceGuardrail = {
            ...(organization.settings?.confidenceGuardrail || {}),
            ...confidenceGuardrail,
          };
        }
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
          confidenceGuardrail: updatedOrg.settings?.confidenceGuardrail,
        },
      };
    }),
});
