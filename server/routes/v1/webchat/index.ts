import { router, scopedProcedure, publicProcedure } from "@server/trpc";
import { z } from "zod";
import { webchatSettingsService } from "@server/services/webchat/webchat-settings.service";
import { WebchatPosition, WebchatTheme } from "@server/database/entities/webchat-settings.entity";

export const webchatRouter = router({
  /**
   * Get webchat settings for the current organization
   */
  getSettings: scopedProcedure("webchat", "read").query(async ({ ctx }) => {
    return await webchatSettingsService.getSettings(ctx.organizationId!);
  }),

  /**
   * Update webchat settings
   */
  updateSettings: scopedProcedure("webchat", "write")
    .input(
      z.object({
        widgetTitle: z.string().min(1).max(100).optional(),
        widgetSubtitle: z.string().max(200).nullable().optional(),
        position: z.nativeEnum(WebchatPosition).optional(),
        theme: z.nativeEnum(WebchatTheme).optional(),
        showGreeting: z.boolean().optional(),
        greetingMessage: z.string().nullable().optional(),
        allowedDomains: z.array(z.string()).optional(),
        isEnabled: z.boolean().optional(),
        customCss: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await webchatSettingsService.updateSettings(ctx.organizationId!, input);
    }),

  /**
   * Get public configuration for the widget (no auth required)
   * Used by the widget to fetch configuration on load
   */
  getPublicConfig: publicProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      // Check if webchat is enabled
      const isEnabled = await webchatSettingsService.isEnabled(input.organizationId);

      if (!isEnabled) {
        throw new Error("Webchat is disabled for this organization");
      }

      return await webchatSettingsService.getPublicConfig(input.organizationId);
    }),
});
